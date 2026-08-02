import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import {
    buildRecommendations,
    parseAnalyticsDays,
    parseDate,
    parseEventId,
    parseMonth,
    summarizeHistory,
} from '../src/route/analytics.js';
import analyticsRouter from '../src/route/analytics.js';
import {
    assessPosture,
    PostureIncident,
    PostureIncidentTracker,
} from '../src/service/telemetry.js';
import {
    ForecastFeatureFrame,
    SensorReferences,
} from '../src/service/postureFeatures.js';
import { config } from '../src/config.js';
import {
    DEFAULT_USER_PREFERENCES,
    isUserPreferences,
} from '../src/service/userPreferences.js';

function features(
    overrides: Partial<ForecastFeatureFrame> = {},
): ForecastFeatureFrame {
    return {
        neck_back_pitch: 0,
        neck_back_roll: 0,
        trunk_pitch: 0,
        shoulder_asymmetry: 0,
        neck_back_pitch_velocity: 0,
        neck_back_roll_velocity: 0,
        trunk_pitch_velocity: 0,
        shoulder_asymmetry_velocity: 0,
        ...overrides,
    };
}

const references: SensorReferences = {
    neck: { w: 1, x: 0, y: 0, z: 0 },
    lower_back: { w: 1, x: 0, y: 0, z: 0 },
    left_shoulder: { w: 1, x: 0, y: 0, z: 0 },
    right_shoulder: { w: 1, x: 0, y: 0, z: 0 },
};

function replaySnapshot(frame: number) {
    return {
        frame,
        sensors: {
            neck: { quat: { w: 1, x: frame / 100, y: 0, z: 0 } },
            lower_back: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            left_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
            right_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        },
    };
}

function predictionSnapshot(
    frame: number,
    level: 'LOW' | 'ELEVATED' | 'HIGH',
) {
    return {
        ...replaySnapshot(frame),
        metrics: {
            forecast_probability:
                level === 'LOW' ? 0.2 : level === 'ELEVATED' ? 0.62 : 0.88,
            forecast_level: level,
            forecast_horizon_seconds: 5,
            forecast_generated_at_ms: frame * 1000,
        },
    };
}

test('estimated RULA thresholds use calibrated sensor features', () => {
    assert.deepEqual(assessPosture(features()), {
        cvaAngle: 55,
        estimatedRulaScore: 1,
        status: 'good',
    });
    assert.equal(
        assessPosture(features({ neck_back_pitch: 15 })).status,
        'warning',
    );
    const critical = assessPosture(
        features({
            neck_back_pitch: 36,
            trunk_pitch: 21,
            shoulder_asymmetry: 11,
        }),
    );
    assert.equal(critical.status, 'critical');
    assert.equal(critical.estimatedRulaScore, 7);
    assert.ok(critical.cvaAngle < 30);
    assert.equal(
        assessPosture(features({ neck_back_pitch: 15 }), 4).status,
        'warning',
    );
    assert.equal(
        assessPosture(features({ neck_back_pitch: 15 }), 4, 40).status,
        'good',
    );
    assert.equal(
        assessPosture(features({ neck_back_pitch: 8 }), 6, 50).status,
        'warning',
    );
    assert.equal(
        assessPosture(features({ trunk_pitch: 25 }), 6, 50).status,
        'good',
    );
    assert.equal(
        assessPosture(features({ trunk_pitch: 75 }), 6, 50).status,
        'warning',
    );
    assert.equal(
        assessPosture(features({ neck_back_pitch: 22 }), 6, 50).status,
        'critical',
    );
});

test('estimated RULA and CVA match shared policy fixtures', () => {
    const fixtures = JSON.parse(readFileSync(
        new URL('../../document/posture-policy-fixtures.json', import.meta.url),
        'utf8',
    )) as Array<{
        name: string;
        neck_back_pitch: number;
        trunk_pitch: number;
        shoulder_asymmetry: number;
        estimated_rula_score: number;
        estimated_cva_angle: number;
        rula_bad: boolean;
        cva_bad: boolean;
        combined_bad: boolean;
    }>;

    for (const fixture of fixtures) {
        const assessment = assessPosture(features({
            neck_back_pitch: fixture.neck_back_pitch,
            trunk_pitch: fixture.trunk_pitch,
            shoulder_asymmetry: fixture.shoulder_asymmetry,
        }));
        const rulaBad = assessment.estimatedRulaScore >=
            DEFAULT_USER_PREFERENCES.warningRulaThreshold;
        const cvaBad = assessment.cvaAngle <
            DEFAULT_USER_PREFERENCES.warningCvaThreshold;
        assert.equal(
            assessment.estimatedRulaScore,
            fixture.estimated_rula_score,
            `${fixture.name} RULA`,
        );
        assert.equal(
            assessment.cvaAngle,
            fixture.estimated_cva_angle,
            `${fixture.name} CVA`,
        );
        assert.equal(rulaBad, fixture.rula_bad, `${fixture.name} RULA label`);
        assert.equal(cvaBad, fixture.cva_bad, `${fixture.name} CVA label`);
        assert.equal(
            rulaBad || cvaBad,
            fixture.combined_bad,
            `${fixture.name} combined label`,
        );
    }
});

test('user posture preferences enforce supported ranges', () => {
    assert.equal(DEFAULT_USER_PREFERENCES.warningCvaThreshold, 50);
    assert.equal(DEFAULT_USER_PREFERENCES.forecastModelVariant, 'rula');
    assert.equal(DEFAULT_USER_PREFERENCES.alertConsecutivePredictions, 2);
    assert.equal(DEFAULT_USER_PREFERENCES.alertCooldownSeconds, 300);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 50,
        incidentDurationSeconds: 20,
    }), true);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 7,
        warningCvaThreshold: 50,
        incidentDurationSeconds: 20,
    }), false);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 50,
        incidentDurationSeconds: 2,
    }), false);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 19,
        incidentDurationSeconds: 20,
    }), false);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 20,
        incidentDurationSeconds: 20,
    }), true);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 60,
        incidentDurationSeconds: 20,
    }), true);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 61,
        incidentDurationSeconds: 20,
    }), false);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 50,
        incidentDurationSeconds: 20,
        forecastModelVariant: 'combined_strict',
        alertConsecutivePredictions: 5,
        alertCooldownSeconds: 1800,
    }), true);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 50,
        incidentDurationSeconds: 20,
        forecastModelVariant: 'unsupported',
        alertConsecutivePredictions: 3,
        alertCooldownSeconds: 300,
    }), false);
    assert.equal(isUserPreferences({
        warningRulaThreshold: 3,
        warningCvaThreshold: 50,
        incidentDurationSeconds: 20,
        forecastModelVariant: 'rula',
        alertConsecutivePredictions: 0,
        alertCooldownSeconds: 29,
    }), false);
});

test('incident tracker stores one completed sustained episode with snapshot', async () => {
    const saved: PostureIncident[] = [];
    const tracker = new PostureIncidentTracker(async (incident) => {
        saved.push(incident);
    }, 15);
    const warning = assessPosture(features({ neck_back_pitch: 15 }));
    const critical = assessPosture(features({ neck_back_pitch: 36 }));
    const good = assessPosture(features());

    await tracker.observe('user-a', 'device-a', warning, 1_000, { frame: 1 }, 'user-a');
    await tracker.observe('user-a', 'device-a', critical, 17_000, { frame: 2 }, 'user-a');
    await tracker.observe('user-a', 'device-a', good, 18_000, { frame: 3 }, 'user-a');

    assert.equal(saved.length, 1);
    assert.equal(saved[0].eventType, 'critical');
    assert.equal(saved[0].durationSeconds, 16);
    assert.equal(saved[0].peakRulaScore, critical.estimatedRulaScore);
    assert.equal(saved[0].minimumCvaAngle, critical.cvaAngle);
    assert.deepEqual(saved[0].sensorSnapshot, { frame: 2 });
    assert.equal(saved[0].ownerUserId, 'user-a');
});

test('incident tracker discards brief deviations', async () => {
    const saved: PostureIncident[] = [];
    const tracker = new PostureIncidentTracker(async (incident) => {
        saved.push(incident);
    }, 15);
    await tracker.observe(
        'user-a',
        'device-a',
        assessPosture(features({ trunk_pitch: 10 })),
        1_000,
        {},
    );
    await tracker.observe(
        'user-a',
        'device-a',
        assessPosture(features()),
        8_000,
        {},
    );
    assert.equal(saved.length, 0);
});

test('incident tracker samples bounded replay frames at 5 Hz', async () => {
    const saved: PostureIncident[] = [];
    const tracker = new PostureIncidentTracker(async (incident) => {
        saved.push(incident);
    }, 0, 5, 3);
    const warning = assessPosture(features({ neck_back_pitch: 15 }));
    const good = assessPosture(features());

    await tracker.observe(
        'user-a',
        'device-a',
        warning,
        1_000,
        replaySnapshot(1),
        'user-a',
        0,
        references,
    );
    await tracker.observe(
        'user-a',
        'device-a',
        warning,
        1_100,
        replaySnapshot(2),
        'user-a',
        0,
        references,
    );
    for (const [timestamp, frame] of [
        [1_200, 3],
        [1_400, 4],
        [1_600, 5],
    ] as const) {
        await tracker.observe(
            'user-a',
            'device-a',
            warning,
            timestamp,
            replaySnapshot(frame),
            'user-a',
            0,
            references,
        );
    }
    await tracker.observe(
        'user-a',
        'device-a',
        good,
        2_000,
        replaySnapshot(6),
        'user-a',
        0,
        references,
    );

    assert.equal(saved.length, 1);
    assert.deepEqual(
        saved[0].replay?.frames.map((frame) => frame.offset_ms),
        [0, 200, 400],
    );
    assert.equal(saved[0].replay?.sampleHz, 5);
    assert.equal(saved[0].replay?.truncated, true);
    assert.deepEqual(
        saved[0].replay?.frames.map((frame) => frame.cva_angle),
        [warning.cvaAngle, warning.cvaAngle, warning.cvaAngle],
    );
    assert.deepEqual(saved[0].replay?.referenceSensors, {
        neck: { quat: references.neck },
        lower_back: { quat: references.lower_back },
        left_shoulder: { quat: references.left_shoulder },
        right_shoulder: { quat: references.right_shoulder },
    });
});

test('incident replay includes five-second prediction context and onset offset', async () => {
    const saved: PostureIncident[] = [];
    const tracker = new PostureIncidentTracker(async (incident) => {
        saved.push(incident);
    }, 0);
    const good = assessPosture(features());
    const warning = assessPosture(features({ neck_back_pitch: 15 }));

    for (const [timestamp, frame, level] of [
        [1_000, 1, 'LOW'],
        [1_200, 2, 'ELEVATED'],
        [1_400, 3, 'HIGH'],
    ] as const) {
        await tracker.observe(
            'user-a',
            'device-a',
            good,
            timestamp,
            predictionSnapshot(frame, level),
            'user-a',
            0,
            references,
        );
    }
    await tracker.observe(
        'user-a',
        'device-a',
        warning,
        1_600,
        predictionSnapshot(4, 'HIGH'),
        'user-a',
        0,
        references,
    );
    await tracker.observe(
        'user-a',
        'device-a',
        warning,
        1_800,
        predictionSnapshot(5, 'HIGH'),
        'user-a',
        0,
        references,
    );
    await tracker.observe(
        'user-a',
        'device-a',
        good,
        2_000,
        predictionSnapshot(6, 'LOW'),
        'user-a',
        0,
        references,
    );

    assert.equal(saved.length, 1);
    assert.equal(saved[0].replay?.incidentOnsetOffsetMs, 600);
    assert.deepEqual(
        saved[0].replay?.frames.map((frame) => frame.offset_ms),
        [0, 200, 400, 600, 800, 1000],
    );
    assert.deepEqual(
        saved[0].replay?.frames.map((frame) => frame.status),
        ['good', 'good', 'good', 'warning', 'warning', 'good'],
    );
    assert.equal(
        saved[0].replay?.frames[1].forecast_level,
        'ELEVATED',
    );
});

test('analytics range and aggregate helpers return typed summaries', () => {
    assert.equal(parseAnalyticsDays(undefined), 7);
    assert.equal(parseAnalyticsDays('30'), 30);
    assert.equal(parseAnalyticsDays('14'), null);
    assert.equal(parseMonth('2026-07'), '2026-07');
    assert.equal(parseMonth('2026-13'), null);
    assert.equal(parseDate('2026-07-14'), '2026-07-14');
    assert.equal(parseDate('2026-02-30'), null);
    assert.equal(parseEventId('42'), 42);
    assert.equal(parseEventId('0'), null);
    assert.equal(parseEventId('not-an-id'), null);

    const summary = summarizeHistory([
        {
            date: '2026-07-13',
            avg_rula: 3,
            avg_cva: 45,
            cva_sample_count: 2,
            total_bad_posture_seconds: 60,
            incident_count: 2,
            warning_count: 2,
            critical_count: 0,
        },
        {
            date: '2026-07-14',
            avg_rula: 6,
            avg_cva: 30,
            cva_sample_count: 1,
            total_bad_posture_seconds: 30,
            incident_count: 1,
            warning_count: 0,
            critical_count: 1,
        },
    ]);
    assert.deepEqual(summary, {
        total_bad_posture_seconds: 90,
        total_incidents: 3,
        average_rula: 4,
        average_cva: 40,
        warning_incidents: 2,
        critical_incidents: 1,
    });
    assert.match(buildRecommendations(summary)[0], /Critical posture/);
    assert.equal(summarizeHistory([{
        date: '2026-07-12',
        avg_rula: 2,
        avg_cva: null,
        cva_sample_count: 0,
        total_bad_posture_seconds: 15,
        incident_count: 1,
        warning_count: 1,
        critical_count: 0,
    }]).average_cva, null);
});

test('analytics endpoints reject unauthenticated and device principals', async () => {
    const app = express();
    app.use('/api/analytics', analyticsRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address() as AddressInfo;
        const endpoint = `http://127.0.0.1:${address.port}/api/analytics/history`;
        const unauthenticated = await fetch(endpoint);
        assert.equal(unauthenticated.status, 401);

        const deviceToken = jwt.sign(
            { kind: 'device', userId: 'user-a', deviceId: 'device-a' },
            config.jwtSecret,
        );
        const deviceResponse = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${deviceToken}` },
        });
        assert.equal(deviceResponse.status, 403);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => {
            if (error) reject(error);
            else resolve();
        }));
    }
});
