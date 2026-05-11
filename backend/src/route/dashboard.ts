import { Router, Request, Response } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/today/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    try {
        const userQuery = await pool.query(`SELECT name, baseline_cva FROM users WHERE id = $1`, [userId]);
        const eventsQuery = await pool.query(
            `SELECT event_type, duration_seconds, peak_rula_score, logged_at 
             FROM posture_events WHERE user_id = $1 AND DATE(logged_at) = CURRENT_DATE ORDER BY logged_at DESC`,
            [userId]
        );

        res.status(200).json({ user: userQuery.rows[0], today_events: eventsQuery.rows });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;