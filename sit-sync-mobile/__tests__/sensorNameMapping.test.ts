import { mapDevicesByName } from '../src/ble/sensorNameMapping';
import { BodyPosition } from '../src/types';

const names: Record<BodyPosition, string> = {
  neck: 'SitSync-Neck',
  lower_back: 'SitSync-LowerBack',
  left_shoulder: 'SitSync-LeftShoulder',
  right_shoulder: 'SitSync-RightShoulder',
};

describe('mapDevicesByName', () => {
  it('maps fixed BLE names to their body positions', () => {
    const mapped = mapDevicesByName(
      [
        { id: '3', name: 'SitSync-LeftShoulder', rssi: -60 },
        { id: '1', name: 'SitSync-Neck', rssi: -50 },
        { id: '4', name: 'SitSync-RightShoulder', rssi: -62 },
        { id: '2', name: 'SitSync-LowerBack', rssi: -55 },
      ],
      names,
    );

    expect(mapped.neck?.id).toBe('1');
    expect(mapped.lower_back?.id).toBe('2');
    expect(mapped.left_shoulder?.id).toBe('3');
    expect(mapped.right_shoulder?.id).toBe('4');
  });

  it('matches names without case sensitivity and leaves missing sensors empty', () => {
    const mapped = mapDevicesByName(
      [{ id: '1', name: 'sitsync-neck', rssi: null }],
      names,
    );

    expect(mapped.neck?.id).toBe('1');
    expect(mapped.lower_back).toBeUndefined();
  });
});
