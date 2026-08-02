import { constants, createWriteStream, WriteStream } from 'node:fs';
import { access, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import pool from '../db.js';
import { errorFields, logger } from '../logger.js';
import {
    PosturePayload,
    SensorPlacementMode,
} from '../types/index.js';

export interface RawRecordingFrame {
    frame: number;
    timestamp_ms: number;
    sensors: {
        neck: [number, number, number, number];
        lower_back: [number, number, number, number];
        left_shoulder: [number, number, number, number];
        right_shoulder: [number, number, number, number];
    };
}

export interface RawRecordingStore {
    start(input: {
        userId: string;
        deviceId: string;
        sequenceId: string;
        participantId: string;
        actionId: string;
        split: 'train' | 'validation' | 'test';
        mountingMode: SensorPlacementMode;
        startedAt: number;
        filePath: string;
    }): Promise<string>;
    appendChunk(
        sessionId: string,
        chunkIndex: number,
        frames: RawRecordingFrame[],
    ): Promise<void>;
    complete(
        sessionId: string,
        input: {
            endedAt: number;
            frameCount: number;
            sampleHz: number;
        },
    ): Promise<void>;
    fail(sessionId: string, message: string): Promise<void>;
}

interface RecordingSession {
    deviceId: string;
    sequenceId: string;
    participantId: string;
    actionId: string;
    split: 'train' | 'validation' | 'test';
    mountingMode: SensorPlacementMode;
    startedAt: number;
    frame: number;
    lastFrameAt?: number;
    writeErrors: number;
    lastWriteError?: string;
    stream: WriteStream;
    filePath: string;
    partialFilePath: string;
    databaseStore: RawRecordingStore | null;
    databaseSessionId?: string;
    databaseBuffer: RawRecordingFrame[];
    databaseChunkIndex: number;
    databaseWriteChain: Promise<void>;
    databasePersistedFrames: number;
    databaseWriteErrors: number;
    lastDatabaseWriteError?: string;
}

export interface StartRecordingOptions {
    deviceId: string;
    ownerUserId?: string;
    sequenceId: string;
    participantId: string;
    actionId: string;
    split: 'train' | 'validation' | 'test';
    mountingMode?: SensorPlacementMode;
    outputDirectory?: string;
    databaseStore?: RawRecordingStore;
}

export class RecordingError extends Error {
    constructor(
        message: string,
        readonly statusCode: number,
    ) {
        super(message);
        this.name = 'RecordingError';
    }
}

const sessions = new Map<string, RecordingSession>();
const HEADER = [
    'sequence_id',
    'source',
    'character_id',
    'action_id',
    'split',
    'mounting_mode',
    'frame',
    'timestamp_ms',
    'neck_qw',
    'neck_qx',
    'neck_qy',
    'neck_qz',
    'lower_back_qw',
    'lower_back_qx',
    'lower_back_qy',
    'lower_back_qz',
    'left_shoulder_qw',
    'left_shoulder_qx',
    'left_shoulder_qy',
    'left_shoulder_qz',
    'right_shoulder_qw',
    'right_shoulder_qx',
    'right_shoulder_qy',
    'right_shoulder_qz',
].join(',');

const postgresRawRecordingStore: RawRecordingStore = {
    async start(input) {
        const result = await pool.query<{ id: string }>(
            `WITH expired AS (
                 DELETE FROM raw_recording_sessions
                 WHERE expires_at <= CURRENT_TIMESTAMP
             )
             INSERT INTO raw_recording_sessions
                (user_id, device_id, sequence_id, participant_id, action_id,
                 split, mounting_mode, started_at, file_path, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), $9,
                     CURRENT_TIMESTAMP + ($10 * INTERVAL '1 day'))
             RETURNING id`,
            [
                input.userId,
                input.deviceId,
                input.sequenceId,
                input.participantId,
                input.actionId,
                input.split,
                input.mountingMode,
                input.startedAt,
                input.filePath,
                config.rawRecording.retentionDays,
            ],
        );
        return result.rows[0].id;
    },
    async appendChunk(sessionId, chunkIndex, frames) {
        await pool.query(
            `INSERT INTO raw_recording_chunks
                (session_id, chunk_index, start_timestamp_ms, end_timestamp_ms,
                 frame_count, frames)
             VALUES ($1, $2, $3, $4, $5, $6::JSONB)`,
            [
                sessionId,
                chunkIndex,
                frames[0].timestamp_ms,
                frames[frames.length - 1].timestamp_ms,
                frames.length,
                JSON.stringify(frames),
            ],
        );
    },
    async complete(sessionId, input) {
        await pool.query(
            `UPDATE raw_recording_sessions
             SET status = 'completed', ended_at = to_timestamp($2 / 1000.0),
                 frame_count = $3, sample_hz = $4, error_message = NULL
             WHERE id = $1`,
            [sessionId, input.endedAt, input.frameCount, input.sampleHz],
        );
    },
    async fail(sessionId, message) {
        await pool.query(
            `UPDATE raw_recording_sessions
             SET status = 'failed', ended_at = CURRENT_TIMESTAMP,
                 error_message = $2
             WHERE id = $1`,
            [sessionId, message],
        );
    },
};

export async function startRecording(
    options: StartRecordingOptions,
): Promise<{ filePath: string; databaseSessionId?: string }> {
    if (sessions.has(options.deviceId)) {
        throw new Error(`Device ${options.deviceId} is already recording`);
    }
    const outputDirectory = options.outputDirectory ?? config.recordingDir;
    await ensureRecordingStorage(outputDirectory);
    const filename = `${safeName(options.sequenceId)}.csv`;
    const filePath = path.join(outputDirectory, filename);
    const partialFilePath = `${filePath}.part`;
    try {
        await access(filePath);
        throw new RecordingError(`Recording ${filename} already exists`, 409);
    } catch (error) {
        if (error instanceof RecordingError) throw error;
    }
    const stream = createWriteStream(partialFilePath, { flags: 'wx' });
    await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve());
        stream.once('error', reject);
    });
    const startedAt = Date.now();
    const mountingMode = options.mountingMode ?? 'shoulder_top';
    const databaseStore =
        options.databaseStore ??
        (options.ownerUserId ? postgresRawRecordingStore : null);
    const session: RecordingSession = {
        deviceId: options.deviceId,
        sequenceId: options.sequenceId,
        participantId: options.participantId,
        actionId: options.actionId,
        split: options.split,
        mountingMode,
        startedAt,
        frame: 0,
        writeErrors: 0,
        stream,
        filePath,
        partialFilePath,
        databaseStore,
        databaseBuffer: [],
        databaseChunkIndex: 0,
        databaseWriteChain: Promise.resolve(),
        databasePersistedFrames: 0,
        databaseWriteErrors: 0,
    };
    stream.on('error', (error) => {
        session.writeErrors += 1;
        session.lastWriteError = error.message;
        logger.error('recording_write_failed', {
            deviceId: options.deviceId,
            filePath: partialFilePath,
            ...errorFields(error),
        });
    });
    stream.write(`${HEADER}\n`);
    if (databaseStore && options.ownerUserId) {
        try {
            session.databaseSessionId = await databaseStore.start({
                userId: options.ownerUserId,
                deviceId: options.deviceId,
                sequenceId: options.sequenceId,
                participantId: options.participantId,
                actionId: options.actionId,
                split: options.split,
                mountingMode,
                startedAt,
                filePath,
            });
        } catch (error) {
            await new Promise<void>((resolve) => stream.end(resolve));
            await unlink(partialFilePath).catch(() => undefined);
            throw new RecordingError(
                `Could not start PostgreSQL raw recording: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                503,
            );
        }
    }
    sessions.set(options.deviceId, session);
    return {
        filePath,
        databaseSessionId: session.databaseSessionId,
    };
}

export async function initializeRecordingStorage(): Promise<void> {
    await ensureRecordingStorage(config.recordingDir);
    logger.info('recording_storage_ready', { directory: config.recordingDir });
}

export function recordTelemetry(
    payload: PosturePayload,
    timestampMs: number,
): void {
    const session = sessions.get(payload.device_id);
    if (!session) return;
    const payloadMode = payload.mounting_mode ?? 'shoulder_top';
    if (payloadMode !== session.mountingMode) {
        session.writeErrors += 1;
        session.lastWriteError =
            `Mounting mode changed from ${session.mountingMode} to ${payloadMode} during recording`;
        return;
    }
    if (session.lastWriteError) return;
    const { sensors } = payload;
    const values = [
        session.sequenceId,
        'bno085',
        session.participantId,
        session.actionId,
        session.split,
        session.mountingMode,
        session.frame,
        timestampMs,
        ...quaternionValues(sensors.neck.quat),
        ...quaternionValues(sensors.lower_back.quat),
        ...quaternionValues(sensors.left_shoulder.quat),
        ...quaternionValues(sensors.right_shoulder.quat),
    ];
    try {
        session.stream.write(`${values.join(',')}\n`);
    } catch (error) {
        session.writeErrors += 1;
        session.lastWriteError =
            error instanceof Error ? error.message : 'Unknown recording write error';
        logger.error('recording_write_failed', {
            deviceId: payload.device_id,
            ...errorFields(error),
        });
        return;
    }
    if (session.databaseSessionId) {
        session.databaseBuffer.push({
            frame: session.frame,
            timestamp_ms: timestampMs,
            sensors: {
                neck: quaternionTuple(sensors.neck.quat),
                lower_back: quaternionTuple(sensors.lower_back.quat),
                left_shoulder: quaternionTuple(sensors.left_shoulder.quat),
                right_shoulder: quaternionTuple(sensors.right_shoulder.quat),
            },
        });
        if (session.databaseBuffer.length >= config.rawRecording.chunkFrames) {
            queueDatabaseChunk(session);
        }
    }
    session.frame += 1;
    session.lastFrameAt = timestampMs;
}

export async function stopRecording(deviceId: string): Promise<{
    filePath: string;
    frames: number;
    persistedFrames: number;
    durationSeconds: number;
    effectiveSampleHz: number;
    writeErrors: number;
    databaseSessionId?: string;
    databaseStatus: 'disabled' | 'completed' | 'failed';
    databasePersistedFrames: number;
    databaseWriteErrors: number;
    mountingMode: SensorPlacementMode;
}> {
    const session = sessions.get(deviceId);
    if (!session) throw new Error(`Device ${deviceId} is not recording`);
    sessions.delete(deviceId);
    await new Promise<void>((resolve, reject) => {
        session.stream.once('error', reject);
        session.stream.end(() => resolve());
    });
    if (session.lastWriteError) {
        await failDatabaseRecording(session, session.lastWriteError);
        throw new RecordingError(
            `Raw recording write failed: ${session.lastWriteError}. Partial file retained at ${session.partialFilePath}`,
            500,
        );
    }
    if (session.frame === 0) {
        await unlink(session.partialFilePath).catch(() => undefined);
        await failDatabaseRecording(session, 'Recording contained no telemetry frames');
        throw new RecordingError('Recording stopped without receiving telemetry frames', 422);
    }
    queueDatabaseChunk(session);
    await session.databaseWriteChain;
    await rename(session.partialFilePath, session.filePath);
    const endedAt = Date.now();
    const durationSeconds = (endedAt - session.startedAt) / 1000;
    const effectiveSampleHz = durationSeconds > 0 ? session.frame / durationSeconds : 0;
    let databaseStatus: 'disabled' | 'completed' | 'failed' =
        session.databaseSessionId ? 'completed' : 'disabled';
    if (session.databaseSessionId && session.databaseStore) {
        if (session.databaseWriteErrors === 0) {
            try {
                await session.databaseStore.complete(session.databaseSessionId, {
                    endedAt,
                    frameCount: session.frame,
                    sampleHz: effectiveSampleHz,
                });
            } catch (error) {
                recordDatabaseError(session, error);
            }
        }
        if (session.databaseWriteErrors > 0) {
            databaseStatus = 'failed';
            await failDatabaseRecording(
                session,
                session.lastDatabaseWriteError ?? 'Raw PostgreSQL persistence failed',
            );
        }
    }
    return {
        filePath: session.filePath,
        frames: session.frame,
        persistedFrames: session.frame,
        durationSeconds,
        effectiveSampleHz,
        writeErrors: session.writeErrors,
        databaseSessionId: session.databaseSessionId,
        databaseStatus,
        databasePersistedFrames: session.databasePersistedFrames,
        databaseWriteErrors: session.databaseWriteErrors,
        mountingMode: session.mountingMode,
    };
}

export function recordingStatus(deviceId: string): {
    recording: boolean;
    frames?: number;
    filePath?: string;
    sequenceId?: string;
    durationSeconds?: number;
    lastFrameAt?: number;
    effectiveSampleHz?: number;
    writeErrors?: number;
    lastWriteError?: string;
    databaseSessionId?: string;
    databaseStatus?: 'disabled' | 'recording' | 'failed';
    databasePersistedFrames?: number;
    databaseWriteErrors?: number;
    lastDatabaseWriteError?: string;
    mountingMode?: SensorPlacementMode;
} {
    const session = sessions.get(deviceId);
    return session
        ? {
            recording: true,
            frames: session.frame,
            filePath: session.filePath,
            sequenceId: session.sequenceId,
            durationSeconds: (Date.now() - session.startedAt) / 1000,
            lastFrameAt: session.lastFrameAt,
            effectiveSampleHz:
                session.frame /
                Math.max((Date.now() - session.startedAt) / 1000, 0.001),
            writeErrors: session.writeErrors,
            lastWriteError: session.lastWriteError,
            databaseSessionId: session.databaseSessionId,
            databaseStatus: session.databaseSessionId
                ? session.databaseWriteErrors > 0
                    ? 'failed'
                    : 'recording'
                : 'disabled',
            databasePersistedFrames: session.databasePersistedFrames,
            databaseWriteErrors: session.databaseWriteErrors,
            lastDatabaseWriteError: session.lastDatabaseWriteError,
            mountingMode: session.mountingMode,
        }
        : { recording: false };
}

function queueDatabaseChunk(session: RecordingSession): void {
    if (
        !session.databaseStore ||
        !session.databaseSessionId ||
        session.databaseBuffer.length === 0
    ) {
        return;
    }
    const frames = session.databaseBuffer.splice(0);
    const chunkIndex = session.databaseChunkIndex;
    session.databaseChunkIndex += 1;
    session.databaseWriteChain = session.databaseWriteChain
        .then(async () => {
            await session.databaseStore!.appendChunk(
                session.databaseSessionId!,
                chunkIndex,
                frames,
            );
            session.databasePersistedFrames += frames.length;
        })
        .catch((error) => {
            recordDatabaseError(session, error);
        });
}

function recordDatabaseError(session: RecordingSession, error: unknown): void {
    session.databaseWriteErrors += 1;
    session.lastDatabaseWriteError =
        error instanceof Error ? error.message : String(error);
    logger.error('raw_recording_database_write_failed', {
        deviceId: session.deviceId,
        databaseSessionId: session.databaseSessionId,
        ...errorFields(error),
    });
}

async function failDatabaseRecording(
    session: RecordingSession,
    message: string,
): Promise<void> {
    if (!session.databaseStore || !session.databaseSessionId) return;
    try {
        await session.databaseStore.fail(session.databaseSessionId, message);
    } catch (error) {
        logger.error('raw_recording_database_status_failed', {
            deviceId: session.deviceId,
            databaseSessionId: session.databaseSessionId,
            ...errorFields(error),
        });
    }
}

async function ensureRecordingStorage(directory: string): Promise<void> {
    try {
        await mkdir(directory, { recursive: true });
        await access(directory, constants.R_OK | constants.W_OK);
    } catch (error) {
        throw new RecordingError(
            `Recording directory is not writable: ${directory}`,
            503,
        );
    }
}

function quaternionValues(value: {
    w: number;
    x: number;
    y: number;
    z: number;
}): number[] {
    return [value.w, value.x, value.y, value.z];
}

function quaternionTuple(value: {
    w: number;
    x: number;
    y: number;
    z: number;
}): [number, number, number, number] {
    return [value.w, value.x, value.y, value.z];
}

function safeName(value: string): string {
    const safe = value.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safe) throw new Error('sequence_id must contain a letter or number');
    return safe;
}

