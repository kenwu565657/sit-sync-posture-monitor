import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    recordingStatus,
    recordTelemetry,
    RawRecordingFrame,
    RawRecordingStore,
    startRecording,
    stopRecording,
} from '../src/service/recording.js';
import { PosturePayload } from '../src/types/index.js';

test('recording session writes raw quaternions and exposes live progress', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sitsync-recording-'));
    const timestamp = Date.now();
    const payload: PosturePayload = {
        schema_version: 1,
        timestamp,
        device_id: 'mobile-pilot',
        user_id: 'user-pilot',
        sensors: {
            neck: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            lower_back: { quat: { w: 0.9, x: 0.1, y: 0, z: 0 } },
            left_shoulder: { quat: { w: 0.8, x: 0, y: 0.2, z: 0 } },
            right_shoulder: { quat: { w: 0.7, x: 0, y: 0, z: 0.3 } },
        },
    };

    try {
        await startRecording({
            deviceId: payload.device_id,
            sequenceId: 'pilot_test',
            participantId: 'self_pilot',
            actionId: 'natural_desk_30min',
            split: 'test',
            outputDirectory: directory,
        });
        recordTelemetry(payload, timestamp);

        const live = recordingStatus(payload.device_id);
        assert.equal(live.recording, true);
        assert.equal(live.frames, 1);
        assert.equal(live.sequenceId, 'pilot_test');
        assert.equal(live.lastFrameAt, timestamp);

        const stopped = await stopRecording(payload.device_id);
        assert.equal(stopped.frames, 1);
        assert.equal(stopped.persistedFrames, 1);
        assert.equal(stopped.writeErrors, 0);
        assert.match(stopped.filePath, /pilot_test\.csv$/);
        const csv = await readFile(stopped.filePath, 'utf8');
        assert.match(csv, /sequence_id,source,character_id/);
        assert.match(
            csv,
            /pilot_test,bno085,self_pilot,natural_desk_30min,test,shoulder_top,0/,
        );
        assert.deepEqual(recordingStatus(payload.device_id), { recording: false });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('recording batches raw frames into PostgreSQL chunks', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sitsync-db-recording-'));
    const chunks: RawRecordingFrame[][] = [];
    let completedFrames = 0;
    const store: RawRecordingStore = {
        async start() {
            return 'raw-session-1';
        },
        async appendChunk(_sessionId, _chunkIndex, frames) {
            chunks.push(frames);
        },
        async complete(_sessionId, input) {
            completedFrames = input.frameCount;
        },
        async fail() {
            throw new Error('unexpected failure');
        },
    };
    const payload: PosturePayload = {
        schema_version: 1,
        timestamp: 0,
        device_id: 'database-pilot',
        user_id: 'user-pilot',
        sensors: {
            neck: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            lower_back: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            left_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            right_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        },
    };

    try {
        const started = await startRecording({
            deviceId: payload.device_id,
            ownerUserId: 'user-pilot',
            sequenceId: 'database_pilot',
            participantId: 'self_pilot',
            actionId: 'natural_desk_30min',
            split: 'test',
            outputDirectory: directory,
            databaseStore: store,
        });
        assert.equal(started.databaseSessionId, 'raw-session-1');
        for (let index = 0; index < 205; index += 1) {
            recordTelemetry(payload, 1_000 + index * 100);
        }

        const stopped = await stopRecording(payload.device_id);
        assert.equal(stopped.databaseStatus, 'completed');
        assert.equal(stopped.databasePersistedFrames, 205);
        assert.equal(stopped.databaseWriteErrors, 0);
        assert.equal(completedFrames, 205);
        assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 5]);
        assert.equal(chunks[0][0].sensors.neck[0], 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('CSV completes while a PostgreSQL chunk failure is reported', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sitsync-db-failure-'));
    let failedMessage = '';
    const store: RawRecordingStore = {
        async start() {
            return 'raw-session-failed';
        },
        async appendChunk() {
            throw new Error('database unavailable');
        },
        async complete() {
            throw new Error('complete should not run');
        },
        async fail(_sessionId, message) {
            failedMessage = message;
        },
    };
    const payload: PosturePayload = {
        schema_version: 1,
        timestamp: 1000,
        device_id: 'database-failure-pilot',
        user_id: 'user-pilot',
        sensors: {
            neck: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            lower_back: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            left_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            right_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        },
    };

    try {
        await startRecording({
            deviceId: payload.device_id,
            ownerUserId: 'user-pilot',
            sequenceId: 'database_failure_pilot',
            participantId: 'self_pilot',
            actionId: 'natural_desk_30min',
            split: 'test',
            outputDirectory: directory,
            databaseStore: store,
        });
        recordTelemetry(payload, payload.timestamp);
        const stopped = await stopRecording(payload.device_id);
        assert.equal(stopped.databaseStatus, 'failed');
        assert.equal(stopped.databaseWriteErrors, 1);
        assert.match(failedMessage, /database unavailable/);
        assert.match(await readFile(stopped.filePath, 'utf8'), /database_failure_pilot/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('empty recording is rejected and its partial file is removed', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sitsync-empty-recording-'));
    try {
        await startRecording({
            deviceId: 'empty-device',
            sequenceId: 'empty_pilot',
            participantId: 'self_pilot',
            actionId: 'natural_desk_30min',
            split: 'test',
            outputDirectory: directory,
        });
        await assert.rejects(
            stopRecording('empty-device'),
            /without receiving telemetry frames/,
        );
        assert.deepEqual(recordingStatus('empty-device'), { recording: false });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
