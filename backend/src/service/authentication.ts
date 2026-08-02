import { createHash, timingSafeEqual } from 'node:crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import pool from '../db.js';
import { config } from '../config.js';

export type Principal =
    | { kind: 'user'; userId: string; role?: string }
    | { kind: 'device'; userId: string; deviceId: string };

interface EnvironmentDevice {
    userId: string;
    credential?: string;
    credentialHash?: string;
}

let environmentDevices: Record<string, EnvironmentDevice> | undefined;

function getEnvironmentDevices(): Record<string, EnvironmentDevice> {
    if (environmentDevices) return environmentDevices;
    if (!config.deviceCredentialsJson) return (environmentDevices = {});
    const parsed = JSON.parse(config.deviceCredentialsJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('DEVICE_CREDENTIALS_JSON must be an object');
    }
    environmentDevices = parsed as Record<string, EnvironmentDevice>;
    return environmentDevices;
}

function hashCredential(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function credentialMatches(value: string, expected: string): boolean {
    const actualBuffer = Buffer.from(hashCredential(value), 'hex');
    const normalized = expected.startsWith('sha256:') ? expected.slice(7) : expected;
    if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
    const expectedBuffer = Buffer.from(normalized, 'hex');
    return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function authenticateUserToken(token: string): Principal {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    const userId = decoded.userId ?? decoded.sub;
    if (typeof userId !== 'string' || !userId) throw new Error('Token has no user identity');
    if (decoded.kind === 'device' && typeof decoded.deviceId === 'string' && decoded.deviceId) {
        return {
            kind: 'device',
            userId,
            deviceId: decoded.deviceId,
        };
    }
    return {
        kind: 'user',
        userId,
        role: typeof decoded.role === 'string' ? decoded.role : undefined,
    };
}

export async function authenticateDevice(
    deviceId: string,
    credential: string,
): Promise<Principal | null> {
    const fromEnvironment = getEnvironmentDevices()[deviceId];
    if (fromEnvironment && typeof fromEnvironment.userId === 'string') {
        const expected = fromEnvironment.credentialHash ??
            (fromEnvironment.credential
                ? `sha256:${hashCredential(fromEnvironment.credential)}`
                : '');
        if (credentialMatches(credential, expected)) {
            return { kind: 'device', deviceId, userId: fromEnvironment.userId };
        }
    }

    const { rows } = await pool.query<{
        user_id: string;
        credential_hash: string;
    }>(
        `SELECT user_id, credential_hash
         FROM devices
         WHERE id = $1 AND revoked_at IS NULL`,
        [deviceId],
    );
    const device = rows[0];
    return device && credentialMatches(credential, device.credential_hash)
        ? { kind: 'device', deviceId, userId: device.user_id }
        : null;
}

export async function authorizedDeviceIds(
    principal: Principal,
    requested: string[],
): Promise<string[] | null> {
    if (principal.kind === 'device') {
        return requested.every((id) => id === principal.deviceId)
            ? [principal.deviceId]
            : null;
    }
    const environmentOwned = Object.entries(getEnvironmentDevices())
        .filter(([, device]) => device?.userId === principal.userId)
        .map(([id]) => id);
    if (requested.length === 0) {
        const { rows } = await pool.query<{ id: string }>(
            'SELECT id FROM devices WHERE user_id = $1 AND revoked_at IS NULL',
            [principal.userId],
        );
        return [...new Set([...environmentOwned, ...rows.map((row) => row.id)])];
    }
    const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM devices
         WHERE user_id = $1 AND revoked_at IS NULL AND id = ANY($2::varchar[])`,
        [principal.userId, requested],
    );
    const allowed = new Set([...environmentOwned, ...rows.map((row) => row.id)]);
    return requested.every((id) => allowed.has(id)) ? requested : null;
}

export async function ownsDevice(userId: string, deviceId: string): Promise<boolean> {
    const envDevice = getEnvironmentDevices()[deviceId];
    if (envDevice?.userId === userId) return true;
    const { rowCount } = await pool.query(
        'SELECT 1 FROM devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
        [deviceId, userId],
    );
    return rowCount === 1;
}
