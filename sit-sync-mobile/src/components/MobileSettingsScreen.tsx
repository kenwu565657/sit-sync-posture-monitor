import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  deleteTrainingData,
  loadTrainingSettings,
  savePosturePreferences,
  saveTrainingConsent,
  TrainingSettings,
  trainPersonalModel,
} from '../settings/personalization';
import type { SensorPlacementMode } from '../types';

export function MobileSettingsScreen({
  baseUrl,
  token,
  onUnauthorized,
  mountingMode,
  alertSoundEnabled,
  onAlertSoundEnabledChange,
}: {
  baseUrl: string;
  token: string;
  onUnauthorized: () => void;
  mountingMode: SensorPlacementMode;
  alertSoundEnabled: boolean;
  onAlertSoundEnabledChange: (enabled: boolean) => Promise<void>;
}) {
  const [settings, setSettings] = useState<TrainingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const reportError = useCallback(
    (caught: unknown, fallback: string) => {
      const text = caught instanceof Error ? caught.message : fallback;
      if (text.includes('(401)')) unauthorizedRef.current();
      else setError(text);
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      setError('');
      setSettings(await loadTrainingSettings(baseUrl, token, mountingMode));
    } catch (caught) {
      reportError(caught, 'Settings unavailable');
    }
  }, [baseUrl, mountingMode, reportError, token]);

  useEffect(() => {
    runAsync(load());
  }, [load]);

  const updateConsent = async (
    telemetry: boolean,
    personalized: boolean,
  ) => {
    if (!settings) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await saveTrainingConsent(baseUrl, token, {
        telemetry_training_opt_in: telemetry,
        personalized_model_opt_in: telemetry && personalized,
      });
      setSettings({
        ...settings,
        telemetry_training_opt_in: telemetry,
        personalized_model_opt_in: telemetry && personalized,
      });
      setMessage('Training choices saved.');
    } catch (caught) {
      reportError(caught, 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const saveCvaThreshold = async () => {
    if (!settings) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const preferences = await savePosturePreferences(
        baseUrl,
        token,
        settings.preferences,
      );
      setSettings({ ...settings, preferences });
      setMessage('Posture warning threshold saved.');
    } catch (caught) {
      reportError(caught, 'Threshold update failed');
    } finally {
      setBusy(false);
    }
  };

  const train = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await trainPersonalModel(baseUrl, token, mountingMode);
      setMessage('Personal model training requested.');
      await load();
    } catch (caught) {
      reportError(caught, 'Training failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete training data?',
      'This permanently deletes saved training telemetry and your personal model.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            setError('');
            setMessage('');
            runAsync(deleteTrainingData(baseUrl, token)
              .then(async () => {
                setMessage('Training data and personal model deleted.');
                await load();
              })
              .catch(caught => reportError(caught, 'Delete failed'))
              .finally(() => setBusy(false)));
          },
        },
      ],
    );
  };

  if (!settings) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#22d3ee" />
        <Text style={styles.help}>{error || 'Loading settings…'}</Text>
      </View>
    );
  }

  const personal = settings.personalization;
  const canTrain =
    settings.telemetry_training_opt_in &&
    settings.personalized_model_opt_in &&
    !busy;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.intro}>
        Manage posture warnings and choose whether your sensor data can improve
        forecasting.
      </Text>
      <Text style={styles.help}>
        Personalization partition: {mountingMode.replace('_', ' ')}
      </Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!!message && <Text style={styles.success}>{message}</Text>}

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.label}>Alert sound</Text>
            <Text style={styles.help}>
              Play a short game-style sound with posture alerts. Vibration
              remains enabled.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Enable posture alert sound"
            value={alertSoundEnabled}
            onValueChange={value =>
              runAsync(onAlertSoundEnabledChange(value))
            }
            trackColor={{ false: '#475569', true: '#0891b2' }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Derived CVA-like warning threshold</Text>
        <Text style={styles.help}>
          Lower angles are worse. SitSync warns when the derived CVA-like
          estimate falls below this threshold; it is not a clinical
          measurement.
        </Text>
        <View style={styles.thresholdRow}>
          <TouchableOpacity
            accessibilityLabel="Decrease CVA threshold"
            disabled={busy || settings.preferences.warningCvaThreshold <= 20}
            style={styles.stepButton}
            onPress={() =>
              setSettings({
                ...settings,
                preferences: {
                  ...settings.preferences,
                  warningCvaThreshold:
                    settings.preferences.warningCvaThreshold - 1,
                },
              })
            }
          >
            <Text style={styles.stepButtonText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.thresholdValue}>
            {settings.preferences.warningCvaThreshold}°
          </Text>
          <TouchableOpacity
            accessibilityLabel="Increase CVA threshold"
            disabled={busy || settings.preferences.warningCvaThreshold >= 60}
            style={styles.stepButton}
            onPress={() =>
              setSettings({
                ...settings,
                preferences: {
                  ...settings.preferences,
                  warningCvaThreshold:
                    settings.preferences.warningCvaThreshold + 1,
                },
              })
            }
          >
            <Text style={styles.stepButtonText}>+</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          disabled={busy}
          style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          onPress={() => runAsync(saveCvaThreshold())}
        >
          <Text style={styles.secondaryButtonText}>Save CVA threshold</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.label}>Share movement features for training</Text>
            <Text style={styles.help}>
              Allow calibrated movement features to improve your forecasts. Raw
              sensor quaternions are not saved for this feature. Off by default.
            </Text>
          </View>
          <Switch
            value={settings.telemetry_training_opt_in}
            disabled={busy}
            onValueChange={value =>
              runAsync(updateConsent(
                value,
                value && settings.personalized_model_opt_in,
              ))
            }
            trackColor={{ false: '#475569', true: '#0891b2' }}
          />
        </View>
        <View
          style={[
            styles.row,
            styles.divider,
            !settings.telemetry_training_opt_in && styles.disabled,
          ]}
        >
          <View style={styles.copy}>
            <Text style={styles.label}>Use a model trained for me</Text>
            <Text style={styles.help}>
              Build personal forecasts from your telemetry. The global result
              remains available.
            </Text>
          </View>
          <Switch
            value={settings.personalized_model_opt_in}
            disabled={!settings.telemetry_training_opt_in || busy}
            onValueChange={value =>
              runAsync(
                updateConsent(settings.telemetry_training_opt_in, value),
              )
            }
            trackColor={{ false: '#475569', true: '#7c3aed' }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Personal model</Text>
          <Text style={styles.badge}>
            {personal.status.replace(/_/g, ' ')}
          </Text>
        </View>
        <Text style={styles.help}>
          {personal.sample_count.toLocaleString()} samples ·{' '}
          {personal.sequence_count.toLocaleString()} sequences
        </Text>
        <Text style={styles.help}>
          Personal: {personal.model_version ?? 'not trained'} · Global:{' '}
          {personal.global_model_version ?? 'unavailable'}
        </Text>
        {!!personal.last_error && (
          <Text style={styles.inlineError}>
            Last training error: {personal.last_error}
          </Text>
        )}
        <TouchableOpacity
          disabled={busy}
          style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          onPress={() => runAsync(load())}
        >
          <Text style={styles.secondaryButtonText}>Refresh status</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!canTrain}
          style={[styles.primaryButton, !canTrain && styles.buttonDisabled]}
          onPress={() => runAsync(train())}
        >
          <Text style={styles.primaryButtonText}>
            {busy
              ? 'Working…'
              : personal.model_version
                ? 'Retrain personal model'
                : 'Train personal model'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={
            busy || (personal.sample_count === 0 && !personal.model_version)
          }
          style={[
            styles.deleteButton,
            (busy ||
              (personal.sample_count === 0 && !personal.model_version)) &&
              styles.disabled,
          ]}
          onPress={confirmDelete}
        >
          <Text style={styles.deleteText}>Delete training data</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function runAsync(task: Promise<unknown>): void {
  task.catch(error => console.error(error));
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 48 },
  loading: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    flex: 1,
    justifyContent: 'center',
  },
  title: { color: '#f8fafc', fontSize: 27, fontWeight: '900' },
  intro: { color: '#94a3b8', lineHeight: 20, marginBottom: 18, marginTop: 6 },
  card: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  divider: {
    borderTopColor: '#334155',
    borderTopWidth: 1,
    marginTop: 16,
    paddingTop: 16,
  },
  copy: { flex: 1 },
  label: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  help: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginTop: 5 },
  disabled: { opacity: 0.5 },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  thresholdRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'center',
    marginTop: 16,
  },
  thresholdValue: {
    color: '#67e8f9',
    fontSize: 28,
    fontWeight: '900',
    minWidth: 72,
    textAlign: 'center',
  },
  stepButton: {
    alignItems: 'center',
    backgroundColor: '#164e63',
    borderRadius: 9,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  stepButtonText: { color: '#cffafe', fontSize: 24, fontWeight: '900' },
  badge: {
    backgroundColor: '#4c1d95',
    borderRadius: 20,
    color: '#ddd6fe',
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
    textTransform: 'capitalize',
  },
  error: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    color: '#fecaca',
    marginBottom: 12,
    padding: 10,
  },
  success: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    color: '#bbf7d0',
    marginBottom: 12,
    padding: 10,
  },
  inlineError: { color: '#fca5a5', fontSize: 12, marginTop: 10 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#a78bfa',
    borderRadius: 9,
    marginTop: 18,
    padding: 13,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  secondaryButtonText: {
    color: '#cbd5e1',
    fontWeight: '700',
  },
  primaryButtonText: { color: '#2e1065', fontWeight: '900' },
  buttonDisabled: { backgroundColor: '#475569' },
  deleteButton: {
    alignItems: 'center',
    borderColor: '#ef4444',
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  deleteText: { color: '#fca5a5', fontWeight: '800' },
});
