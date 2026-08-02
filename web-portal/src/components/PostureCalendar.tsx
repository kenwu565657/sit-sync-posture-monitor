import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useNavigate } from 'react-router-dom';
import { clearWebSession, getWebToken } from '../auth/webSession';
import { apiUrl } from '../config/env';
import Avatar3D from './Avatar3D';
import PostureReplay from './PostureReplay';
import type { ReplayData } from './PostureReplay';

type DayStatus = 'warning' | 'critical';
type SavedSensors = React.ComponentProps<typeof Avatar3D>['sensors'];

interface CalendarDay {
    date: string;
    status: DayStatus;
    incident_count: number;
    total_duration_seconds: number;
}

interface PostureEvent {
    id: string;
    device_id: string | null;
    mounting_mode?: 'shoulder_top' | 'upper_arm';
    event_type: DayStatus;
    duration_seconds: number;
    peak_rula_score: number;
    minimum_cva_angle?: number | null;
    sensor_snapshot: {
        sensors?: SavedSensors;
    } | null;
    replay_available: boolean;
    logged_at: string;
}

interface CalendarResponse {
    status: 'success';
    month: string;
    days: CalendarDay[];
}

interface EventsResponse {
    status: 'success';
    date: string;
    events: PostureEvent[];
}

interface ReplayResponse {
    status: 'success';
    replay: ReplayData;
}

function localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function monthKey(date: Date): string {
    return localDateKey(date).slice(0, 7);
}

function parseMonth(value: string): Date {
    const [year, month] = value.split('-').map(Number);
    return new Date(year, month - 1, 1);
}

function shiftMonth(value: string, offset: number): string {
    const date = parseMonth(value);
    date.setMonth(date.getMonth() + offset);
    return monthKey(date);
}

function durationLabel(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export default function PostureCalendar() {
    const navigate = useNavigate();
    const today = useMemo(() => new Date(), []);
    const [month, setMonth] = useState(() => monthKey(today));
    const [selectedDate, setSelectedDate] = useState(() => localDateKey(today));
    const [days, setDays] = useState<CalendarDay[]>([]);
    const [events, setEvents] = useState<PostureEvent[]>([]);
    const [activeEvent, setActiveEvent] = useState<PostureEvent | null>(null);
    const [activeReplay, setActiveReplay] = useState<ReplayData | null>(null);
    const [replayLoading, setReplayLoading] = useState(false);
    const [replayError, setReplayError] = useState('');
    const [monthLoading, setMonthLoading] = useState(true);
    const [eventsLoading, setEventsLoading] = useState(true);
    const [error, setError] = useState('');

    const authenticatedFetch = useCallback(async (
        path: string,
        signal: AbortSignal,
    ) => {
        const token = getWebToken();
        if (!token) {
            navigate('/login', { replace: true });
            throw new Error('Authentication required');
        }
        const response = await fetch(apiUrl(path), {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });
        if (response.status === 401) {
            clearWebSession();
            navigate('/login', { replace: true });
            throw new Error('Session expired');
        }
        if (!response.ok) throw new Error('Posture history could not be loaded.');
        return response;
    }, [navigate]);

    useEffect(() => {
        const controller = new AbortController();
        void authenticatedFetch(
            `/api/analytics/calendar?month=${month}`,
            controller.signal,
        )
            .then((response) => response.json() as Promise<CalendarResponse>)
            .then((body) => setDays(body.days))
            .catch((caught) => {
                if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
                    setError(caught instanceof Error ? caught.message : 'Failed to load history.');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setMonthLoading(false);
            });
        return () => controller.abort();
    }, [authenticatedFetch, month]);

    useEffect(() => {
        const controller = new AbortController();
        void authenticatedFetch(
            `/api/analytics/events?date=${selectedDate}`,
            controller.signal,
        )
            .then((response) => response.json() as Promise<EventsResponse>)
            .then((body) => setEvents(body.events))
            .catch((caught) => {
                if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
                    setError(caught instanceof Error ? caught.message : 'Failed to load events.');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setEventsLoading(false);
            });
        return () => controller.abort();
    }, [authenticatedFetch, selectedDate]);

    useEffect(() => {
        if (!activeEvent?.replay_available) return;
        const controller = new AbortController();
        void authenticatedFetch(
            `/api/analytics/events/${activeEvent.id}/replay`,
            controller.signal,
        )
            .then((response) => response.json() as Promise<ReplayResponse>)
            .then((body) => setActiveReplay(body.replay))
            .catch((caught) => {
                if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
                    setReplayError(
                        caught instanceof Error
                            ? caught.message
                            : 'Replay could not be loaded.',
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setReplayLoading(false);
            });
        return () => controller.abort();
    }, [activeEvent, authenticatedFetch]);

    const monthDate = parseMonth(month);
    const daysInMonth = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0,
    ).getDate();
    const leadingBlanks = monthDate.getDay();
    const dayLookup = new Map(days.map((day) => [day.date, day]));
    const monthLabel = new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
    }).format(monthDate);
    const selectedLabel = new Intl.DateTimeFormat(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(`${selectedDate}T00:00:00`));

    const changeMonth = (offset: number) => {
        const nextMonth = shiftMonth(month, offset);
        setMonthLoading(true);
        setEventsLoading(true);
        setActiveEvent(null);
        setActiveReplay(null);
        setReplayError('');
        setError('');
        setMonth(nextMonth);
        setSelectedDate(`${nextMonth}-01`);
    };

    const selectDate = (date: string) => {
        if (date === selectedDate) return;
        setEventsLoading(true);
        setActiveEvent(null);
        setActiveReplay(null);
        setReplayError('');
        setError('');
        setSelectedDate(date);
    };

    const selectEvent = (event: PostureEvent) => {
        setActiveEvent(event);
        setActiveReplay(null);
        setReplayError('');
        setReplayLoading(event.replay_available);
    };

    return (
        <main style={styles.container}>
            <header style={styles.headerRow}>
                <div>
                    <h2 style={styles.header}>Posture History & Replay</h2>
                    <p style={styles.subtitle}>
                        Completed warning and critical incidents from your sensors
                    </p>
                </div>
                <div style={styles.legend}>
                    <LegendDot color="#f59e0b" label="Warning" />
                    <LegendDot color="#ef4444" label="Critical" />
                </div>
            </header>

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.masterGrid}>
                <section style={styles.leftColumn}>
                    <article style={styles.card}>
                        <div style={styles.monthHeader}>
                            <button
                                type="button"
                                style={styles.monthButton}
                                onClick={() => changeMonth(-1)}
                                aria-label="Previous month"
                            >
                                ‹
                            </button>
                            <h3 style={styles.cardTitle}>{monthLabel}</h3>
                            <button
                                type="button"
                                style={styles.monthButton}
                                onClick={() => changeMonth(1)}
                                aria-label="Next month"
                            >
                                ›
                            </button>
                        </div>
                        <div style={styles.weekdays}>
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                                <div key={`${day}-${index}`}>{day}</div>
                            ))}
                        </div>
                        <div style={styles.calendarGrid} aria-busy={monthLoading}>
                            {Array.from({ length: leadingBlanks }, (_, index) => (
                                <div key={`blank-${index}`} style={styles.dayBoxEmpty} />
                            ))}
                            {Array.from({ length: daysInMonth }, (_, index) => {
                                const dayNumber = index + 1;
                                const date = `${month}-${String(dayNumber).padStart(2, '0')}`;
                                const history = dayLookup.get(date);
                                const selected = selectedDate === date;
                                return (
                                    <button
                                        key={date}
                                        type="button"
                                        onClick={() => selectDate(date)}
                                        style={{
                                            ...styles.dayBox,
                                            ...(selected ? styles.dayBoxSelected : {}),
                                        }}
                                    >
                                        <span>{dayNumber}</span>
                                        {history && (
                                            <span
                                                title={`${history.incident_count} incidents`}
                                                style={{
                                                    ...styles.statusDot,
                                                    backgroundColor: history.status === 'critical'
                                                        ? '#ef4444'
                                                        : '#f59e0b',
                                                }}
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </article>

                    <article style={styles.card}>
                        <h3 style={styles.cardTitle}>{selectedLabel}</h3>
                        {eventsLoading && <p style={styles.muted}>Loading events…</p>}
                        {!eventsLoading && events.length === 0 && (
                            <p style={styles.muted}>
                                No sustained risky-posture incidents recorded.
                            </p>
                        )}
                        {!eventsLoading && events.length > 0 && (
                            <div style={styles.timelineList}>
                                {events.map((event) => {
                                    const hasReplay = event.replay_available;
                                    const hasStaticSnapshot = Boolean(
                                        event.sensor_snapshot?.sensors,
                                    );
                                    const canView = hasReplay || hasStaticSnapshot;
                                    return (
                                        <button
                                            key={event.id}
                                            type="button"
                                            disabled={!canView}
                                            onClick={() => selectEvent(event)}
                                            style={{
                                                ...styles.eventItem,
                                                ...(activeEvent?.id === event.id
                                                    ? styles.eventItemActive
                                                    : {}),
                                                ...(!canView ? styles.eventItemDisabled : {}),
                                            }}
                                        >
                                            <span style={styles.eventTime}>
                                                {new Date(event.logged_at).toLocaleTimeString([], {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </span>
                                            <span style={styles.eventDetails}>
                                                <strong style={{
                                                    color: event.event_type === 'critical'
                                                        ? '#fca5a5'
                                                        : '#fcd34d',
                                                }}>
                                                    {event.event_type === 'critical'
                                                        ? 'Critical posture'
                                                        : 'Posture warning'}
                                                </strong>
                                                <small style={styles.eventMeta}>
                                                    {durationLabel(event.duration_seconds)}
                                                    {' · '}Estimated RULA {event.peak_rula_score}
                                                    {' · '}Minimum CVA-like angle{' '}
                                                    {event.minimum_cva_angle == null
                                                        ? '—'
                                                        : `${event.minimum_cva_angle.toFixed(1)}°`}
                                                </small>
                                                {!canView && (
                                                    <small style={styles.eventMeta}>
                                                        Replay unavailable for legacy event
                                                    </small>
                                                )}
                                                {!hasReplay && hasStaticSnapshot && (
                                                    <small style={styles.eventMeta}>
                                                        Static snapshot only
                                                    </small>
                                                )}
                                            </span>
                                            <span style={styles.playIcon}>
                                                {canView ? '▶' : '—'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </article>
                </section>

                <section style={styles.rightColumn}>
                    {replayLoading ? (
                        <div style={styles.emptyViewer}>
                            <h3>Loading replay…</h3>
                            <p style={styles.muted}>
                                Downloading the recorded 5 Hz posture timeline.
                            </p>
                        </div>
                    ) : replayError ? (
                        <div style={styles.emptyViewer}>
                            <h3>Replay unavailable</h3>
                            <p style={styles.error}>{replayError}</p>
                        </div>
                    ) : activeEvent && activeReplay ? (
                        <PostureReplay
                            key={activeEvent.id}
                            replay={activeReplay}
                            eventLabel={activeEvent.event_type.toUpperCase()}
                            minimumCvaAngle={activeEvent.minimum_cva_angle}
                        />
                    ) : activeEvent?.sensor_snapshot?.sensors ? (
                        <div style={styles.viewerContainer}>
                            <div style={styles.viewerOverlay}>
                                <h3 style={styles.viewerTitle}>Recorded posture</h3>
                                <small style={styles.snapshotLabel}>
                                    Legacy static snapshot
                                </small>
                                <strong style={{
                                    color: activeEvent.event_type === 'critical'
                                        ? '#f87171'
                                        : '#fbbf24',
                                }}>
                                    {activeEvent.event_type.toUpperCase()}
                                </strong>
                                <p style={styles.viewerMeta}>
                                    {new Date(activeEvent.logged_at).toLocaleString()}
                                    {' · '}Estimated RULA {activeEvent.peak_rula_score}
                                    {' · '}Minimum CVA-like angle{' '}
                                    {activeEvent.minimum_cva_angle == null
                                        ? '—'
                                        : `${activeEvent.minimum_cva_angle.toFixed(1)}°`}
                                </p>
                            </div>
                            <Canvas camera={{ position: [0, 1, 3], fov: 50 }}>
                                <ambientLight intensity={1} />
                                <directionalLight position={[2, 2, 2]} intensity={1.5} />
                                <Avatar3D
                                    sensors={activeEvent.sensor_snapshot.sensors}
                                    mountingMode={
                                        activeEvent.mounting_mode ?? 'shoulder_top'
                                    }
                                />
                            </Canvas>
                        </div>
                    ) : (
                        <div style={styles.emptyViewer}>
                            <h3>Select an incident</h3>
                            <p style={styles.muted}>
                                Incidents recorded by the new telemetry pipeline include
                                a sensor snapshot for 3D replay.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span style={styles.legendItem}>
            <span style={{ ...styles.statusDot, backgroundColor: color }} />
            {label}
        </span>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        maxWidth: '1280px',
        minHeight: '100vh',
        margin: '0 auto',
        padding: '30px',
        color: '#f8fafc',
        fontFamily: 'sans-serif',
    },
    headerRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '20px',
        marginBottom: '24px',
    },
    header: { margin: 0, fontSize: '28px' },
    subtitle: { margin: '6px 0 0', color: '#94a3b8' },
    legend: { display: 'flex', gap: '14px', color: '#cbd5e1', fontSize: '13px' },
    legendItem: { display: 'flex', alignItems: 'center', gap: '6px' },
    error: {
        marginBottom: '18px',
        padding: '12px 14px',
        border: '1px solid #b91c1c',
        borderRadius: '8px',
        color: '#fecaca',
        backgroundColor: '#450a0a',
    },
    masterGrid: {
        display: 'grid',
        gridTemplateColumns: 'minmax(340px, 0.9fr) minmax(480px, 1.4fr)',
        gap: '24px',
    },
    leftColumn: { display: 'flex', flexDirection: 'column', gap: '20px' },
    rightColumn: { minHeight: '650px' },
    card: {
        padding: '20px',
        border: '1px solid #334155',
        borderRadius: '12px',
        backgroundColor: '#1e293b',
    },
    monthHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
    },
    monthButton: {
        width: '34px',
        height: '34px',
        border: '1px solid #475569',
        borderRadius: '7px',
        color: '#e2e8f0',
        backgroundColor: '#0f172a',
        cursor: 'pointer',
        fontSize: '22px',
    },
    cardTitle: { margin: 0, fontSize: '18px' },
    weekdays: {
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        marginBottom: '8px',
        color: '#94a3b8',
        textAlign: 'center',
        fontSize: '12px',
        fontWeight: 700,
    },
    calendarGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '6px',
    },
    dayBox: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        aspectRatio: '1',
        border: '1px solid #334155',
        borderRadius: '7px',
        color: '#cbd5e1',
        backgroundColor: '#0f172a',
        cursor: 'pointer',
    },
    dayBoxSelected: {
        borderColor: '#38bdf8',
        color: '#e0f2fe',
        backgroundColor: '#164e63',
    },
    dayBoxEmpty: { aspectRatio: '1' },
    statusDot: {
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
    },
    timelineList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        marginTop: '16px',
    },
    eventItem: {
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: '14px',
        border: '1px solid #334155',
        borderRadius: '8px',
        color: '#f8fafc',
        textAlign: 'left',
        backgroundColor: '#0f172a',
        cursor: 'pointer',
    },
    eventItemActive: { borderColor: '#38bdf8', backgroundColor: '#0c4a6e' },
    eventItemDisabled: { opacity: 0.65, cursor: 'not-allowed' },
    eventTime: { width: '82px', color: '#38bdf8', fontWeight: 700 },
    eventDetails: { display: 'flex', flex: 1, flexDirection: 'column', gap: '4px' },
    eventMeta: { color: '#94a3b8' },
    playIcon: { color: '#94a3b8' },
    viewerContainer: {
        position: 'relative',
        height: '100%',
        minHeight: '650px',
        overflow: 'hidden',
        border: '1px solid #334155',
        borderRadius: '12px',
        backgroundColor: '#1e293b',
    },
    viewerOverlay: {
        position: 'absolute',
        top: '20px',
        left: '20px',
        zIndex: 10,
        maxWidth: '70%',
        padding: '14px',
        borderRadius: '8px',
        backgroundColor: 'rgba(15, 23, 42, 0.82)',
        backdropFilter: 'blur(4px)',
    },
    viewerTitle: { margin: '0 0 6px' },
    snapshotLabel: {
        display: 'block',
        marginBottom: '6px',
        color: '#94a3b8',
    },
    viewerMeta: { margin: '5px 0 0', color: '#94a3b8', fontSize: '13px' },
    emptyViewer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        height: '100%',
        minHeight: '650px',
        padding: '40px',
        border: '2px dashed #334155',
        borderRadius: '12px',
        textAlign: 'center',
        backgroundColor: '#1e293b',
    },
    muted: { color: '#94a3b8', lineHeight: 1.5 },
};
