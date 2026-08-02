import pool from '../db.js';
import { PosturePayload } from '../types/index.js';
import type { SensorPlacementMode } from '../types/index.js';
import {
    addPostureFrame,
    ForecastFeatureFrame,
    getCalibrationProgress,
    getDeviceCalibrationReferences,
    resetDeviceCalibration,
    SensorReferences,
} from './postureFeatures.js';
import { recordTelemetry } from './recording.js';
import { config } from '../config.js';
import { errorFields, logger } from '../logger.js';
import {
    DEFAULT_USER_PREFERENCES,
    ForecastModelVariant,
    getUserPreferences,
} from './userPreferences.js';
import { personalizationCollector } from './personalization.js';
import { AlertController } from './alertController.js';

const SLOUCH_THRESHOLD_SECONDS = 15;
export const REPLAY_SAMPLE_HZ = 5;
export const MAX_REPLAY_FRAMES = REPLAY_SAMPLE_HZ * 60 * 5;

export interface PostureAssessment {
    cvaAngle: number;
    estimatedRulaScore: number;
    status: 'good' | 'warning' | 'critical';
}

export interface PostureIncident {
    userId: string;
    ownerUserId?: string;
    deviceId: string;
    mountingMode: SensorPlacementMode;
    eventType: 'warning' | 'critical';
    durationSeconds: number;
    peakRulaScore: number;
    minimumCvaAngle: number;
    sensorSnapshot: Record<string, unknown>;
    replay: {
        mountingMode: SensorPlacementMode;
        sampleHz: number;
        referenceSensors: PosturePayload['sensors'];
        frames: ReplayFrame[];
        truncated: boolean;
        incidentOnsetOffsetMs: number;
    } | null;
    loggedAt: Date;
}

export interface ReplayFrame {
    offset_ms: number;
    timestamp: number;
    sensors: PosturePayload['sensors'];
    rula_score: number;
    cva_angle: number;
    status: 'good' | 'warning' | 'critical';
    forecast_probability?: number;
    forecast_level?: ForecastResult['risk_level'];
    forecast_horizon_seconds?: number;
    forecast_generated_at_ms?: number;
}

interface ActiveIncident {
    mountingMode: SensorPlacementMode;
    startedAt: number;
    lastSeenAt: number;
    eventType: 'warning' | 'critical';
    peakRulaScore: number;
    minimumCvaAngle: number;
    sensorSnapshot: Record<string, unknown>;
    referenceSensors: SensorReferences | null;
    replayFrames: ReplayFrame[];
    lastReplayTimestamp: number | null;
    replayTruncated: boolean;
    incidentOnsetOffsetMs: number;
}

/**
 * A transparent estimated-RULA approximation for the four available sensors.
 * It is not a clinical full-body RULA assessment: points are added for
 * calibrated neck flexion, trunk flexion, and shoulder asymmetry.
 */
export function assessPosture(
    features: ForecastFeatureFrame,
    warningRulaThreshold = DEFAULT_USER_PREFERENCES.warningRulaThreshold,
    warningCvaThreshold = DEFAULT_USER_PREFERENCES.warningCvaThreshold,
): PostureAssessment {
    const neckFlexion = Math.abs(features.neck_back_pitch);
    const trunkFlexion = Math.abs(features.trunk_pitch);
    const shoulderAsymmetry = Math.abs(features.shoulder_asymmetry);
    const upperArmElevation = Math.abs(features.upper_arm_elevation ?? 0);
    let score = 1;
    if (neckFlexion >= 10) score += 1;
    if (neckFlexion >= 20) score += 1;
    if (trunkFlexion >= 8) score += 1;
    if (trunkFlexion >= 20) score += 1;
    if (shoulderAsymmetry >= 10) score += 1;
    if (upperArmElevation >= 20) score += 1;
    if (upperArmElevation >= 45) score += 1;
    if (neckFlexion >= 35 || trunkFlexion >= 30) score += 1;
    score = Math.min(7, score);

    const cvaAngle = Math.max(
        20,
        Math.min(60, 55 - neckFlexion * 0.7 - trunkFlexion * 0.2),
    );
    const rulaStatus = score < warningRulaThreshold
        ? 'good'
        : score < Math.min(7, warningRulaThreshold + 2)
          ? 'warning'
          : 'critical';
    const cvaStatus = cvaAngle >= warningCvaThreshold
        ? 'good'
        : cvaAngle >= warningCvaThreshold - 10
          ? 'warning'
          : 'critical';
    const severity = { good: 0, warning: 1, critical: 2 } as const;

    return {
        cvaAngle,
        estimatedRulaScore: score,
        status: severity[cvaStatus] > severity[rulaStatus]
            ? cvaStatus
            : rulaStatus,
    };
}

export class PostureIncidentTracker {
    private active = new Map<string, ActiveIncident>();
    private preRoll = new Map<string, ReplayFrame[]>();

    constructor(
        private readonly saveIncident: (incident: PostureIncident) => Promise<void>,
        private readonly minimumDurationSeconds = SLOUCH_THRESHOLD_SECONDS,
        private readonly replaySampleHz = REPLAY_SAMPLE_HZ,
        private readonly maxReplayFrames = MAX_REPLAY_FRAMES,
    ) {}

    async observe(
        userId: string,
        deviceId: string,
        assessment: PostureAssessment,
        timestampMs: number,
        sensorSnapshot: Record<string, unknown>,
        ownerUserId?: string,
        minimumDurationSeconds = this.minimumDurationSeconds,
        referenceSensors: SensorReferences | null = null,
        mountingMode: SensorPlacementMode = 'shoulder_top',
    ): Promise<void> {
        const key = `${userId}:${deviceId}:${mountingMode}`;
        const current = this.active.get(key);
        const sampledFrame = this.samplePreRoll(
            key,
            timestampMs,
            assessment,
            sensorSnapshot,
        );
        if (assessment.status !== 'good') {
            const severity = assessment.status;
            if (!current) {
                const replayFrames = [...(this.preRoll.get(key) ?? [])];
                const replayStartedAt =
                    replayFrames[0]?.timestamp ?? timestampMs;
                const next: ActiveIncident = {
                    mountingMode,
                    startedAt: timestampMs,
                    lastSeenAt: timestampMs,
                    eventType: severity,
                    peakRulaScore: assessment.estimatedRulaScore,
                    minimumCvaAngle: assessment.cvaAngle,
                    sensorSnapshot,
                    referenceSensors,
                    replayFrames,
                    lastReplayTimestamp:
                        replayFrames.at(-1)?.timestamp ?? null,
                    replayTruncated: false,
                    incidentOnsetOffsetMs: Math.max(
                        0,
                        timestampMs - replayStartedAt,
                    ),
                };
                this.active.set(key, next);
                return;
            }
            current.lastSeenAt = Math.max(current.lastSeenAt, timestampMs);
            if (assessment.estimatedRulaScore >= current.peakRulaScore) {
                current.peakRulaScore = assessment.estimatedRulaScore;
                current.sensorSnapshot = sensorSnapshot;
            }
            if (assessment.cvaAngle < current.minimumCvaAngle) {
                current.minimumCvaAngle = assessment.cvaAngle;
                current.sensorSnapshot = sensorSnapshot;
            }
            if (severity === 'critical') current.eventType = 'critical';
            current.referenceSensors ??= referenceSensors;
            if (sampledFrame) this.appendReplayFrame(current, sampledFrame);
            return;
        }

        if (!current) return;
        if (sampledFrame) this.appendReplayFrame(current, sampledFrame);
        this.active.delete(key);
        const durationSeconds = Math.round(
            Math.max(0, current.lastSeenAt - current.startedAt) / 1000,
        );
        if (durationSeconds < minimumDurationSeconds) return;
        await this.saveIncident({
            userId,
            ownerUserId,
            deviceId,
            mountingMode: current.mountingMode,
            eventType: current.eventType,
            durationSeconds,
            peakRulaScore: current.peakRulaScore,
            minimumCvaAngle: current.minimumCvaAngle,
            sensorSnapshot: current.sensorSnapshot,
            replay: current.referenceSensors && current.replayFrames.length
                ? {
                    mountingMode: current.mountingMode,
                    sampleHz: this.replaySampleHz,
                    referenceSensors: {
                        neck: { quat: { ...current.referenceSensors.neck } },
                        lower_back: {
                            quat: { ...current.referenceSensors.lower_back },
                        },
                        left_shoulder: {
                            quat: { ...current.referenceSensors.left_shoulder },
                        },
                        right_shoulder: {
                            quat: { ...current.referenceSensors.right_shoulder },
                        },
                    },
                    frames: current.replayFrames.map((frame) => ({
                        ...frame,
                        offset_ms: Math.max(
                            0,
                            frame.timestamp -
                                current.replayFrames[0].timestamp,
                        ),
                    })),
                    truncated: current.replayTruncated,
                    incidentOnsetOffsetMs:
                        current.incidentOnsetOffsetMs,
                }
                : null,
            loggedAt: new Date(current.startedAt),
        });
    }

    private samplePreRoll(
        key: string,
        timestampMs: number,
        assessment: PostureAssessment,
        sensorSnapshot: Record<string, unknown>,
    ): ReplayFrame | null {
        const recent = this.preRoll.get(key) ?? [];
        const minimumIntervalMs = 1000 / this.replaySampleHz;
        if (
            recent.length &&
            timestampMs - recent[recent.length - 1].timestamp <
                minimumIntervalMs
        ) {
            return null;
        }
        const sensors = (
            sensorSnapshot as { sensors?: PosturePayload['sensors'] }
        ).sensors;
        if (!sensors) return null;
        const metrics = (
            sensorSnapshot as { metrics?: PosturePayload['metrics'] }
        ).metrics;
        const frame: ReplayFrame = {
            offset_ms: 0,
            timestamp: timestampMs,
            sensors,
            rula_score: assessment.estimatedRulaScore,
            cva_angle: assessment.cvaAngle,
            status: assessment.status,
            forecast_probability: metrics?.forecast_probability,
            forecast_level: metrics?.forecast_level,
            forecast_horizon_seconds:
                metrics?.forecast_horizon_seconds,
            forecast_generated_at_ms:
                metrics?.forecast_generated_at_ms,
        };
        const cutoff = timestampMs - 5000;
        this.preRoll.set(
            key,
            [...recent, frame].filter(
                (candidate) => candidate.timestamp >= cutoff,
            ),
        );
        return frame;
    }

    private appendReplayFrame(
        incident: ActiveIncident,
        frame: ReplayFrame,
    ): void {
        if (
            incident.lastReplayTimestamp !== null &&
            frame.timestamp <= incident.lastReplayTimestamp
        ) {
            return;
        }
        incident.lastReplayTimestamp = frame.timestamp;
        if (incident.replayFrames.length >= this.maxReplayFrames) {
            incident.replayTruncated = true;
            return;
        }
        incident.replayFrames.push(frame);
    }

    reset(): void {
        this.active.clear();
        this.preRoll.clear();
    }

    resetDevice(deviceId: string): void {
        for (const key of this.active.keys()) {
            if (key.includes(`:${deviceId}:`)) this.active.delete(key);
        }
        for (const key of this.preRoll.keys()) {
            if (key.includes(`:${deviceId}:`)) this.preRoll.delete(key);
        }
    }
}

const incidentTracker = new PostureIncidentTracker(async (incident) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ id: number }>(
            `INSERT INTO posture_events
            (user_id, owner_user_id, device_id, event_type, duration_seconds,
             peak_rula_score, minimum_cva_angle, sensor_snapshot, logged_at,
             mounting_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
            [
                incident.userId,
                incident.ownerUserId ?? null,
                incident.deviceId,
                incident.eventType,
                incident.durationSeconds,
                incident.peakRulaScore,
                incident.minimumCvaAngle,
                incident.sensorSnapshot,
                incident.loggedAt,
                incident.mountingMode,
            ],
        );
        if (incident.replay) {
            await client.query(
                `INSERT INTO posture_event_replays
                    (event_id, sample_hz, reference_sensors, frames, truncated,
                     incident_onset_offset_ms, mounting_mode)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    rows[0].id,
                    incident.replay.sampleHz,
                    JSON.stringify(incident.replay.referenceSensors),
                    JSON.stringify(incident.replay.frames),
                    incident.replay.truncated,
                    incident.replay.incidentOnsetOffsetMs,
                    incident.replay.mountingMode,
                ],
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
});

export interface ForecastResult {
    risk_probability?: number;
    risk_level: 'CALIBRATING' | 'COLLECTING' | 'LOW' | 'ELEVATED' | 'HIGH' | 'OFFLINE';
    forecast_horizon_seconds?: number;
    generated_at_ms?: number;
    threshold?: number;
    high_threshold?: number;
    model_version?: string;
    model_variant?: ForecastModelVariant;
    global_forecast?: ForecastPrediction;
    personal_forecast?: ForecastPrediction;
    personal_model_status?: string;
}

export type ForecastPrediction = Omit<
    ForecastResult,
    'global_forecast' | 'personal_forecast'
>;

const lastMlRequestTimes = new Map<string, number>();
const currentForecasts = new Map<string, ForecastResult>();
const calibrationRevisions = new Map<string, number>();
const alertController = new AlertController();

export function resetTelemetryCalibration(deviceId: string): void {
    resetDeviceCalibration(deviceId);
    incidentTracker.resetDevice(deviceId);
    alertController.resetDevice(deviceId);
    lastMlRequestTimes.delete(deviceId);
    currentForecasts.delete(deviceId);
    calibrationRevisions.set(
        deviceId,
        (calibrationRevisions.get(deviceId) ?? 0) + 1,
    );
}

export async function requestForecast(
    deviceId: string,
    timestampMs: number,
    featureWindow: unknown,
    userIdOrFetch?: string | typeof fetch,
    providedFetch: typeof fetch = fetch,
    modelVariant: ForecastModelVariant = 'rula',
    mountingMode: SensorPlacementMode = 'shoulder_top',
): Promise<ForecastResult> {
    const userId = typeof userIdOrFetch === 'string' ? userIdOrFetch : undefined;
    const fetchImplementation = typeof userIdOrFetch === 'function'
        ? userIdOrFetch
        : providedFetch;
    try {
        const response = await fetchImplementation(
            `${config.mlUrl}/api/v1/predict/posture-risk`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(config.mlTimeoutMs),
                body: JSON.stringify({
                    device_id: deviceId,
                    user_id: userId,
                    timestamp_ms: timestampMs,
                    feature_window: featureWindow,
                    model_variant: modelVariant,
                    mounting_mode: mountingMode,
                }),
            },
        );
        if (!response.ok) throw new Error(`ML response ${response.status}`);
        const data = await response.json() as Record<string, unknown>;
        const responseVariant =
            data.model_variant === 'rula' ||
            data.model_variant === 'combined_strict'
                ? data.model_variant
                : undefined;
        const globalData = data.global_forecast &&
            typeof data.global_forecast === 'object'
            ? data.global_forecast as Record<string, unknown>
            : data;
        const parsePrediction = (
            value: Record<string, unknown>,
        ): ForecastPrediction => {
            const level = value.risk_level ?? value.level;
            if (
                typeof level !== 'string' ||
                !['CALIBRATING', 'COLLECTING', 'LOW', 'ELEVATED', 'HIGH', 'OFFLINE']
                    .includes(level)
            ) {
                throw new Error('ML response has an invalid risk_level');
            }
            const threshold = typeof value.threshold === 'number'
                ? value.threshold
                : undefined;
            return {
                risk_probability: typeof (value.risk_probability ?? value.probability) ===
                    'number'
                    ? (value.risk_probability ?? value.probability) as number
                    : undefined,
                risk_level: level as ForecastResult['risk_level'],
                forecast_horizon_seconds:
                    typeof (value.forecast_horizon_seconds ??
                        value.horizon_seconds) === 'number'
                        ? (value.forecast_horizon_seconds ??
                            value.horizon_seconds) as number
                        : undefined,
                generated_at_ms: timestampMs,
                threshold,
                high_threshold: threshold === undefined
                    ? undefined
                    : Math.min(0.95, Math.max(threshold + 0.2, 0.75)),
                model_version: typeof value.model_version === 'string'
                    ? value.model_version
                    : undefined,
                model_variant:
                    value.model_variant === 'rula' ||
                    value.model_variant === 'combined_strict'
                        ? value.model_variant
                        : undefined,
            };
        };
        const globalForecast = parsePrediction(globalData);
        globalForecast.model_variant ??= responseVariant;
        const personalData = data.personal_forecast &&
            typeof data.personal_forecast === 'object'
            ? data.personal_forecast as Record<string, unknown>
            : null;
        const personalForecast = personalData
            ? parsePrediction(personalData)
            : undefined;
        if (personalForecast) personalForecast.model_variant ??= responseVariant;
        return {
            ...globalForecast,
            global_forecast: globalForecast,
            personal_forecast: personalForecast,
            personal_model_status: typeof data.personal_model_status === 'string'
                ? data.personal_model_status
                : undefined,
        };
    } catch (error) {
        logger.warn('ml_forecast_unavailable', {
            deviceId,
            ...errorFields(error),
        });
        return { risk_level: 'OFFLINE' };
    }
}

export function isPosturePayload(data: unknown): data is PosturePayload {
    if (!data || typeof data !== 'object') return false;
    const payload = data as Record<string, unknown>;
    const sensors = payload.sensors as Record<string, unknown> | undefined;
    const validQuaternion = (sensor: unknown): boolean => {
        if (!sensor || typeof sensor !== 'object') return false;
        const quat = (sensor as Record<string, unknown>).quat;
        if (!quat || typeof quat !== 'object') return false;
        const value = quat as Record<string, unknown>;
        const valid = ['w', 'x', 'y', 'z'].every(
            (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
        );
        return valid && Math.hypot(
            value.w as number,
            value.x as number,
            value.y as number,
            value.z as number,
        ) > 1e-9;
    };
    const metrics = payload.metrics;
    const validMountingMode =
        payload.mounting_mode === undefined ||
        payload.mounting_mode === 'shoulder_top' ||
        payload.mounting_mode === 'upper_arm';
    const validMetrics = metrics === undefined || (
        !!metrics &&
        typeof metrics === 'object' &&
        !Array.isArray(metrics) &&
        Object.entries(metrics as Record<string, unknown>).every(([key, value]) => {
            if (['cva_angle', 'rula_score', 'forecast_probability',
                'forecast_horizon_seconds', 'forecast_generated_at_ms',
                'forecast_threshold', 'forecast_high_threshold',
                'global_forecast_probability',
                'personal_forecast_probability'].includes(key)) {
                return typeof value === 'number' && Number.isFinite(value);
            }
            if (['ml_activity', 'forecast_model_version',
                'forecast_model_variant',
                'global_forecast_model_version',
                'personal_forecast_model_version',
                'personal_forecast_status'].includes(key)) {
                return typeof value === 'string' && value.length <= 128;
            }
            if (key === 'status') return ['good', 'warning', 'critical'].includes(value as string);
            if (['forecast_level', 'global_forecast_level',
                'personal_forecast_level'].includes(key)) {
                return ['CALIBRATING', 'COLLECTING', 'LOW', 'ELEVATED', 'HIGH', 'OFFLINE']
                    .includes(value as string);
            }
            return false;
        })
    );
    return (
        payload.schema_version === 1 &&
        typeof payload.device_id === 'string' &&
        payload.device_id.length > 0 &&
        payload.device_id.length <= 128 &&
        typeof payload.user_id === 'string' &&
        payload.user_id.length > 0 &&
        payload.user_id.length <= 128 &&
        typeof payload.timestamp === 'number' &&
        Number.isFinite(payload.timestamp) &&
        payload.timestamp >= 0 &&
        !!sensors &&
        typeof sensors === 'object' &&
        validQuaternion(sensors.neck) &&
        validQuaternion(sensors.lower_back) &&
        validQuaternion(sensors.left_shoulder) &&
        validQuaternion(sensors.right_shoulder) &&
        validMountingMode &&
        validMetrics
    );
}

export async function processTelemetry(
    sensorData: PosturePayload,
    authenticatedUserId?: string,
): Promise<void> {
    const deviceId = sensorData.device_id;
    const userId = authenticatedUserId ?? deviceId;
    const mountingMode = sensorData.mounting_mode ?? 'shoulder_top';
    const normalizedSensorData: PosturePayload = {
        ...sensorData,
        mounting_mode: mountingMode,
    };

    const now = Date.now();
    const timestampMs = sensorData.timestamp ?? now;
    recordTelemetry(normalizedSensorData, timestampMs);
    const preferences = authenticatedUserId
        ? await getUserPreferences(authenticatedUserId)
        : DEFAULT_USER_PREFERENCES;
    const forecastModelVariant =
        mountingMode === 'upper_arm'
            ? 'rula'
            : preferences.forecastModelVariant;
    const postureFrame = addPostureFrame(normalizedSensorData, timestampMs);
    if (authenticatedUserId && postureFrame) {
        try {
            await personalizationCollector.collect(
                authenticatedUserId,
                deviceId,
                timestampMs,
                postureFrame.features,
                mountingMode,
            );
        } catch (error) {
            logger.warn('personalization_collection_failed', {
                userId: authenticatedUserId,
                deviceId,
                ...errorFields(error),
            });
        }
    }
    const assessment = postureFrame
        ? assessPosture(
            postureFrame.features,
            preferences.warningRulaThreshold,
            preferences.warningCvaThreshold,
        )
        : null;
    const calibrationProgress = getCalibrationProgress(deviceId);
    let forecast =
        currentForecasts.get(deviceId) ??
        ({
            risk_level:
                calibrationProgress < 1 ? 'CALIBRATING' : 'COLLECTING',
        } satisfies ForecastResult);
    const lastRequest = lastMlRequestTimes.get(deviceId) ?? 0;

    if (postureFrame?.featureWindow && now - lastRequest > 1000) {
        lastMlRequestTimes.set(deviceId, now);
        const calibrationRevision = calibrationRevisions.get(deviceId) ?? 0;
        void requestForecast(
            deviceId,
            timestampMs,
            postureFrame.featureWindow,
            authenticatedUserId,
            fetch,
            forecastModelVariant,
            mountingMode,
        )
            .then((result) => {
                if (
                    (calibrationRevisions.get(deviceId) ?? 0) ===
                    calibrationRevision
                ) {
                    currentForecasts.set(deviceId, result);
                }
            });
    }
    forecast = currentForecasts.get(deviceId) ?? forecast;

    const enrichedData = {
        ...normalizedSensorData,
        mounting_mode: mountingMode,
        timestamp: timestampMs,
        metrics: {
            ...sensorData.metrics,
            ...(assessment
                ? {
                    cva_angle: assessment.cvaAngle,
                    rula_score: assessment.estimatedRulaScore,
                    status: assessment.status,
                }
                : {}),
            forecast_probability: forecast.risk_probability,
            forecast_level: forecast.risk_level,
            forecast_horizon_seconds: forecast.forecast_horizon_seconds,
            forecast_generated_at_ms: forecast.generated_at_ms,
            forecast_threshold: forecast.threshold,
            forecast_high_threshold: forecast.high_threshold,
            forecast_model_version: forecast.model_version,
            forecast_model_variant: forecast.model_variant ??
                forecastModelVariant,
            global_forecast_probability:
                forecast.global_forecast?.risk_probability ?? forecast.risk_probability,
            global_forecast_level:
                forecast.global_forecast?.risk_level ?? forecast.risk_level,
            global_forecast_model_version:
                forecast.global_forecast?.model_version ?? forecast.model_version,
            personal_forecast_probability:
                forecast.personal_forecast?.risk_probability,
            personal_forecast_level: forecast.personal_forecast?.risk_level,
            personal_forecast_model_version:
                forecast.personal_forecast?.model_version,
            personal_forecast_status: forecast.personal_model_status,
        },
    };

    // Dynamic import avoids a load-time cycle with websocket.ts
    const { broadcastToClients } = await import('./websocket.js');
    broadcastToClients(userId, deviceId, {
        type: 'telemetry',
        payload: enrichedData,
    });

    if (assessment) {
        const alert = alertController.observe({
            key: `${userId}:${deviceId}:${mountingMode}`,
            observedAtMs: timestampMs,
            detectedPosture: assessment.status,
            forecastLevel: forecast.risk_level,
            forecastGeneratedAtMs: forecast.generated_at_ms,
            consecutivePredictions: preferences.alertConsecutivePredictions,
            cooldownSeconds: preferences.alertCooldownSeconds,
        });
        if (alert) {
            broadcastToClients(userId, deviceId, {
                type: 'alert',
                payload: {
                    device_id: deviceId,
                    ...alert,
                },
            });
        }
    }

    if (assessment) {
        try {
            await incidentTracker.observe(
                userId,
                deviceId,
                assessment,
                timestampMs,
                {
                    timestamp: timestampMs,
                    sensors: normalizedSensorData.sensors,
                    metrics: enrichedData.metrics,
                },
                authenticatedUserId,
                preferences.incidentDurationSeconds,
                getDeviceCalibrationReferences(deviceId),
                mountingMode,
            );
        } catch (error) {
            logger.error('posture_event_insert_failed', errorFields(error));
        }
    }
}
