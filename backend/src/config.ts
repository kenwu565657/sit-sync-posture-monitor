import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

function integer(name: string, fallback: number, minimum = 1): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(`${name} must be an integer >= ${minimum}`);
    }
    return value;
}

function boolean(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${name} must be true or false`);
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const defaultRecordingDir = fileURLToPath(
    new URL('../../ml-service/data/raw/real', import.meta.url),
);
const jwtSecret = process.env.JWT_SECRET;
if (nodeEnv === 'production' && (!jwtSecret || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be set to at least 32 characters in production');
}

export const config = {
    nodeEnv,
    port: integer('PORT', 8787),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:8081')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    mlUrl: (process.env.ML_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    mlTimeoutMs: integer('ML_TIMEOUT_MS', 2000),
    mlTrainingTimeoutMs: integer('ML_TRAINING_TIMEOUT_MS', 900000),
    jwtSecret: jwtSecret ?? 'development-only-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    deviceJwtExpiresIn: process.env.DEVICE_JWT_EXPIRES_IN ?? '1h',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    recordingDir: path.resolve(
        process.env.RECORDING_DIR ?? defaultRecordingDir,
    ),
    rawRecording: {
        chunkFrames: integer('RAW_RECORDING_CHUNK_FRAMES', 100, 10),
        retentionDays: integer('RAW_RECORDING_RETENTION_DAYS', 30),
    },
    db: {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        name: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: integer('DB_PORT', 5432),
        tls: boolean('DB_TLS', nodeEnv === 'production'),
        tlsRejectUnauthorized: boolean('DB_TLS_REJECT_UNAUTHORIZED', true),
    },
    ws: {
        maxMessageBytes: integer('WS_MAX_MESSAGE_BYTES', 64 * 1024),
        messagesPerMinute: integer('WS_MESSAGES_PER_MINUTE', 900),
        authTimeoutMs: integer('WS_AUTH_TIMEOUT_MS', 5000),
        heartbeatMs: integer('WS_HEARTBEAT_MS', 30000),
    },
    personalization: {
        sampleIntervalMs: integer('PERSONALIZATION_SAMPLE_INTERVAL_MS', 100, 50),
        minimumSampleIntervalMs: integer(
            'PERSONALIZATION_MINIMUM_SAMPLE_INTERVAL_MS',
            80,
            50,
        ),
        sequenceFrames: integer('PERSONALIZATION_SEQUENCE_FRAMES', 200, 100),
        continuityGapMs: integer('PERSONALIZATION_CONTINUITY_GAP_MS', 2000, 100),
        maxFramesPerDay: integer('PERSONALIZATION_MAX_FRAMES_PER_DAY', 36000),
        maxSequencesPerUser: integer('PERSONALIZATION_MAX_SEQUENCES_PER_USER', 500),
        retentionDays: integer('PERSONALIZATION_RETENTION_DAYS', 30),
        trainingMaxSequences: integer('PERSONALIZATION_TRAINING_MAX_SEQUENCES', 200),
    },
    deviceCredentialsJson: process.env.DEVICE_CREDENTIALS_JSON,
} as const;
