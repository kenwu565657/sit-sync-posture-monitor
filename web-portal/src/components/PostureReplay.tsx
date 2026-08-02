import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Quaternion } from 'three';
import Avatar3D from './Avatar3D';
import type { SensorSet } from './Avatar3D';

const SENSOR_KEYS = [
    'neck',
    'lower_back',
    'left_shoulder',
    'right_shoulder',
] as const;

export interface ReplayFrame {
    offset_ms: number;
    timestamp: number;
    sensors: SensorSet;
    rula_score: number;
    cva_angle?: number | null;
    status: 'good' | 'warning' | 'critical';
    forecast_probability?: number;
    forecast_level?: 'CALIBRATING' | 'COLLECTING' | 'LOW' | 'ELEVATED' | 'HIGH' | 'OFFLINE';
    forecast_horizon_seconds?: number;
    forecast_generated_at_ms?: number;
}

export interface ReplayData {
    mounting_mode?: 'shoulder_top' | 'upper_arm';
    sample_hz: number;
    reference_sensors: SensorSet;
    frames: ReplayFrame[];
    truncated: boolean;
    incident_onset_offset_ms?: number;
}

interface PostureReplayProps {
    replay: ReplayData;
    eventLabel: string;
    minimumCvaAngle?: number | null;
}

function quaternionAt(
    sensors: SensorSet,
    key: (typeof SENSOR_KEYS)[number],
): Quaternion {
    const value = sensors[key]?.quat;
    if (!value) return new Quaternion();
    return new Quaternion(value.x, value.y, value.z, value.w).normalize();
}

function interpolateReplaySensors(
    frames: ReplayFrame[],
    positionMs: number,
): SensorSet | undefined {
    if (!frames.length) return undefined;
    if (positionMs <= frames[0].offset_ms) return frames[0].sensors;
    const finalFrame = frames.at(-1) as ReplayFrame;
    if (positionMs >= finalFrame.offset_ms) return finalFrame.sensors;

    let low = 0;
    let high = frames.length - 1;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (frames[middle].offset_ms <= positionMs) low = middle;
        else high = middle;
    }
    const before = frames[low];
    const after = frames[high];
    const span = Math.max(1, after.offset_ms - before.offset_ms);
    const alpha = (positionMs - before.offset_ms) / span;
    return Object.fromEntries(
        SENSOR_KEYS.map((key) => {
            const interpolated = quaternionAt(before.sensors, key).slerp(
                quaternionAt(after.sensors, key),
                alpha,
            );
            return [
                key,
                {
                    quat: {
                        w: interpolated.w,
                        x: interpolated.x,
                        y: interpolated.y,
                        z: interpolated.z,
                    },
                },
            ];
        }),
    ) as SensorSet;
}

function formatTime(milliseconds: number): string {
    const totalSeconds = milliseconds / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

export default function PostureReplay({
    replay,
    eventLabel,
    minimumCvaAngle,
}: PostureReplayProps) {
    const durationMs = replay.frames.at(-1)?.offset_ms ?? 0;
    const [positionMs, setPositionMs] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [detailsVisible, setDetailsVisible] = useState(true);
    const positionRef = useRef(0);

    useEffect(() => {
        if (!playing) return;
        const startedAt = performance.now();
        const startedPosition = positionRef.current;
        let animationFrame = 0;
        const advance = (now: number) => {
            const next = Math.min(
                durationMs,
                startedPosition + (now - startedAt) * speed,
            );
            positionRef.current = next;
            setPositionMs(next);
            if (next >= durationMs) {
                setPlaying(false);
                return;
            }
            animationFrame = requestAnimationFrame(advance);
        };
        animationFrame = requestAnimationFrame(advance);
        return () => cancelAnimationFrame(animationFrame);
    }, [durationMs, playing, speed]);

    const sensors = useMemo(
        () => interpolateReplaySensors(replay.frames, positionMs),
        [positionMs, replay.frames],
    );
    const currentFrame = replay.frames.reduce(
        (selected, frame) =>
            frame.offset_ms <= positionMs ? frame : selected,
        replay.frames[0],
    );
    const onsetOffsetMs = replay.incident_onset_offset_ms ?? 0;
    const predictionOffsetMs = replay.frames.find(
        (frame) =>
            frame.forecast_level === 'ELEVATED' ||
            frame.forecast_level === 'HIGH',
    )?.offset_ms;
    const beforeOnset = positionMs < onsetOffsetMs;
    const timeUntilOnsetSeconds = Math.max(
        0,
        (onsetOffsetMs - positionMs) / 1000,
    );

    const togglePlayback = () => {
        if (playing) {
            setPlaying(false);
            return;
        }
        if (positionRef.current >= durationMs) {
            positionRef.current = 0;
            setPositionMs(0);
        }
        setPlaying(true);
    };

    return (
        <div style={styles.container}>
            <div style={styles.viewerOverlay}>
                <div style={styles.viewerHeader}>
                    <h3 style={styles.viewerTitle}>Recorded posture</h3>
                    <button
                        type="button"
                        aria-label={
                            detailsVisible
                                ? 'Hide recorded posture details'
                                : 'Show recorded posture details'
                        }
                        aria-expanded={detailsVisible}
                        title={detailsVisible ? 'Hide details' : 'Show details'}
                        style={styles.overlayToggle}
                        onClick={() => setDetailsVisible((visible) => !visible)}
                    >
                        {detailsVisible ? '▴' : '▾'}
                    </button>
                </div>
                {detailsVisible && (
                    <>
                        <strong style={{
                            color: beforeOnset
                                ? '#22d3ee'
                                : currentFrame?.status === 'critical'
                                  ? '#f87171'
                                  : '#fbbf24',
                        }}>
                            {beforeOnset
                                ? 'PREDICTED RISK'
                                : currentFrame?.status.toUpperCase() ?? eventLabel}
                        </strong>
                        <p style={styles.viewerMeta}>
                            Estimated RULA {currentFrame?.rula_score ?? '—'}
                            {' · '}Derived CVA {currentFrame?.cva_angle == null
                                ? '—'
                                : `${currentFrame.cva_angle.toFixed(1)}°`}
                            {currentFrame?.forecast_probability == null
                                ? ''
                                : ` · Forecast ${Math.round(
                                    currentFrame.forecast_probability * 100,
                                )}%`}
                            {' · '}{replay.sample_hz} Hz recording
                        </p>
                        <p style={styles.viewerMeta}>
                            Event minimum CVA-like angle: {minimumCvaAngle == null
                                ? '—'
                                : `${minimumCvaAngle.toFixed(1)}°`}
                        </p>
                        {beforeOnset && (
                            <p style={styles.predictionLead}>
                                {timeUntilOnsetSeconds.toFixed(1)} seconds before
                                detected incident
                            </p>
                        )}
                    </>
                )}
            </div>
            <div style={styles.canvasWrapper}>
                <Canvas camera={{ position: [0, 1, 3], fov: 50 }}>
                    <ambientLight intensity={1} />
                    <directionalLight position={[2, 2, 2]} intensity={1.5} />
                    <group position={[0, -0.6, 0]}>
                        <Avatar3D
                            sensors={sensors}
                            referenceSensors={replay.reference_sensors}
                            mountingMode={replay.mounting_mode ?? 'shoulder_top'}
                            smoothingFactor={1}
                        />
                    </group>
                    <OrbitControls enablePan={false} />
                </Canvas>
            </div>
            <div style={styles.controls}>
                <button
                    type="button"
                    onClick={togglePlayback}
                    style={styles.playButton}
                    disabled={durationMs === 0}
                >
                    {playing ? 'Pause' : positionMs >= durationMs ? 'Replay' : 'Play'}
                </button>
                <span style={styles.time}>
                    {formatTime(positionMs)} / {formatTime(durationMs)}
                </span>
                <div style={styles.scrubberWrap}>
                    <input
                        aria-label="Replay position"
                        type="range"
                        min={0}
                        max={Math.max(1, durationMs)}
                        step={20}
                        value={positionMs}
                        style={styles.scrubber}
                        onChange={(event) => {
                            const next = Number(event.target.value);
                            setPlaying(false);
                            positionRef.current = next;
                            setPositionMs(next);
                        }}
                    />
                    {predictionOffsetMs != null && durationMs > 0 && (
                        <span
                            title="First elevated prediction"
                            style={{
                                ...styles.timelineMarker,
                                ...styles.predictionMarker,
                                left: `${(predictionOffsetMs / durationMs) * 100}%`,
                            }}
                        >
                            P
                        </span>
                    )}
                    {onsetOffsetMs > 0 && durationMs > 0 && (
                        <span
                            title="Detected incident onset"
                            style={{
                                ...styles.timelineMarker,
                                ...styles.onsetMarker,
                                left: `${(onsetOffsetMs / durationMs) * 100}%`,
                            }}
                        >
                            I
                        </span>
                    )}
                </div>
                <div style={styles.speedControls} aria-label="Playback speed">
                    {[0.5, 1, 2].map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setSpeed(value)}
                            style={{
                                ...styles.speedButton,
                                ...(speed === value ? styles.speedButtonActive : {}),
                            }}
                        >
                            {value}×
                        </button>
                    ))}
                </div>
            </div>
            {replay.truncated && (
                <div style={styles.notice}>
                    This incident exceeded five minutes. The replay shows the
                    first recorded segment.
                </div>
            )}
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        position: 'relative',
        minHeight: '650px',
        overflow: 'hidden',
        border: '1px solid #334155',
        borderRadius: '12px',
        color: '#f8fafc',
        backgroundColor: '#1e293b',
    },
    viewerOverlay: {
        position: 'absolute',
        top: '18px',
        left: '18px',
        zIndex: 10,
        maxWidth: '70%',
        padding: '13px',
        borderRadius: '8px',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(4px)',
    },
    viewerHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '14px',
    },
    viewerTitle: { margin: 0 },
    overlayToggle: {
        width: '28px',
        height: '28px',
        padding: 0,
        border: '1px solid #475569',
        borderRadius: '6px',
        color: '#cbd5e1',
        backgroundColor: '#1e293b',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '26px',
    },
    viewerMeta: { margin: '5px 0 0', color: '#94a3b8', fontSize: '13px' },
    predictionLead: {
        margin: '7px 0 0',
        color: '#67e8f9',
        fontSize: '12px',
        fontWeight: 700,
    },
    canvasWrapper: { height: '560px', width: '100%' },
    controls: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '70px',
        padding: '12px 16px',
        borderTop: '1px solid #334155',
        backgroundColor: '#0f172a',
    },
    playButton: {
        minWidth: '72px',
        padding: '9px 14px',
        border: 0,
        borderRadius: '7px',
        color: '#083344',
        backgroundColor: '#22d3ee',
        cursor: 'pointer',
        fontWeight: 800,
    },
    time: { minWidth: '92px', color: '#cbd5e1', fontSize: '12px' },
    scrubberWrap: {
        position: 'relative',
        flex: 1,
        minWidth: '100px',
        paddingTop: '18px',
    },
    scrubber: { width: '100%', accentColor: '#22d3ee' },
    timelineMarker: {
        position: 'absolute',
        top: 0,
        width: '18px',
        height: '18px',
        marginLeft: '-9px',
        borderRadius: '50%',
        color: '#0f172a',
        textAlign: 'center',
        fontSize: '10px',
        fontWeight: 900,
        lineHeight: '18px',
    },
    predictionMarker: { backgroundColor: '#22d3ee' },
    onsetMarker: { backgroundColor: '#f87171' },
    speedControls: { display: 'flex', gap: '4px' },
    speedButton: {
        padding: '6px 8px',
        border: '1px solid #475569',
        borderRadius: '5px',
        color: '#94a3b8',
        backgroundColor: '#1e293b',
        cursor: 'pointer',
    },
    speedButtonActive: {
        borderColor: '#22d3ee',
        color: '#cffafe',
        backgroundColor: '#164e63',
    },
    notice: {
        padding: '9px 14px',
        borderTop: '1px solid #92400e',
        color: '#fde68a',
        backgroundColor: '#422006',
        fontSize: '12px',
    },
};