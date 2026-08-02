import { Router, Request, Response } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { errorFields, logger } from '../logger.js';

const router = Router();
router.use(requireAuth);

export type AnalyticsDays = 7 | 30;

interface DailyHistory {
    date: string;
    avg_rula: number;
    avg_cva: number | null;
    cva_sample_count: number;
    total_bad_posture_seconds: number;
    incident_count: number;
    warning_count: number;
    critical_count: number;
}

interface AnalyticsSummary {
    total_bad_posture_seconds: number;
    total_incidents: number;
    average_rula: number;
    average_cva: number | null;
    warning_incidents: number;
    critical_incidents: number;
}

export function parseAnalyticsDays(value: unknown): AnalyticsDays | null {
    if (value === undefined) return 7;
    if (value === '7' || value === 7) return 7;
    if (value === '30' || value === 30) return 30;
    return null;
}

export function parseMonth(value: unknown): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
    const [year, month] = value.split('-').map(Number);
    return year >= 2000 && year <= 2100 && month >= 1 && month <= 12
        ? value
        : null;
}

export function parseDate(value: unknown): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
        ? value
        : null;
}

export function parseEventId(value: unknown): number | null {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}

function numeric(value: unknown): number {
    const converted = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(converted) ? converted : 0;
}

function nullableNumeric(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const converted = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(converted) ? converted : null;
}

export function summarizeHistory(history: DailyHistory[]): AnalyticsSummary {
    const totalIncidents = history.reduce(
        (sum, day) => sum + day.incident_count,
        0,
    );
    const weightedRula = history.reduce(
        (sum, day) => sum + day.avg_rula * day.incident_count,
        0,
    );
    const cvaSampleCount = history.reduce(
        (sum, day) => sum + day.cva_sample_count,
        0,
    );
    const weightedCva = history.reduce(
        (sum, day) => sum + (day.avg_cva ?? 0) * day.cva_sample_count,
        0,
    );
    return {
        total_bad_posture_seconds: history.reduce(
            (sum, day) => sum + day.total_bad_posture_seconds,
            0,
        ),
        total_incidents: totalIncidents,
        average_rula: totalIncidents
            ? Math.round((weightedRula / totalIncidents) * 10) / 10
            : 0,
        average_cva: cvaSampleCount
            ? Math.round((weightedCva / cvaSampleCount) * 10) / 10
            : null,
        warning_incidents: history.reduce(
            (sum, day) => sum + day.warning_count,
            0,
        ),
        critical_incidents: history.reduce(
            (sum, day) => sum + day.critical_count,
            0,
        ),
    };
}

export function buildRecommendations(summary: AnalyticsSummary): string[] {
    if (summary.total_incidents === 0) {
        return ['No sustained risky-posture incidents were detected in this period.'];
    }
    const recommendations: string[] = [];
    if (summary.critical_incidents > 0) {
        recommendations.push(
            'Critical posture was detected. Recheck monitor height and neutral neck alignment.',
        );
    }
    if (summary.total_bad_posture_seconds >= 300) {
        recommendations.push(
            'Risky posture exceeded five minutes. Add a short movement break to your routine.',
        );
    }
    if (summary.warning_incidents >= 5) {
        recommendations.push(
            'Frequent warning episodes suggest fatigue. Recalibrate after confirming a neutral seated pose.',
        );
    }
    if (recommendations.length === 0) {
        recommendations.push(
            'Only brief posture deviations were recorded. Continue correcting them early.',
        );
    }
    return recommendations;
}

async function loadHistory(
    userId: string,
    days: AnalyticsDays,
): Promise<DailyHistory[]> {
    const { rows } = await pool.query<{
        date: string;
        avg_rula: unknown;
        avg_cva: unknown;
        cva_sample_count: unknown;
        total_bad_posture_seconds: unknown;
        incident_count: unknown;
        warning_count: unknown;
        critical_count: unknown;
    }>(
        `WITH date_range AS (
             SELECT day::date AS date
             FROM generate_series(
                 CURRENT_DATE - ($2::integer - 1),
                 CURRENT_DATE,
                 INTERVAL '1 day'
             ) AS day
         )
         SELECT
             TO_CHAR(date_range.date, 'YYYY-MM-DD') AS date,
             COALESCE(ROUND(AVG(events.peak_rula_score)::numeric, 1), 0) AS avg_rula,
             ROUND(AVG(events.minimum_cva_angle)::numeric, 1) AS avg_cva,
             COUNT(events.minimum_cva_angle) AS cva_sample_count,
             COALESCE(SUM(events.duration_seconds), 0) AS total_bad_posture_seconds,
             COUNT(events.id) AS incident_count,
             COUNT(events.id) FILTER (WHERE events.event_type = 'warning') AS warning_count,
             COUNT(events.id) FILTER (WHERE events.event_type = 'critical') AS critical_count
         FROM date_range
         LEFT JOIN posture_events AS events
           ON events.logged_at >= date_range.date
          AND events.logged_at < date_range.date + INTERVAL '1 day'
          AND COALESCE(events.owner_user_id::TEXT, events.user_id) = $1
         GROUP BY date_range.date
         ORDER BY date_range.date ASC`,
        [userId, days],
    );
    return rows.map((row) => ({
        date: row.date,
        avg_rula: numeric(row.avg_rula),
        avg_cva: nullableNumeric(row.avg_cva),
        cva_sample_count: numeric(row.cva_sample_count),
        total_bad_posture_seconds: numeric(row.total_bad_posture_seconds),
        incident_count: numeric(row.incident_count),
        warning_count: numeric(row.warning_count),
        critical_count: numeric(row.critical_count),
    }));
}

router.get('/history', async (req: Request, res: Response) => {
    if (req.principal?.kind !== 'user') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const days = parseAnalyticsDays(req.query.days);
    if (!days) {
        res.status(400).json({ error: 'days must be 7 or 30' });
        return;
    }

    try {
        const data = await loadHistory(req.principal.userId, days);
        const publicData = data.map(({ cva_sample_count: _, ...day }) => day);
        res.status(200).json({
            status: 'success',
            timeframe: `${days} days`,
            range_days: days,
            data: publicData,
            summary: summarizeHistory(data),
        });
    } catch (error) {
        logger.error('analytics_history_failed', errorFields(error));
        res.status(500).json({ status: 'error', message: 'Failed to fetch history' });
    }
});

router.get('/insights', async (req: Request, res: Response) => {
    if (req.principal?.kind !== 'user') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const days = parseAnalyticsDays(req.query.days);
    if (!days) {
        res.status(400).json({ error: 'days must be 7 or 30' });
        return;
    }

    try {
        const data = await loadHistory(req.principal.userId, days);
        const summary = summarizeHistory(data);

        res.status(200).json({
            status: 'success',
            today_incidents: data.at(-1)?.incident_count ?? 0,
            insights: buildRecommendations(summary),
        });

    } catch (error) {
        logger.error('analytics_insights_failed', errorFields(error));
        res.status(500).json({ status: 'error', message: 'Failed to generate insights' });
    }
});

router.get('/calendar', async (req: Request, res: Response) => {
    if (req.principal?.kind !== 'user') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const month = parseMonth(req.query.month);
    if (!month) {
        res.status(400).json({ error: 'month must use YYYY-MM format' });
        return;
    }
    try {
        const { rows } = await pool.query<{
            date: string;
            status: 'warning' | 'critical';
            incident_count: unknown;
            total_duration_seconds: unknown;
        }>(
            `SELECT
                 TO_CHAR(DATE(logged_at), 'YYYY-MM-DD') AS date,
                 CASE
                     WHEN BOOL_OR(event_type = 'critical') THEN 'critical'
                     ELSE 'warning'
                 END AS status,
                 COUNT(*) AS incident_count,
                 COALESCE(SUM(duration_seconds), 0) AS total_duration_seconds
             FROM posture_events
             WHERE COALESCE(owner_user_id::TEXT, user_id) = $1
               AND logged_at >= $2::date
               AND logged_at < $2::date + INTERVAL '1 month'
             GROUP BY DATE(logged_at)
             ORDER BY DATE(logged_at)`,
            [req.principal.userId, `${month}-01`],
        );
        res.status(200).json({
            status: 'success',
            month,
            days: rows.map((row) => ({
                date: row.date,
                status: row.status,
                incident_count: numeric(row.incident_count),
                total_duration_seconds: numeric(row.total_duration_seconds),
            })),
        });
    } catch (error) {
        logger.error('analytics_calendar_failed', errorFields(error));
        res.status(500).json({ status: 'error', message: 'Failed to fetch calendar' });
    }
});

router.get('/events', async (req: Request, res: Response) => {
    if (req.principal?.kind !== 'user') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const date = parseDate(req.query.date);
    if (!date) {
        res.status(400).json({ error: 'date must use YYYY-MM-DD format' });
        return;
    }
    try {
        const { rows } = await pool.query<{
            id: unknown;
            device_id: string | null;
            event_type: 'warning' | 'critical';
            duration_seconds: unknown;
            peak_rula_score: unknown;
            minimum_cva_angle: unknown;
            sensor_snapshot: unknown;
            logged_at: Date;
            replay_available: boolean;
        }>(
            `SELECT id, device_id, event_type, duration_seconds, mounting_mode,
                    peak_rula_score, minimum_cva_angle, sensor_snapshot, logged_at,
                    EXISTS (
                        SELECT 1 FROM posture_event_replays replay
                        WHERE replay.event_id = posture_events.id
                    ) AS replay_available
             FROM posture_events
             WHERE COALESCE(owner_user_id::TEXT, user_id) = $1
               AND logged_at >= $2::date
               AND logged_at < $2::date + INTERVAL '1 day'
             ORDER BY logged_at`,
            [req.principal.userId, date],
        );
        res.status(200).json({
            status: 'success',
            date,
            events: rows.map((row) => ({
                id: String(row.id),
                device_id: row.device_id,
                event_type: row.event_type,
                duration_seconds: numeric(row.duration_seconds),
                peak_rula_score: numeric(row.peak_rula_score),
                minimum_cva_angle: nullableNumeric(row.minimum_cva_angle),
                sensor_snapshot: row.sensor_snapshot,
                logged_at: row.logged_at,
                replay_available: row.replay_available,
            })),
        });
    } catch (error) {
        logger.error('analytics_events_failed', errorFields(error));
        res.status(500).json({ status: 'error', message: 'Failed to fetch events' });
    }
});

router.get('/events/:eventId/replay', async (req: Request, res: Response) => {
    if (req.principal?.kind !== 'user') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const eventId = parseEventId(req.params.eventId);
    if (!eventId) {
        res.status(400).json({ error: 'eventId must be a positive integer' });
        return;
    }
    try {
        const { rows } = await pool.query<{
            event_id: number;
            event_type: 'warning' | 'critical';
            duration_seconds: unknown;
            peak_rula_score: unknown;
            minimum_cva_angle: unknown;
            logged_at: Date;
            sample_hz: unknown;
            reference_sensors: unknown;
            frames: unknown;
            truncated: boolean;
            incident_onset_offset_ms: unknown;
            mounting_mode: 'shoulder_top' | 'upper_arm';
        }>(
            `SELECT replay.event_id, event.event_type, event.duration_seconds,
                    event.peak_rula_score, event.minimum_cva_angle,
                    event.logged_at, replay.sample_hz,
                    replay.reference_sensors, replay.frames, replay.truncated,
                    replay.incident_onset_offset_ms, replay.mounting_mode
             FROM posture_event_replays replay
             JOIN posture_events event ON event.id = replay.event_id
             WHERE replay.event_id = $1
               AND COALESCE(event.owner_user_id::TEXT, event.user_id) = $2`,
            [eventId, req.principal.userId],
        );
        const replay = rows[0];
        if (!replay) {
            res.status(404).json({ error: 'Replay not found' });
            return;
        }
        res.status(200).json({
            status: 'success',
            event: {
                id: String(replay.event_id),
                event_type: replay.event_type,
                duration_seconds: numeric(replay.duration_seconds),
                peak_rula_score: numeric(replay.peak_rula_score),
                minimum_cva_angle: nullableNumeric(replay.minimum_cva_angle),
                logged_at: replay.logged_at,
            },
            replay: {
                mounting_mode: replay.mounting_mode,
                sample_hz: numeric(replay.sample_hz),
                reference_sensors: replay.reference_sensors,
                frames: replay.frames,
                truncated: replay.truncated,
                incident_onset_offset_ms: numeric(
                    replay.incident_onset_offset_ms,
                ),
            },
        });
    } catch (error) {
        logger.error('analytics_replay_failed', errorFields(error));
        res.status(500).json({ status: 'error', message: 'Failed to fetch replay' });
    }
});

export default router;