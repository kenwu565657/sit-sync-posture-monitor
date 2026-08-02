// src/db.ts
import pkg from 'pg';
const { Pool } = pkg;
import { config } from './config.js';
import { errorFields, logger } from './logger.js';

const pool = new Pool({
    user: config.db.user,
    host: config.db.host,
    database: config.db.name,
    password: config.db.password,
    port: config.db.port,
    ssl: config.db.tls
        ? { rejectUnauthorized: config.db.tlsRejectUnauthorized }
        : undefined,
});

pool.on('connect', () => {
    logger.debug('database_connected');
});

pool.on('error', (err) => {
    logger.error('database_idle_client_error', errorFields(err));
});

export default pool;