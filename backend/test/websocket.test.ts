import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
    broadcastToClients,
    initWebSocket,
} from '../src/service/websocket.js';
import { Principal } from '../src/service/authentication.js';

let server: http.Server;
let url: string;
const openSockets = new Set<WebSocket>();
const ingested: Array<{ deviceId: string; userId?: string }> = [];

before(async () => {
    server = http.createServer();
    initWebSocket(server, {
        authenticateUserToken(token): Principal {
            if (token === 'user-a-token') return { kind: 'user', userId: 'user-a' };
            throw new Error('bad token');
        },
        async authenticateDevice(deviceId, credential) {
            return deviceId === 'device-a' && credential === 'device-secret'
                ? { kind: 'device', deviceId, userId: 'user-a' }
                : null;
        },
        async authorizedDeviceIds(principal, requested) {
            if (principal.userId !== 'user-a') return null;
            const desired = requested.length ? requested : ['device-a'];
            return desired.every((id) => id === 'device-a') ? desired : null;
        },
        async processTelemetry(payload, userId) {
            ingested.push({ deviceId: payload.device_id, userId });
            broadcastToClients(userId ?? '', payload.device_id, {
                type: 'telemetry',
                payload,
            });
        },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    url = `ws://127.0.0.1:${address.port}`;
});

after(async () => {
    for (const socket of openSockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connect(): Promise<WebSocket> {
    const socket = new WebSocket(url);
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
    await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    return socket;
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for message')), 1000);
        socket.once('message', (raw) => {
            clearTimeout(timeout);
            resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
        });
    });
}

async function send(
    socket: WebSocket,
    message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const response = nextMessage(socket);
    socket.send(JSON.stringify(message));
    return response;
}

async function authenticateUser(socket: WebSocket): Promise<void> {
    assert.equal((await send(socket, { type: 'auth', token: 'user-a-token' })).type, 'auth_ok');
    assert.equal((await send(socket, { type: 'hello', role: 'client' })).type, 'hello_ack');
}

async function authenticateDevice(socket: WebSocket): Promise<void> {
    assert.equal(
        (await send(socket, {
            type: 'auth',
            device_id: 'device-a',
            credential: 'device-secret',
        })).type,
        'auth_ok',
    );
    assert.equal((await send(socket, { type: 'hello', role: 'device' })).type, 'hello_ack');
}

const payload = {
    schema_version: 1 as const,
    timestamp: 1000,
    device_id: 'device-a',
    user_id: 'user-a',
    sensors: {
        neck: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        lower_back: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        left_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        right_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
    },
};

test('authenticated device ingest reaches an authorized subscription', async () => {
    const browser = await connect();
    const device = await connect();
    await authenticateUser(browser);
    await authenticateDevice(device);
    assert.deepEqual(
        (await send(browser, { type: 'subscribe', device_ids: ['device-a'] })).device_ids,
        ['device-a'],
    );

    const broadcast = nextMessage(browser);
    const acknowledgement = send(device, { type: 'telemetry', payload });
    assert.equal((await broadcast).type, 'telemetry');
    assert.equal((await acknowledgement).type, 'telemetry_ack');
    assert.deepEqual(ingested.at(-1), { deviceId: 'device-a', userId: 'user-a' });
    browser.close();
    device.close();
});

test('invalid telemetry payload returns a protocol error', async () => {
    const device = await connect();
    await authenticateDevice(device);
    const response = await send(device, {
        type: 'telemetry',
        payload: { ...payload, sensors: { neck: payload.sensors.neck } },
    });
    assert.equal(response.type, 'error');
    assert.equal(response.code, 'INVALID_PAYLOAD');
    device.close();
});

test('a user cannot subscribe to a device they do not own', async () => {
    const browser = await connect();
    await authenticateUser(browser);
    const response = await send(browser, {
        type: 'subscribe',
        device_ids: ['device-b'],
    });
    assert.equal(response.type, 'error');
    assert.equal(response.code, 'FORBIDDEN');
    browser.close();
});
