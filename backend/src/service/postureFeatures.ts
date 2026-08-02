import {
    PosturePayload,
    Quaternion,
    SensorPlacementMode,
} from '../types/index.js';

export interface ForecastFeatureFrame {
    neck_back_pitch: number;
    neck_back_roll: number;
    trunk_pitch: number;
    shoulder_asymmetry: number;
    upper_arm_elevation?: number;
    neck_back_pitch_velocity: number;
    neck_back_roll_velocity: number;
    trunk_pitch_velocity: number;
    shoulder_asymmetry_velocity: number;
    upper_arm_elevation_velocity?: number;
}

export interface PostureFrameResult {
    features: ForecastFeatureFrame;
    featureWindow: ForecastFeatureFrame[] | null;
}

interface BaseFeatures {
    neckBackPitch: number;
    neckBackRoll: number;
    trunkPitch: number;
    shoulderAsymmetry: number;
    upperArmElevation: number;
}

export interface SensorReferences {
    neck: Quaternion;
    lower_back: Quaternion;
    left_shoulder: Quaternion;
    right_shoulder: Quaternion;
}

interface DeviceFeatureState {
    mountingMode: SensorPlacementMode;
    calibration: PosturePayload['sensors'][];
    references: SensorReferences | null;
    previous: BaseFeatures | null;
    lastSampleTimestamp: number | null;
    featureWindow: ForecastFeatureFrame[];
}

const CALIBRATION_FRAMES = 50;
const MINIMUM_WINDOW_FRAMES = 200;
const MAXIMUM_WINDOW_FRAMES = 200;
const MINIMUM_SAMPLE_INTERVAL_MS = 80;
const SAMPLE_INTERVAL_SECONDS = 0.1;
const devices = new Map<string, DeviceFeatureState>();

export function addPostureFrame(
    payload: PosturePayload,
    timestampMs: number,
): PostureFrameResult | null {
    const state = getState(
        payload.device_id,
        payload.mounting_mode ?? 'shoulder_top',
    );
    if (
        state.lastSampleTimestamp !== null &&
        timestampMs - state.lastSampleTimestamp < MINIMUM_SAMPLE_INTERVAL_MS
    ) {
        return null;
    }
    state.lastSampleTimestamp = timestampMs;

    if (!state.references) {
        state.calibration.push(payload.sensors);
        if (state.calibration.length < CALIBRATION_FRAMES) return null;
        state.references = buildReferences(state.calibration);
        state.calibration = [];
    }

    const current = calculateBaseFeatures(
        payload.sensors,
        state.references,
        state.mountingMode,
    );
    const previous = state.previous ?? current;
    const frame: ForecastFeatureFrame = {
        neck_back_pitch: current.neckBackPitch,
        neck_back_roll: current.neckBackRoll,
        trunk_pitch: current.trunkPitch,
        shoulder_asymmetry: current.shoulderAsymmetry,
        upper_arm_elevation: current.upperArmElevation,
        neck_back_pitch_velocity:
            (current.neckBackPitch - previous.neckBackPitch) / SAMPLE_INTERVAL_SECONDS,
        neck_back_roll_velocity:
            (current.neckBackRoll - previous.neckBackRoll) / SAMPLE_INTERVAL_SECONDS,
        trunk_pitch_velocity:
            (current.trunkPitch - previous.trunkPitch) / SAMPLE_INTERVAL_SECONDS,
        shoulder_asymmetry_velocity:
            (current.shoulderAsymmetry - previous.shoulderAsymmetry) /
            SAMPLE_INTERVAL_SECONDS,
        upper_arm_elevation_velocity:
            (current.upperArmElevation - previous.upperArmElevation) /
            SAMPLE_INTERVAL_SECONDS,
    };

    state.previous = current;
    state.featureWindow.push(frame);
    if (state.featureWindow.length > MAXIMUM_WINDOW_FRAMES) {
        state.featureWindow.shift();
    }
    return {
        features: frame,
        featureWindow: state.featureWindow.length >= MINIMUM_WINDOW_FRAMES
            ? [...state.featureWindow]
            : null,
    };
}

export function resetDeviceCalibration(deviceId: string): void {
    devices.delete(deviceId);
}

export function getCalibrationProgress(deviceId: string): number {
    const state = devices.get(deviceId);
    if (!state) return 0;
    if (state.references) return 1;
    return state.calibration.length / CALIBRATION_FRAMES;
}

export function getDeviceCalibrationReferences(
    deviceId: string,
): SensorReferences | null {
    const references = devices.get(deviceId)?.references;
    if (!references) return null;
    return {
        neck: { ...references.neck },
        lower_back: { ...references.lower_back },
        left_shoulder: { ...references.left_shoulder },
        right_shoulder: { ...references.right_shoulder },
    };
}

function getState(
    deviceId: string,
    mountingMode: SensorPlacementMode = 'shoulder_top',
): DeviceFeatureState {
    let state = devices.get(deviceId);
    if (state && state.mountingMode !== mountingMode) {
        devices.delete(deviceId);
        state = undefined;
    }
    if (!state) {
        state = {
            mountingMode,
            calibration: [],
            references: null,
            previous: null,
            lastSampleTimestamp: null,
            featureWindow: [],
        };
        devices.set(deviceId, state);
    }
    return state;
}

function buildReferences(samples: PosturePayload['sensors'][]): SensorReferences {
    return {
        neck: meanQuaternion(samples.map((sample) => sample.neck.quat)),
        lower_back: meanQuaternion(samples.map((sample) => sample.lower_back.quat)),
        left_shoulder: meanQuaternion(
            samples.map((sample) => sample.left_shoulder.quat),
        ),
        right_shoulder: meanQuaternion(
            samples.map((sample) => sample.right_shoulder.quat),
        ),
    };
}

function calculateBaseFeatures(
    sensors: PosturePayload['sensors'],
    references: SensorReferences,
    mountingMode: SensorPlacementMode,
): BaseFeatures {
    const neck = relative(references.neck, sensors.neck.quat);
    const back = relative(references.lower_back, sensors.lower_back.quat);
    const left = relative(references.left_shoulder, sensors.left_shoulder.quat);
    const right = relative(references.right_shoulder, sensors.right_shoulder.quat);

    const neckToBack = relative(back, neck);
    const leftToBack = relative(back, left);
    const rightToBack = relative(back, right);
    const neckAngles = toEulerDegrees(neckToBack);
    const trunkAngles = toEulerDegrees(back);
    const leftAngles = toEulerDegrees(leftToBack);
    const rightAngles = toEulerDegrees(rightToBack);

    if (mountingMode === 'upper_arm') {
        // Upper-arm boards: +Y points proximally and +Z points inward.
        // Therefore sagittal flexion is local Z (mirrored right) and lateral
        // abduction is local X (mirrored left).
        const leftSagittal = leftAngles.yaw;
        const rightSagittal = -rightAngles.yaw;
        const leftLateral = -leftAngles.roll;
        const rightLateral = rightAngles.roll;
        return {
            neckBackPitch: neckAngles.roll,
            neckBackRoll: neckAngles.pitch,
            trunkPitch: trunkAngles.roll,
            shoulderAsymmetry: 0,
            upperArmElevation: Math.max(
                Math.hypot(leftSagittal, leftLateral),
                Math.hypot(rightSagittal, rightLateral),
            ),
        };
    }

    return {
        // Must match forecasting/features.py: local X is sagittal flexion,
        // local Y is lateral roll.
        neckBackPitch: neckAngles.roll,
        neckBackRoll: neckAngles.pitch,
        trunkPitch: trunkAngles.roll,
        shoulderAsymmetry: leftAngles.pitch - rightAngles.pitch,
        upperArmElevation: 0,
    };
}

function meanQuaternion(values: Quaternion[]): Quaternion {
    const first = normalize(values[0]);
    const sum = values.reduce(
        (accumulator, value) => {
            let current = normalize(value);
            if (dot(first, current) < 0) {
                current = scale(current, -1);
            }
            return {
                w: accumulator.w + current.w,
                x: accumulator.x + current.x,
                y: accumulator.y + current.y,
                z: accumulator.z + current.z,
            };
        },
        { w: 0, x: 0, y: 0, z: 0 },
    );
    return normalize(sum);
}

function relative(reference: Quaternion, orientation: Quaternion): Quaternion {
    return multiply(inverse(reference), orientation);
}

function inverse(value: Quaternion): Quaternion {
    const normalized = normalize(value);
    return {
        w: normalized.w,
        x: -normalized.x,
        y: -normalized.y,
        z: -normalized.z,
    };
}

function multiply(left: Quaternion, right: Quaternion): Quaternion {
    const a = normalize(left);
    const b = normalize(right);
    return normalize({
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    });
}

function normalize(value: Quaternion): Quaternion {
    const magnitude = Math.hypot(value.w, value.x, value.y, value.z);
    if (magnitude < 1e-9) throw new Error('Invalid zero-length quaternion');
    return {
        w: value.w / magnitude,
        x: value.x / magnitude,
        y: value.y / magnitude,
        z: value.z / magnitude,
    };
}

function dot(left: Quaternion, right: Quaternion): number {
    return (
        left.w * right.w +
        left.x * right.x +
        left.y * right.y +
        left.z * right.z
    );
}

function scale(value: Quaternion, factor: number): Quaternion {
    return {
        w: value.w * factor,
        x: value.x * factor,
        y: value.y * factor,
        z: value.z * factor,
    };
}

function toEulerDegrees(value: Quaternion): {
    roll: number;
    pitch: number;
    yaw: number;
} {
    const { w, x, y, z } = normalize(value);
    const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    const degrees = 180 / Math.PI;
    return {
        roll: roll * degrees,
        pitch: pitch * degrees,
        yaw: yaw * degrees,
    };
}

