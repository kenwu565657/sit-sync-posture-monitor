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
        forecast_level?: 'CALIBRATING' | 'COLLECTING' | 'LOW' | 'ELEVATED' | 'HIGH' | 'OFFLINE';
        forecast_horizon_seconds?: number;
        forecast_generated_at_ms?: number;
        forecast_threshold?: number;
        forecast_high_threshold?: number;
        forecast_model_version?: string;
        forecast_model_variant?: 'rula' | 'combined_strict';
        global_forecast_probability?: number;
        global_forecast_level?: 'CALIBRATING' | 'COLLECTING' | 'LOW' | 'ELEVATED' | 'HIGH' | 'OFFLINE';
        global_forecast_model_version?: string;
        personal_forecast_probability?: number;
        personal_forecast_level?: 'CALIBRATING' | 'COLLECTING' | 'LOW' | 'ELEVATED' | 'HIGH' | 'OFFLINE';
        personal_forecast_model_version?: string;
        personal_forecast_status?: string;
    };
}