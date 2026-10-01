import { useEffect, useRef, useState } from 'react';
import { getIceConfiguration } from '@/lib/video-call/iceServers';
import { MediaAccessError, MediaErrorKind, getLocalMedia, stopStream } from '@/lib/video-call/media';
import {
  VIDEO_CALL_ACCEPT,
  VIDEO_CALL_END,
  VIDEO_CALL_REJECT,
  VIDEO_CALL_REQUEST,
  VIDEO_ICE_CANDIDATE,
  VIDEO_PEER_LEFT,
  VIDEO_SIGNAL_ERROR,
  VideoSignalMessage,
  isVideoSignalMessage,
} from '@/lib/video-call/signaling';

export type CallStatus =
  | 'idle'
  | 'calling' // I started a call; waiting for the opponent to answer
  | 'incoming' // opponent is calling me
  | 'connecting' // answer exchanged, WebRTC connecting
  | 'connected'
  | 'rejected'
  | 'ended'
  | 'opponent_disconnected'
  | 'error';

export type CallErrorKind = MediaErrorKind | 'connection_failed' | 'call_unavailable';

// Extra detail for the 'rejected' / 'ended' notices.
export type CallReason =
  | 'declined'
  | 'busy'
  | 'media_error'
  | 'hangup' // I hung up
  | 'remote_hangup'
  | 'no_answer'
  | 'missed';

const RING_TIMEOUT_MS = 45_000;
const INCOMING_EXPIRY_MS = 50_000; // slightly longer than the caller's timeout
const DISCONNECT_GRACE_MS = 8_000; // WebRTC 'disconnected' often self-heals

const ACTIVE: CallStatus[] = ['calling', 'incoming', 'connecting', 'connected'];
const isActive = (status: CallStatus) => ACTIVE.includes(status);

interface UseVideoCallArgs {
  socket: WebSocket | null;
  gameId: string;
  opponentId: string | null;
}

export function useVideoCall({ socket, gameId, opponentId }: UseVideoCallArgs) {
  const [status, setStatusState] = useState<CallStatus>('idle');
  const [error, setError] = useState<CallErrorKind | null>(null);
  const [reason, setReason] = useState<CallReason | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);

  // Refs hold the mutable WebRTC objects; state above is only for rendering.
  const statusRef = useRef<CallStatus>('idle');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever a call attempt starts or is torn down. Every `await` in the
  // call flow checks it, so a cancelled attempt never touches newer state.
  const sessionRef = useRef(0);

  const setStatus = (next: CallStatus) => {
    statusRef.current = next;
    setStatusState(next);
  };

  // ---------- signaling out ----------

  const send = (type: string, extra: Record<string, unknown> = {}): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !opponentId) return false;
    // The server re-validates all of this and stamps the real `from`.
    socket.send(JSON.stringify({ type, payload: { ...extra, gameId, to: opponentId } }));
    return true;
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  // ---------- cleanup ----------

  const clearTimers = () => {
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    ringTimerRef.current = null;
    disconnectTimerRef.current = null;
  };

  const releaseResources = () => {
    clearTimers();
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      // Detach first so closing does not fire handlers into a finished call.
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    stopStream(localStreamRef.current); // turns the camera light off
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    incomingOfferRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMicOn(true);
    setIsCameraOn(true);
  };

  const finishCall = (next: CallStatus, detail: { error?: CallErrorKind; reason?: CallReason } = {}) => {
    sessionRef.current += 1; // invalidate any in-flight async work
    releaseResources();
    setError(detail.error ?? null);
    setReason(detail.reason ?? null);
    setStatus(next);
  };

  // ---------- WebRTC ----------

  const createPeerConnection = async (stream: MediaStream, session: number) => {
    const configuration = await getIceConfiguration();
    if (session !== sessionRef.current) return null;

    const pc = new RTCPeerConnection(configuration);
    pcRef.current = pc;

    // Send my camera + microphone.
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // Send each locally discovered ICE candidate to the opponent (trickle ICE).
    pc.onicecandidate = (event) => {
      if (pcRef.current !== pc || !event.candidate) return;
      sendRef.current(VIDEO_ICE_CANDIDATE, { candidate: event.candidate.toJSON() });
    };

    // Receive the opponent's media.
    pc.ontrack = (event) => {
      if (pcRef.current !== pc) return;
      const [remote] = event.streams;
      if (remote) setRemoteStream(remote);
    };

    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      switch (pc.connectionState) {
        case 'connected':
          if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
          setStatus('connected');
          break;
        case 'disconnected':
          // Often a brief network blip; only give up if it does not recover.
          if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = setTimeout(() => {
            if (pcRef.current === pc && pc.connectionState !== 'connected') {
              sendRef.current(VIDEO_CALL_END, { reason: 'failed' });
              finishCall('error', { error: 'connection_failed' });
            }
          }, DISCONNECT_GRACE_MS);
          break;
        case 'failed':
          sendRef.current(VIDEO_CALL_END, { reason: 'failed' });
          finishCall('error', { error: 'connection_failed' });
          break;
        default:
          break;
      }
    };

    return pc;
  };

  // Candidates can arrive before the remote description is set; queue them.
  const flushPendingCandidates = async (pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn('Ignoring bad ICE candidate', e);
      }
    }
  };

  const toDescriptionInit = (pc: RTCPeerConnection): RTCSessionDescriptionInit => {
    const description = pc.localDescription!;
    return { type: description.type, sdp: description.sdp };
  };

  // ---------- user actions ----------

  const startCall = async () => {
    if (!opponentId || isActive(statusRef.current)) return;
    const session = ++sessionRef.current;
    setError(null);
    setReason(null);
    setStatus('calling');

    try {
      const stream = await getLocalMedia(); // 1. camera + mic permission
      if (session !== sessionRef.current) return stopStream(stream); // cancelled meanwhile
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = await createPeerConnection(stream, session); // 2. peer connection
      if (!pc) return;

      const offer = await pc.createOffer(); // 3. offer
      await pc.setLocalDescription(offer);
      if (session !== sessionRef.current) return;

      // 4. send it through the existing WebSocket
      if (!send(VIDEO_CALL_REQUEST, { sdp: toDescriptionInit(pc) })) {
        finishCall('error', { error: 'call_unavailable' });
        return;
      }

      ringTimerRef.current = setTimeout(() => {
        if (session === sessionRef.current && statusRef.current === 'calling') {
          send(VIDEO_CALL_END, { reason: 'timeout' });
          finishCall('ended', { reason: 'no_answer' });
        }
      }, RING_TIMEOUT_MS);
    } catch (err) {
      if (session !== sessionRef.current) return;
      finishCall('error', {
        error: err instanceof MediaAccessError ? err.kind : 'connection_failed',
      });
    }
  };

  const acceptCall = async () => {
    const offer = incomingOfferRef.current;
    if (statusRef.current !== 'incoming' || !offer) return;
    clearTimers();
    const session = ++sessionRef.current;
    setStatus('connecting');

    try {
      const stream = await getLocalMedia();
      if (session !== sessionRef.current) return stopStream(stream);
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = await createPeerConnection(stream, session);
      if (!pc) return;

      await pc.setRemoteDescription(offer);
      await flushPendingCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (session !== sessionRef.current) return;

      send(VIDEO_CALL_ACCEPT, { sdp: toDescriptionInit(pc) });
    } catch (err) {
      if (session !== sessionRef.current) return;
      if (err instanceof MediaAccessError) {
        send(VIDEO_CALL_REJECT, { reason: 'media_error' }); // tell the caller
      } else {
        send(VIDEO_CALL_END, { reason: 'failed' });
      }
      finishCall('error', {
        error: err instanceof MediaAccessError ? err.kind : 'connection_failed',
      });
    }
  };

  const rejectCall = () => {
    if (statusRef.current !== 'incoming') return;
    send(VIDEO_CALL_REJECT, { reason: 'declined' });
    finishCall('idle');
  };

  const endCall = () => {
    if (!isActive(statusRef.current)) return;
    send(VIDEO_CALL_END, { reason: 'hangup' });
    finishCall('ended', { reason: 'hangup' });
  };

  // Close a "rejected / ended / error" notice.
  const dismiss = () => {
    if (!isActive(statusRef.current)) finishCall('idle');
  };

  const toggleMicrophone = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    if (tracks.length === 0) return;
    const enable = !tracks[0].enabled;
    tracks.forEach((track) => (track.enabled = enable));
    setIsMicOn(enable);
  };

  const toggleCamera = () => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    const enable = !tracks[0].enabled;
    tracks.forEach((track) => (track.enabled = enable));
    setIsCameraOn(enable);
  };

  // ---------- signaling in ----------

  const onSignal = async (message: VideoSignalMessage) => {
    const current = statusRef.current;

    switch (message.type) {
      case VIDEO_CALL_REQUEST: {
        if (current === 'incoming') return; // duplicate
        if (isActive(current)) {
          send(VIDEO_CALL_REJECT, { reason: 'busy' });
          return;
        }
        incomingOfferRef.current = message.payload.sdp;
        pendingCandidatesRef.current = [];
        setError(null);
        setReason(null);
        setStatus('incoming');
        ringTimerRef.current = setTimeout(() => {
          if (statusRef.current === 'incoming') finishCall('ended', { reason: 'missed' });
        }, INCOMING_EXPIRY_MS);
        return;
      }

      case VIDEO_CALL_ACCEPT: {
        const pc = pcRef.current;
        if (current !== 'calling' || !pc) return;
        clearTimers();
        setStatus('connecting');
        try {
          await pc.setRemoteDescription(message.payload.sdp);
          await flushPendingCandidates(pc);
        } catch (e) {
          if (pcRef.current !== pc) return;
          console.error('Failed to apply answer', e);
          send(VIDEO_CALL_END, { reason: 'failed' });
          finishCall('error', { error: 'connection_failed' });
        }
        return;
      }

      case VIDEO_CALL_REJECT:
        if (current === 'calling' || current === 'connecting') {
          const { reason: why } = message.payload;
          if (why === 'timeout') finishCall('ended', { reason: 'no_answer' });
          else finishCall('rejected', { reason: why });
        }
        return;

      case VIDEO_ICE_CANDIDATE: {
        if (!isActive(current)) return; // stale candidate from an old call
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(message.payload.candidate);
          } catch (e) {
            console.warn('Ignoring bad ICE candidate', e);
          }
        } else {
          pendingCandidatesRef.current.push(message.payload.candidate);
        }
        return;
      }

      case VIDEO_CALL_END:
        if (isActive(current)) {
          finishCall('ended', {
            // Caller gave up before I answered => a missed call.
            reason: current === 'incoming' ? 'missed' : 'remote_hangup',
          });
        }
        return;

      case VIDEO_PEER_LEFT:
        if (isActive(current)) finishCall('opponent_disconnected');
        return;

      case VIDEO_SIGNAL_ERROR:
        if (!isActive(current)) return;
        finishCall(
          message.payload.code === 'peer_unavailable' ? 'opponent_disconnected' : 'error',
          message.payload.code === 'peer_unavailable' ? {} : { error: 'call_unavailable' }
        );
        return;
    }
  };

  // The socket listener is attached once per socket/game; it always calls the
  // latest onSignal, so handlers never see stale state.
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    if (!socket) return;
    // addEventListener (not onmessage) so we coexist with Game.tsx's handler.
    const listener = (event: MessageEvent) => {
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isVideoSignalMessage(message)) return;
      // Ignore anything not for this game or not from my opponent.
      if (message.payload.gameId !== gameId) return;
      if ('from' in message.payload && message.payload.from !== opponentId) return;
      void onSignalRef.current(message);
    };
    socket.addEventListener('message', listener);
    return () => socket.removeEventListener('message', listener);
  }, [socket, gameId, opponentId]);

  // Leaving the game screen (or the game ending) ends the call and turns the
  // camera/microphone off.
  useEffect(() => {
    return () => {
      if (isActive(statusRef.current)) {
        sendRef.current(VIDEO_CALL_END, { reason: 'hangup' });
      }
      sessionRef.current += 1;
      releaseResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    error,
    reason,
    localStream,
    remoteStream,
    isMicOn,
    isCameraOn,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    dismiss,
    toggleMicrophone,
    toggleCamera,
  };
}
