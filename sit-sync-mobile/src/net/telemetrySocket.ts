import {
  ConnectionState,
  PosturePayload,
  ServerPostureAlert,
} from '../types';

type StateListener = (state: ConnectionState, detail?: string) => void;
type TelemetryListener = (payload: PosturePayload) => void;
type AlertListener = (alert: ServerPostureAlert) => void;

export interface TelemetrySocketOptions {
  httpUrl: string;
  wsUrl: string;
  deviceId: string;
  userId: string;
  credential?: string;
  accessToken?: string;
  accessTokenProvider?: () => Promise<string>;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  random?: () => number;
}

export class TelemetrySocket {
  private ws: WebSocket | null = null;
  private listener: StateListener | null = null;
  private telemetryListener: TelemetryListener | null = null;
  private alertListener: AlertListener | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private token: string | null;
  private queuedFrame: PosturePayload | null = null;
  private protocolReady = false;

  constructor(private readonly options: TelemetrySocketOptions) {
    this.token = options.accessToken ?? null;
  }

  onStateChange(listener: StateListener) {
    this.listener = listener;
  }

  onTelemetry(listener: TelemetryListener) {
    this.telemetryListener = listener;
  }

  onAlert(listener: AlertListener) {
    this.alertListener = listener;
  }

  private setState(state: ConnectionState, detail?: string) {
    this.listener?.(state, detail);
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!this.options.httpUrl || !this.options.wsUrl) {
      this.setState('error', 'Telemetry endpoints are not configured');
      return;
    }
    if (!this.options.deviceId || !this.options.userId) {
      this.setState('error', 'Gateway identity is not configured');
      return;
    }

    if (!this.token) {
      this.setState('authenticating');
      try {
        this.token = await this.authenticate();
      } catch (error) {
        this.setState(
          'error',
          error instanceof Error ? error.message : 'Device authentication failed',
        );
        this.scheduleReconnect();
        return;
      }
    }

    this.setState('connecting');
    const ws = new WebSocket(this.options.wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.protocolReady = false;
      this.setState('authenticating');
      ws.send(
        JSON.stringify({
          type: 'auth',
          token: this.token,
        }),
      );
    };

    ws.onerror = () => {
      this.setState('error', 'WebSocket error');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as
          | PosturePayload
          | {
              type?: string;
              code?: string;
              message?: string;
              payload?: PosturePayload;
              data?: unknown;
            };
        if ('type' in message && message.type === 'auth_ok') {
          ws.send(
            JSON.stringify({
              type: 'hello',
              role: 'device',
              schema_version: 1,
              device_id: this.options.deviceId,
              user_id: this.options.userId,
            }),
          );
          return;
        }
        if ('type' in message && message.type === 'hello_ack') {
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              device_ids: [this.options.deviceId],
            }),
          );
          return;
        }
        if ('type' in message && message.type === 'subscribed') {
          this.protocolReady = true;
          this.setState('connected');
          this.reconnectAttempt = 0;
          this.flushQueue();
          this.startHeartbeat();
          return;
        }
        if ('type' in message && message.type === 'error') {
          if (message.code === 'AUTH_FAILED' || message.code === 'AUTH_REQUIRED') {
            this.token = null;
          }
          this.setState('error', message.message ?? message.code ?? 'Server rejected message');
          return;
        }
        if ('type' in message && message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }
        if ('type' in message && message.type === 'pong') {
          this.clearPongTimeout();
          return;
        }
        const serverAlert = parseServerAlert(message);
        if (serverAlert) {
          this.alertListener?.(serverAlert);
          return;
        }
        if (
          'type' in message &&
          message.type === 'telemetry' &&
          message.payload?.sensors
        ) {
          this.telemetryListener?.(message.payload);
          return;
        }
        if ('sensors' in message && message.sensors) {
          this.telemetryListener?.(message as PosturePayload);
        }
      } catch {
        // Ignore non-JSON diagnostic messages.
      }
    };

    ws.onclose = () => {
      this.protocolReady = false;
      this.stopHeartbeat();
      this.ws = null;
      if (this.intentionalClose) {
        this.setState('idle');
        return;
      }
      this.setState('reconnecting', 'Disconnected — retrying');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const exponential = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    const jitter = 0.5 + (this.options.random ?? Math.random)();
    const delay = Math.round(exponential * jitter);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  disconnect() {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.protocolReady = false;
    this.setState('idle');
  }

  /** Keep at most the newest unsent posture frame while offline. */
  async send(payload: PosturePayload): Promise<boolean> {
    const envelope = { type: 'telemetry', payload };

    if (this.ws?.readyState === WebSocket.OPEN && this.protocolReady) {
      this.ws.send(JSON.stringify(envelope));
      return true;
    }

    this.queuedFrame = payload;
    if (!this.token) return false;
    try {
      const res = await fetch(`${this.options.httpUrl}/api/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok && this.queuedFrame === payload) this.queuedFrame = null;
      if (res.status === 401 || res.status === 403) this.token = null;
      return res.ok;
    } catch {
      return false;
    }
  }

  private async authenticate(): Promise<string> {
    if (this.options.accessTokenProvider) {
      return this.options.accessTokenProvider();
    }
    if (!this.options.credential) {
      throw new Error('Please sign in again to renew the gateway session');
    }
    const response = await fetch(`${this.options.httpUrl}/api/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema_version: 1,
        device_id: this.options.deviceId,
        user_id: this.options.userId,
        credential: this.options.credential,
      }),
    });
    if (!response.ok) {
      throw new Error(`Device authentication failed (${response.status})`);
    }
    const body = (await response.json()) as {
      token?: unknown;
      access_token?: unknown;
    };
    const token =
      typeof body.access_token === 'string'
        ? body.access_token
        : typeof body.token === 'string'
          ? body.token
          : null;
    if (!token) throw new Error('Authentication response did not include a token');
    return token;
  }

  private flushQueue(): void {
    if (!this.queuedFrame || this.ws?.readyState !== WebSocket.OPEN) return;
    const payload = this.queuedFrame;
    this.queuedFrame = null;
    this.ws.send(JSON.stringify({ type: 'telemetry', payload }));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const heartbeatMs = this.options.heartbeatMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      this.clearPongTimeout();
      this.pongTimer = setTimeout(() => {
        this.ws?.close();
      }, this.options.pongTimeoutMs ?? 10_000);
    }, heartbeatMs);
  }

  private clearPongTimeout(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.clearPongTimeout();
  }
}

export function parseServerAlert(message: unknown): ServerPostureAlert | null {
  if (!isRecord(message)) return null;
  if (message.type !== 'alert' && message.type !== 'posture_alert') return null;
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
  ) {
    return null;
  }
  const event =
    source.event === 'escalated' || source.event === 'resolved'
      ? source.event
      : 'triggered';
  const level =
    event === 'resolved'
      ? 'none'
      : source.level === 'critical' || source.level === 'HIGH'
        ? 'critical'
        : 'warning';
  const kind =
    source.kind === 'prediction' ||
    source.alert_type === 'prediction' ||
    source.source === 'forecast'
      ? 'prediction'
      : 'detected';
  const fallbackTitle =
    level === 'none'
      ? 'Posture alert resolved'
      : level === 'critical'
        ? 'Critical posture'
        : 'Posture warning';
  return {
    id:
      typeof source.id === 'string'
        ? source.id
        : typeof source.event_id === 'string'
          ? source.event_id
          : undefined,
    timestamp:
      typeof source.observed_at_ms === 'number' &&
      Number.isFinite(source.observed_at_ms)
        ? source.observed_at_ms
        : typeof source.timestamp === 'number' &&
            Number.isFinite(source.timestamp)
          ? source.timestamp
          : Date.now(),
    deviceId:
      typeof source.device_id === 'string' ? source.device_id : undefined,
    level,
    kind,
    event,
    title: typeof source.title === 'string' ? source.title : fallbackTitle,
    detail:
      typeof source.detail === 'string'
        ? source.detail
        : typeof source.message === 'string'
          ? source.message
          : level === 'none'
            ? 'The server reports that the active posture alert has cleared.'
            : 'The server detected posture risk. Adjust toward your neutral pose.',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
