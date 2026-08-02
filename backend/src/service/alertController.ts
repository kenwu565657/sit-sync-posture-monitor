export type AlertLevel = 'ELEVATED' | 'HIGH';
export type DetectedPosture = 'good' | 'warning' | 'critical';
export type ForecastLevel =
    | 'CALIBRATING'
    | 'COLLECTING'
    | 'LOW'
    | AlertLevel
    | 'OFFLINE';

export interface AlertObservation {
    key: string;
    observedAtMs: number;
    detectedPosture: DetectedPosture;
    forecastLevel: ForecastLevel;
    forecastGeneratedAtMs?: number;
    consecutivePredictions: number;
    cooldownSeconds: number;
}

export interface AlertEvent {
    event: 'triggered' | 'escalated' | 'resolved';
    level: AlertLevel;
    source: 'detected' | 'forecast';
    observed_at_ms: number;
    forecast_generated_at_ms?: number;
}

interface AlertState {
    activeLevel?: AlertLevel;
    activeSource?: AlertEvent['source'];
    cooldownUntilMs: number;
    lastForecastGeneratedAtMs?: number;
    consecutiveForecasts: number;
    consecutiveLevel?: AlertLevel;
}

const severity: Record<AlertLevel, number> = {
    ELEVATED: 1,
    HIGH: 2,
};

/**
 * Stateful alert policy with no I/O. Callers own delivery and persistence.
 * Detected posture is authoritative whenever it is warning or critical.
 */
export class AlertController {
    private readonly states = new Map<string, AlertState>();

    observe(observation: AlertObservation): AlertEvent | null {
        const state = this.states.get(observation.key) ?? {
            cooldownUntilMs: 0,
            consecutiveForecasts: 0,
        };
        this.states.set(observation.key, state);

        const detectedLevel = observation.detectedPosture === 'critical'
            ? 'HIGH'
            : observation.detectedPosture === 'warning'
              ? 'ELEVATED'
              : undefined;
        let candidate: AlertLevel | undefined;
        let source: AlertEvent['source'] = 'forecast';

        if (detectedLevel) {
            candidate = detectedLevel;
            source = 'detected';
            state.consecutiveForecasts = 0;
            state.consecutiveLevel = undefined;
        } else {
            candidate = this.forecastCandidate(state, observation);
        }

        if (state.activeLevel) {
            if (!candidate) {
                const resolvedLevel = state.activeLevel;
                const resolvedSource = state.activeSource ?? 'forecast';
                state.activeLevel = undefined;
                state.activeSource = undefined;
                state.cooldownUntilMs =
                    observation.observedAtMs + observation.cooldownSeconds * 1000;
                return {
                    event: 'resolved',
                    level: resolvedLevel,
                    source: resolvedSource,
                    observed_at_ms: observation.observedAtMs,
                    forecast_generated_at_ms:
                        observation.forecastGeneratedAtMs,
                };
            }
            if (severity[candidate] > severity[state.activeLevel]) {
                state.activeLevel = candidate;
                state.activeSource = source;
                return this.event('escalated', candidate, source, observation);
            }
            return null;
        }

        if (!candidate) return null;
        const inCooldown = observation.observedAtMs < state.cooldownUntilMs;
        if (inCooldown && candidate !== 'HIGH') {
            state.consecutiveForecasts = 0;
            state.consecutiveLevel = undefined;
            return null;
        }

        state.activeLevel = candidate;
        state.activeSource = source;
        return this.event('triggered', candidate, source, observation);
    }

    reset(key?: string): void {
        if (key === undefined) this.states.clear();
        else this.states.delete(key);
    }

    resetDevice(deviceId: string): void {
        for (const key of this.states.keys()) {
            if (key.endsWith(`:${deviceId}`)) this.states.delete(key);
        }
    }

    private forecastCandidate(
        state: AlertState,
        observation: AlertObservation,
    ): AlertLevel | undefined {
        const generatedAt = observation.forecastGeneratedAtMs;
        if (
            generatedAt === undefined ||
            generatedAt === state.lastForecastGeneratedAtMs
        ) {
            return state.consecutiveForecasts >= observation.consecutivePredictions
                ? state.consecutiveLevel
                : undefined;
        }
        state.lastForecastGeneratedAtMs = generatedAt;

        if (
            observation.forecastLevel !== 'ELEVATED' &&
            observation.forecastLevel !== 'HIGH'
        ) {
            state.consecutiveForecasts = 0;
            state.consecutiveLevel = undefined;
            return undefined;
        }

        state.consecutiveForecasts += 1;
        if (
            !state.consecutiveLevel ||
            severity[observation.forecastLevel] > severity[state.consecutiveLevel]
        ) {
            state.consecutiveLevel = observation.forecastLevel;
        }
        return state.consecutiveForecasts >= observation.consecutivePredictions
            ? state.consecutiveLevel
            : undefined;
    }

    private event(
        event: AlertEvent['event'],
        level: AlertLevel,
        source: AlertEvent['source'],
        observation: AlertObservation,
    ): AlertEvent {
        return {
            event,
            level,
            source,
            observed_at_ms: observation.observedAtMs,
            forecast_generated_at_ms: observation.forecastGeneratedAtMs,
        };
    }
}
