export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export const SENSOR_PLACEMENT_MODES = ['shoulder_top', 'upper_arm'] as const;
export type SensorPlacementMode = (typeof SENSOR_PLACEMENT_MODES)[number];

export interface PosturePayload {
  schema_version: 1;
  timestamp: number;
  device_id: string;
  user_id: string;
  mounting_mode?: SensorPlacementMode;
  sensors: {
    neck: { quat: Quaternion };
    lower_back: { quat: Quaternion };
    left_shoulder: { quat: Quaternion };
    right_shoulder: { quat: Quaternion };
  };
  metrics?: {
    cva_angle?: number;
    rula_score?: number;
    status?: 'good' | 'warning' | 'critical';
    ml_activity?: string;
    forecast_probability?: number;
    forecast_level?:
      | 'CALIBRATING'
      | 'COLLECTING'
      | 'LOW'
      | 'ELEVATED'
      | 'HIGH'
      | 'OFFLINE';
    forecast_horizon_seconds?: number;
    forecast_generated_at_ms?: number;
    forecast_threshold?: number;
    forecast_high_threshold?: number;
    forecast_model_version?: string;
    personal_forecast_probability?: number;
    personal_forecast_level?:
      | 'CALIBRATING'
      | 'COLLECTING'
      | 'LOW'
      | 'ELEVATED'
      | 'HIGH'
      | 'OFFLINE';
    personal_forecast_model_version?: string;
    personal_forecast_status?: string;
  };
}

export interface ServerPostureAlert {
  id?: string;
  timestamp: number;
  deviceId?: string;
  level: 'none' | 'warning' | 'critical';
  kind: 'prediction' | 'detected';
  event: 'triggered' | 'escalated' | 'resolved';
  title: string;
  detail: string;
}

export interface DailyPostureHistory {
  date: string;
  avg_rula: number;
  avg_cva: number | null;
  total_bad_posture_seconds: number;
  incident_count: number;
  warning_count: number;
  critical_count: number;
}

export interface PostureAnalyticsSummary {
  total_bad_posture_seconds: number;
  total_incidents: number;
  average_rula: number;
  average_cva: number | null;
  warning_incidents: number;
  critical_incidents: number;
}

export interface PostureEvent {
  id: string;
  device_id: string | null;
  event_type: 'warning' | 'critical';
  duration_seconds: number;
  peak_rula_score: number;
  minimum_cva_angle: number | null;
  sensor_snapshot: unknown;
  logged_at: string;
  replay_available: boolean;
}

export type ConnectionState =
  | 'idle'
  | 'authenticating'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export const BODY_POSITIONS = [
  'neck',
  'lower_back',
  'left_shoulder',
  'right_shoulder',
] as const;

export type BodyPosition = (typeof BODY_POSITIONS)[number];

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionSample {
  schemaVersion: 1;
  timestamp: number;
  sensorTimestamp: number;
  sequence: number;
  accuracy: number;
  raw: string;
  deviceId: string;
  deviceName: string;
  sensorId: string;
  position: BodyPosition;
  quaternion: Quaternion;
}

export type ImuSample = QuaternionSample;
export type CombinedImuFrame = PosturePayload;
