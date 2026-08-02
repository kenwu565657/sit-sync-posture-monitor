import { WebSocketServer, WebSocket, RawData } from 'ws';
import { Server } from 'node:http';
import { config } from '../config.js';
import { errorFields, logger } from '../logger.js';
import { isPosturePayload, processTelemetry } from './telemetry.js';
import {
    authenticateDevice,
    authenticateUserToken,
    authorizedDeviceIds,
    Principal,
} from './authentication.js';

let wss: WebSocketServer | undefined;

interface ClientState {
    principal?: Principal;
    hello: boolean;
    subscriptions: Set<string>;
    isAlive: boolean;
    rateWindowStarted: number;
    rateCount: number;
}

interface Dependencies {
    authenticateDevice: typeof authenticateDevice;
    authenticateUserToken: typeof authenticateUserToken;
    authorizedDeviceIds: typeof authorizedDeviceIds;
    processTelemetry: typeof processTelemetry;
}

const clients = new Map<WebSocket, ClientState>();

function send(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function protocolError(
    ws: WebSocket,
    code: string,
    message: string,
    requestId?: unknown,
): void {
    send(ws, {
        type: 'error',
        code,
        message,
        ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rawByteLength(raw: RawData): number {
    if (Array.isArray(raw)) return raw.reduce((sum, item) => sum + item.byteLength, 0);
    return raw.byteLength;
}

export function initWebSocket(
    server: Server,
    overrides: Partial<Dependencies> = {},
): WebSocketServer {
    const dependencies: Dependencies = {
        authenticateDevice,
        authenticateUserToken,
        authorizedDeviceIds,
        processTelemetry,
        ...overrides,
    };
    wss = new WebSocketServer({
        server,
        maxPayload: config.ws.maxMessageBytes,
        verifyClient: ({ origin }, done) => {
            const allowed = !origin || config.corsOrigins.includes('*') ||
                config.corsOrigins.includes(origin);
            done(allowed, allowed ? undefined : 403, allowed ? undefined : 'Origin not allowed');
        },
    });

    const heartbeat = setInterval(() => {
        for (const ws of wss?.clients ?? []) {
            const state = clients.get(ws);
            if (!state?.isAlive) {
                ws.terminate();
                continue;
            }
            state.isAlive = false;
            ws.ping();
        }
    }, config.ws.heartbeatMs);
    heartbeat.unref();

    wss.on('connection', (ws, request) => {
        const state: ClientState = {
            hello: false,
            subscriptions: new Set(),
            isAlive: true,
            rateWindowStarted: Date.now(),
            rateCount: 0,
        };
        clients.set(ws, state);
        const authTimer = setTimeout(() => {
            if (!state.principal) {
                protocolError(ws, 'AUTH_TIMEOUT', 'Authentication message was not received');
                ws.close(1008, 'Authentication required');
            }
        }, config.ws.authTimeoutMs);
        authTimer.unref();

        ws.on('pong', () => {
            state.isAlive = true;
        });
        ws.on('message', async (raw, isBinary) => {
            try {
                if (isBinary) {
                    protocolError(ws, 'UNSUPPORTED_DATA', 'Binary messages are not supported');
                    return;
                }
                if (rawByteLength(raw) > config.ws.maxMessageBytes) {
                    protocolError(ws, 'MESSAGE_TOO_LARGE', 'Message exceeds configured limit');
                    ws.close(1009, 'Message too large');
                    return;
                }
                const now = Date.now();
                if (now - state.rateWindowStarted >= 60000) {
                    state.rateWindowStarted = now;
                    state.rateCount = 0;
                }
                state.rateCount += 1;
                if (state.rateCount > config.ws.messagesPerMinute) {
                    protocolError(ws, 'RATE_LIMITED', 'Message rate limit exceeded');
                    ws.close(1008, 'Rate limited');
                    return;
                }

                let message: unknown;
                try {
                    message = JSON.parse(raw.toString());
                } catch {
                    protocolError(ws, 'INVALID_JSON', 'Message must be valid JSON');
                    return;
                }
                if (!isRecord(message) || typeof message.type !== 'string') {
                    protocolError(ws, 'INVALID_MESSAGE', 'Message type is required');
                    return;
                }
                const requestId = message.request_id;

                if (!state.principal) {
                    if (message.type !== 'auth') {
                        protocolError(ws, 'AUTH_REQUIRED', 'Authenticate before other messages', requestId);
                        return;
                    }
                    let principal: Principal | null = null;
                    if (typeof message.token === 'string' && message.token) {
                        principal = dependencies.authenticateUserToken(message.token);
                    } else if (
                        typeof message.device_id === 'string' &&
                        typeof message.credential === 'string'
                    ) {
                        principal = await dependencies.authenticateDevice(
                            message.device_id,
                            message.credential,
                        );
                    }
                    if (!principal) {
                        protocolError(ws, 'AUTH_FAILED', 'Invalid credentials', requestId);
                        ws.close(1008, 'Authentication failed');
                        return;
                    }
                    state.principal = principal;
                    clearTimeout(authTimer);
                    send(ws, {
                        type: 'auth_ok',
                        principal: principal.kind,
                        ...(principal.kind === 'device'
                            ? { device_id: principal.deviceId }
                            : { user_id: principal.userId }),
                        ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
                    });
                    return;
                }

                if (!state.hello) {
                    if (message.type !== 'hello') {
                        protocolError(ws, 'HELLO_REQUIRED', 'Send hello after authentication', requestId);
                        return;
                    }
                    const expectedRole = state.principal.kind === 'device' ? 'device' : 'client';
                    if (message.role !== undefined && message.role !== expectedRole) {
                        protocolError(ws, 'INVALID_HELLO', `role must be ${expectedRole}`, requestId);
                        return;
                    }
                    state.hello = true;
                    send(ws, {
                        type: 'hello_ack',
                        protocol: 'sit-sync.v1',
                        heartbeat_ms: config.ws.heartbeatMs,
                        ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
                    });
                    return;
                }

                if (message.type === 'ping') {
                    send(ws, {
                        type: 'pong',
                        timestamp: Date.now(),
                        ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
                    });
                    return;
                }
                if (message.type === 'pong') return;

                if (message.type === 'telemetry') {
                    if (state.principal.kind !== 'device') {
                        protocolError(ws, 'FORBIDDEN', 'Only devices may ingest telemetry', requestId);
                        return;
                    }
                    if (!isPosturePayload(message.payload)) {
                        protocolError(ws, 'INVALID_PAYLOAD', 'Invalid telemetry payload', requestId);
                        return;
                    }
                    if (message.payload.device_id !== state.principal.deviceId) {
                        protocolError(ws, 'FORBIDDEN', 'Payload device does not match credentials', requestId);
                        return;
                    }
                    if (message.payload.user_id !== state.principal.userId) {
                        protocolError(ws, 'FORBIDDEN', 'Payload user does not match device owner', requestId);
                        return;
                    }
                    await dependencies.processTelemetry(message.payload, state.principal.userId);
                    send(ws, {
                        type: 'telemetry_ack',
                        timestamp: message.payload.timestamp,
                        ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
                    });
                    return;
                }

                if (message.type === 'subscribe') {
                    const requested = message.device_ids === undefined
                        ? []
                        : message.device_ids;
                    if (
                        !Array.isArray(requested) ||
                        requested.length > 100 ||
                        !requested.every((id) => typeof id === 'string' && id.length <= 128)
                    ) {
                        protocolError(ws, 'INVALID_PAYLOAD', 'device_ids must be an array of at most 100 IDs', requestId);
                        return;
                    }
                    const allowed = await dependencies.authorizedDeviceIds(
                        state.principal,
                        [...new Set(requested as string[])],
                    );
                    if (!allowed) {
                        protocolError(ws, 'FORBIDDEN', 'One or more devices are not authorized', requestId);
                        return;
                    }
                    state.subscriptions = new Set(allowed);
                    send(ws, {
                        type: 'subscribed',
                        device_ids: allowed,
                        ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
                    });
                    return;
                }

                protocolError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${message.type}`, requestId);
            } catch (error) {
                logger.warn('websocket_message_failed', {
                    remoteAddress: request.socket.remoteAddress,
                    ...errorFields(error),
                });
                protocolError(
                    ws,
                    state.principal ? 'INTERNAL_ERROR' : 'AUTH_FAILED',
                    state.principal ? 'Message could not be processed' : 'Invalid credentials',
                );
                if (!state.principal) ws.close(1008, 'Authentication failed');
            }
        });

        ws.on('error', (error) => {
            logger.warn('websocket_client_error', errorFields(error));
        });
        ws.on('close', () => {
            clearTimeout(authTimer);
            clients.delete(ws);
        });
    });

    wss.on('close', () => {
        clearInterval(heartbeat);
        clients.clear();
    });
    return wss;
}

export function broadcastToClients(
    userId: string,
    deviceId: string,
    data: Record<string, unknown>,
): void {
    if (!wss) return;
    const encoded = JSON.stringify(data);
    for (const client of wss.clients) {
        const state = clients.get(client);
        if (
            client.readyState === WebSocket.OPEN &&
            state?.principal?.userId === userId &&
            state.subscriptions.has(deviceId)
        ) {
            client.send(encoded);
        }
    }
}

export function closeWebSocket(): Promise<void> {
    if (!wss) return Promise.resolve();
    for (const client of wss.clients) client.close(1001, 'Server shutting down');
    const forceClose = setTimeout(() => {
        for (const client of wss?.clients ?? []) client.terminate();
    }, 1000);
    forceClose.unref();
    return new Promise((resolve) => wss?.close(() => {
        clearTimeout(forceClose);
        resolve();
    }));
}
