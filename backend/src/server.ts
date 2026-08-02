import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { closeWebSocket, initWebSocket } from './service/websocket.js';
import hardwareRoutes from './route/hardware.js';
import analyticsRouter from './route/analytics.js';
import authRoutes from './route/auth.js';
import settingsRoutes from './route/settings.js';
import { config } from './config.js';
import { errorFields, logger } from './logger.js';
import pool from './db.js';
import { initializeRecordingStorage } from './service/recording.js';

export const app = express();
app.disable('x-powered-by');
app.use(cors({
    origin(origin, callback) {
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin not allowed'));
    },
}));
app.use(express.json({ limit: config.ws.maxMessageBytes }));
app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        logger.info('http_request', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - startedAt,
        });
    });
    next();
});

// Create HTTP server
export const server = http.createServer(app);

// Initialize WebSockets
initWebSocket(server);

// Mount API Routes
app.use('/api/auth', authRoutes); // Maps to /api/auth/login
app.use('/api', hardwareRoutes);             // Maps to /api/telemetry, /api/calibration
app.use('/api/analytics', analyticsRouter);
app.use('/api/settings', settingsRoutes);

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});
app.get('/ready', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'ready' });
    } catch (error) {
        logger.warn('readiness_check_failed', errorFields(error));
        res.status(503).json({ status: 'not_ready' });
    }
});

app.use((
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
) => {
    logger.warn('http_request_failed', errorFields(error));
    res.status(400).json({ error: 'Invalid request' });
});

async function startServer(): Promise<void> {
    try {
        await initializeRecordingStorage();
        server.listen(config.port, () => {
            logger.info('server_started', {
                port: config.port,
                environment: config.nodeEnv,
            });
        });
    } catch (error) {
        logger.error('server_start_failed', errorFields(error));
        process.exitCode = 1;
    }
}

void startServer();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server_shutdown_started', { signal });
    const forceExit = setTimeout(() => {
        logger.error('server_shutdown_timeout');
        process.exit(1);
    }, 10000);
    forceExit.unref();

    server.closeIdleConnections();
    await closeWebSocket();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    clearTimeout(forceExit);
    logger.info('server_shutdown_complete');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        void shutdown(signal);
    });
}