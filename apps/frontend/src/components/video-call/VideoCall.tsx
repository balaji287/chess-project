import { Video } from 'lucide-react';
import { useVideoCall } from '@/hooks/useVideoCall';
import type { Player } from '@/screens/Game';
import { IncomingCallBanner } from './IncomingCallBanner';
import { VideoPanel } from './VideoPanel';

interface VideoCallProps {
  socket: WebSocket;
  gameId: string;
  opponent: Player;
}

// Video call between the two players of one game. Rendered by Game.tsx only for
// players (never spectators). All logic lives in useVideoCall.
export const VideoCall = ({ socket, gameId, opponent }: VideoCallProps) => {
  const call = useVideoCall({ socket, gameId, opponentId: opponent.id });
  const opponentName = opponent.name || 'Your opponent';

  if (call.status === 'incoming') {
    return <IncomingCallBanner callerName={opponentName} onAccept={call.acceptCall} onReject={call.rejectCall} />;
  }

  if (call.status === 'idle') {
    return (
      // Sits with the Exit button in the sidebar on md+, floats bottom-right on
      // small screens.
      <div className="fixed bottom-4 right-4 z-40 md:static md:flex md:justify-center md:pb-4">
        <button
          onClick={call.startCall}
          className="flex h-12 items-center gap-2 rounded-md bg-stone-800 px-4 font-semibold text-white shadow-lg hover:bg-stone-700"
        >
          <Video className="h-5 w-5" aria-hidden />
          Video Call
        </button>
      </div>
    );
  }

  return (
    <VideoPanel
      status={call.status}
      reason={call.reason}
      error={call.error}
      opponentName={opponentName}
      localStream={call.localStream}
      remoteStream={call.remoteStream}
      isMicOn={call.isMicOn}
      isCameraOn={call.isCameraOn}
      onEnd={call.endCall}
      onToggleMic={call.toggleMicrophone}
      onToggleCamera={call.toggleCamera}
      onCallAgain={call.startCall}
      onDismiss={call.dismiss}
    />
  );
};
