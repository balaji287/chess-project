import { Phone, PhoneOff } from 'lucide-react';

interface IncomingCallBannerProps {
  callerName: string;
  onAccept: () => void;
  onReject: () => void;
}

// Small banner at the top of the screen so an incoming call is noticeable
// without blocking the chessboard.
export const IncomingCallBanner = ({ callerName, onAccept, onReject }: IncomingCallBannerProps) => (
  <div
    role="alertdialog"
    aria-live="assertive"
    aria-label={`Incoming video call from ${callerName}`}
    className="fixed left-1/2 top-4 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-stone-600 bg-stone-800 p-4 text-white shadow-2xl animate-in fade-in slide-in-from-top-2"
  >
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 animate-pulse items-center justify-center rounded-full bg-[#739552]">
        <Phone className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold">{callerName}</p>
        <p className="text-sm text-stone-300">is calling you on video</p>
      </div>
    </div>
    <div className="mt-4 flex gap-2">
      <button
        onClick={onAccept}
        className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-[#739552] font-semibold hover:bg-[#8aae64]"
      >
        <Phone className="h-4 w-4" aria-hidden /> Accept
      </button>
      <button
        onClick={onReject}
        className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-red-600 font-semibold hover:bg-red-500"
      >
        <PhoneOff className="h-4 w-4" aria-hidden /> Reject
      </button>
    </div>
  </div>
);
