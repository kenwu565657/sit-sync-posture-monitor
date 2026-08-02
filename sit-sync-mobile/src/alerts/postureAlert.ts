import { PosturePayload, ServerPostureAlert } from '../types';
import { derivedCvaDetail } from '../cva';

export type PostureAlertLevel = 'none' | 'warning' | 'critical';

export interface PostureAlert {
  level: PostureAlertLevel;
  kind: 'prediction' | 'detected' | 'normal';
  title: string;
  detail: string;
}

export function postureAlert(payload: PosturePayload): PostureAlert {
  const metrics = payload.metrics;
  const cvaDetail = derivedCvaDetail(metrics?.cva_angle);
  if (metrics?.status === 'critical') {
    return {
      level: 'critical',
      kind: 'detected',
      title: 'Critical posture',
      detail: `Estimated RULA ${
        metrics.rula_score ?? 'high'
      } — return to neutral. ${cvaDetail}`,
    };
  }
  if (metrics?.status === 'warning') {
    return {
      level: 'warning',
      kind: 'detected',
      title: 'Posture warning',
      detail: `Estimated RULA ${
        metrics.rula_score ?? 'elevated'
      } — check your posture. ${cvaDetail}`,
    };
  }
  if (metrics?.forecast_level === 'HIGH') {
    return {
      level: 'critical',
      kind: 'prediction',
      title: 'Posture risk predicted',
      detail: `High risk is predicted within the next 5 seconds. Adjust now. ${cvaDetail}`,
    };
  }
  if (metrics?.forecast_level === 'ELEVATED') {
    return {
      level: 'warning',
      kind: 'prediction',
      title: 'Posture warning',
      detail: `Posture risk is rising. Make a small correction. ${cvaDetail}`,
    };
  }
  return {
    level: 'none',
    kind: 'normal',
    title: 'Posture normal',
    detail: `${
      metrics?.forecast_level === 'CALIBRATING'
        ? 'Calibrating your neutral posture…'
        : 'No current warning.'
    } ${cvaDetail}`,
  };
}

export function serverPostureAlert(alert: ServerPostureAlert): PostureAlert {
  return {
    level: alert.level,
    kind: alert.kind,
    title: alert.title,
    detail: alert.detail,
  };
}

export function shouldApplyTelemetryAlert(
  lastServerAlertAt: number,
  now: number,
  precedenceMs = 30_000,
): boolean {
  return now - lastServerAlertAt >= precedenceMs;
}

export function shouldDeliverTelemetryFeedback(
  alert: PostureAlert,
  lastServerAlertAt: number,
  now: number,
): boolean {
  return (
    alert.kind === 'detected' &&
    shouldApplyTelemetryAlert(lastServerAlertAt, now)
  );
}

export function shouldVibrate(
  nextLevel: PostureAlertLevel,
  previousLevel: PostureAlertLevel,
  lastVibrationAt: number,
  now: number,
  cooldownMs = 30_000,
): boolean {
  if (nextLevel === 'none') return false;
  if (nextLevel === 'critical' && previousLevel !== 'critical') return true;
  return now - lastVibrationAt >= cooldownMs;
}
