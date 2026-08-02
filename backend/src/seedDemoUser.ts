import bcrypt from 'bcrypt';
import pool from './db.js';
import { errorFields, logger } from './logger.js';

const email = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
const password = process.env.DEMO_USER_PASSWORD;
const name = process.env.DEMO_USER_NAME?.trim() || 'Sit-Sync Demo';

if (!email && !password) {
    logger.info('demo_user_seed_skipped');
    await pool.end();
    process.exit(0);
}

if (!email || !password || password.length < 8) {
    logger.error('demo_user_seed_invalid', {
        reason: 'DEMO_USER_EMAIL and DEMO_USER_PASSWORD (at least 8 characters) are required',
    });
    await pool.end();
    process.exit(1);
}

try {
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'user')
         ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash`,
        [name, email, passwordHash],
    );
    logger.info('demo_user_seeded', { email });
} catch (error) {
    logger.error('demo_user_seed_failed', errorFields(error));
    process.exitCode = 1;
} finally {
    await pool.end();
}
