import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, Quaternion } from 'three';
import { type Quaternion as WSQuaternion } from '../hooks/usePostureSocket';

interface Avatar3DProps {
    neckQuat?: WSQuaternion;
    status?: 'good' | 'warning' | 'critical';
}

export default function Avatar3D({ neckQuat, status = 'good' }: Avatar3DProps) {
    const neckRef = useRef<Mesh>(null);

    // Determine the color based on the RULA status
    const statusColor = status === 'good' ? '#22c55e' : status === 'warning' ? '#eab308' : '#ef4444';

    // The Three.js animation loop (runs 60 times a second)
    useFrame(() => {
        if (neckRef.current && neckQuat) {
            // Apply the incoming hardware quaternion to the 3D mesh
            const targetQuat = new Quaternion(neckQuat.x, neckQuat.y, neckQuat.z, neckQuat.w);
            
            // Slerp (Spherical Linear Interpolation) smooths the movement so it doesn't jitter
            neckRef.current.quaternion.slerp(targetQuat, 0.1); 
        }
    });

    return (
        <group position={[0, -1, 0]}>
            {/* The Base/Hips (Static) */}
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[1, 0.5, 0.5]} />
                <meshStandardMaterial color="#64748b" />
            </mesh>

            {/* The Spine (Static for now, will move when you add the Lower Back sensor) */}
            <mesh position={[0, 1.5, 0]}>
                <cylinderGeometry args={[0.2, 0.2, 2.5]} />
                <meshStandardMaterial color="#94a3b8" />
            </mesh>

            {/* The Neck/Head (Dynamic - Driven by STM32) */}
            <mesh ref={neckRef} position={[0, 3, 0]}>
                <boxGeometry args={[0.8, 0.8, 0.8]} />
                <meshStandardMaterial color={statusColor} />
            </mesh>
        </group>
    );
}