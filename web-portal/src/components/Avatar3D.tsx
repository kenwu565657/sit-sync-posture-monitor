import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Quaternion, Object3D } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import type { GLTF } from 'three-stdlib';
import {
    relativeQuaternion,
    retargetSensorDelta,
} from '../math/sensorRetarget';
import type { SensorKey } from '../math/sensorRetarget';
import type { SensorPlacementMode } from '../math/sensorRetarget';

export interface SensorData {
    quat: { w: number; x: number; y: number; z: number };
}
export interface SensorSet {
    neck?: SensorData;
    lower_back?: SensorData;
    left_shoulder?: SensorData;
    right_shoulder?: SensorData;
}
interface Avatar3DProps {
    sensors?: SensorSet;
    referenceSensors?: SensorSet;
    enableCalibration?: boolean;
    calibrationRevision?: number;
    onCalibrated?: () => void;
    smoothingFactor?: number;
    mountingMode?: SensorPlacementMode;
    scale?: number;
}

const SENSOR_KEYS: SensorKey[] = [
    'neck',
    'lower_back',
    'left_shoulder',
    'right_shoulder',
];

function sensorQuaternion(sensor: SensorData): Quaternion {
    return new Quaternion(
        sensor.quat.x,
        sensor.quat.y,
        sensor.quat.z,
        sensor.quat.w,
    ).normalize();
}

function findMixamoBone(root: Object3D, part: string): Object3D | undefined {
    return [
        `mixamorig${part}`,
        `mixamorig:${part}`,
        `mixamorig_${part}`,
    ]
        .map((name) => root.getObjectByName(name))
        .find((bone): bone is Object3D => bone !== undefined);
}

export default function Avatar3D({
    sensors,
    referenceSensors,
    enableCalibration = false,
    calibrationRevision = 0,
    onCalibrated,
    smoothingFactor = 0.15,
    mountingMode = 'shoulder_top',
    scale = 1.5,
}: Avatar3DProps) {
    const { scene } = useGLTF('/model.glb') as GLTF;
    const avatarScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
    const modelRef = useRef<Object3D>(null);
    const bones = useRef<Record<string, Object3D>>({});
    const baseQuats = useRef<Record<string, Quaternion>>({});
    const sensorReferences = useRef<Partial<Record<SensorKey, Quaternion>>>({});
    const calibratedRevision = useRef<number | null>(null);
    const recordedReferenceSource = useRef<SensorSet | null>(null);
    const onCalibratedRef = useRef(onCalibrated);

    useEffect(() => {
        onCalibratedRef.current = onCalibrated;
    }, [onCalibrated]);

    useEffect(() => {
        const root = modelRef.current;
        if (!root) return;
        const loadedBones = Object.fromEntries(
            [
                'Hips',
                'LeftUpLeg',
                'RightUpLeg',
                'LeftLeg',
                'RightLeg',
                'LeftShoulder',
                'RightShoulder',
                'LeftArm',
                'RightArm',
                'LeftForeArm',
                'RightForeArm',
                'Neck',
                'Spine',
            ].map((part) => [`mixamorig${part}`, findMixamoBone(root, part)]),
        ) as Record<string, Object3D | undefined>;
        if (Object.values(loadedBones).some((bone) => !bone)) return;
        const nodes = loadedBones as Record<string, Object3D>;
        bones.current = nodes;

        nodes.mixamorigHips.position.y = 0.5;

        // Legs
        nodes.mixamorigLeftUpLeg.rotation.x = -1.5;
        nodes.mixamorigRightUpLeg.rotation.x = -1.5;
        nodes.mixamorigLeftLeg.rotation.x = -1.5;
        nodes.mixamorigRightLeg.rotation.x = -1.5;

        // Arms (Typing Posture)
        nodes.mixamorigLeftArm.rotation.z = 0.5;
        nodes.mixamorigRightArm.rotation.z = -0.5;
        nodes.mixamorigLeftArm.rotation.x = 1;
        nodes.mixamorigRightArm.rotation.x = 1;
        nodes.mixamorigLeftForeArm.rotation.x = 0.5;
        nodes.mixamorigRightForeArm.rotation.x = 0.5;

        baseQuats.current['neck'] = nodes.mixamorigNeck.quaternion.clone();
        baseQuats.current['spine'] = nodes.mixamorigSpine.quaternion.clone();
        baseQuats.current['leftShoulder'] =
            nodes.mixamorigLeftShoulder.quaternion.clone();
        baseQuats.current['rightShoulder'] =
            nodes.mixamorigRightShoulder.quaternion.clone();
        baseQuats.current['leftArm'] =
            nodes.mixamorigLeftArm.quaternion.clone();
        baseQuats.current['rightArm'] =
            nodes.mixamorigRightArm.quaternion.clone();
        sensorReferences.current = {};
        calibratedRevision.current = null;
        recordedReferenceSource.current = null;
    }, [avatarScene]);

    useEffect(() => {
        sensorReferences.current = {};
        calibratedRevision.current = null;
        recordedReferenceSource.current = null;
    }, [mountingMode]);

    useFrame(() => {
        const nodes = bones.current;
        if (
            !sensors ||
            !baseQuats.current.neck ||
            !nodes.mixamorigNeck ||
            !SENSOR_KEYS.every((key) => sensors[key])
        ) {
            return;
        }

        if (
            referenceSensors &&
            SENSOR_KEYS.every((key) => referenceSensors[key]) &&
            recordedReferenceSource.current !== referenceSensors
        ) {
            sensorReferences.current = Object.fromEntries(
                SENSOR_KEYS.map((key) => [
                    key,
                    sensorQuaternion(referenceSensors[key] as SensorData),
                ]),
            );
            recordedReferenceSource.current = referenceSensors;
        } else if (
            !referenceSensors &&
            enableCalibration &&
            calibratedRevision.current !== calibrationRevision
        ) {
            sensorReferences.current = Object.fromEntries(
                SENSOR_KEYS.map((key) => [
                    key,
                    sensorQuaternion(sensors[key] as SensorData),
                ]),
            );
            calibratedRevision.current = calibrationRevision;
            onCalibratedRef.current?.();
        } else if (
            !referenceSensors &&
            !enableCalibration &&
            calibratedRevision.current === null
        ) {
            sensorReferences.current = Object.fromEntries(
                SENSOR_KEYS.map((key) => [key, new Quaternion()]),
            );
            calibratedRevision.current = calibrationRevision;
        }

        const calibratedDeltas = Object.fromEntries(
            SENSOR_KEYS.map((key) => {
                const current = sensorQuaternion(sensors[key] as SensorData);
                const reference = sensorReferences.current[key] as Quaternion;
                return [key, relativeQuaternion(reference, current)];
            }),
        ) as Record<SensorKey, Quaternion>;

        const boneDeltas = {
            spine: retargetSensorDelta(
                'lower_back',
                calibratedDeltas.lower_back,
                mountingMode,
            ),
            neck: retargetSensorDelta(
                'neck',
                calibratedDeltas.neck,
                mountingMode,
            ),
            leftShoulder: retargetSensorDelta(
                'left_shoulder',
                calibratedDeltas.left_shoulder,
                mountingMode,
            ),
            rightShoulder: retargetSensorDelta(
                'right_shoulder',
                calibratedDeltas.right_shoulder,
                mountingMode,
            ),
        };

        const applyDelta = (
            bone: Object3D,
            baseName:
                | 'neck'
                | 'spine'
                | 'leftShoulder'
                | 'rightShoulder'
                | 'leftArm'
                | 'rightArm',
            delta: Quaternion,
        ) => {
            const target = baseQuats.current[baseName].clone().multiply(delta);
            bone.quaternion.slerp(
                target,
                Math.max(0, Math.min(1, smoothingFactor)),
            );
        };

        applyDelta(nodes.mixamorigSpine, 'spine', boneDeltas.spine);
        applyDelta(nodes.mixamorigNeck, 'neck', boneDeltas.neck);
        if (mountingMode === 'upper_arm') {
            applyDelta(
                nodes.mixamorigLeftArm,
                'leftArm',
                boneDeltas.leftShoulder,
            );
            applyDelta(
                nodes.mixamorigRightArm,
                'rightArm',
                boneDeltas.rightShoulder,
            );
        } else {
            applyDelta(
                nodes.mixamorigLeftShoulder,
                'leftShoulder',
                boneDeltas.leftShoulder,
            );
            applyDelta(
                nodes.mixamorigRightShoulder,
                'rightShoulder',
                boneDeltas.rightShoulder,
            );
        }
    });

    return (
        <primitive
            ref={modelRef}
            object={avatarScene}
            scale={scale}
            position={[0, -0.8, 0]}
        />
    );
}

useGLTF.preload('/model.glb');