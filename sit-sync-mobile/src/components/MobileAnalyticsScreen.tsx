import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatDerivedCva } from '../cva';
import {
  DailyPostureHistory,
  PostureAnalyticsSummary,
} from '../types';

type AnalyticsMode = 'history' | 'report';

interface HistoryResponse {
  data: DailyPostureHistory[];
  summary: PostureAnalyticsSummary;
}

interface InsightsResponse {
  insights: string[];
}

interface MobileAnalyticsScreenProps {
  mode: AnalyticsMode;
  baseUrl: string;
  token: string;
  userName: string;
  onUnauthorized: () => void;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function MobileAnalyticsScreen({
  mode,
  baseUrl,
  token,
  userName,
  onUnauthorized,
}: MobileAnalyticsScreenProps) {
  const days = mode === 'history' ? 7 : 30;
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [historyResponse, insightsResponse] = await Promise.all([
          fetch(endpoint(baseUrl, `/api/analytics/history?days=${days}`), {
            headers,
          }),
          fetch(endpoint(baseUrl, `/api/analytics/insights?days=${days}`), {
            headers,
          }),
        ]);
        if (historyResponse.status === 401 || insightsResponse.status === 401) {
          onUnauthorizedRef.current();
          return;
        }
        if (!historyResponse.ok || !insightsResponse.ok) {
          throw new Error('Analytics could not be loaded.');
        }
        const historyBody = (await historyResponse.json()) as HistoryResponse;
        const insightsBody =
          (await insightsResponse.json()) as InsightsResponse;
        if (cancelled) return;
        setHistory(historyBody);
        setInsights(insightsBody.insights);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : 'Analytics unavailable.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [baseUrl, days, refreshKey, token]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22d3ee" size="large" />
        <Text style={styles.muted}>Loading real posture data…</Text>
      </View>
    );
  }

  if (error || !history) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'Analytics unavailable.'}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            setError('');
            setRefreshKey(value => value + 1);
          }}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>
        {mode === 'history' ? 'Posture History' : 'Posture Report'}
      </Text>
      <Text style={styles.subtitle}>
        {mode === 'history'
          ? 'Completed incidents from the last 7 days'
          : `${userName} · authenticated 30-day summary`}
      </Text>

      <View style={styles.summaryGrid}>
        <SummaryCard
          label="Incidents"
          value={String(history.summary.total_incidents)}
        />
        <SummaryCard
          label="Risky time"
          value={durationLabel(history.summary.total_bad_posture_seconds)}
        />
        <SummaryCard
          label="Average RULA"
          value={
            history.summary.total_incidents
              ? history.summary.average_rula.toFixed(1)
              : '—'
          }
        />
        <SummaryCard
          label="Derived CVA-like"
          value={formatDerivedCva(history.summary.average_cva)}
        />
        <SummaryCard
          label="Critical"
          value={String(history.summary.critical_incidents)}
          critical={history.summary.critical_incidents > 0}
        />
      </View>

      {mode === 'history' ? (
        <>
          <Text style={styles.sectionTitle}>Daily history</Text>
          {history.data.map(day => (
            <View key={day.date} style={styles.dayCard}>
              <View>
                <Text style={styles.dayDate}>
                  {new Date(`${day.date}T00:00:00`).toLocaleDateString(
                    undefined,
                    { weekday: 'short', month: 'short', day: 'numeric' },
                  )}
                </Text>
                <Text style={styles.dayMeta}>
                  {day.incident_count} incidents ·{' '}
                  {durationLabel(day.total_bad_posture_seconds)}
                </Text>
                <Text style={styles.dayCva}>
                  Derived CVA-like: {formatDerivedCva(day.avg_cva)} · lower is
                  worse
                </Text>
              </View>
              <View style={styles.daySeverity}>
                <Text style={styles.warningText}>{day.warning_count} W</Text>
                <Text style={styles.criticalText}>{day.critical_count} C</Text>
              </View>
            </View>
          ))}
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Severity breakdown</Text>
          <View style={styles.reportCard}>
            <ReportRow
              label="Warnings"
              value={history.summary.warning_incidents}
            />
            <ReportRow
              label="Critical incidents"
              value={history.summary.critical_incidents}
            />
            <ReportRow
              label="Estimated RULA"
              value={
                history.summary.total_incidents
                  ? history.summary.average_rula.toFixed(1)
                  : 'No incidents'
              }
            />
            <ReportRow
              label="Derived CVA-like (lower is worse)"
              value={formatDerivedCva(history.summary.average_cva)}
            />
          </View>

          <Text style={styles.sectionTitle}>Guidance</Text>
          {insights.map(insight => (
            <View key={insight} style={styles.insightCard}>
              <View style={styles.insightDot} />
              <Text style={styles.insightText}>{insight}</Text>
            </View>
          ))}
          <Text style={styles.disclaimer}>
            Estimated RULA uses four IMUs and is not a complete full-body
            assessment. Derived CVA-like is an IMU estimate; lower angles are
            worse and it is not a clinical measurement.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function SummaryCard({
  label,
  value,
  critical = false,
}: {
  label: string;
  value: string;
  critical?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, critical && styles.summaryCardCritical]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function ReportRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <View style={styles.reportRow}>
      <Text style={styles.reportLabel}>{label}</Text>
      <Text style={styles.reportValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 36 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#f8fafc', fontSize: 27, fontWeight: '900' },
  subtitle: { color: '#94a3b8', marginTop: 5, marginBottom: 20 },
  muted: { color: '#94a3b8', marginTop: 12 },
  error: { color: '#fca5a5', textAlign: 'center' },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0284c7',
  },
  retryText: { color: '#fff', fontWeight: '800' },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryCard: {
    width: '48%',
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#1e293b',
  },
  summaryCardCritical: {
    borderColor: '#ef4444',
    backgroundColor: '#451a1a',
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: '#f8fafc',
    fontSize: 25,
    fontWeight: '900',
    marginTop: 7,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 24,
    marginBottom: 10,
  },
  dayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  dayDate: { color: '#f8fafc', fontWeight: '800' },
  dayMeta: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  dayCva: { color: '#67e8f9', fontSize: 11, marginTop: 4 },
  daySeverity: { flexDirection: 'row', gap: 10 },
  warningText: { color: '#fbbf24', fontWeight: '800' },
  criticalText: { color: '#f87171', fontWeight: '800' },
  reportCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#1e293b',
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#475569',
  },
  reportLabel: { color: '#cbd5e1' },
  reportValue: { color: '#f8fafc', fontWeight: '900' },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    marginBottom: 9,
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  insightDot: {
    width: 8,
    height: 8,
    marginTop: 6,
    borderRadius: 4,
    backgroundColor: '#22d3ee',
  },
  insightText: { flex: 1, color: '#e2e8f0', lineHeight: 20 },
  disclaimer: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 16,
  },
});
