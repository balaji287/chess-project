// Video-call signaling protocol. Must stay in sync with apps/ws/src/messages.ts
// (the repo already duplicates message constants between ws and frontend).

export const VIDEO_CALL_REQUEST = 'video_call_request'; // carries the SDP offer
export const VIDEO_CALL_ACCEPT = 'video_call_accept'; // carries the SDP answer
export const VIDEO_CALL_REJECT = 'video_call_reject';
export const VIDEO_ICE_CANDIDATE = 'video_ice_candidate';
export const VIDEO_CALL_END = 'video_call_end';
// Server-originated only
export const VIDEO_PEER_LEFT = 'video_peer_left';
export const VIDEO_SIGNAL_ERROR = 'video_signal_error';

export type RejectReason = 'declined' | 'busy' | 'media_error' | 'timeout';
export type EndReason = 'hangup' | 'timeout' | 'failed';

interface Envelope {
  gameId: string;
  from: string; // stamped by the server, never trusted from the client
  to: string;
}

export type VideoSignalMessage =
  | { type: typeof VIDEO_CALL_REQUEST; payload: Envelope & { sdp: RTCSessionDescriptionInit } }
  | { type: typeof VIDEO_CALL_ACCEPT; payload: Envelope & { sdp: RTCSessionDescriptionInit } }
  | { type: typeof VIDEO_CALL_REJECT; payload: Envelope & { reason: RejectReason } }
  | { type: typeof VIDEO_ICE_CANDIDATE; payload: Envelope & { candidate: RTCIceCandidateInit } }
  | { type: typeof VIDEO_CALL_END; payload: Envelope & { reason: EndReason } }
  | { type: typeof VIDEO_PEER_LEFT; payload: Envelope }
  | { type: typeof VIDEO_SIGNAL_ERROR; payload: { gameId?: string; code: string } };

// All video-call messages share this prefix. Game.tsx uses this to ignore them
// in its own message switch (its default branch would otherwise alert()).
export const isVideoSignalMessage = (message: unknown): message is VideoSignalMessage =>
  typeof message === 'object' &&
  message !== null &&
  typeof (message as { type?: unknown }).type === 'string' &&
  (message as { type: string }).type.startsWith('video_');
