import pool from './src/db.js';
import type { PosturePayload, Quaternion } from './src/types/index.js';

const SAMPLE_HZ = 5;
const DEMO_DEVICE_ID = 'demo-replay';

interface DemoDefinition {
    minutesAgo: number;
    durationSeconds: number;
    eventType: 'warning' | 'critical';
    peakRulaScore: number;
    neckDegrees: number;
    trunkDegrees: number;
    shoulderDegrees: number;
}

const demos: DemoDefinition[] = [
    {
        minutesAgo: 35,
        durationSeconds: 18,
        eventType: 'warning',
        peakRulaScore: 4,
        neckDegrees: 24,
        trunkDegrees: 12,
        shoulderDegrees: 8,
    },
    {
        minutesAgo: 70,
        durationSeconds: 26,
        eventType: 'critical',
        peakRulaScore: 7,
        neckDegrees: 42,
        trunkDegrees: 28,
        shoulderDegrees: 15,
    },
    {
        minutesAgo: 125,
        durationSeconds: 34,
        eventType: 'warning',
        peakRulaScore: 5,
        neckDegrees: 31,
        trunkDegrees: 18,
        shoulderDegrees: 11,
    },
];

function axisQuaternion(
    axis: 'x' | 'z',
    degrees: number,
): Quaternion {
    const halfAngle = (degrees * Math.PI) / 360;
    return {
        w: Math.cos(halfAngle),
        x: axis === 'x' ? Math.sin(halfAngle) : 0,
        y: 0,
        z: axis === 'z' ? Math.sin(halfAngle) : 0,
    };
}

function sensorsAt(
    definition: DemoDefinition,
    movement: number,
): PosturePayload['sensors'] {
    return {
        neck: {
            quat: axisQuaternion('x', definition.neckDegrees * movement),
        },
        lower_back: {
            quat: axisQuaternion('x', definition.trunkDegrees * movement),
        },
        left_shoulder: {
            quat: axisQuaternion('z', definition.shoulderDegrees * movement),
        },
        right_shoulder: {
            quat: axisQuaternion('z', -definition.shoulderDegrees * movement),
        },
    };
}

function buildReplay(definition: DemoDefinition, startedAt: number) {
    const preRollMs = 5000;
    const replayStartedAt = startedAt - preRollMs;
    const frameCount =
        (definition.durationSeconds * SAMPLE_HZ) +
        (preRollMs / 1000) * SAMPLE_HZ +
        1;
    return Array.from({ length: frameCount }, (_, index) => {
        const offsetMs = (index * 1000) / SAMPLE_HZ;
        const incidentElapsedMs = offsetMs - preRollMs;
        const incidentProgress = Math.max(
            0,
            Math.min(
                1,
                incidentElapsedMs / (definition.durationSeconds * 1000),
            ),
        );
        const beforeOnset = incidentElapsedMs < 0;
        const intensity = beforeOnset
            ? 0
            : Math.sin(Math.PI * incidentProgress);
        const movement = beforeOnset
            ? 0.05 + (offsetMs / preRollMs) * 0.2
            : 0.25 + intensity * 0.75;
        const probability = beforeOnset
            ? 0.58 + (offsetMs / preRollMs) * 0.27
            : Math.max(0.55, 0.85 - incidentProgress * 0.22);
        const generatedAtMs =
            replayStartedAt + Math.floor(offsetMs / 1000) * 1000;
        const cvaAngle = Math.max(
            20,
            Math.min(
                60,
                55 -
                    definition.neckDegrees * movement * 0.7 -
                    definition.trunkDegrees * movement * 0.2,
            ),
        );
        return {
            offset_ms: offsetMs,
            timestamp: replayStartedAt + offsetMs,
            sensors: sensorsAt(definition, movement),
            rula_score: beforeOnset
                ? 1
                : Math.max(
                    2,
                    Math.round(
                        2 +
                            (definition.peakRulaScore - 2) *
                                intensity,
                    ),
                ),
            cva_angle: cvaAngle,
            status:
                beforeOnset
                    ? 'good'
                    : definition.eventType === 'critical' && intensity > 0.62
                    ? 'critical'
                    : 'warning',
            forecast_probability: probability,
            forecast_level:
                probability >= 0.75 ? 'HIGH' : 'ELEVATED',
            forecast_horizon_seconds: 5,
            forecast_generated_at_ms: generatedAtMs,
        };
    });
}

async function seedReplayEvents(): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: users } = await client.query<{ id: string }>(
            `SELECT id
             FROM users
             ORDER BY (email = 'alex@example.com') DESC, created_at
             LIMIT 1`,
        );
        const userId = users[0]?.id;
        if (!userId) {
            throw new Error('No user exists. Run npx tsx seed.ts first.');
        }

        await client.query(
            `DELETE FROM posture_events
             WHERE owner_user_id = $1 AND device_id = $2`,
            [userId, DEMO_DEVICE_ID],
        );

        const identity = { w: 1, x: 0, y: 0, z: 0 };
        const referenceSensors: PosturePayload['sensors'] = {
            neck: { quat: identity },
            lower_back: { quat: identity },
            left_shoulder: { quat: identity },
            right_shoulder: { quat: identity },
        };
        const eventIds: number[] = [];

        for (const definition of demos) {
            const startedAt = Date.now() - definition.minutesAgo * 60_000;
            const frames = buildReplay(definition, startedAt);
            const minimumCvaFrame = frames.reduce((minimum, frame) =>
                frame.cva_angle < minimum.cva_angle ? frame : minimum,
            );
            const { rows } = await client.query<{ id: number }>(
                `INSERT INTO posture_events
                    (user_id, owner_user_id, device_id, event_type,
                     duration_seconds, peak_rula_score, minimum_cva_angle,
                     sensor_snapshot, logged_at)
                 VALUES ($1::TEXT, $1::UUID, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id`,
                [
                    userId,
                    DEMO_DEVICE_ID,
                    definition.eventType,
                    definition.durationSeconds,
                    definition.peakRulaScore,
                    minimumCvaFrame.cva_angle,
                    {
                        timestamp: minimumCvaFrame.timestamp,
                        sensors: minimumCvaFrame.sensors,
                        metrics: {
                            rula_score: definition.peakRulaScore,
                            cva_angle: minimumCvaFrame.cva_angle,
                            status: definition.eventType,
                        },
                    },
                    new Date(startedAt),
                ],
            );
            await client.query(
                `INSERT INTO posture_event_replays
                    (event_id, sample_hz, reference_sensors, frames, truncated,
                     incident_onset_offset_ms)
                 VALUES ($1, $2, $3, $4, FALSE, $5)`,
                [
                    rows[0].id,
                    SAMPLE_HZ,
                    JSON.stringify(referenceSensors),
                    JSON.stringify(frames),
                    5000,
                ],
            );
            eventIds.push(rows[0].id);
        }
        await client.query('COMMIT');
        console.log(`Created ${eventIds.length} demo replay events: ${eventIds.join(', ')}`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

seedReplayEvents().catch((error) => {
    console.error('Replay seed failed:', error);
    process.exitCode = 1;
});
