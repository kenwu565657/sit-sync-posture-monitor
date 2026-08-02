import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
    relativeQuaternion,
    retargetSensorDelta,
} from './sensorRetarget';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

function rotation(axis: Vector3, degrees: number): Quaternion {
    return new Quaternion().setFromAxisAngle(
        axis,
        (degrees * Math.PI) / 180,
    );
}

function expectSameRotation(actual: Quaternion, expected: Quaternion): void {
    expect(Math.abs(actual.dot(expected))).toBeGreaterThan(0.999999);
}

describe('sensor quaternion retargeting', () => {
    it('matches backend reference-inverse times current calibration', () => {
        expectSameRotation(
            relativeQuaternion(rotation(X, 5), rotation(X, 20)),
            rotation(X, 15),
        );
    });

    it('keeps trunk and shoulder-top rotations on matching axes', () => {
        const flexion = rotation(X, 10);
        expectSameRotation(
            retargetSensorDelta('lower_back', flexion),
            rotation(X, 10),
        );
        expectSameRotation(
            retargetSensorDelta('neck', flexion),
            rotation(X, 10),
        );
        expectSameRotation(
            retargetSensorDelta('left_shoulder', flexion),
            rotation(X, 10),
        );
        expectSameRotation(
            retargetSensorDelta('right_shoulder', flexion),
            rotation(X, 10),
        );
    });

    it('uses the same board-frame conversion on both shoulder-top nodes', () => {
        const lateral = rotation(Y, 10);
        expectSameRotation(
            retargetSensorDelta('left_shoulder', lateral),
            rotation(Y, 10),
        );
        expectSameRotation(
            retargetSensorDelta('right_shoulder', lateral),
            rotation(Y, 10),
        );
    });

    it('maps mirrored upper-arm board axes to symmetric arm motion', () => {
        expectSameRotation(
            retargetSensorDelta(
                'left_shoulder',
                rotation(Z, 10),
                'upper_arm',
            ),
            rotation(Z, -10),
        );
        expectSameRotation(
            retargetSensorDelta(
                'right_shoulder',
                rotation(Z, -10),
                'upper_arm',
            ),
            rotation(Z, 10),
        );
        expectSameRotation(
            retargetSensorDelta(
                'left_shoulder',
                rotation(X, -10),
                'upper_arm',
            ),
            rotation(X, -10),
        );
        expectSameRotation(
            retargetSensorDelta(
                'right_shoulder',
                rotation(X, 10),
                'upper_arm',
            ),
            rotation(X, -10),
        );
    });
});

