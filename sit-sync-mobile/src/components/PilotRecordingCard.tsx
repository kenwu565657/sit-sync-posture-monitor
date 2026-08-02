import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createPilotSequenceId,
  getPilotRecordingStatus,
  pilotRecordingWarning,
  PilotRecordingStatus,
  startPilotRecording,
  stopPilotRecording,
} from '../recording/pilotRecording';
import {TELEMETRY_HZ} from '../config';
import type {SensorPlacementMode} from '../types';

interface PilotRecordingCardProps {
  baseUrl: string;
  token: string;
  deviceId: string | null;
  sensorsConnected: number;
  cloudConnected: boolean;
  mountingMode: SensorPlacementMode;
}

const TARGET_SECONDS = 30 * 60;
const MINIMUM_HEALTHY_SAMPLE_HZ = 8.5;

export function PilotRecordingCard({
  baseUrl,
  token,
  deviceId,
  sensorsConnected,
  cloudConnected,
  mountingMode,
}: PilotRecordingCardProps) {
  const [status, setStatus] = useState<PilotRecordingStatus>({
    recording: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Connect all four sensors and the cloud before recording.',
  );

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    try {
      const next = await getPilotRecordingStatus(baseUrl, token, deviceId);
      setStatus(next);
      const warning = pilotRecordingWarning(
        next,
        MINIMUM_HEALTHY_SAMPLE_HZ,
      );
      if (warning) setMessage(warning);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Status check failed');
    }
  }, [baseUrl, deviceId, token]);

  useEffect(() => {
    if (!deviceId) return;
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [deviceId, refresh]);

  const ready =
    Boolean(deviceId) && sensorsConnected === 4 && cloudConnected && !busy;

  const start = async () => {
    if (!deviceId || !ready) return;
    setBusy(true);
    try {
      const sequenceId = createPilotSequenceId();
      const started = await startPilotRecording(
        baseUrl,
        token,
        deviceId,
        sequenceId,
        mountingMode,
      );
      setStatus(started);
      setMessage(
        `Recording started at ${started.filePath ?? 'the server recording directory'}. Remain upright and still for the first 5 seconds.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!deviceId || busy) return;
    setBusy(true);
    try {
      const result = await stopPilotRecording(baseUrl, token, deviceId);
      setStatus({recording: false});
      if (
        result.persistedFrames <= 0 ||
        result.writeErrors > 0 ||
        result.databaseStatus === 'failed'
      ) {
        setMessage('Raw recording was not saved successfully.');
      } else {
        setMessage(
          `Saved ${result.persistedFrames} frames at ${result.effectiveSampleHz.toFixed(
            1,
          )} Hz to ${result.filePath}; PostgreSQL stored ${
            result.databasePersistedFrames
          } frames.`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not stop');
    } finally {
      setBusy(false);
    }
  };

  const duration = status.durationSeconds ?? 0;
  const frames = status.frames ?? 0;
  const sampleRate =
    status.effectiveSampleHz ?? (duration > 0 ? frames / duration : 0);
  const lastFrameAge =
    status.lastFrameAt == null
      ? null
      : Math.max(0, (Date.now() - status.lastFrameAt) / 1000);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>30-minute pilot recording</Text>
      <Text style={styles.detail}>
        Raw quaternions are saved to the ML recording directory. Consented
        feature sequences and completed incidents are stored in PostgreSQL.
      </Text>
      <Text style={styles.gateway}>Gateway: {deviceId ?? 'initializing'}</Text>
      <Text style={styles.gateway}>Mounting mode: {mountingMode}</Text>
      {status.recording && (
        <View style={styles.metrics}>
          <Text style={styles.live}>● RECORDING</Text>
          <Text style={styles.metric}>Time: {formatDuration(duration)} / 30:00</Text>
          <Text style={styles.metric}>
            Frames: {frames} / approximately {TARGET_SECONDS * TELEMETRY_HZ}
          </Text>
          <Text style={styles.metric}>
            Effective rate: {sampleRate.toFixed(1)} Hz
          </Text>
          <Text style={styles.phase}>Protocol: {pilotPhase(duration)}</Text>
          <Text
            style={[
              styles.metric,
              lastFrameAge != null && lastFrameAge > 2 && styles.warning,
            ]}
          >
            Latest server frame:{' '}
            {lastFrameAge == null ? 'waiting' : `${lastFrameAge.toFixed(1)}s ago`}
          </Text>
          <Text style={styles.metric}>
            Raw file: {status.filePath ?? 'waiting for server path'}
          </Text>
          <Text style={styles.metric}>
            PostgreSQL: {status.databaseStatus ?? 'waiting'} ·{' '}
            {status.databasePersistedFrames ?? 0} frames persisted
          </Text>
          {(status.writeErrors ?? 0) > 0 && (
            <Text style={styles.warning}>
              Write errors: {status.writeErrors}
            </Text>
          )}
        </View>
      )}
      <Text style={styles.message}>{message}</Text>
      <TouchableOpacity
        disabled={status.recording ? busy : !ready}
        onPress={() => (status.recording ? stop() : start())}
        style={[
          styles.button,
          status.recording && styles.stopButton,
          (status.recording ? busy : !ready) && styles.disabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>
            {status.recording ? 'Stop and save recording' : 'Start pilot recording'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function pilotPhase(seconds: number): string {
  if (seconds < 5) return 'Remain upright and still for calibration';
  if (seconds < 5 * 60) return 'Normal desk work';
  if (seconds < 6 * 60) return 'Forward-head transition, hold, then recover';
  if (seconds < 10 * 60) return 'Normal desk work';
  if (seconds < 11 * 60) return 'Trunk-slouch transition, hold, then recover';
  if (seconds < 15 * 60) return 'Normal desk work';
  if (seconds < 16 * 60) return 'Combined slouch transition, hold, then recover';
  if (seconds < 20 * 60) return 'Normal desk work';
  if (seconds < 21 * 60) return 'Shoulder asymmetry, hold, then recover';
  if (seconds < 25 * 60) return 'Normal desk work';
  if (seconds < 26 * 60) return 'Natural slouch, hold, then recover';
  if (seconds < 30 * 60) return 'Normal desk work';
  return 'Thirty minutes complete—stop and save';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderColor: '#0e7490',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  title: {color: '#e2e8f0', fontSize: 17, fontWeight: '900'},
  detail: {color: '#94a3b8', fontSize: 12, lineHeight: 18, marginTop: 6},
  gateway: {
    color: '#67e8f9',
    fontFamily: 'monospace',
    fontSize: 10,
    marginTop: 8,
  },
  metrics: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    marginTop: 10,
    padding: 10,
  },
  live: {color: '#f87171', fontSize: 12, fontWeight: '900'},
  metric: {color: '#cbd5e1', fontSize: 12, marginTop: 4},
  phase: {color: '#67e8f9', fontSize: 12, fontWeight: '800', marginTop: 7},
  warning: {color: '#fbbf24', fontWeight: '800'},
  message: {color: '#cbd5e1', fontSize: 12, marginTop: 10},
  button: {
    alignItems: 'center',
    backgroundColor: '#0891b2',
    borderRadius: 10,
    marginTop: 12,
    padding: 13,
  },
  stopButton: {backgroundColor: '#b91c1c'},
  disabled: {backgroundColor: '#475569'},
  buttonText: {color: '#ffffff', fontSize: 14, fontWeight: '900'},
});
