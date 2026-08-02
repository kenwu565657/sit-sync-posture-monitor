import {
  postureAlert,
  shouldApplyTelemetryAlert,
  shouldDeliverTelemetryFeedback,
  shouldVibrate,
} from '../src/alerts/postureAlert';
import { PosturePayload } from '../src/types';

describe('foreground posture alerts', () => {
  it('prioritizes a high five-second forecast', () => {
    expect(
      postureAlert(payload({ forecast_level: 'HIGH', status: 'good' })),
    ).toMatchObject({
      level: 'critical',
      title: 'Posture risk predicted',
    });
  });

  it('maps backend posture status to warning and normal states', () => {
    expect(postureAlert(payload({ status: 'warning' })).level).toBe('warning');
    expect(postureAlert(payload({ status: 'good' })).level).toBe('none');
  });

  it('labels derived CVA-like values and explains the direction', () => {
    expect(
      postureAlert(
        payload({ status: 'warning', rula_score: 4, cva_angle: 42.25 }),
      ).detail,
    ).toContain('Derived CVA-like: 42.3° (lower is worse).');
    expect(postureAlert(payload({ status: 'good' })).detail).toContain(
      'Derived CVA-like: — (lower is worse).',
    );
  });

  it('prioritizes detected bad posture over a stale forecast', () => {
    expect(
      postureAlert(payload({ forecast_level: 'HIGH', status: 'critical' })),
    ).toMatchObject({
      kind: 'detected',
      title: 'Critical posture',
    });
  });

  it('vibrates immediately on escalation and then observes cooldown', () => {
    expect(shouldVibrate('critical', 'warning', 9_000, 10_000)).toBe(true);
    expect(shouldVibrate('critical', 'critical', 9_000, 10_000)).toBe(false);
    expect(shouldVibrate('critical', 'critical', 9_000, 40_000)).toBe(true);
    expect(shouldVibrate('none', 'critical', 0, 100_000)).toBe(false);
  });

  it('keeps a recent server alert ahead of telemetry-derived display state', () => {
    expect(shouldApplyTelemetryAlert(10_000, 39_999)).toBe(false);
    expect(shouldApplyTelemetryAlert(10_000, 40_000)).toBe(true);
  });

  it('uses telemetry as a detected-posture feedback fallback only', () => {
    const detected = postureAlert(payload({ status: 'warning' }));
    const predicted = postureAlert(
      payload({ status: 'good', forecast_level: 'HIGH' }),
    );

    expect(shouldDeliverTelemetryFeedback(detected, 0, 40_000)).toBe(true);
    expect(shouldDeliverTelemetryFeedback(detected, 10_000, 39_999)).toBe(
      false,
    );
    expect(shouldDeliverTelemetryFeedback(predicted, 0, 40_000)).toBe(false);
  });
});

function payload(metrics: PosturePayload['metrics']): PosturePayload {
  const sensor = { quat: { x: 0, y: 0, z: 0, w: 1 } };
  return {
    schema_version: 1,
    timestamp: 1,
    device_id: 'gateway-1',
    user_id: 'user-1',
    sensors: {
      neck: sensor,
      lower_back: sensor,
      left_shoulder: sensor,
      right_shoulder: sensor,
    },
    metrics,
  };
}
