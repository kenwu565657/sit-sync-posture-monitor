import { BODY_POSITIONS, BodyPosition } from '../types';
import type { BleScanDevice } from './bleGateway';

export function mapDevicesByName(
  devices: BleScanDevice[],
  expectedNames: Record<BodyPosition, string>,
): Partial<Record<BodyPosition, BleScanDevice>> {
  const mapped: Partial<Record<BodyPosition, BleScanDevice>> = {};
  for (const position of BODY_POSITIONS) {
    const expected = expectedNames[position].trim().toLocaleLowerCase();
    mapped[position] = devices.find(
      (device) => device.name.trim().toLocaleLowerCase() === expected,
    );
  }
  return mapped;
}
