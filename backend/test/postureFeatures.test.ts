import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    addPostureFrame,
    getCalibrationProgress,
    resetDeviceCalibration,
} from '../src/service/postureFeatures.js';
import { PosturePayload, Quaternion } from '../src/types/index.js';
import type { SensorPlacementMode } from '../src/types/index.js';

test('10 Hz features use fixed velocity timing and expose only a 200-frame window', () => {
    const deviceId = 'feature-rate-device';
    resetDeviceCalibration(deviceId);

    for (let index = 0; index < 50; index += 1) {
        addPostureFrame(payload(deviceId, identity()), index * 100);
    }

    const changed = addPostureFrame(
        payload(deviceId, xRotation(10)),
        5000,
    );
    assert.ok(changed);
    assert.ok(Math.abs(changed.features.neck_back_pitch_velocity) > 99);
    assert.ok(Math.abs(changed.features.neck_back_pitch_velocity) < 101);
    assert.equal(changed.featureWindow, null);

    assert.equal(
        addPostureFrame(payload(deviceId, xRotation(10)), 5079),
        null,
    );

    let result = changed;
    for (let index = 51; index <= 248; index += 1) {
        result = addPostureFrame(
            payload(deviceId, xRotation(10)),
            index * 100,
        )!;
    }
    assert.equal(result.featureWindow?.length, 200);
});

test('changing mounting mode discards calibration and feature history', () => {
    const deviceId = 'feature-mode-device';
    resetDeviceCalibration(deviceId);
    for (let index = 0; index < 50; index += 1) {
        addPostureFrame(
            payload(deviceId, identity(), 'shoulder_top'),
            index * 100,
        );
    }
    assert.equal(getCalibrationProgress(deviceId), 1);

    assert.equal(
        addPostureFrame(
            payload(deviceId, identity(), 'upper_arm'),
            5000,
        ),
        null,
    );
    assert.equal(getCalibrationProgress(deviceId), 1 / 50);
});

test('upper-arm mode maps mirrored local Z motion to arm elevation', () => {
    const deviceId = 'upper-arm-transform-device';
    resetDeviceCalibration(deviceId);
    for (let index = 0; index < 50; index += 1) {
        addPostureFrame(
            payload(deviceId, identity(), 'upper_arm'),
            index * 100,
        );
    }
    const frame = payload(deviceId, identity(), 'upper_arm');
    frame.sensors.left_shoulder.quat = zRotation(30);
    const result = addPostureFrame(frame, 5000);
    assert.ok(result);
    assert.ok(Math.abs((result.features.upper_arm_elevation ?? 0) - 30) < 0.01);
    assert.equal(result.features.shoulder_asymmetry, 0);
});

function payload(
    deviceId: string,
    neck: Quaternion,
    mountingMode?: SensorPlacementMode,
): PosturePayload {
    const neutral = identity();
    return {
        schema_version: 1,
        timestamp: 0,
        device_id: deviceId,
        user_id: 'feature-user',
        mounting_mode: mountingMode,
        sensors: {
            neck: { quat: neck },
            lower_back: { quat: neutral },
            left_shoulder: { quat: neutral },
            right_shoulder: { quat: neutral },
        },
    };
}

function identity(): Quaternion {
    return { w: 1, x: 0, y: 0, z: 0 };
}

function xRotation(degrees: number): Quaternion {
    const half = (degrees * Math.PI) / 360;
    return { w: Math.cos(half), x: Math.sin(half), y: 0, z: 0 };
}

function zRotation(degrees: number): Quaternion {
    const half = (degrees * Math.PI) / 360;
    return { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) };
}
