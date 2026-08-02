import { Matrix4, Quaternion, Vector3 } from 'three';

export type SensorKey =
    | 'neck'
    | 'lower_back'
    | 'left_shoulder'
    | 'right_shoulder';
export type SensorPlacementMode = 'shoulder_top' | 'upper_arm';

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const NEGATIVE_X = new Vector3(-1, 0, 0);
const NEGATIVE_Y = new Vector3(0, -1, 0);
const NEGATIVE_Z = new Vector3(0, 0, -1);

function alignmentFromBasis(
    sensorXInBone: Vector3,
    sensorYInBone: Vector3,
    sensorZInBone: Vector3,
): Quaternion {
    return new Quaternion()
        .setFromRotationMatrix(
            new Matrix4().makeBasis(
                sensorXInBone,
                sensorYInBone,
                sensorZInBone,
            ),
        )
        .normalize();
}

// With the current inward-facing neck/back mount, sensor local +X and the
// Mixamo spine/neck local +X represent the same sagittal direction.
const SPINE_ALIGNMENT = new Quaternion();
const SHOULDER_TOP_ALIGNMENT = new Quaternion();

export const SHOULDER_TOP_ALIGNMENTS: Record<SensorKey, Quaternion> = {
    // BNO085 +X is sagittal flexion and maps directly to Mixamo local +X.
    lower_back: SPINE_ALIGNMENT.clone(),
    neck: SPINE_ALIGNMENT.clone(),
    // Both shoulder-top boards use the same orientation. Keep their calibrated
    // X/Y/Z rotations on the matching Mixamo local axes; the rest-pose bone
    // quaternions already contain the anatomical left/right mirror.
    left_shoulder: SHOULDER_TOP_ALIGNMENT.clone(),
    right_shoulder: SHOULDER_TOP_ALIGNMENT.clone(),
};

export const UPPER_ARM_ALIGNMENTS: Record<SensorKey, Quaternion> = {
    lower_back: SPINE_ALIGNMENT.clone(),
    neck: SPINE_ALIGNMENT.clone(),
    // Both boards use +Y toward the shoulder and printed +Z into the arm.
    // The mirrored bases keep equal anatomical motion symmetric on the avatar.
    left_shoulder: alignmentFromBasis(X, NEGATIVE_Y, NEGATIVE_Z),
    right_shoulder: alignmentFromBasis(NEGATIVE_X, Y, NEGATIVE_Z),
};

export const SENSOR_BONE_ALIGNMENTS = SHOULDER_TOP_ALIGNMENTS;

/** Match backend/ML relative(reference, orientation). */
export function relativeQuaternion(
    reference: Quaternion,
    orientation: Quaternion,
): Quaternion {
    return reference.clone().invert().multiply(orientation).normalize();
}

/** Convert a calibrated BNO085 delta into a Mixamo bone-local delta. */
export function retargetSensorDelta(
    sensor: SensorKey,
    delta: Quaternion,
    mountingMode: SensorPlacementMode = 'shoulder_top',
): Quaternion {
    const alignment = mountingMode === 'upper_arm'
        ? UPPER_ARM_ALIGNMENTS[sensor]
        : SHOULDER_TOP_ALIGNMENTS[sensor];
    return alignment
        .clone()
        .multiply(delta)
        .multiply(alignment.clone().invert())
        .normalize();
}

