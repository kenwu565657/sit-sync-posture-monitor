import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  predictionSecondsRemaining,
  PredictionCountdownState,
} from '../alerts/predictionCountdown';

export function PredictionCountdownCard({
  state,
}: {
  state: PredictionCountdownState;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (state.mode === 'idle') return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [state.mode]);

  if (state.mode === 'idle') return null;
  if (state.mode === 'corrected') {
    if (now >= state.visibleUntilMs) return null;
    return (
      <View style={[styles.card, styles.correctedCard]}>
        <Text style={styles.correctedTitle}>Correction successful</Text>
        <Text style={styles.detail}>
          Forecast risk returned to low before posture became unsafe.
        </Text>
      </View>
    );
  }

  const remaining = predictionSecondsRemaining(state, now);
  if (remaining <= 0) return null;
  return (
    <View
      style={[
        styles.card,
        state.level === 'HIGH' ? styles.highCard : styles.elevatedCard,
      ]}
    >
      <View style={styles.countdown}>
        <Text style={styles.countdownValue}>{remaining.toFixed(1)}</Text>
        <Text style={styles.countdownUnit}>seconds</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>Posture risk predicted</Text>
        <Text style={styles.detail}>
          Make a small correction now. This is a prediction, not a detected
          incident.
        </Text>
        <Text style={styles.probability}>
          {state.level} risk
          {state.probability == null
            ? ''
            : ` · ${Math.round(state.probability * 100)}%`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
    padding: 14,
  },
  elevatedCard: {
    backgroundColor: '#422006',
    borderColor: '#f59e0b',
  },
  highCard: {
    backgroundColor: '#450a0a',
    borderColor: '#ef4444',
  },
  correctedCard: {
    alignItems: 'flex-start',
    backgroundColor: '#052e16',
    borderColor: '#22c55e',
    flexDirection: 'column',
  },
  countdown: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderRadius: 48,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  countdownValue: { color: '#f8fafc', fontSize: 25, fontWeight: '900' },
  countdownUnit: { color: '#cbd5e1', fontSize: 10 },
  copy: { flex: 1 },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '900' },
  correctedTitle: { color: '#86efac', fontSize: 16, fontWeight: '900' },
  detail: { color: '#e2e8f0', fontSize: 12, lineHeight: 17, marginTop: 5 },
  probability: {
    color: '#fef3c7',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 7,
  },
});
