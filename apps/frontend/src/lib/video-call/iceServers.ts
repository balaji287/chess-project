// ICE (STUN/TURN) configuration for the video call.
//
// Development: public STUN servers are enough for two browsers on the same
// machine/LAN or on friendly NATs.
//
// Production: many networks (corporate, mobile carrier, symmetric NAT) cannot
// connect peer-to-peer with STUN alone and need a TURN relay. Configure TURN
// with the optional variables below, but note that anything prefixed VITE_ is
// bundled into the public JS. For a real deployment, replace the static
// credentials with short-lived credentials fetched from your backend (e.g.
// coturn `use-auth-secret`) inside getIceConfiguration(). It is async so that
// change stays local to this file.
//
//   VITE_APP_STUN_URLS   comma-separated, default: Google public STUN
//   VITE_APP_TURN_URLS   comma-separated, e.g. turn:turn.example.com:3478,turns:turn.example.com:5349
//   VITE_APP_TURN_USERNAME / VITE_APP_TURN_CREDENTIAL

const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

const parseList = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

export async function getIceConfiguration(): Promise<RTCConfiguration> {
  const stunUrls = parseList(import.meta.env.VITE_APP_STUN_URLS);
  const iceServers: RTCIceServer[] = [{ urls: stunUrls.length > 0 ? stunUrls : DEFAULT_STUN_URLS }];

  const turnUrls = parseList(import.meta.env.VITE_APP_TURN_URLS);
  const username = import.meta.env.VITE_APP_TURN_USERNAME as string | undefined;
  const credential = import.meta.env.VITE_APP_TURN_CREDENTIAL as string | undefined;
  if (turnUrls.length > 0 && username && credential) {
    iceServers.push({ urls: turnUrls, username, credential });
  }

  return { iceServers };
}
