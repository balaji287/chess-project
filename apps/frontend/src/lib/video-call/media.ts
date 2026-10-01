// Camera/microphone access with precise error classification.

export type MediaErrorKind =
  | 'insecure_context'
  | 'camera_denied'
  | 'microphone_denied'
  | 'camera_and_microphone_denied'
  | 'device_not_found'
  | 'device_in_use'
  | 'unknown_media_error';

export class MediaAccessError extends Error {
  kind: MediaErrorKind;
  originalError?: unknown;
  constructor(kind: MediaErrorKind, originalError?: unknown) {
    super(kind);
    this.name = 'MediaAccessError';
    this.kind = kind;
    this.originalError = originalError;
  }
}

export const stopStream = (stream: MediaStream | null | undefined) => {
  stream?.getTracks().forEach((track) => track.stop());
};

async function queryPermission(name: 'camera' | 'microphone'): Promise<PermissionState | 'unsupported'> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return 'unsupported'; // e.g. Firefox does not support these names
  }
}

async function canOpen(constraints: MediaStreamConstraints): Promise<boolean> {
  try {
    stopStream(await navigator.mediaDevices.getUserMedia(constraints));
    return true;
  } catch {
    return false;
  }
}

// getUserMedia({video, audio}) rejects with the same NotAllowedError whichever
// device was refused, so work out which one it was.
async function classifyPermissionDenial(): Promise<MediaErrorKind> {
  let [camera, microphone] = await Promise.all([queryPermission('camera'), queryPermission('microphone')]);

  if (camera === 'unsupported' || microphone === 'unsupported') {
    // Fallback for browsers without the Permissions API for devices: probe each
    // device separately (no extra prompt where the user already denied).
    camera = (await canOpen({ video: true })) ? 'granted' : 'denied';
    microphone = (await canOpen({ audio: true })) ? 'granted' : 'denied';
  }

  const cameraBlocked = camera !== 'granted';
  const microphoneBlocked = microphone !== 'granted';
  if (cameraBlocked && microphoneBlocked) return 'camera_and_microphone_denied';
  if (cameraBlocked) return 'camera_denied';
  if (microphoneBlocked) return 'microphone_denied';
  return 'unknown_media_error'; // e.g. blocked at OS level
}

export async function getLocalMedia(): Promise<MediaStream> {
  // getUserMedia only exists on secure origins (HTTPS or localhost).
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MediaAccessError('insecure_context');
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    const name = (error as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MediaAccessError(await classifyPermissionDenial(), error);
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new MediaAccessError('device_not_found', error);
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw new MediaAccessError('device_in_use', error);
    }
    throw new MediaAccessError('unknown_media_error', error);
  }
}
