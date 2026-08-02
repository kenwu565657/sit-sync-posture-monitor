import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { authenticateUserToken } from '../src/service/authentication.js';

test('device JWTs retain their owner and gateway identity', () => {
    const token = jwt.sign(
        {
            kind: 'device',
            userId: 'user-a',
            deviceId: 'gateway-a',
        },
        config.jwtSecret,
        { expiresIn: '5m' },
    );

    assert.deepEqual(authenticateUserToken(token), {
        kind: 'device',
        userId: 'user-a',
        deviceId: 'gateway-a',
    });
});
