import { TelemetrySocket } from '../src/net/telemetrySocket';
import { PosturePayload } from '../src/types';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(value: string) {
    this.sent.push(value);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('TelemetrySocket', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.instances = [];
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('authenticates and retains only the latest offline frame', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'short-lived-token' }),
      })
      .mockRejectedValue(new Error('offline'));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
    const socket = createSocket();

    await socket.connect();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/device',
      expect.objectContaining({ method: 'POST' }),
    );
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('wss://socket.example.com');

    await socket.send(payload(1));
    await socket.send(payload(2));
    ws.open();
    ws.onmessage?.({ data: '{"type":"auth_ok"}' });
    ws.onmessage?.({ data: '{"type":"hello_ack"}' });
    expect(JSON.parse(ws.sent.at(-1) ?? '{}')).toEqual({
      type: 'subscribe',
      device_ids: ['gateway-1'],
    });
    ws.onmessage?.({ data: '{"type":"subscribed"}' });

    const messages = ws.sent.map((message) => JSON.parse(message));
    expect(messages.filter((message) => message.type === 'telemetry')).toEqual([
      { type: 'telemetry', payload: payload(2) },
    ]);
    socket.disconnect();
  });

  it('sends heartbeats and accepts pong replies', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'token' }),
      }),
    });
    const socket = createSocket();
    await socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.onmessage?.({ data: '{"type":"auth_ok"}' });
    ws.onmessage?.({ data: '{"type":"hello_ack"}' });
    ws.onmessage?.({ data: '{"type":"subscribed"}' });

    jest.advanceTimersByTime(100);
    expect(ws.sent.some((message) => JSON.parse(message).type === 'ping')).toBe(
      true,
    );
    ws.onmessage?.({ data: '{"type":"pong"}' });
    jest.advanceTimersByTime(60);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    socket.disconnect();
  });

  it('reconnects with exponential jitter after an unexpected close', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'token' }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
    const socket = createSocket();
    await socket.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].close();

    jest.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    socket.disconnect();
  });

  it('uses an enrolled device token without credential authentication', async () => {
    const fetchMock = jest.fn();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
    const socket = new TelemetrySocket({
      httpUrl: 'http://localhost:8787',
      wsUrl: 'ws://localhost:8787',
      deviceId: 'gateway-1',
      userId: 'user-1',
      accessToken: 'enrolled-device-token',
    });

    await socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: 'auth',
      token: 'enrolled-device-token',
    });
    socket.disconnect();
  });

  it('renews an expired device token from the mobile user session', async () => {
    const accessTokenProvider = jest.fn().mockResolvedValue('renewed-token');
    const socket = new TelemetrySocket({
      httpUrl: 'http://localhost:8787',
      wsUrl: 'ws://localhost:8787',
      deviceId: 'gateway-1',
      userId: 'user-1',
      accessToken: 'expired-token',
      accessTokenProvider,
      random: () => 0,
    });

    await socket.connect();
    const expiredSocket = FakeWebSocket.instances[0];
    expiredSocket.open();
    expiredSocket.onmessage?.({
      data: '{"type":"error","code":"AUTH_FAILED"}',
    });
    expiredSocket.close();

    await jest.advanceTimersByTimeAsync(500);

    expect(accessTokenProvider).toHaveBeenCalledTimes(1);
    const renewedSocket = FakeWebSocket.instances[1];
    renewedSocket.open();
    expect(JSON.parse(renewedSocket.sent[0])).toEqual({
      type: 'auth',
      token: 'renewed-token',
    });
    socket.disconnect();
  });

  it('delivers dedicated server alerts separately from telemetry', async () => {
    const socket = new TelemetrySocket({
      httpUrl: 'http://localhost:8787',
      wsUrl: 'ws://localhost:8787',
      deviceId: 'gateway-1',
      userId: 'user-1',
      accessToken: 'device-token',
    });
    const listener = jest.fn();
    socket.onAlert(listener);
    await socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'posture_alert',
        payload: {
          event_id: 'alert-42',
          observed_at_ms: 1234,
          device_id: 'gateway-1',
          event: 'escalated',
          level: 'HIGH',
          source: 'detected',
        },
      }),
    });

    expect(listener).toHaveBeenCalledWith({
      id: 'alert-42',
      timestamp: 1234,
      deviceId: 'gateway-1',
      level: 'critical',
      kind: 'detected',
      event: 'escalated',
      title: 'Critical posture',
      detail:
        'The server detected posture risk. Adjust toward your neutral pose.',
    });
    socket.disconnect();
  });

  it('maps a resolved server alert to a non-vibrating normal state', async () => {
    const socket = new TelemetrySocket({
      httpUrl: 'http://localhost:8787',
      wsUrl: 'ws://localhost:8787',
      deviceId: 'gateway-1',
      userId: 'user-1',
      accessToken: 'device-token',
    });
    const listener = jest.fn();
    socket.onAlert(listener);
    await socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'alert',
        payload: {
          device_id: 'gateway-1',
          event: 'resolved',
          level: 'ELEVATED',
          source: 'forecast',
          observed_at_ms: 2000,
        },
      }),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'none',
        kind: 'prediction',
        event: 'resolved',
        timestamp: 2000,
      }),
    );
    socket.disconnect();
  });
});

function createSocket() {
  return new TelemetrySocket({
    httpUrl: 'https://api.example.com',
    wsUrl: 'wss://socket.example.com',
    deviceId: 'gateway-1',
    userId: 'user-1',
    credential: 'provisioned-secret',
    heartbeatMs: 100,
    pongTimeoutMs: 50,
    random: () => 0,
  });
}

function payload(timestamp: number): PosturePayload {
  const sensor = { quat: { x: 0, y: 0, z: 0, w: 1 } };
  return {
    schema_version: 1,
    timestamp,
    device_id: 'gateway-1',
    user_id: 'user-1',
    sensors: {
      neck: sensor,
      lower_back: sensor,
      left_shoulder: sensor,
      right_shoulder: sensor,
    },
  };
}
