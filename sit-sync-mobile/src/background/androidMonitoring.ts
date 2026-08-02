import notifee, { AndroidImportance } from '@notifee/react-native';
import BackgroundService from 'react-native-background-actions';
import { PermissionsAndroid, Platform } from 'react-native';
import { PostureAlert } from '../alerts/postureAlert';
import { derivedCvaDetail } from '../cva';
import { PosturePayload } from '../types';

const ALERT_CHANNEL_ID = 'posture-alerts-silent-v3';
const ALERT_SOUND_CHANNEL_ID = 'posture-alerts-game-sound-v3';
const PREDICTION_CHANNEL_ID = 'posture-predictions-silent-v3';
const PREDICTION_SOUND_CHANNEL_ID = 'posture-predictions-game-sound-v3';

const sleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function monitoringTask(): Promise<void> {
  while (BackgroundService.isRunning()) {
    await sleep(1000);
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 33) return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function initializePostureNotifications(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannels([
    {
      id: ALERT_CHANNEL_ID,
      name: 'Detected posture alerts',
      description: 'Warnings when SitSync detects sustained risky posture.',
      importance: AndroidImportance.HIGH,
      vibration: false,
    },
    {
      id: ALERT_SOUND_CHANNEL_ID,
      name: 'Detected posture alerts with sound',
      description: 'Game-style warnings for sustained risky posture.',
      importance: AndroidImportance.HIGH,
      vibration: false,
      sound: 'sitsync_game_alert',
    },
    {
      id: PREDICTION_CHANNEL_ID,
      name: 'Predicted posture risk',
      description: 'Early warnings before risky posture is expected.',
      importance: AndroidImportance.HIGH,
      vibration: false,
    },
    {
      id: PREDICTION_SOUND_CHANNEL_ID,
      name: 'Predicted posture risk with sound',
      description: 'Game-style early warnings for predicted posture risk.',
      importance: AndroidImportance.HIGH,
      vibration: false,
      sound: 'sitsync_game_alert',
    },
  ]);
}

export async function startAndroidMonitoring(): Promise<void> {
  if (Platform.OS !== 'android' || BackgroundService.isRunning()) return;
  await initializePostureNotifications();
  await BackgroundService.start(monitoringTask, {
    taskName: 'SitSyncMonitoring',
    taskTitle: 'SitSync posture monitoring',
    taskDesc: 'Four sensors are connected and posture alerts are active.',
    taskIcon: {
      name: 'ic_launcher',
      type: 'mipmap',
    },
    color: '#22d3ee',
    foregroundServiceType: ['connectedDevice'],
  });
}

export async function stopAndroidMonitoring(): Promise<void> {
  if (Platform.OS === 'android' && BackgroundService.isRunning()) {
    await BackgroundService.stop();
  }
}

export async function showPostureSystemNotification(
  alert: PostureAlert,
  payload?: PosturePayload,
  soundEnabled = false,
): Promise<void> {
  if (Platform.OS !== 'android' || alert.level === 'none') return;
  await initializePostureNotifications();
  const detail = buildPostureNotificationBody(alert, payload);
  await notifee.displayNotification({
    id: 'current-posture-alert',
    title: alert.title,
    body: detail,
    android: {
      channelId:
        alert.kind === 'prediction'
          ? soundEnabled
            ? PREDICTION_SOUND_CHANNEL_ID
            : PREDICTION_CHANNEL_ID
          : soundEnabled
            ? ALERT_SOUND_CHANNEL_ID
            : ALERT_CHANNEL_ID,
      smallIcon: 'ic_launcher',
      color: alert.level === 'critical' ? '#ef4444' : '#f59e0b',
      pressAction: { id: 'default' },
    },
  });
}

export function buildPostureNotificationBody(
  alert: PostureAlert,
  payload?: PosturePayload,
): string {
  const rula = payload?.metrics?.rula_score;
  const parts = [alert.detail];
  if (rula != null && !alert.detail.includes('Estimated RULA')) {
    parts.push(`Estimated RULA: ${rula}.`);
  }
  if (!alert.detail.includes('Derived CVA-like')) {
    parts.push(derivedCvaDetail(payload?.metrics?.cva_angle));
  }
  return parts.join(' ');
}
