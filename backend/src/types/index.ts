export interface Quaternion {
    w: number;
    x: number;
    y: number;
    z: number;
}

export interface PosturePayload {
    timestamp: number;
    device_id: string;
    sensors: {
        neck: { quat: Quaternion };
    };
    metrics?: {
        cva_angle?: number;
    };
}