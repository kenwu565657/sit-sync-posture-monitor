import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    PersonalizationCollector,
    PersonalizationSequence,
    mergeContiguousPersonalizationChunks,
} from '../src/service/personalization.js';
import { ForecastFeatureFrame } from '../src/service/postureFeatures.js';

function frame(value: number): ForecastFeatureFrame {
    return {
        neck_back_pitch: value,
        neck_back_roll: value,
        trunk_pitch: value,
        shoulder_asymmetry: value,
        upper_arm_elevation: 0,
        neck_back_pitch_velocity: value,
        neck_back_roll_velocity: value,
        trunk_pitch_velocity: value,
        shoulder_asymmetry_velocity: value,
        upper_arm_elevation_velocity: 0,
    };
}

test('collector stores bounded continuous feature-only sequences', async () => {
    const saved: PersonalizationSequence[] = [];
    const collector = new PersonalizationCollector(
        async () => true,
        async (sequence) => { saved.push(sequence); },
        {
            sampleIntervalMs: 100,
            sequenceFrames: 3,
            continuityGapMs: 500,
            maxFramesPerDay: 10,
        },
    );

    await collector.collect('user-a', 'device-a', 1000, frame(1));
    assert.equal(
        await collector.collect('user-a', 'device-a', 1050, frame(2)),
        false,
    );
    await collector.collect('user-a', 'device-a', 1100, frame(3));
    await collector.collect('user-a', 'device-a', 1200, frame(4));

    assert.equal(saved.length, 1);
    assert.equal(saved[0].frames.length, 3);
    assert.deepEqual(Object.keys(saved[0].frames[0]).sort(), [
        'neck_back_pitch',
        'neck_back_pitch_velocity',
        'neck_back_roll',
        'neck_back_roll_velocity',
        'shoulder_asymmetry',
        'shoulder_asymmetry_velocity',
        'trunk_pitch',
        'trunk_pitch_velocity',
        'upper_arm_elevation',
        'upper_arm_elevation_velocity',
    ]);
    assert.equal(JSON.stringify(saved).includes('quat'), false);
});

test('collector treats opt-out as authoritative and drops partial chunks', async () => {
    let consented = true;
    const saved: PersonalizationSequence[] = [];
    const collector = new PersonalizationCollector(
        async () => consented,
        async (sequence) => { saved.push(sequence); },
        {
            sampleIntervalMs: 100,
            sequenceFrames: 2,
            continuityGapMs: 500,
            maxFramesPerDay: 10,
        },
    );

    await collector.collect('user-a', 'device-a', 1000, frame(1));
    consented = false;
    assert.equal(
        await collector.collect('user-a', 'device-a', 1100, frame(2)),
        false,
    );
    consented = true;
    await collector.collect('user-a', 'device-a', 1200, frame(3));
    await collector.collect('user-a', 'device-a', 1300, frame(4));

    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].frames, [frame(3), frame(4)]);
});

test('collector resets an incomplete sequence after a continuity gap', async () => {
    const saved: PersonalizationSequence[] = [];
    const collector = new PersonalizationCollector(
        async () => true,
        async (sequence) => { saved.push(sequence); },
        {
            sampleIntervalMs: 100,
            sequenceFrames: 2,
            continuityGapMs: 500,
            maxFramesPerDay: 10,
        },
    );

    await collector.collect('user-a', 'device-a', 1000, frame(1));
    await collector.collect('user-a', 'device-a', 2000, frame(2));
    await collector.collect('user-a', 'device-a', 2100, frame(3));

    assert.deepEqual(saved[0].frames, [frame(2), frame(3)]);
});

test('training merges adjacent chunks but preserves continuity boundaries', () => {
    const sequences = mergeContiguousPersonalizationChunks(
        [
            {
                deviceId: 'device-a',
                startedAt: new Date(1_000),
                endedAt: new Date(1_100),
                sampleIntervalMs: 100,
                frames: [frame(1), frame(2)],
            },
            {
                deviceId: 'device-a',
                startedAt: new Date(1_200),
                endedAt: new Date(1_300),
                sampleIntervalMs: 100,
                frames: [frame(3), frame(4)],
            },
            {
                deviceId: 'device-a',
                startedAt: new Date(5_000),
                endedAt: new Date(5_100),
                sampleIntervalMs: 100,
                frames: [frame(5), frame(6)],
            },
            {
                deviceId: 'device-b',
                startedAt: new Date(5_200),
                endedAt: new Date(5_300),
                sampleIntervalMs: 100,
                frames: [frame(7), frame(8)],
            },
        ],
        500,
    );

    assert.deepEqual(
        sequences.map((sequence) => sequence.map((item) => item.trunk_pitch)),
        [[1, 2, 3, 4], [5, 6], [7, 8]],
    );
});
