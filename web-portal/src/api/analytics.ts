import { clearWebSession, getWebToken } from '../auth/webSession';
import { apiUrl } from '../config/env';

export interface AnalyticsDay {
    date: string;
    avg_rula: number;
    avg_cva?: number | null;
    total_bad_posture_seconds: number;
    incident_count: number;
    warning_count: number;
    critical_count: number;
}

export interface AnalyticsSummary {
    total_bad_posture_seconds: number;
    total_incidents: number;
    average_rula: number;
    average_cva?: number | null;
    warning_incidents: number;
    critical_incidents: number;
}

export interface AnalyticsHistory {
    range_days: 7 | 30;
    data: AnalyticsDay[];
    summary: AnalyticsSummary;
}

export class SessionExpiredError extends Error {}

export async function getAnalyticsHistory(
    days: 7 | 30,
    signal?: AbortSignal,
): Promise<AnalyticsHistory> {
    const token = getWebToken();
    if (!token) throw new SessionExpiredError('Authentication required');
    const response = await fetch(apiUrl(`/api/analytics/history?days=${days}`), {
        headers: { Authorization: `Bearer ${token}` },
        signal,
    });
    if (response.status === 401) {
        clearWebSession();
        throw new SessionExpiredError('Session expired');
    }
    if (!response.ok) throw new Error('Analytics could not be loaded.');
    return response.json() as Promise<AnalyticsHistory>;
}
