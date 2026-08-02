import type {SensorPlacementMode} from '../types';

export interface PilotRecordingStatus {
  recording: boolean;
  mountingMode?: SensorPlacementMode;
  frames?: number;
  sequenceId?: string;
  durationSeconds?: number;
  lastFrameAt?: number;
  filePath?: string;
  effectiveSampleHz?: number;
  writeErrors?: number;
  lastWriteError?: string;
  databaseSessionId?: string;
  databaseStatus?: 'disabled' | 'recording' | 'completed' | 'failed';
  databasePersistedFrames?: number;
  databaseWriteErrors?: number;
  lastDatabaseWriteError?: string;
}

export interface StoppedPilotRecording {
  status: 'stopped';
  mountingMode: SensorPlacementMode;
  frames: number;
  persistedFrames: number;
  durationSeconds: number;
  effectiveSampleHz: number;
  writeErrors: number;
  databaseSessionId?: string;
  databaseStatus: 'disabled' | 'completed' | 'failed';
  databasePersistedFrames: number;
  databaseWriteErrors: number;
  filePath: string;
}

export function pilotRecordingWarning(
  status: PilotRecordingStatus,
  minimumHealthyHz = 8.5,
): string | null {
  if ((status.writeErrors ?? 0) > 0) {
    return status.lastWriteError ?? 'Raw recording encountered a write error.';
  }
  if (
    status.databaseStatus === 'failed' ||
    (status.databaseWriteErrors ?? 0) > 0
  ) {
    return (
      status.lastDatabaseWriteError ??
      'PostgreSQL raw recording encountered a write error.'
    );
  }
  if (
    status.recording &&
    (status.durationSeconds ?? 0) >= 10 &&
    (status.frames ?? 0) === 0
  ) {
    return 'Recording is active but no server frames arrived. Stop and check the gateway device ID.';
  }
  if (
    status.recording &&
    (status.durationSeconds ?? 0) >= 10 &&
    (status.effectiveSampleHz ?? 0) < minimumHealthyHz
  ) {
    return `Capture rate is below ${minimumHealthyHz.toFixed(
      1,
    )} Hz. Check sensor freshness before continuing.`;
  }
  return null;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function request<T>(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(endpoint(baseUrl, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? {'Content-Type': 'application/json'} : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Recording request failed (${response.status})`;
    try {
      const body = (await response.json()) as {error?: unknown};
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // Preserve the status fallback for non-JSON responses.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function createPilotSequenceId(now = new Date()): string {
  return `pilot_self_${now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:TZ]/g, '')}`;
}

export async function startPilotRecording(
  baseUrl: string,
  token: string,
  deviceId: string,
  sequenceId: string,
  mountingMode: SensorPlacementMode = 'shoulder_top',
): Promise<PilotRecordingStatus> {
  const response = await request<{
    status: 'recording';
    filePath: string;
    databaseSessionId?: string;
  }>(
    baseUrl,
    token,
    '/api/recording/start',
    {
      method: 'POST',
      body: JSON.stringify({
        device_id: deviceId,
        sequence_id: sequenceId,
        participant_id: 'self_pilot',
        action_id: 'natural_desk_30min',
        split: 'test',
        mounting_mode: mountingMode,
      }),
    },
  );
  return {
    recording: true,
    mountingMode,
    frames: 0,
    sequenceId,
    durationSeconds: 0,
    filePath: response.filePath,
    writeErrors: 0,
    databaseSessionId: response.databaseSessionId,
    databaseStatus: response.databaseSessionId ? 'recording' : 'disabled',
    databasePersistedFrames: 0,
    databaseWriteErrors: 0,
  };
}

export async function stopPilotRecording(
  baseUrl: string,
  token: string,
  deviceId: string,
): Promise<StoppedPilotRecording> {
  return request<StoppedPilotRecording>(
    baseUrl,
    token,
    '/api/recording/stop',
    {
      method: 'POST',
      body: JSON.stringify({device_id: deviceId}),
    },
  );
}

export async function getPilotRecordingStatus(
  baseUrl: string,
  token: string,
  deviceId: string,
): Promise<PilotRecordingStatus> {
  return request<PilotRecordingStatus>(
    baseUrl,
    token,
    `/api/recording/status/${encodeURIComponent(deviceId)}`,
  );
}
