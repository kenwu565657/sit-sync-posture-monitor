import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@sitsync/device-id/v1';
let cachedDeviceId: string | null = null;

function createDeviceId(): string {
  const random = () => Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, '0');
  return `mobile-${Date.now().toString(36)}-${random()}${random()}`;
}

export async function getStableDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }
  cachedDeviceId = createDeviceId();
  await AsyncStorage.setItem(STORAGE_KEY, cachedDeviceId);
  return cachedDeviceId;
}
