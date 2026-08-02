import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SENSOR_PLACEMENT_MODES,
  SensorPlacementMode,
} from '../types';

const STORAGE_KEY = '@sitsync/sensor-placement/v1';
export const DEFAULT_SENSOR_PLACEMENT_MODE: SensorPlacementMode = 'shoulder_top';

export function isSensorPlacementMode(
  value: unknown,
): value is SensorPlacementMode {
  return (
    typeof value === 'string' &&
    SENSOR_PLACEMENT_MODES.includes(value as SensorPlacementMode)
  );
}

export async function loadSensorPlacementMode(): Promise<SensorPlacementMode> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return isSensorPlacementMode(stored)
    ? stored
    : DEFAULT_SENSOR_PLACEMENT_MODE;
}

export async function saveSensorPlacementMode(
  mode: SensorPlacementMode,
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, mode);
}
