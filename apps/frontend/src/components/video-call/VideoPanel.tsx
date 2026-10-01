import { useEffect, useRef } from 'react';
import { Loader2, Mic, MicOff, PhoneOff, RotateCcw, Video, VideoOff, X } from 'lucide-react';
import type { CallErrorKind, CallReason, CallStatus } from '@/hooks/useVideoCall';

const ERROR_TEXT: Record<CallErrorKind, string> = {
  camera_denied: "Camera access was denied. Allow the camera in your browser's site settings and try again.",
  microphone_denied:
    "Microphone access was denied. Allow the microphone in your browser's site settings and try again.",
  camera_and_microphone_denied:
    "Camera and microphone access was denied. Allow both in your browser's site settings and try again.",
  device_not_found: 'No camera or microphone was found on this device.',
  device_in_use: 'Your camera or microphone is being used by another app.',
  insecure_context: 'Video calls need a secure connection (HTTPS or localhost).',
  unknown_media_error: 'Could not access your camera or microphone. Check your browser and system privacy settings.',
  connection_failed: 'Could not connect the video call. This can happen on restrictive networks.',
  call_unavailable: 'The call could not be started. Please try again.',
};

const noticeText = (
  status: CallStatus,
  reason: CallReason | null,
  error: CallErrorKind | null,
  name: string
): string => {
  switch (status) {
    case 'rejected':
      if (reason === 'busy') return `${name} is busy right now.`;
      if (reason === 'media_error') return `${name} could not turn on their camera or microphone.`;
      return `${name} declined the call.`;
    case 'ended':
      if (reason === 'no_answer') return `${name} did not answer.`;
      if (reason === 'missed') return `Missed call from ${name}.`;
      if (reason === 'remote_hangup') return `${name} ended the call.`;
      return 'Call ended.';
    case 'opponent_disconnected':
      return `${name} disconnected.`;
    case 'error':
      return ERROR_TEXT[error ?? 'call_unavailable'];
    default:
      return '';
  }
};

const StreamVideo = ({
  stream,
  muted = false,
  mirrored = false,
  className = '',
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) element.play().catch(() => undefined);
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${className}`}
    />
  );
};

const ControlButton = ({
  label,
  onClick,
  active = true,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors ${
      danger
        ? 'bg-red-600 hover:bg-red-500'
        : active
          ? 'bg-stone-700 hover:bg-stone-600'
          : 'bg-stone-100 text-stone-900 hover:bg-white'
    }`}
  >
    {children}
  </button>
);

interface VideoPanelProps {
  status: CallStatus;
  reason: CallReason | null;
  error: CallErrorKind | null;
  opponentName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicOn: boolean;
  isCameraOn: boolean;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onCallAgain: () => void;
  onDismiss: () => void;
}

export const VideoPanel = ({
  status,
  reason,
  error,
  opponentName,
  localStream,
  remoteStream,
  isMicOn,
  isCameraOn,
  onEnd,
  onToggleMic,
  onToggleCamera,
  onCallAgain,
  onDismiss,
}: VideoPanelProps) => {
  const inCall = status === 'calling' || status === 'connecting' || status === 'connected';
  const showRemote = status === 'connected' && remoteStream;

  return (
    // Floating card on small screens (the board is wide, so the sidebar can be
    // off-screen there); regular in-flow card in the sidebar from md up.
    <section
      aria-label="Video call"
      className="fixed bottom-4 right-4 z-40 w-[min(18rem,calc(100vw-2rem))] md:static md:w-full md:px-8 md:pb-4"
    >
      <div className="overflow-hidden rounded-lg border border-stone-700 bg-stone-900 text-white shadow-xl">
        <div className="relative aspect-video bg-black">
          {showRemote ? (
            <StreamVideo stream={remoteStream} />
          ) : (
            <div
              role="status"
              className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-stone-200"
            >
              {inCall ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                  <span>
                    {status === 'calling' && `Calling ${opponentName}…`}
                    {status === 'connecting' && 'Connecting…'}
                    {status === 'connected' && 'Waiting for video…'}
                  </span>
                </>
              ) : (
                <span>{noticeText(status, reason, error, opponentName)}</span>
              )}
            </div>
          )}

          {inCall && (
            <span className="absolute left-2 top-2 max-w-[60%] truncate rounded bg-black/60 px-2 py-0.5 text-xs">
              {opponentName}
            </span>
          )}

          {localStream && (
            <div className="absolute bottom-2 right-2 aspect-video w-1/4 min-w-[64px] overflow-hidden rounded-md border border-stone-600 bg-stone-800">
              <StreamVideo stream={localStream} muted mirrored />
              {!isCameraOn && (
                <div className="absolute inset-0 flex items-center justify-center bg-stone-800">
                  <VideoOff className="h-4 w-4" aria-label="Your camera is off" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 p-3">
          {inCall ? (
            <>
              <ControlButton
                label={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
                active={isMicOn}
                onClick={onToggleMic}
              >
                {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </ControlButton>
              <ControlButton
                label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
                active={isCameraOn}
                onClick={onToggleCamera}
              >
                {isCameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
              </ControlButton>
              <ControlButton label={status === 'calling' ? 'Cancel call' : 'End call'} danger onClick={onEnd}>
                <PhoneOff className="h-4 w-4" />
              </ControlButton>
            </>
          ) : (
            <>
              <button
                onClick={onCallAgain}
                className="flex h-10 items-center gap-2 rounded-md bg-[#739552] px-3 text-sm font-semibold hover:bg-[#8aae64]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Call again
              </button>
              <button
                onClick={onDismiss}
                className="flex h-10 items-center gap-2 rounded-md bg-stone-700 px-3 text-sm font-semibold hover:bg-stone-600"
              >
                <X className="h-4 w-4" aria-hidden /> Close
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
