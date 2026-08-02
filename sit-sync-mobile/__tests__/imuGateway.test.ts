import {
  parseBinaryImuTelemetry,
  parseImuTelemetry,
} from '../src/ble/parseImuTelemetry';
import { SensorFrameAggregator } from '../src/ble/sensorFrameAggregator';
import { BODY_POSITIONS, BodyPosition, ImuSample } from '../src/types';

describe('firmware IMU telemetry', () => {
  it('parses one fixed 20-byte binary quaternion packet', () => {
    const packet = new Uint8Array(20);
    const view = new DataView(packet.buffer);
    packet.set([0x53, 0x53, 1, 3]);
    view.setUint32(4, 42, true);
    view.setUint32(8, 987, true);
    view.setInt16(12, Math.round(0.1 * 32767), true);
    view.setInt16(14, Math.round(0.2 * 32767), true);
    view.setInt16(16, Math.round(0.3 * 32767), true);
    view.setInt16(18, Math.round(0.927 * 32767), true);

    const parsedSample = parseBinaryImuTelemetry(
      packet,
      'device-id',
      'SitSync-Neck',
      'neck',
      1234,
    );

    expect(parsedSample).toMatchObject({
      schemaVersion: 1,
      timestamp: 1234,
      sensorTimestamp: 987,
      sequence: 42,
      accuracy: 3,
      deviceId: 'device-id',
      deviceName: 'SitSync-Neck',
      sensorId: 'SitSync-Neck',
      position: 'neck',
    });
    expect(parsedSample?.raw).toMatch(/^binary:[0-9a-f]{40}$/);
    expect(parsedSample?.quaternion.x).toBeCloseTo(0.1, 4);
    expect(parsedSample?.quaternion.y).toBeCloseTo(0.2, 4);
    expect(parsedSample?.quaternion.z).toBeCloseTo(0.3, 4);
    expect(parsedSample?.quaternion.w).toBeCloseTo(0.927, 4);
  });

  it('rejects malformed binary packets', () => {
    expect(
      parseBinaryImuTelemetry(
        new Uint8Array(19),
        'id',
        'SitSync-Neck',
        'neck',
      ),
    ).toBeNull();

    const wrongMagic = new Uint8Array(20);
    wrongMagic.set([0, 0, 1, 3]);
    expect(
      parseBinaryImuTelemetry(wrongMagic, 'id', 'SitSync-Neck', 'neck'),
    ).toBeNull();
  });

  it('parses a versioned quaternion packet', () => {
    const parsedSample = parseImuTelemetry(
      '{"v":1,"sensor":"Device05","seq":42,"ts":987,"accuracy":3,"q":{"x":0.1,"y":0.2,"z":0.3,"w":0.927}}',
      'device-id',
      'Device05',
      'neck',
      1234,
    );

    expect(parsedSample).toEqual({
      schemaVersion: 1,
      timestamp: 1234,
      sensorTimestamp: 987,
      sequence: 42,
      accuracy: 3,
      raw: '{"v":1,"sensor":"Device05","seq":42,"ts":987,"accuracy":3,"q":{"x":0.1,"y":0.2,"z":0.3,"w":0.927}}',
      deviceId: 'device-id',
      deviceName: 'Device05',
      sensorId: 'Device05',
      position: 'neck',
      quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.927 },
    });
  });

  it('rejects incomplete or non-numeric payloads', () => {
    expect(
      parseImuTelemetry('{"v":1}', 'id', 'Device01', 'neck'),
    ).toBeNull();
    expect(
      parseImuTelemetry(
        '{"v":2,"sensor":"Device01","ts":2,"q":{"x":0,"y":0,"z":0,"w":1}}',
        'id',
        'Device01',
        'neck',
      ),
    ).toBeNull();
  });
});

describe('four-sensor frame aggregation', () => {
  it('emits a clocked snapshot from four fresh samples', () => {
    const aggregator = new SensorFrameAggregator('gateway-1', 'user-1');
    aggregator.add(sample('neck', 1000));
    aggregator.add(sample('lower_back', 1010));
    aggregator.add(sample('left_shoulder', 1020));
    expect(aggregator.snapshot(1030)).toBeNull();
    aggregator.add(sample('right_shoulder', 1030));

    const frame = aggregator.snapshot(1100);
    expect(frame?.timestamp).toBe(1100);
    expect(frame).toMatchObject({
      schema_version: 1,
      device_id: 'gateway-1',
      user_id: 'user-1',
      sensors: {
        neck: { quat: { x: 0, y: 0, z: 0, w: 1 } },
      },
    });

    expect(aggregator.snapshot(1200)).not.toBeNull();
  });

  it('suppresses snapshots when any sensor sample is stale', () => {
    const aggregator = new SensorFrameAggregator('gateway-1', 'user-1', 250);
    for (const position of BODY_POSITIONS) {
      aggregator.add(sample(position, 1000));
    }
    expect(aggregator.snapshot(1250)).not.toBeNull();
    expect(aggregator.snapshot(1251)).toBeNull();
  });

  it('contains every required body position', () => {
    expect(BODY_POSITIONS).toEqual([
      'neck',
      'lower_back',
      'left_shoulder',
      'right_shoulder',
    ]);
  });
});

function sample(position: BodyPosition, timestamp: number): ImuSample {
  return {
    schemaVersion: 1,
    timestamp,
    sensorTimestamp: timestamp,
    sequence: timestamp,
    accuracy: 3,
    raw: '',
    position,
    deviceId: position,
    deviceName: `Device-${position}`,
    sensorId: `Device-${position}`,
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
}

