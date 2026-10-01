export const INIT_GAME = 'init_game';
export const MOVE = 'move';
export const GAME_OVER = 'game_over';
export const JOIN_GAME = 'join_game';
export const OPPONENT_DISCONNECTED = 'opponent_disconnected';
export const JOIN_ROOM = 'join_room';
export const GAME_NOT_FOUND = 'game_not_found';
export const GAME_JOINED = 'game_joined';
export const GAME_ENDED = 'game_ended';
export const GAME_ALERT = 'game_alert';
export const GAME_ADDED = 'game_added';
export const GAME_TIME = 'game_time';
export const EXIT_GAME = 'exit_game';

// --- Video call signaling (WebRTC). See VideoSignaling.ts ---
// Client -> server -> opponent (relayed only to the other player of the game)
export const VIDEO_CALL_REQUEST = 'video_call_request'; // carries the SDP offer
export const VIDEO_CALL_ACCEPT = 'video_call_accept'; // carries the SDP answer
export const VIDEO_CALL_REJECT = 'video_call_reject';
export const VIDEO_ICE_CANDIDATE = 'video_ice_candidate';
export const VIDEO_CALL_END = 'video_call_end';
// Server -> client only (never sent by clients)
export const VIDEO_PEER_LEFT = 'video_peer_left';
export const VIDEO_SIGNAL_ERROR = 'video_signal_error';
