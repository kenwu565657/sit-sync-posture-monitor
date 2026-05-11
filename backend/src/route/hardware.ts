import { Router, Request, Response } from 'express';
import pool from '../db.js';
import { broadcastToClients } from '../service/websocket.js';
import { calculateRULA } from '../utils/rula.js';
import { PosturePayload } from '../types/index.js';

const router = Router();

// State for slouching timer
let slouchStartTime: number | null = null;
const SLOUCH_THRESHOLD_SECONDS = 15;

// 1. Live Telemetry
router.post('/telemetry', async (req: Request, res: Response) => {
    const sensorData = req.body as PosturePayload;
    const currentCVA = sensorData.metrics?.cva_angle || 55;
    const userId = sensorData.device_id || 'user_01';

    const { score, status } = calculateRULA(currentCVA);

    const enrichedData = {
        ...sensorData,
        metrics: { ...sensorData.metrics, rula_score: score, status }
    };

    broadcastToClients(enrichedData);

    // Database Spam Protection Logic
    if (status === 'critical' || status === 'warning') {
        if (!slouchStartTime) {
            slouchStartTime = Date.now();
        } else {
            const secondsSlouching = (Date.now() - slouchStartTime) / 1000;
            if (secondsSlouching >= SLOUCH_THRESHOLD_SECONDS) {
                console.log(`Logging bad posture to DB (${secondsSlouching}s)`);
                try {
                    await pool.query(
                        `INSERT INTO posture_events (user_id, event_type, duration_seconds, peak_rula_score) VALUES ($1, $2, $3, $4)`,
                        [userId, status, Math.round(secondsSlouching), score]
                    );
                } catch (err) { console.error(err); }
                slouchStartTime = null;
            }
        }
    } else {
        slouchStartTime = null;
    }

    res.status(200).json({ status: 'streamed' });
});

// 2. Calibration
router.post('/calibration', async (req: Request, res: Response) => {
    const { user_id, baseline_cva } = req.body;
    try {
        await pool.query(`UPDATE users SET baseline_cva = $1 WHERE id = $2`, [baseline_cva, user_id]);
        res.status(200).json({ status: 'success' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;