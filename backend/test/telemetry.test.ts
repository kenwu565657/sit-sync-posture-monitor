import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestForecast } from '../src/service/telemetry.js';

test('ML network failures return the offline fallback', async () => {
    const result = await requestForecast(
        'device-a',
        1000,
        [],
        async () => {
            throw new Error('connection refused');
        },
    );

    assert.deepEqual(result, { risk_level: 'OFFLINE' });
});

test('ML forecasts retain their generation time and thresholds', async () => {
    const result = await requestForecast(
        'device-a',
        12_345,
        [],
        async () => new Response(JSON.stringify({
            risk_probability: 0.82,
            risk_level: 'HIGH',
            forecast_horizon_seconds: 5,
            threshold: 0.55,
            model_version: 'demo',
        }), { status: 200 }),
    );

    assert.equal(result.generated_at_ms, 12_345);
    assert.equal(result.threshold, 0.55);
    assert.equal(result.high_threshold, 0.75);
});

test('ML request sends user identity and accepts dual forecast responses', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const result = await requestForecast(
        'device-a',
        12_345,
        [{ trunk_pitch: 1 }],
        'user-a',
        async (_input, init) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(JSON.stringify({
                global_forecast: {
                    probability: 0.4,
                    level: 'ELEVATED',
                    horizon_seconds: 5,
                    threshold: 0.35,
                    model_version: 'global-1',
                },
                personal_forecast: {
                    probability: 0.7,
                    level: 'HIGH',
                    horizon_seconds: 5,
                    threshold: 0.5,
                    model_version: 'personal-1',
                },
                personal_model_status: 'ready',
                model_variant: 'combined_strict',
            }), { status: 200 });
        },
        'combined_strict',
    );

    assert.equal(requestBody?.user_id, 'user-a');
    assert.equal(requestBody?.model_variant, 'combined_strict');
    assert.equal(result.risk_probability, 0.4);
    assert.equal(result.model_variant, 'combined_strict');
    assert.equal(result.global_forecast?.model_version, 'global-1');
    assert.equal(result.personal_forecast?.risk_probability, 0.7);
    assert.equal(result.personal_model_status, 'ready');
});
