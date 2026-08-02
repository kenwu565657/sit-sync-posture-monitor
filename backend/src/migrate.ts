import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pool from './db.js';
import { errorFields, logger } from './logger.js';

const migrationDirectory = resolve(process.cwd(), 'migration/db');
const client = await pool.connect();

try {
    await client.query(`SELECT pg_advisory_lock(hashtext('sit_sync_schema_migrations'))`);
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const files = (await readdir(migrationDirectory))
        .filter((filename) => filename.endsWith('.sql'))
        .sort((left, right) => {
            if (left === 'init.sql') return -1;
            if (right === 'init.sql') return 1;
            return left.localeCompare(right);
        });
    for (const filename of files) {
        const applied = await client.query(
            'SELECT 1 FROM schema_migrations WHERE filename = $1',
            [filename],
        );
        if (applied.rowCount) continue;

        const sql = await readFile(resolve(migrationDirectory, filename), 'utf8');
        await client.query(sql);
        await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [filename],
        );
        logger.info('migration_applied', { filename });
    }
} catch (error) {
    logger.error('migration_failed', errorFields(error));
    process.exitCode = 1;
} finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('sit_sync_schema_migrations'))`)
        .catch(() => undefined);
    client.release();
    await pool.end();
}
