import { Platform } from 'react-native';
import Config from 'react-native-config';
import type { BodyPosition } from './types';

export interface SitSyncEnvironment {
  httpUrl?: string;
  wsUrl?: string;
  userId?: string;
  deviceCredential?: string;
}

const injected = (
  globalThis as typeof globalThis & {
    __SITSYNC_CONFIG__?: SitSyncEnvironment;
  }
).__SITSYNC_CONFIG__;
const developmentHost =
  Platform.OS === 'android' ? '10.0.2.2:8787' : 'localhost:8787';

export const SERVER_HTTP_URL =
  injected?.httpUrl ??
  Config.SITSYNC_HTTP_URL ??
  (__DEV__ ? `http://${developmentHost}` : '');
export const SERVER_WS_URL =
  injected?.wsUrl ??
  Config.SITSYNC_WS_URL ??
  (__DEV__ ? `ws://${developmentHost}` : '');
export const USER_ID =
  injected?.userId ?? Config.SITSYNC_USER_ID ?? '';
export const DEVICE_CREDENTIAL =
  injected?.deviceCredential ?? Config.SITSYNC_DEVICE_CREDENTIAL ?? '';
export const ALLOW_INSECURE_HTTP =
  Config.SITSYNC_ALLOW_INSECURE_HTTP?.toLowerCase() === 'true';

export function validateEnvironment(): string | null {
  if (!SERVER_HTTP_URL || !SERVER_WS_URL) {
    return 'SITSYNC_HTTP_URL and SITSYNC_WS_URL are required';
  }
  const hasTls =
    SERVER_HTTP_URL.startsWith('https://') && SERVER_WS_URL.startsWith('wss://');
  if (!__DEV__ && !ALLOW_INSECURE_HTTP && !hasTls) {
    return 'Production telemetry requires HTTPS and WSS';
  }
  const validDemoSchemes =
    SERVER_HTTP_URL.startsWith('http://') && SERVER_WS_URL.startsWith('ws://');
  if (!hasTls && !validDemoSchemes) {
    return 'Endpoint protocols must be HTTPS/WSS or HTTP/WS';
  }
  return null;
}

export const TELEMETRY_HZ = 10;

/** Nordic UART Service used by firmware/firmware.ino (Bluefruit BLEUart). */
export const BLE_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const HARDWARE_SAMPLE_HZ = TELEMETRY_HZ;

/** Fixed BLE names used by one-button sensor assignment. */
export const SENSOR_DEVICE_NAMES: Record<BodyPosition, string> = {
  neck: Config.SITSYNC_BLE_NECK_NAME ?? 'SitSync-Neck',
  lower_back: Config.SITSYNC_BLE_LOWER_BACK_NAME ?? 'SitSync-LowerBack',
  left_shoulder:
    Config.SITSYNC_BLE_LEFT_SHOULDER_NAME ?? 'SitSync-LeftShoulder',
  right_shoulder:
    Config.SITSYNC_BLE_RIGHT_SHOULDER_NAME ?? 'SitSync-RightShoulder',
};
