import pool from '../db.js';
import { config } from '../config.js';
import { errorFields, logger } from '../logger.js';
import { ForecastFeatureFrame } from './postureFeatures.js';
import type { SensorPlacementMode } from '../types/index.js';
import {
    hasPersonalizationConsent,
    hasTelemetryTrainingConsent,
} from './userPreferences.js';

export interface PersonalizationSequence {
    userId: string;
    deviceId: string;
    mountingMode: SensorPlacementMode;
    startedAtMs: number;
    endedAtMs: number;
    sampleIntervalMs: number;
    frames: ForecastFeatureFrame[];
}

interface ActiveSequence {
    startedAtMs: number;
    lastAtMs: number;
    frames: ForecastFeatureFrame[];
}

export interface CollectorOptions {
    sampleIntervalMs: number;
    minimumSampleIntervalMs?: number;
    sequenceFrames: number;
    continuityGapMs: number;
    maxFramesPerDay: number;
}

const FEATURE_KEYS: (keyof ForecastFeatureFrame)[] = [
    'neck_back_pitch',
    'neck_back_roll',
    'trunk_pitch',
    'shoulder_asymmetry',
    'upper_arm_elevation',
    'neck_back_pitch_velocity',
    'neck_back_roll_velocity',
    'trunk_pitch_velocity',
    'shoulder_asymmetry_velocity',
    'upper_arm_elevation_velocity',
];

function safeFeatureFrame(frame: ForecastFeatureFrame): ForecastFeatureFrame | null {
    if (!FEATURE_KEYS.every((key) => Number.isFinite(frame[key] ?? 0))) return null;
    return Object.fromEntries(
        FEATURE_KEYS.map((key) => [key, frame[key] ?? 0]),
    ) as unknown as ForecastFeatureFrame;
}

export class PersonalizationCollector {
    private readonly active = new Map<string, ActiveSequence>();
    private readonly dailyFrames = new Map<string, { day: string; count: number }>();

    constructor(
        private readonly isConsented: (userId: string) => Promise<boolean>,
        private readonly persist: (sequence: PersonalizationSequence) => Promise<void>,
        private readonly options: CollectorOptions,
    ) {}

    async collect(
        userId: string,
        deviceId: string,
        timestampMs: number,
        featureFrame: ForecastFeatureFrame,
        mountingMode: SensorPlacementMode = 'shoulder_top',
    ): Promise<boolean> {
        const key = `${userId}:${deviceId}:${mountingMode}`;
        if (!(await this.isConsented(userId))) {
            this.active.delete(key);
            return false;
        }
        const frame = safeFeatureFrame(featureFrame);
        if (!frame) return false;

        const day = new Date(timestampMs).toISOString().slice(0, 10);
        let usage = this.dailyFrames.get(userId);
        if (!usage || usage.day !== day) {
            usage = { day, count: 0 };
            this.dailyFrames.set(userId, usage);
        }
        if (usage.count >= this.options.maxFramesPerDay) return false;

        let sequence = this.active.get(key);
        if (
            sequence &&
            (timestampMs <= sequence.lastAtMs ||
                timestampMs - sequence.lastAtMs > this.options.continuityGapMs)
        ) {
            this.active.delete(key);
            sequence = undefined;
        }
        if (
            sequence &&
            timestampMs - sequence.lastAtMs <
                (this.options.minimumSampleIntervalMs ?? this.options.sampleIntervalMs)
        ) {
            return false;
        }
        if (!sequence) {
            sequence = { startedAtMs: timestampMs, lastAtMs: timestampMs, frames: [] };
            this.active.set(key, sequence);
        }
        sequence.lastAtMs = timestampMs;
        sequence.frames.push(frame);
        usage.count += 1;
        if (sequence.frames.length < this.options.sequenceFrames) return true;

        this.active.delete(key);
        await this.persist({
            userId,
            deviceId,
            mountingMode,
            startedAtMs: sequence.startedAtMs,
            endedAtMs: timestampMs,
            sampleIntervalMs: this.options.sampleIntervalMs,
            frames: sequence.frames,
        });
        return true;
    }

    dropUser(userId: string): void {
        for (const key of this.active.keys()) {
            if (key.startsWith(`${userId}:`)) this.active.delete(key);
        }
        this.dailyFrames.delete(userId);
    }
}

async function persistSequence(sequence: PersonalizationSequence): Promise<void> {
    await pool.query(
        `WITH expired AS (
             DELETE FROM personalization_sequences WHERE expires_at <= CURRENT_TIMESTAMP
         ), capacity AS (
             SELECT COUNT(*)::INTEGER AS count
             FROM personalization_sequences
             WHERE user_id = $1
         )
         INSERT INTO personalization_sequences
             (user_id, device_id, started_at, ended_at, sample_interval_ms,
              frame_count, feature_sequences, expires_at, mounting_mode)
         SELECT $1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0),
                $5, $6, $7::JSONB,
                CURRENT_TIMESTAMP + ($8 * INTERVAL '1 day'), $10
         FROM capacity
         WHERE capacity.count < $9`,
        [
            sequence.userId,
            sequence.deviceId,
            sequence.startedAtMs,
            sequence.endedAtMs,
            sequence.sampleIntervalMs,
            sequence.frames.length,
            JSON.stringify(sequence.frames),
            config.personalization.retentionDays,
            config.personalization.maxSequencesPerUser,
            sequence.mountingMode,
        ],
    );
}

export const personalizationCollector = new PersonalizationCollector(
    hasTelemetryTrainingConsent,
    persistSequence,
    config.personalization,
);

export interface PersonalizationStatus {
    mounting_mode: SensorPlacementMode;
    status: string;
    sample_count: number;
    sequence_count: number;
    model_version: string | null;
    global_model_version: string | null;
    last_error: string | null;
}

export interface RetainedPersonalizationChunk {
    deviceId: string;
    mountingMode?: SensorPlacementMode;
    startedAt: Date;
    endedAt: Date;
    sampleIntervalMs: number;
    frames: ForecastFeatureFrame[];
}

export function mergeContiguousPersonalizationChunks(
    chunks: RetainedPersonalizationChunk[],
    continuityGapMs: number,
): ForecastFeatureFrame[][] {
    const sequences: ForecastFeatureFrame[][] = [];
    let previous: RetainedPersonalizationChunk | null = null;
    for (const chunk of chunks) {
        const gapMs = previous
            ? chunk.startedAt.getTime() - previous.endedAt.getTime()
            : Number.POSITIVE_INFINITY;
        const contiguous = previous !== null &&
            previous.deviceId === chunk.deviceId &&
            (previous.mountingMode ?? 'shoulder_top') ===
                (chunk.mountingMode ?? 'shoulder_top') &&
            previous.sampleIntervalMs === chunk.sampleIntervalMs &&
            gapMs >= 0 &&
            gapMs <= continuityGapMs;
        if (!contiguous) sequences.push([]);
        sequences[sequences.length - 1].push(...chunk.frames);
        previous = chunk;
    }
    return sequences.filter((sequence) => sequence.length > 0);
}

export async function getPersonalizationStatus(
    userId: string,
    mountingMode: SensorPlacementMode = 'shoulder_top',
): Promise<PersonalizationStatus> {
    const [sequences, models, jobs] = await Promise.all([
        pool.query<{ sequence_count: number; frame_count: number }>(
            `SELECT COUNT(*)::INTEGER AS sequence_count,
                    COALESCE(SUM(frame_count), 0)::INTEGER AS frame_count
             FROM personalization_sequences
             WHERE user_id = $1 AND mounting_mode = $2
               AND expires_at > CURRENT_TIMESTAMP`,
            [userId, mountingMode],
        ),
        pool.query(
            `SELECT id, model_version, status, metadata, error_message,
                    created_at, updated_at
             FROM user_forecast_models
             WHERE user_id = $1 AND mounting_mode = $2
             ORDER BY updated_at DESC LIMIT 1`,
            [userId, mountingMode],
        ),
        pool.query(
            `SELECT id, model_id, status, sequence_count, frame_count,
                    error_message, requested_at, started_at, completed_at
             FROM personalization_training_jobs
             WHERE user_id = $1 AND mounting_mode = $2
             ORDER BY requested_at DESC LIMIT 1`,
            [userId, mountingMode],
        ),
    ]);
    const model = models.rows[0] as Record<string, unknown> | undefined;
    const job = jobs.rows[0] as Record<string, unknown> | undefined;
    const jobStatus = typeof job?.status === 'string' ? job.status : null;
    const modelStatus = typeof model?.status === 'string' ? model.status : null;
    const metadata = model?.metadata && typeof model.metadata === 'object'
        ? model.metadata as Record<string, unknown>
        : null;
    const status = ['queued', 'running'].includes(jobStatus ?? '')
        ? 'training'
        : jobStatus === 'failed' || modelStatus === 'failed'
            ? 'failed'
            : modelStatus === 'ready'
                ? 'ready'
                : sequences.rows[0].frame_count > 0 ? 'collecting' : 'not_started';
    return {
        mounting_mode: mountingMode,
        status,
        sample_count: sequences.rows[0].frame_count,
        sequence_count: sequences.rows[0].sequence_count,
        model_version: typeof model?.model_version === 'string'
            ? model.model_version
            : null,
        global_model_version:
            typeof metadata?.initialized_from_model_version === 'string'
                ? metadata.initialized_from_model_version
                : null,
        last_error: typeof job?.error_message === 'string'
            ? job.error_message
            : typeof model?.error_message === 'string' ? model.error_message : null,
    };
}

export async function queuePersonalizationTraining(
    userId: string,
    mountingMode: SensorPlacementMode = 'shoulder_top',
): Promise<{ jobId: string; modelId: string }> {
    if (!(await hasPersonalizationConsent(userId))) {
        throw new Error('PERSONALIZATION_CONSENT_REQUIRED');
    }
    const active = await pool.query(
        `SELECT 1 FROM personalization_training_jobs
         WHERE user_id = $1 AND mounting_mode = $2
           AND status IN ('queued', 'running') LIMIT 1`,
        [userId, mountingMode],
    );
    if (active.rowCount) throw new Error('TRAINING_ALREADY_ACTIVE');

    const count = await pool.query<{ sequence_count: number; frame_count: number }>(
        `SELECT COUNT(*)::INTEGER AS sequence_count,
                COALESCE(SUM(frame_count), 0)::INTEGER AS frame_count
         FROM personalization_sequences
         WHERE user_id = $1 AND mounting_mode = $2
           AND expires_at > CURRENT_TIMESTAMP`,
        [userId, mountingMode],
    );
    if (!count.rows[0].sequence_count) throw new Error('NO_TRAINING_DATA');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const model = await client.query<{ id: string }>(
            `INSERT INTO user_forecast_models (user_id, status, mounting_mode)
             VALUES ($1, 'training', $2) RETURNING id`,
            [userId, mountingMode],
        );
        const job = await client.query<{ id: string }>(
            `INSERT INTO personalization_training_jobs
                (user_id, model_id, status, sequence_count, frame_count,
                 mounting_mode)
             VALUES ($1, $2, 'queued', $3, $4, $5) RETURNING id`,
            [
                userId,
                model.rows[0].id,
                count.rows[0].sequence_count,
                count.rows[0].frame_count,
                mountingMode,
            ],
        );
        await client.query('COMMIT');
        setImmediate(() => {
            void runTrainingJob(
                job.rows[0].id,
                model.rows[0].id,
                userId,
                mountingMode,
            );
        });
        return { jobId: job.rows[0].id, modelId: model.rows[0].id };
    } catch (error) {
        await client.query('ROLLBACK');
        if (
            error &&
            typeof error === 'object' &&
            (error as { code?: string }).code === '23505'
        ) {
            throw new Error('TRAINING_ALREADY_ACTIVE');
        }
        throw error;
    } finally {
        client.release();
    }
}

async function runTrainingJob(
    jobId: string,
    modelId: string,
    userId: string,
    mountingMode: SensorPlacementMode,
): Promise<void> {
    try {
        await pool.query(
            `UPDATE personalization_training_jobs
             SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [jobId],
        );
        // Re-check consent at execution time so queued work cannot bypass opt-out.
        if (!(await hasPersonalizationConsent(userId))) {
            throw new Error('Personalization consent was withdrawn');
        }
        const { rows } = await pool.query<{
            device_id: string;
            started_at: Date;
            ended_at: Date;
            sample_interval_ms: number;
            feature_sequences: ForecastFeatureFrame[];
        }>(
            `SELECT device_id, started_at, ended_at, sample_interval_ms,
                    feature_sequences
             FROM (
                 SELECT device_id, started_at, ended_at, sample_interval_ms,
                        feature_sequences, created_at
                 FROM personalization_sequences
                 WHERE user_id = $1 AND mounting_mode = $3
                   AND expires_at > CURRENT_TIMESTAMP
                 ORDER BY created_at DESC LIMIT $2
             ) retained
             ORDER BY started_at`,
            [userId, config.personalization.trainingMaxSequences, mountingMode],
        );
        if (!rows.length) throw new Error('No retained training sequences');
        const featureSequences = mergeContiguousPersonalizationChunks(
            rows.map((row) => ({
                deviceId: row.device_id,
                mountingMode,
                startedAt: row.started_at,
                endedAt: row.ended_at,
                sampleIntervalMs: row.sample_interval_ms,
                frames: row.feature_sequences,
            })),
            config.personalization.continuityGapMs,
        );
        const response = await fetch(`${config.mlUrl}/api/v1/models/train`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(config.mlTrainingTimeoutMs),
            body: JSON.stringify({
                user_id: userId,
                mounting_mode: mountingMode,
                feature_sequences: featureSequences,
            }),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 700);
            throw new Error(
                `ML training response ${response.status}${detail ? `: ${detail}` : ''}`,
            );
        }
        const result = await response.json() as Record<string, unknown>;
        const modelVersion = typeof result.model_version === 'string'
            ? result.model_version
            : null;
        const artifactUri = typeof result.artifact_uri === 'string'
            ? result.artifact_uri
            : typeof result.model_path === 'string' ? result.model_path : null;
        const resolvedArtifactUri = artifactUri ??
            (typeof result.onnx === 'string' ? result.onnx : null);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE user_forecast_models
                 SET status = 'ready', model_version = $2, artifact_uri = $3,
                     metadata = $4, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [modelId, modelVersion, resolvedArtifactUri, JSON.stringify(result)],
            );
            await client.query(
                `UPDATE user_forecast_models
                 SET status = 'retired', updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $1 AND mounting_mode = $3
                   AND id <> $2 AND status = 'ready'`,
                [userId, modelId, mountingMode],
            );
            await client.query(
                `UPDATE personalization_training_jobs
                 SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [jobId],
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : 'Training failed';
        await Promise.all([
            pool.query(
                `UPDATE user_forecast_models
                 SET status = 'failed', error_message = $2,
                     updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [modelId, message],
            ),
            pool.query(
                `UPDATE personalization_training_jobs
                 SET status = 'failed', error_message = $2,
                     completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [jobId, message],
            ),
        ]).catch((dbError) => {
            logger.error('personalization_job_status_failed', errorFields(dbError));
        });
        logger.warn('personalization_training_failed', {
            userId,
            jobId,
            ...errorFields(error),
        });
    }
}

export async function deletePersonalizationTrainingData(
    userId: string,
): Promise<{ sequences: number; models: number; jobs: number }> {
    personalizationCollector.dropUser(userId);
    try {
        await fetch(
            `${config.mlUrl}/api/v1/models/${encodeURIComponent(userId)}`,
            {
                method: 'DELETE',
                signal: AbortSignal.timeout(config.mlTimeoutMs),
            },
        );
    } catch (error) {
        logger.warn('personalization_artifact_delete_failed', {
            userId,
            ...errorFields(error),
        });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sequences = await client.query(
            'DELETE FROM personalization_sequences WHERE user_id = $1',
            [userId],
        );
        const jobs = await client.query(
            'DELETE FROM personalization_training_jobs WHERE user_id = $1',
            [userId],
        );
        const models = await client.query(
            'DELETE FROM user_forecast_models WHERE user_id = $1',
            [userId],
        );
        await client.query('COMMIT');
        return {
            sequences: sequences.rowCount ?? 0,
            models: models.rowCount ?? 0,
            jobs: jobs.rowCount ?? 0,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
