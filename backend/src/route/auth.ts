import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { config } from '../config.js';
import { errorFields, logger } from '../logger.js';
import { authenticateDevice } from '../service/authentication.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function signDeviceToken(userId: string, deviceId: string): string {
    return jwt.sign(
        { kind: 'device', userId, deviceId },
        config.jwtSecret,
        { expiresIn: config.deviceJwtExpiresIn as jwt.SignOptions['expiresIn'] },
    );
}

router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'email and password are required' });
        return;
    }

    try {
        // 1. Find user in the database
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (rows.length === 0) return res.status(401).json({ error: 'User not found' });

        const user = rows[0];

        // 2. Check password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.status(401).json({ error: 'Invalid password' });

        // 3. Generate the Ticket (JWT)
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role }, 
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] },
        );

        res.json({ message: 'Login successful', token, user: { id: user.id, name: user.name } });

    } catch (error) {
        logger.error('login_failed', { email, ...errorFields(error) });
        res.status(500).json({ error: 'Server error during login' });
    }
});

router.post('/device', async (req: Request, res: Response) => {
    const { device_id: deviceId, credential } = req.body ?? {};
    if (typeof deviceId !== 'string' || typeof credential !== 'string') {
        res.status(400).json({ error: 'device_id and credential are required' });
        return;
    }

    try {
        const principal = await authenticateDevice(deviceId, credential);
        if (!principal || principal.kind !== 'device') {
            res.status(401).json({ error: 'Invalid device credentials' });
            return;
        }
        const token = signDeviceToken(principal.userId, principal.deviceId);
        res.json({ access_token: token, token_type: 'Bearer' });
    } catch (error) {
        logger.error('device_login_failed', { deviceId, ...errorFields(error) });
        res.status(500).json({ error: 'Server error during device authentication' });
    }
});

router.post('/device/enroll', requireAuth, async (req: Request, res: Response) => {
    const deviceId = req.body?.device_id;
    if (req.principal?.kind !== 'user') {
        res.status(403).json({ error: 'A user login is required' });
        return;
    }
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 128) {
        res.status(400).json({ error: 'A valid device_id is required' });
        return;
    }

    try {
        const internalCredential = randomBytes(32).toString('hex');
        const credentialHash = `sha256:${createHash('sha256')
            .update(internalCredential)
            .digest('hex')}`;
        const result = await pool.query(
            `INSERT INTO devices (id, user_id, credential_hash, display_name)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE
             SET credential_hash = EXCLUDED.credential_hash,
                 revoked_at = NULL
             WHERE devices.user_id = EXCLUDED.user_id
             RETURNING id`,
            [
                deviceId,
                req.principal.userId,
                credentialHash,
                'Mobile gateway',
            ],
        );
        if (result.rowCount !== 1) {
            res.status(409).json({ error: 'This gateway belongs to another user' });
            return;
        }
        res.json({
            access_token: signDeviceToken(req.principal.userId, deviceId),
            token_type: 'Bearer',
            device_id: deviceId,
            user_id: req.principal.userId,
        });
    } catch (error) {
        logger.error('device_enrollment_failed', {
            deviceId,
            userId: req.principal.userId,
            ...errorFields(error),
        });
        res.status(500).json({ error: 'Could not enroll mobile gateway' });
    }
});

export default router;