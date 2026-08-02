import {
  predictionSecondsRemaining,
  updatePredictionCountdown,
} from '../src/alerts/predictionCountdown';
import { PosturePayload } from '../src/types';

describe('prediction countdown', () => {
  it('uses the model generation time and horizon', () => {
    const active = updatePredictionCountdown(
      { mode: 'idle' },
      payload('HIGH', 0.86, 10_000, 5),
      11_000,
    );
    expect(active).toMatchObject({
      mode: 'active',
      deadlineMs: 15_000,
      probability: 0.86,
    });
    expect(predictionSecondsRemaining(active, 12_500)).toBe(2.5);
  });

  it('resets to a newer prediction deadline', () => {
    const first = updatePredictionCountdown(
      { mode: 'idle' },
      payload('ELEVATED', 0.62, 10_000, 5),
      10_000,
    );
    const newer = updatePredictionCountdown(
      first,
      payload('HIGH', 0.9, 12_000, 5),
      12_100,
    );
    expect(newer).toMatchObject({ mode: 'active', deadlineMs: 17_000 });
  });

  it('shows success when risk drops before the deadline', () => {
    const active = updatePredictionCountdown(
      { mode: 'idle' },
      payload('HIGH', 0.85, 10_000, 5),
      10_500,
    );
    const corrected = updatePredictionCountdown(
      active,
      payload('LOW', 0.15, 12_000, 5),
      12_100,
    );
    expect(corrected).toEqual({
      mode: 'corrected',
      visibleUntilMs: 15_100,
    });
  });
});

function payload(
  level: NonNullable<PosturePayload['metrics']>['forecast_level'],
  probability: number,
  generatedAtMs: number,
  horizonSeconds: number,
): PosturePayload {
  const sensor = { quat: { x: 0, y: 0, z: 0, w: 1 } };
  return {
    schema_version: 1,
    timestamp: generatedAtMs,
    device_id: 'gateway-1',
    user_id: 'user-1',
    sensors: {
      neck: sensor,
      lower_back: sensor,
      left_shoulder: sensor,
      right_shoulder: sensor,
    },
    metrics: {
      status: 'good',
      forecast_level: level,
      forecast_probability: probability,
      forecast_generated_at_ms: generatedAtMs,
      forecast_horizon_seconds: horizonSeconds,
    },
  };
}
