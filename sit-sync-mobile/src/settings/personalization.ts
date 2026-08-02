import type {SensorPlacementMode} from '../types';

export interface PersonalizationStatus {
  mounting_mode?: SensorPlacementMode;
  status: string;
  sample_count: number;
  sequence_count: number;
  model_version: string | null;
  global_model_version: string | null;
  last_error: string | null;
}

export interface PosturePreferences {
  warningRulaThreshold: number;
  warningCvaThreshold: number;
  incidentDurationSeconds: number;
}

export interface TrainingSettings {
  telemetry_training_opt_in: boolean;
  personalized_model_opt_in: boolean;
  personalization: PersonalizationStatus;
  preferences: PosturePreferences;
}

const emptyPersonalization: PersonalizationStatus = {
  status: 'not_started',
  sample_count: 0,
  sequence_count: 0,
  model_version: null,
  global_model_version: null,
  last_error: null,
};

function url(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function request(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url(baseUrl, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`,
    );
  }
  return body;
}

export async function loadTrainingSettings(
  baseUrl: string,
  token: string,
  mountingMode: SensorPlacementMode = 'shoulder_top',
): Promise<TrainingSettings> {
  const body = await request(
    baseUrl,
    token,
    `/api/settings?mounting_mode=${encodeURIComponent(mountingMode)}`,
  );
  const source =
    typeof body.preferences === 'object' && body.preferences !== null
      ? (body.preferences as Record<string, unknown>)
      : body;
  return {
    telemetry_training_opt_in:
      (source.telemetry_training_opt_in ??
        body.telemetry_training_opt_in) === true,
    personalized_model_opt_in:
      (source.personalized_model_opt_in ??
        body.personalized_model_opt_in) === true,
    personalization:
      typeof (source.personalization ?? body.personalization) === 'object' &&
      (source.personalization ?? body.personalization) !== null
        ? ((source.personalization ??
            body.personalization) as PersonalizationStatus)
        : emptyPersonalization,
    preferences: {
      warningRulaThreshold:
        typeof source.warningRulaThreshold === 'number'
          ? source.warningRulaThreshold
          : 2,
      warningCvaThreshold:
        typeof source.warningCvaThreshold === 'number'
          ? source.warningCvaThreshold
          : 50,
      incidentDurationSeconds:
        typeof source.incidentDurationSeconds === 'number'
          ? source.incidentDurationSeconds
          : 15,
    },
  };
}

export async function savePosturePreferences(
  baseUrl: string,
  token: string,
  preferences: PosturePreferences,
): Promise<PosturePreferences> {
  const body = await request(baseUrl, token, '/api/settings', {
    method: 'PUT',
    body: JSON.stringify(preferences),
  });
  const saved =
    typeof body.preferences === 'object' && body.preferences !== null
      ? (body.preferences as Partial<PosturePreferences>)
      : {};
  return {
    warningRulaThreshold:
      saved.warningRulaThreshold ?? preferences.warningRulaThreshold,
    warningCvaThreshold:
      saved.warningCvaThreshold ?? preferences.warningCvaThreshold,
    incidentDurationSeconds:
      saved.incidentDurationSeconds ?? preferences.incidentDurationSeconds,
  };
}

export async function saveTrainingConsent(
  baseUrl: string,
  token: string,
  consent: Pick<
    TrainingSettings,
    'telemetry_training_opt_in' | 'personalized_model_opt_in'
  >,
): Promise<void> {
  await request(baseUrl, token, '/api/settings/consent', {
    method: 'PUT',
    body: JSON.stringify(consent),
  });
}

export async function trainPersonalModel(
  baseUrl: string,
  token: string,
  mountingMode: SensorPlacementMode = 'shoulder_top',
): Promise<void> {
  await request(baseUrl, token, '/api/settings/personalization/train', {
    method: 'POST',
    body: JSON.stringify({mounting_mode: mountingMode}),
  });
}

export async function deleteTrainingData(
  baseUrl: string,
  token: string,
): Promise<void> {
  await request(baseUrl, token, '/api/settings/training-data', {
    method: 'DELETE',
  });
}
