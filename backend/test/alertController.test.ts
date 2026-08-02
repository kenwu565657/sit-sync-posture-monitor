import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    AlertController,
    AlertObservation,
} from '../src/service/alertController.js';

function observation(
    overrides: Partial<AlertObservation> = {},
): AlertObservation {
    return {
        key: 'user-a:device-a',
        observedAtMs: 1000,
        detectedPosture: 'good',
        forecastLevel: 'LOW',
        consecutivePredictions: 3,
        cooldownSeconds: 300,
        ...overrides,
    };
}

test('forecast alerts count only distinct generations and deduplicate episodes', () => {
    const controller = new AlertController();

    assert.equal(controller.observe(observation({
        forecastLevel: 'ELEVATED',
        forecastGeneratedAtMs: 100,
    })), null);
    assert.equal(controller.observe(observation({
        observedAtMs: 2000,
        forecastLevel: 'ELEVATED',
        forecastGeneratedAtMs: 100,
    })), null);
    assert.equal(controller.observe(observation({
        observedAtMs: 3000,
        forecastLevel: 'ELEVATED',
        forecastGeneratedAtMs: 200,
    })), null);
    assert.deepEqual(controller.observe(observation({
        observedAtMs: 4000,
        forecastLevel: 'ELEVATED',
        forecastGeneratedAtMs: 300,
    })), {
        event: 'triggered',
        level: 'ELEVATED',
        source: 'forecast',
        observed_at_ms: 4000,
        forecast_generated_at_ms: 300,
    });
    assert.equal(controller.observe(observation({
        observedAtMs: 5000,
        forecastLevel: 'ELEVATED',
        forecastGeneratedAtMs: 300,
    })), null);
});

test('resolution starts cooldown while high escalation bypasses it', () => {
    const controller = new AlertController();
    const immediate = { consecutivePredictions: 1, cooldownSeconds: 300 };

    assert.equal(controller.observe(observation({
        ...immediate,
        forecastLevel: 'ELEVATED',
        forecastGeneratedAtMs: 100,
    }))?.event, 'triggered');
    assert.equal(controller.observe(observation({
        ...immediate,
        observedAtMs: 2000,
        forecastLevel: 'LOW',
        forecastGeneratedAtMs: 200,
    }))?.event, 'resolved');
    assert.equal(controller.observe(observation({
        ...immediate,
        observedAtMs: 3000,
        forecastLevel: 'ELEVATED',
        forecastGeneratedAtMs: 300,
    })), null);
    assert.deepEqual(controller.observe(observation({
        ...immediate,
        observedAtMs: 4000,
        forecastLevel: 'HIGH',
        forecastGeneratedAtMs: 400,
    }))?.event, 'triggered');
});

test('detected posture takes priority and escalation emits once', () => {
    const controller = new AlertController();

    const started = controller.observe(observation({
        detectedPosture: 'warning',
        forecastLevel: 'HIGH',
        forecastGeneratedAtMs: 100,
    }));
    assert.equal(started?.level, 'ELEVATED');
    assert.equal(started?.source, 'detected');
    assert.equal(controller.observe(observation({
        observedAtMs: 2000,
        detectedPosture: 'warning',
        forecastLevel: 'HIGH',
        forecastGeneratedAtMs: 200,
    })), null);
    assert.equal(controller.observe(observation({
        observedAtMs: 3000,
        detectedPosture: 'critical',
        forecastLevel: 'LOW',
        forecastGeneratedAtMs: 300,
    }))?.event, 'escalated');
    assert.equal(controller.observe(observation({
        observedAtMs: 4000,
        detectedPosture: 'critical',
        forecastLevel: 'LOW',
        forecastGeneratedAtMs: 400,
    })), null);
});

test('reset clears an active device episode', () => {
    const controller = new AlertController();
    assert.equal(controller.observe(observation({
        detectedPosture: 'critical',
    }))?.event, 'triggered');
    controller.resetDevice('device-a');
    assert.equal(controller.observe(observation({
        detectedPosture: 'critical',
        observedAtMs: 2000,
    }))?.event, 'triggered');
});
