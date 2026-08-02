import AsyncStorage from '@react-native-async-storage/async-storage';

const ALERT_SOUND_KEY = 'sit-sync.alert-sound-enabled';

export async function loadAlertSoundEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ALERT_SOUND_KEY)) === 'true';
}

export async function saveAlertSoundEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ALERT_SOUND_KEY, String(enabled));
}
