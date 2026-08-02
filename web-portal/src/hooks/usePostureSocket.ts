import { useEffect, useRef, useState } from 'react';
import { env } from '../config/env';

export interface Quaternion {
    w: number;
    x: number;
    y: number;
    z: number;
}

interface SensorReading {
    quat: Quaternion;
}

export interface PosturePayload {
    schema_version: 1;
    timestamp: number;
    device_id: string;
    user_id: string;
    mounting_mode?: 'shoulder_top' | 'upper_arm';
    sensors: {
        neck?: SensorReading;
        lower_back?: SensorReading;
        left_shoulder?: SensorReading;
        right_shoulder?: SensorReading;
    };
    metrics?: {
        cva_angle?: number;
        rula_score?: number;
        status?: 'good' | 'warning' | 'critical';
        ml_activity?: string;
        forecast_probability?: number;
        forecast_level?: 'CALIBRATING' | 'COLLECTING' | 'LOW' | 'ELEVATED' | 'HIGH' | 'OFFLINE';
        forecast_horizon_seconds?: number;
        forecast_generated_at_ms?: number;
        forecast_threshold?: number;
        forecast_high_threshold?: number;
        forecast_model_version?: string;
        personal_forecast_probability?: number;
        personal_forecast_level?: 'CALIBRATING' | 'COLLECTING' | 'LOW' | 'ELEVATED' | 'HIGH' | 'OFFLINE';
        personal_forecast_model_version?: string;
        personal_forecast_status?: string;
    };
}

export type ConnectionState =
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected';

export interface ForecastSample {
    generatedAtMs: number;
    probability: number;
    level: NonNullable<PosturePayload['metrics']>['forecast_level'];
    threshold?: number;
    highThreshold?: number;
    personalProbability?: number;
    personalLevel?: NonNullable<PosturePayload['metrics']>['personal_forecast_level'];
}

export interface ServerAlert {
    id?: string;
    timestamp: number;
    deviceId?: string;
    level: 'warning' | 'critical' | 'resolved';
    kind: 'detected' | 'prediction';
    event: 'triggered' | 'escalated' | 'resolved';
    title: string;
    detail: string;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_JITTER = 0.3;
const AUTH_CLOSE_CODES = new Set([1008, 4401, 4403]);
const STATUSES = new Set(['good', 'warning', 'critical']);
const FORECAST_LEVELS = new Set([
    'CALIBRATING',
    'COLLECTING',
    'LOW',
    'ELEVATED',
    'HIGH',
    'OFFLINE',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isOptionalFiniteNumber = (value: unknown) =>
    value === undefined || isFiniteNumber(value);

const isQuaternion = (value: unknown): value is Quaternion => {
    if (!isRecord(value)) return false;
    return ['w', 'x', 'y', 'z'].every((key) => isFiniteNumber(value[key]));
};

const isSensorReading = (value: unknown): value is SensorReading =>
    isRecord(value) && isQuaternion(value.quat);

const isMetrics = (value: unknown): value is PosturePayload['metrics'] => {
    if (value === undefined) return true;
    if (!isRecord(value)) return false;

    return (
        isOptionalFiniteNumber(value.cva_angle) &&
        isOptionalFiniteNumber(value.rula_score) &&
        isOptionalFiniteNumber(value.forecast_probability) &&
        isOptionalFiniteNumber(value.personal_forecast_probability) &&
        isOptionalFiniteNumber(value.forecast_horizon_seconds) &&
        isOptionalFiniteNumber(value.forecast_generated_at_ms) &&
        isOptionalFiniteNumber(value.forecast_threshold) &&
        isOptionalFiniteNumber(value.forecast_high_threshold) &&
        (value.status === undefined ||
            (typeof value.status === 'string' && STATUSES.has(value.status))) &&
        (value.ml_activity === undefined || typeof value.ml_activity === 'string') &&
        (value.forecast_level === undefined ||
            (typeof value.forecast_level === 'string' &&
                FORECAST_LEVELS.has(value.forecast_level))) &&
        (value.forecast_model_version === undefined ||
            typeof value.forecast_model_version === 'string') &&
        (value.personal_forecast_level === undefined ||
            (typeof value.personal_forecast_level === 'string' &&
                FORECAST_LEVELS.has(value.personal_forecast_level))) &&
        (value.personal_forecast_model_version === undefined ||
            typeof value.personal_forecast_model_version === 'string') &&
        (value.personal_forecast_status === undefined ||
            typeof value.personal_forecast_status === 'string')
    );
};

export const isPosturePayload = (value: unknown): value is PosturePayload => {
    if (!isRecord(value) || !isRecord(value.sensors)) return false;

    const sensorValues = [
        value.sensors.neck,
        value.sensors.lower_back,
        value.sensors.left_shoulder,
        value.sensors.right_shoulder,
    ].filter((sensor) => sensor !== undefined);

    return (
        value.schema_version === 1 &&
        isFiniteNumber(value.timestamp) &&
        typeof value.device_id === 'string' &&
        value.device_id.length > 0 &&
        typeof value.user_id === 'string' &&
        value.user_id.length > 0 &&
        (value.mounting_mode === undefined ||
            value.mounting_mode === 'shoulder_top' ||
            value.mounting_mode === 'upper_arm') &&
        sensorValues.length > 0 &&
        sensorValues.every(isSensorReading) &&
        isMetrics(value.metrics)
    );
};

const extractPosturePayload = (message: unknown): PosturePayload | null => {
    if (isPosturePayload(message)) return message;
    if (!isRecord(message)) return null;

    if (isPosturePayload(message.payload)) return message.payload;
    if (isPosturePayload(message.data)) return message.data;
    return null;
};

const messageKind = (message: Record<string, unknown>) =>
    typeof message.type === 'string'
        ? message.type
        : typeof message.action === 'string'
          ? message.action
          : null;

export const extractServerAlert = (message: unknown): ServerAlert | null => {
    if (!isRecord(message)) return null;
    const kind = messageKind(message);
    if (kind !== 'alert' && kind !== 'posture_alert') return null;
    const source = isRecord(message.payload)
        ? message.payload
        : isRecord(message.data)
          ? message.data
          : message;
    if (
        source.level !== 'warning' &&
        source.level !== 'critical' &&
        source.level !== 'ELEVATED' &&
        source.level !== 'HIGH'
    ) return null;
    const event =
        source.event === 'escalated' || source.event === 'resolved'
            ? source.event
            : 'triggered';
    const level =
        event === 'resolved'
            ? 'resolved'
            : source.level === 'critical' || source.level === 'HIGH'
              ? 'critical'
              : 'warning';

    const alertKind =
        source.kind === 'prediction' ||
        source.alert_type === 'prediction' ||
        source.source === 'forecast'
            ? 'prediction'
            : 'detected';
    const fallbackTitle =
        level === 'resolved'
            ? 'Posture alert resolved'
            : level === 'critical'
              ? 'Critical posture'
              : 'Posture warning';
    const detail =
        typeof source.detail === 'string'
            ? source.detail
            : typeof source.message === 'string'
              ? source.message
              : level === 'resolved'
                ? 'The server reports that the active posture alert has cleared.'
                : 'The server detected posture risk. Adjust toward your neutral pose.';

    return {
        id:
            typeof source.id === 'string'
                ? source.id
                : typeof source.event_id === 'string'
                  ? source.event_id
                  : undefined,
        timestamp: isFiniteNumber(source.observed_at_ms)
            ? source.observed_at_ms
            : isFiniteNumber(source.timestamp)
              ? source.timestamp
              : Date.now(),
        deviceId: typeof source.device_id === 'string' ? source.device_id : undefined,
        level,
        kind: alertKind,
        event,
        title: typeof source.title === 'string' ? source.title : fallbackTitle,
        detail,
    };
};

export function usePostureSocket(url = env.webSocketUrl) {
    const [postureData, setPostureData] = useState<PosturePayload | null>(null);
    const [connectionState, setConnectionState] =
        useState<ConnectionState>('connecting');
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [isStale, setIsStale] = useState(false);
    const [forecastHistory, setForecastHistory] = useState<ForecastSample[]>([]);
    const [serverAlert, setServerAlert] = useState<ServerAlert | null>(null);
    const lastUpdateMs = useRef<number | null>(null);
    const awaitingFirstUpdateSinceMs = useRef<number | null>(null);

    useEffect(() => {
        let socket: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        let staleTimer: ReturnType<typeof setInterval> | null = null;
        let reconnectAttempt = 0;
        let stopped = false;

        const clearSocketTimers = () => {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        };

        const sendControlMessage = (
            ws: WebSocket,
            action: 'auth' | 'hello' | 'subscribe' | 'ping' | 'pong',
            extra: Record<string, unknown> = {},
        ) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ action, type: action, ...extra }));
        };

        const scheduleReconnect = () => {
            if (stopped || reconnectTimer) return;

            const exponentialDelay = Math.min(
                RECONNECT_MAX_MS,
                RECONNECT_BASE_MS * 2 ** reconnectAttempt,
            );
            const jitter = exponentialDelay * RECONNECT_JITTER * Math.random();
            reconnectAttempt += 1;
            setConnectionState('reconnecting');
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, exponentialDelay + jitter);
        };

        const connect = () => {
            if (stopped) return;

            const token = localStorage.getItem('sit_sync_token');
            if (!token) {
                setConnectionState('disconnected');
                return;
            }

            setConnectionState(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
            socket = new WebSocket(url);

            socket.onopen = () => {
                if (stopped || !socket) return;
                sendControlMessage(socket, 'auth', { token });
            };

            socket.onmessage = (event) => {
                if (!socket) return;

                try {
                    const message: unknown = JSON.parse(String(event.data));
                    const kind = isRecord(message) ? messageKind(message) : null;
                    if (kind === 'auth_ok') {
                        sendControlMessage(socket, 'hello', { role: 'client' });
                        return;
                    }
                    if (kind === 'hello_ack') {
                        reconnectAttempt = 0;
                        setConnectionState('connected');
                        if (lastUpdateMs.current === null) {
                            awaitingFirstUpdateSinceMs.current = Date.now();
                        }
                        sendControlMessage(socket, 'subscribe');
                        heartbeatTimer = setInterval(() => {
                            if (socket) {
                                sendControlMessage(socket, 'ping', {
                                    timestamp: Date.now(),
                                });
                            }
                        }, env.heartbeatIntervalMs);
                        return;
                    }
                    if (kind === 'ping') {
                        sendControlMessage(socket, 'pong', { timestamp: Date.now() });
                        return;
                    }

                    const alert = extractServerAlert(message);
                    if (alert) {
                        setServerAlert(alert);
                        return;
                    }

                    const payload = extractPosturePayload(message);
                    if (!payload) {
                        if (!isRecord(message) ||
                            !['pong', 'heartbeat', 'subscribed', 'auth_ok', 'hello_ack'].includes(
                                messageKind(message) ?? '',
                            )) {
                            console.warn('Ignored invalid WebSocket message');
                        }
                        return;
                    }

                    const receivedAt = Date.now();
                    reconnectAttempt = 0;
                    lastUpdateMs.current = receivedAt;
                    awaitingFirstUpdateSinceMs.current = null;
                    setLastUpdate(new Date(receivedAt));
                    setIsStale(false);
                    setPostureData(payload);
                    const metrics = payload.metrics;
                    if (
                        typeof metrics?.forecast_generated_at_ms === 'number' &&
                        typeof metrics.forecast_probability === 'number' &&
                        metrics.forecast_level
                    ) {
                        const sample: ForecastSample = {
                            generatedAtMs: metrics.forecast_generated_at_ms,
                            probability: metrics.forecast_probability,
                            level: metrics.forecast_level,
                            threshold: metrics.forecast_threshold,
                            highThreshold: metrics.forecast_high_threshold,
                            personalProbability:
                                metrics.personal_forecast_probability,
                            personalLevel: metrics.personal_forecast_level,
                        };
                        setForecastHistory((current) => {
                            if (
                                current.at(-1)?.generatedAtMs ===
                                sample.generatedAtMs
                            ) {
                                return current;
                            }
                            const cutoff = sample.generatedAtMs - 60_000;
                            return [...current, sample].filter(
                                (entry) => entry.generatedAtMs >= cutoff,
                            );
                        });
                    }
                } catch {
                    console.warn('Ignored malformed WebSocket message');
                }
            };

            socket.onerror = () => {
                // The close event owns reconnect scheduling.
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.close();
                }
            };

            socket.onclose = (event) => {
                clearSocketTimers();
                socket = null;
                if (stopped) return;

                if (AUTH_CLOSE_CODES.has(event.code)) {
                    setConnectionState('disconnected');
                    return;
                }
                scheduleReconnect();
            };
        };

        staleTimer = setInterval(() => {
            const freshnessReference =
                lastUpdateMs.current ?? awaitingFirstUpdateSinceMs.current;
            if (freshnessReference !== null) {
                setIsStale(Date.now() - freshnessReference > env.staleAfterMs);
            }
        }, Math.min(1_000, env.staleAfterMs));

        connect();

        return () => {
            stopped = true;
            clearSocketTimers();
            if (staleTimer) clearInterval(staleTimer);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            const activeSocket = socket;
            socket = null;
            if (activeSocket?.readyState === WebSocket.OPEN) {
                activeSocket.close(1000, 'Component unmounted');
            } else if (activeSocket?.readyState === WebSocket.CONNECTING) {
                activeSocket.onmessage = null;
                activeSocket.onerror = null;
                activeSocket.onclose = null;
                activeSocket.onopen = () => {
                    activeSocket.close(1000, 'Component unmounted');
                };
            }
        };
    }, [url]);

    return {
        postureData,
        connectionState,
        isConnected: connectionState === 'connected',
        isStale,
        lastUpdate,
        forecastHistory,
        serverAlert,
    };
}