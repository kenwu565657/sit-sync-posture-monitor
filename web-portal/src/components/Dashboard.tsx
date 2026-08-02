import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { clearWebSession, getWebToken } from '../auth/webSession';
import { apiUrl } from '../config/env';

type AnalyticsDays = 7 | 30;

interface DailyHistory {
    date: string;
    avg_rula: number;
    avg_cva?: number | null;
    total_bad_posture_seconds: number;
    incident_count: number;
    warning_count: number;
    critical_count: number;
}

interface AnalyticsSummary {
    total_bad_posture_seconds: number;
    total_incidents: number;
    average_rula: number;
    average_cva?: number | null;
    warning_incidents: number;
    critical_incidents: number;
}

interface HistoryResponse {
    status: 'success';
    range_days: AnalyticsDays;
    data: DailyHistory[];
    summary: AnalyticsSummary;
}

interface InsightsResponse {
    status: 'success';
    today_incidents: number;
    insights: string[];
}

const EMPTY_SUMMARY: AnalyticsSummary = {
    total_bad_posture_seconds: 0,
    total_incidents: 0,
    average_rula: 0,
    average_cva: null,
    warning_incidents: 0,
    critical_incidents: 0,
};

function durationLabel(totalSeconds: number): string {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function shortDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
    }).format(new Date(`${value}T00:00:00`));
}

export default function Dashboard() {
    const navigate = useNavigate();
    const [days, setDays] = useState<AnalyticsDays>(7);
    const [history, setHistory] = useState<DailyHistory[]>([]);
    const [summary, setSummary] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
    const [insights, setInsights] = useState<string[]>([]);
    const [todayIncidents, setTodayIncidents] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        const fetchAnalytics = async () => {
            setLoading(true);
            setError('');
            const token = getWebToken();
            if (!token) {
                navigate('/login', { replace: true });
                return;
            }
            const headers = { Authorization: `Bearer ${token}` };
            try {
                const [historyResponse, insightsResponse] = await Promise.all([
                    fetch(apiUrl(`/api/analytics/history?days=${days}`), {
                        headers,
                        signal: controller.signal,
                    }),
                    fetch(apiUrl(`/api/analytics/insights?days=${days}`), {
                        headers,
                        signal: controller.signal,
                    }),
                ]);
                if (historyResponse.status === 401 || insightsResponse.status === 401) {
                    clearWebSession();
                    navigate('/login', { replace: true });
                    return;
                }
                if (!historyResponse.ok || !insightsResponse.ok) {
                    throw new Error('The analytics service could not load this period.');
                }
                const historyBody = (await historyResponse.json()) as HistoryResponse;
                const insightsBody = (await insightsResponse.json()) as InsightsResponse;
                setHistory(historyBody.data);
                setSummary(historyBody.summary);
                setInsights(insightsBody.insights);
                setTodayIncidents(insightsBody.today_incidents);
            } catch (caught) {
                if (caught instanceof DOMException && caught.name === 'AbortError') return;
                setError(
                    caught instanceof Error
                        ? caught.message
                        : 'Failed to load analytics.',
                );
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        void fetchAnalytics();
        return () => controller.abort();
    }, [days, navigate, refreshKey]);

    return (
        <main style={styles.container}>
            <header style={styles.headerRow}>
                <div>
                    <h2 style={styles.header}>Posture Analytics</h2>
                    <p style={styles.subtitle}>
                        Sustained incidents calculated from your calibrated sensors
                    </p>
                </div>
                <div style={styles.periodControl} aria-label="Analytics period">
                    {([7, 30] as const).map((period) => (
                        <button
                            key={period}
                            type="button"
                            onClick={() => setDays(period)}
                            style={{
                                ...styles.periodButton,
                                ...(days === period ? styles.periodButtonActive : {}),
                            }}
                        >
                            {period} days
                        </button>
                    ))}
                </div>
            </header>

            {error && (
                <div style={styles.errorBox}>
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={() => setRefreshKey((value) => value + 1)}
                        style={styles.retryButton}
                    >
                        Retry
                    </button>
                </div>
            )}

            <section style={styles.statGrid} aria-busy={loading}>
                <StatCard
                    label="Risky posture time"
                    value={loading ? '—' : durationLabel(summary.total_bad_posture_seconds)}
                />
                <StatCard
                    label="Total incidents"
                    value={loading ? '—' : String(summary.total_incidents)}
                    detail={`${todayIncidents} today`}
                />
                <StatCard
                    label="Average estimated RULA"
                    value={loading || !summary.total_incidents
                        ? '—'
                        : summary.average_rula.toFixed(1)}
                    detail="Estimated from four IMUs"
                />
                <StatCard
                    label="Average derived CVA"
                    value={loading || summary.average_cva == null
                        ? '—'
                        : `${summary.average_cva.toFixed(1)}°`}
                    detail="CVA-like angle; lower values are worse"
                />
                <StatCard
                    label="Severity"
                    value={loading ? '—' : String(summary.critical_incidents)}
                    detail={`${summary.warning_incidents} warning · critical shown above`}
                    critical={summary.critical_incidents > 0}
                />
            </section>

            <section style={styles.contentGrid}>
                <article style={styles.card}>
                    <h3 style={styles.cardTitle}>{days}-day posture trend</h3>
                    <p style={styles.cardSubtitle}>
                        Duration, estimated RULA, and derived CVA for completed incidents
                    </p>
                    <div style={styles.chart}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={history}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={shortDate}
                                    stroke="#94a3b8"
                                    minTickGap={20}
                                />
                                <YAxis
                                    yAxisId="duration"
                                    stroke="#38bdf8"
                                    tickFormatter={(value) => `${Math.round(Number(value) / 60)}m`}
                                />
                                <YAxis
                                    yAxisId="rula"
                                    orientation="right"
                                    domain={[0, 7]}
                                    stroke="#f59e0b"
                                />
                                <YAxis
                                    yAxisId="cva"
                                    orientation="right"
                                    domain={[0, 90]}
                                    hide
                                />
                                <Tooltip
                                    labelFormatter={(value) => shortDate(String(value))}
                                    formatter={(value, name) => {
                                        if (name === 'Risky posture') {
                                            return [durationLabel(Number(value)), name];
                                        }
                                        if (name === 'Derived CVA') {
                                            return [`${Number(value).toFixed(1)}°`, name];
                                        }
                                        return [Number(value).toFixed(1), name];
                                    }}
                                    contentStyle={styles.tooltip}
                                />
                                <Legend />
                                <Bar
                                    yAxisId="duration"
                                    dataKey="total_bad_posture_seconds"
                                    name="Risky posture"
                                    fill="#38bdf8"
                                    radius={[4, 4, 0, 0]}
                                />
                                <Line
                                    yAxisId="rula"
                                    dataKey="avg_rula"
                                    name="Estimated RULA"
                                    stroke="#f59e0b"
                                    strokeWidth={2}
                                    dot={false}
                                />
                                <Line
                                    yAxisId="cva"
                                    dataKey="avg_cva"
                                    name="Derived CVA"
                                    stroke="#a78bfa"
                                    strokeWidth={2}
                                    connectNulls={false}
                                    dot={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    {!loading && summary.total_incidents === 0 && (
                        <div style={styles.emptyState}>
                            No sustained warning or critical incidents were recorded.
                            Keep the mobile gateway connected to build your history.
                        </div>
                    )}
                </article>

                <article style={styles.card}>
                    <h3 style={styles.cardTitle}>Posture guidance</h3>
                    <p style={styles.cardSubtitle}>
                        Rules based on the incidents in this period
                    </p>
                    <div style={styles.recommendations}>
                        {loading && <p style={styles.muted}>Loading guidance…</p>}
                        {!loading && insights.map((insight) => (
                            <div key={insight} style={styles.insight}>
                                <span style={styles.insightMarker} />
                                <p style={styles.insightText}>{insight}</p>
                            </div>
                        ))}
                    </div>
                    <p style={styles.disclaimer}>
                        Estimated RULA is a posture-screening indicator derived from
                        four IMUs, not a complete full-body assessment. Derived CVA
                        is a CVA-like angle from calibrated IMU orientation, not a
                        clinical measurement.
                    </p>
                </article>
            </section>
        </main>
    );
}

function StatCard({
    label,
    value,
    detail,
    critical = false,
}: {
    label: string;
    value: string;
    detail?: string;
    critical?: boolean;
}) {
    return (
        <article style={{
            ...styles.statCard,
            ...(critical ? styles.statCardCritical : {}),
        }}>
            <p style={styles.statLabel}>{label}</p>
            <strong style={styles.statValue}>{value}</strong>
            {detail && <span style={styles.statDetail}>{detail}</span>}
        </article>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        padding: '30px',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        fontFamily: 'sans-serif',
    },
    headerRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '20px',
        flexWrap: 'wrap',
        marginBottom: '24px',
    },
    header: { margin: 0, fontSize: '30px' },
    subtitle: { margin: '6px 0 0', color: '#94a3b8' },
    periodControl: {
        display: 'flex',
        gap: '4px',
        padding: '4px',
        borderRadius: '10px',
        backgroundColor: '#1e293b',
    },
    periodButton: {
        border: 0,
        borderRadius: '7px',
        padding: '9px 14px',
        color: '#94a3b8',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: 700,
    },
    periodButtonActive: { color: '#082f49', backgroundColor: '#38bdf8' },
    errorBox: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        padding: '14px 16px',
        marginBottom: '20px',
        border: '1px solid #b91c1c',
        borderRadius: '10px',
        color: '#fecaca',
        backgroundColor: '#450a0a',
    },
    retryButton: {
        border: '1px solid #ef4444',
        borderRadius: '6px',
        padding: '7px 12px',
        color: '#fee2e2',
        backgroundColor: '#7f1d1d',
        cursor: 'pointer',
    },
    statGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '16px',
        marginBottom: '20px',
    },
    statCard: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: '118px',
        padding: '20px',
        border: '1px solid #334155',
        borderRadius: '12px',
        backgroundColor: '#1e293b',
    },
    statCardCritical: { borderColor: '#dc2626', backgroundColor: '#3f1218' },
    statLabel: {
        margin: 0,
        color: '#94a3b8',
        fontSize: '13px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
    },
    statValue: { marginTop: '10px', fontSize: '32px' },
    statDetail: { marginTop: 'auto', color: '#94a3b8', fontSize: '12px' },
    contentGrid: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
        gap: '20px',
    },
    card: {
        position: 'relative',
        padding: '24px',
        border: '1px solid #334155',
        borderRadius: '12px',
        backgroundColor: '#1e293b',
        overflow: 'hidden',
    },
    cardTitle: { margin: 0, fontSize: '20px' },
    cardSubtitle: { margin: '6px 0 0', color: '#94a3b8', fontSize: '14px' },
    chart: { width: '100%', height: '360px', marginTop: '20px' },
    tooltip: {
        border: '1px solid #475569',
        borderRadius: '8px',
        color: '#f8fafc',
        backgroundColor: '#0f172a',
    },
    emptyState: {
        position: 'absolute',
        inset: '130px 40px auto',
        padding: '20px',
        border: '1px dashed #475569',
        borderRadius: '10px',
        color: '#cbd5e1',
        textAlign: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
    },
    recommendations: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginTop: '22px',
    },
    insight: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '14px',
        borderRadius: '9px',
        backgroundColor: '#0f172a',
    },
    insightMarker: {
        flex: '0 0 auto',
        width: '9px',
        height: '9px',
        marginTop: '6px',
        borderRadius: '50%',
        backgroundColor: '#38bdf8',
    },
    insightText: { margin: 0, color: '#e2e8f0', lineHeight: 1.5 },
    muted: { color: '#94a3b8' },
    disclaimer: {
        margin: '24px 0 0',
        paddingTop: '16px',
        borderTop: '1px solid #334155',
        color: '#64748b',
        fontSize: '12px',
        lineHeight: 1.5,
    },
};
