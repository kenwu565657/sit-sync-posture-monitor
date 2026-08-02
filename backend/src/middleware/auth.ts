import { NextFunction, Request, Response } from 'express';
import {
    authenticateDevice,
    authenticateUserToken,
    Principal,
} from '../service/authentication.js';

declare global {
    namespace Express {
        interface Request {
            principal?: Principal;
        }
    }
}

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const authorization = req.header('authorization');
        if (authorization?.startsWith('Bearer ')) {
            req.principal = authenticateUserToken(authorization.slice(7));
        } else {
            const deviceId = req.header('x-device-id');
            const credential = req.header('x-device-credential');
            if (deviceId && credential) {
                req.principal = (await authenticateDevice(deviceId, credential)) ?? undefined;
            }
        }
        if (!req.principal) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        next();
    } catch {
        res.status(401).json({ error: 'Invalid credentials' });
    }
}

export function requireOwnUser(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const target = req.params.userId ?? req.query.userId;
    if (
        req.principal?.kind !== 'user' ||
        (typeof target === 'string' && target !== req.principal.userId)
    ) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    next();
}
