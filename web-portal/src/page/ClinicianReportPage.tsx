import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getAnalyticsHistory,
    SessionExpiredError,
} from '../api/analytics';
import type { AnalyticsHistory } from '../api/analytics';
import { getWebUser } from '../auth/webSession';

export default function PostureReportPage() {
    const navigate = useNavigate();
    const [days, setDays] = useState<7 | 30>(30);
    const [history, setHistory] = useState<AnalyticsHistory | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        void getAnalyticsHistory(days, controller.signal)
            .then(setHistory)
            .catch((caught) => {
                if (caught instanceof DOMException && caught.name === 'AbortError') return;
                if (caught instanceof SessionExpiredError) {
                    navigate('/login', { replace: true });
                    return;
                }
                setError(caught instanceof Error ? caught.message : 'Report unavailable.');
            });
        return () => controller.abort();
    }, [days, navigate]);

    if (error) return <div style={styles.message}>{error}</div>;
    if (!history) return <div style={styles.message}>Generating report from sensor history…</div>;

    const user = getWebUser();
    const firstDate = history.data[0]?.date;
    const lastDate = history.data.at(-1)?.date;
    const monitoredIncidentDays = history.data.filter(
        (day) => day.incident_count > 0,
    ).length;
    const grade = !history.summary.total_incidents
        ? 'A'
        : history.summary.average_rula <= 2
          ? 'A'
          : history.summary.average_rula <= 3
            ? 'B'
            : history.summary.average_rula <= 4
              ? 'C'
              : 'D';

    const changeRange = (range: 7 | 30) => {
        if (range === days) return;
        setHistory(null);
        setError('');
        setDays(range);
    };

    return (
        <main style={styles.container}>
            <div className="no-print" style={styles.actionBar}>
                <div style={styles.rangeControl}>
                    {([7, 30] as const).map((range) => (
                        <button
                            key={range}
                            type="button"
                            onClick={() => changeRange(range)}
                            style={{
                                ...styles.rangeButton,
                                ...(days === range ? styles.rangeButtonActive : {}),
                            }}
                        >
                            {range === 7 ? 'Weekly' : '30 days'}
                        </button>
                    ))}
                </div>
                <button type="button" onClick={() => window.print()} style={styles.printButton}>
                    Save as PDF / Print
                </button>
            </div>

            <article style={styles.paperReport}>
                <header style={styles.reportHeader}>
                    <h1 style={styles.title}>Sit-Sync Posture Report</h1>
                    <p style={styles.confidential}>
                        {days === 7 ? 'WEEKLY RECAP' : '30-DAY SCREENING REPORT'}
                    </p>
                </header>

                <section style={styles.metaDataRow}>
                    <div><strong>User:</strong> {user?.name ?? 'Unknown'}</div>
                    <div><strong>User ID:</strong> {user?.id ?? 'Unavailable'}</div>
                    <div>
                        <strong>Date range:</strong>{' '}
                        {firstDate && lastDate
                            ? `${new Date(`${firstDate}T00:00:00`).toLocaleDateString()} – ${new Date(`${lastDate}T00:00:00`).toLocaleDateString()}`
                            : 'Unavailable'}
                    </div>
                    <div><strong>Generated:</strong> {new Date().toLocaleDateString()}</div>
                </section>

                <h2 style={styles.sectionTitle}>1. Posture incident summary</h2>
                <table style={styles.table}>
                    <tbody>
                        <ReportRow
                            label={`${days}-day posture grade`}
                            value={grade}
                        />
                        <ReportRow
                            label={`${days}-day average estimated RULA`}
                            value={history.summary.total_incidents
                                ? `${history.summary.average_rula.toFixed(1)} / 7`
                                : 'No incidents'}
                        />
                        <ReportRow
                            label={`${days}-day average derived CVA`}
                            value={history.summary.average_cva == null
                                ? '—'
                                : `${history.summary.average_cva.toFixed(1)}°`}
                        />
                        <ReportRow
                            label="Total completed incidents"
                            value={history.summary.total_incidents}
                        />
                        <ReportRow
                            label="Warning incidents"
                            value={history.summary.warning_incidents}
                        />
                        <ReportRow
                            label="Critical incidents"
                            value={history.summary.critical_incidents}
                        />
                        <ReportRow
                            label="Total sustained risky-posture time"
                            value={`${(history.summary.total_bad_posture_seconds / 60).toFixed(1)} minutes`}
                        />
                        <ReportRow
                            label="Days containing incidents"
                            value={`${monitoredIncidentDays} of ${history.range_days}`}
                        />
                    </tbody>
                </table>

                <h2 style={styles.sectionTitle}>2. Interpretation</h2>
                <p style={styles.bodyText}>
                    {history.summary.critical_incidents > 0
                        ? 'Critical sustained deviations were detected. Review workstation setup, neutral calibration, and symptom history with a qualified professional.'
                        : history.summary.warning_incidents > 0
                          ? 'Warning-level sustained deviations were detected without a critical episode in this reporting period.'
                          : 'No sustained warning or critical posture incidents were recorded in this period.'}
                </p>

                <aside style={styles.limitations}>
                    <strong>Measurement limitations</strong>
                    <p style={styles.bodyText}>
                        This report uses four BNO085 IMUs, an estimated-RULA
                        screening algorithm, and a derived CVA-like angle. Lower
                        CVA-like values indicate greater measured forward-head
                        deviation from the calibrated reference; this derived metric
                        is not a clinical measurement. The system does not observe
                        wrists, elbows, legs, load, or muscle activity and is not a
                        diagnosis or complete ergonomic assessment. The ML
                        service contributes only its existing five-second risk
                        prediction endpoint; no activity classification is claimed.
                    </p>
                </aside>

                <div style={styles.notes}>
                    <strong>Personal notes</strong>
                    {[1, 2, 3].map((line) => (
                        <div key={line} style={styles.noteLine} />
                    ))}
                </div>
            </article>
        </main>
    );
}

function ReportRow({ label, value }: { label: string; value: string | number }) {
    return (
        <tr>
            <td style={styles.td}><strong>{label}</strong></td>
            <td style={styles.td}>{value}</td>
        </tr>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: { maxWidth: '920px', margin: '0 auto', padding: '30px' },
    message: { padding: '30px', color: '#f8fafc' },
    actionBar: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '20px',
        marginBottom: '24px',
        padding: '14px 18px',
        borderRadius: '9px',
        backgroundColor: '#1e293b',
    },
    actionText: { margin: 0, color: '#94a3b8' },
    rangeControl: {
        display: 'flex',
        gap: '4px',
        padding: '4px',
        borderRadius: '8px',
        backgroundColor: '#0f172a',
    },
    rangeButton: {
        border: 0,
        borderRadius: '6px',
        padding: '8px 14px',
        color: '#94a3b8',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        fontWeight: 700,
    },
    rangeButtonActive: { color: '#082f49', backgroundColor: '#38bdf8' },
    printButton: {
        border: 0,
        borderRadius: '7px',
        padding: '10px 18px',
        color: '#fff',
        backgroundColor: '#059669',
        cursor: 'pointer',
        fontWeight: 700,
    },
    paperReport: {
        minHeight: '800px',
        padding: '48px',
        borderRadius: '5px',
        color: '#0f172a',
        backgroundColor: '#fff',
        boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
    },
    reportHeader: {
        paddingBottom: '20px',
        marginBottom: '20px',
        borderBottom: '3px solid #0f172a',
    },
    title: { margin: 0 },
    confidential: { margin: '6px 0 0', color: '#64748b' },
    metaDataRow: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px 24px',
        marginBottom: '36px',
        color: '#334155',
        fontSize: '13px',
    },
    sectionTitle: {
        marginTop: '30px',
        paddingBottom: '6px',
        borderBottom: '1px solid #cbd5e1',
        fontSize: '19px',
    },
    table: { width: '100%', borderCollapse: 'collapse' },
    td: { padding: '11px', border: '1px solid #cbd5e1', color: '#334155' },
    bodyText: { color: '#334155', lineHeight: 1.6 },
    limitations: {
        marginTop: '28px',
        padding: '18px',
        border: '1px solid #f59e0b',
        borderRadius: '8px',
        backgroundColor: '#fffbeb',
    },
    notes: {
        marginTop: '40px',
        padding: '20px',
        border: '1px dashed #94a3b8',
        backgroundColor: '#f8fafc',
    },
    noteLine: {
        height: '30px',
        marginTop: '10px',
        borderBottom: '1px solid #cbd5e1',
    },
};
