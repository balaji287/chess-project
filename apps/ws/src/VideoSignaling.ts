import type { Game } from './Game';
import {
  VIDEO_CALL_ACCEPT,
  VIDEO_CALL_END,
  VIDEO_CALL_REJECT,
  VIDEO_CALL_REQUEST,
  VIDEO_ICE_CANDIDATE,
  VIDEO_PEER_LEFT,
  VIDEO_SIGNAL_ERROR,
} from './messages';
import { socketManager, User } from './SocketManager';

/**
 * WebRTC signaling relay for the video-call feature.
 *
 * The server only forwards small signaling messages (SDP offer/answer, ICE
 * candidates, call control) between the two players of one game. Audio/video
 * flows peer-to-peer and never reaches this server.
 *
 * Security rules enforced here:
 *  - the sender must be player 1 or player 2 of the referenced game
 *    (spectators in the same room are rejected);
 *  - the sender's own socket must have joined that game's room;
 *  - the recipient is ALWAYS computed by the server (the other player);
 *  - `from`/`to` are stamped by the server, and only whitelisted fields of the
 *    client payload are copied, so a client cannot spoof or smuggle fields.
 */

const RELAYED_TYPES = new Set<string>([
  VIDEO_CALL_REQUEST,
  VIDEO_CALL_ACCEPT,
  VIDEO_CALL_REJECT,
  VIDEO_ICE_CANDIDATE,
  VIDEO_CALL_END,
]);

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_ICE_CANDIDATE_LENGTH = 2000;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MESSAGES = 200;

const REJECT_REASONS = ['declined', 'busy', 'media_error', 'timeout'];
const END_REASONS = ['hangup', 'timeout', 'failed'];

const rateBuckets = new WeakMap<User, { start: number; count: number }>();

export const isVideoSignalType = (type: unknown): boolean => typeof type === 'string' && RELAYED_TYPES.has(type);

function isWithinRateLimit(user: User): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(user);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    rateBuckets.set(user, { start: now, count: 1 });
    return true;
  }
  bucket.count++;
  return bucket.count <= RATE_MAX_MESSAGES;
}

function getOpponentId(game: Game, userId: string): string | null {
  if (userId === game.player1UserId) return game.player2UserId;
  if (userId === game.player2UserId) return game.player1UserId;
  return null;
}

function replyError(user: User, code: string, gameId?: string) {
  if (user.socket.readyState !== user.socket.OPEN) return;
  user.socket.send(JSON.stringify({ type: VIDEO_SIGNAL_ERROR, payload: { gameId, code } }));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Copies only the fields we expect for each message type; null if invalid. */
function buildRelayedPayload(type: string, payload: Record<string, unknown>): Record<string, unknown> | null {
  switch (type) {
    case VIDEO_CALL_REQUEST:
    case VIDEO_CALL_ACCEPT: {
      const expected = type === VIDEO_CALL_REQUEST ? 'offer' : 'answer';
      const sdp = payload.sdp;
      if (!isObject(sdp) || sdp.type !== expected) return null;
      if (!isString(sdp.sdp) || sdp.sdp.length === 0) return null;
      return { sdp: { type: expected, sdp: sdp.sdp } };
    }
    case VIDEO_ICE_CANDIDATE: {
      const c = payload.candidate;
      if (!isObject(c) || !isString(c.candidate)) return null;
      if (c.candidate.length > MAX_ICE_CANDIDATE_LENGTH) return null;
      return {
        candidate: {
          candidate: c.candidate,
          sdpMid: isString(c.sdpMid) ? c.sdpMid : null,
          sdpMLineIndex: typeof c.sdpMLineIndex === 'number' ? c.sdpMLineIndex : null,
          usernameFragment: isString(c.usernameFragment) ? c.usernameFragment : null,
        },
      };
    }
    case VIDEO_CALL_REJECT:
      return {
        reason: REJECT_REASONS.includes(payload.reason as string) ? payload.reason : 'declined',
      };
    case VIDEO_CALL_END:
      return {
        reason: END_REASONS.includes(payload.reason as string) ? payload.reason : 'hangup',
      };
    default:
      return null;
  }
}

export function handleVideoSignal(
  user: User,
  message: { type: string; payload?: Record<string, unknown> },
  games: Game[],
  rawBytes: number
): void {
  try {
    const payload = message.payload;
    const gameId = isObject(payload) ? payload.gameId : undefined;

    if (!isString(gameId) || !isObject(payload)) {
      return replyError(user, 'invalid_message');
    }
    if (rawBytes > MAX_MESSAGE_BYTES || !isWithinRateLimit(user)) {
      return replyError(user, 'rate_limited', gameId);
    }

    const game = games.find((g) => g.gameId === gameId);
    if (!game) return replyError(user, 'game_not_found', gameId);

    // Only the two players of this game may signal; spectators are rejected.
    const opponentId = getOpponentId(game, user.userId);
    if (!opponentId) return replyError(user, 'not_a_player', gameId);

    // The sender's own socket must be in this game's room.
    if (!socketManager.isUserInRoom(gameId, user)) {
      return replyError(user, 'not_in_room', gameId);
    }

    // The client may state the receiver, but it must match the real opponent.
    if (payload.to !== undefined && payload.to !== opponentId) {
      return replyError(user, 'invalid_recipient', gameId);
    }

    const relayed = buildRelayedPayload(message.type, payload);
    if (!relayed) return replyError(user, 'invalid_message', gameId);

    const delivered = socketManager.sendToUser(
      gameId,
      opponentId,
      JSON.stringify({
        type: message.type,
        payload: { ...relayed, gameId, from: user.userId, to: opponentId },
      })
    );

    // Only tell the sender for messages that start/answer a call; dropping a
    // stray ICE candidate or hang-up for an absent peer is harmless.
    if (delivered === 0 && (message.type === VIDEO_CALL_REQUEST || message.type === VIDEO_CALL_ACCEPT)) {
      replyError(user, 'peer_unavailable', gameId);
    }
  } catch (e) {
    console.error('Video signaling error', e);
  }
}

/** Tell the opponent that this user's socket closed (so they can end the call). */
export function notifyVideoPeerLeft(user: User, games: Game[]): void {
  try {
    const roomId = socketManager.getRoomIdOfUser(user.userId);
    if (!roomId) return;
    const game = games.find((g) => g.gameId === roomId);
    if (!game) return;
    const opponentId = getOpponentId(game, user.userId);
    if (!opponentId) return;
    socketManager.sendToUser(
      roomId,
      opponentId,
      JSON.stringify({
        type: VIDEO_PEER_LEFT,
        payload: { gameId: roomId, from: user.userId, to: opponentId },
      })
    );
  } catch (e) {
    console.error('Video peer-left notification error', e);
  }
}
