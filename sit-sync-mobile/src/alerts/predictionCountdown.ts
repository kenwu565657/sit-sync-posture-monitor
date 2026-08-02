import { PosturePayload } from '../types';

export type PredictionCountdownState =
  | { mode: 'idle' }
  | {
      mode: 'active';
      generatedAtMs: number;
      deadlineMs: number;
      probability?: number;
      level: 'ELEVATED' | 'HIGH';
    }
  | { mode: 'corrected'; visibleUntilMs: number };

export function updatePredictionCountdown(
  previous: PredictionCountdownState,
  payload: PosturePayload,
  nowMs: number,
): PredictionCountdownState {
  const metrics = payload.metrics;
  const level = metrics?.forecast_level;
  const generatedAtMs = metrics?.forecast_generated_at_ms;
  const horizonSeconds = metrics?.forecast_horizon_seconds;
  if (
    (level === 'ELEVATED' || level === 'HIGH') &&
    metrics?.status === 'good' &&
    typeof generatedAtMs === 'number' &&
    typeof horizonSeconds === 'number'
  ) {
    const deadlineMs = generatedAtMs + horizonSeconds * 1000;
    if (deadlineMs > nowMs) {
      return {
        mode: 'active',
        generatedAtMs,
        deadlineMs,
        probability: metrics?.forecast_probability,
        level,
      };
    }
  }
  if (
    previous.mode === 'active' &&
    level === 'LOW' &&
    metrics?.status === 'good' &&
    nowMs <= previous.deadlineMs
  ) {
    return { mode: 'corrected', visibleUntilMs: nowMs + 3000 };
  }
  if (
    previous.mode === 'corrected' &&
    nowMs < previous.visibleUntilMs &&
    level !== 'ELEVATED' &&
    level !== 'HIGH'
  ) {
    return previous;
  }
  return { mode: 'idle' };
}

export function predictionSecondsRemaining(
  state: PredictionCountdownState,
  nowMs: number,
): number {
  return state.mode === 'active'
    ? Math.max(0, (state.deadlineMs - nowMs) / 1000)
    : 0;
}
