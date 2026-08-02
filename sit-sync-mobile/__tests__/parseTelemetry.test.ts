import { parseBleTelemetry } from '../src/ble/parseTelemetry';

describe('parseBleTelemetry', () => {
  it('parses compact CSV frames', () => {
    const raw =
      'N:0.98,0.17,0,0;B:0.99,0.08,0,0;L:1,0,0,0;R:1,0,0,0;CVA:55.5';
    const payload = parseBleTelemetry(raw, 'test_device');

    expect(payload).not.toBeNull();
    expect(payload?.device_id).toBe('test_device');
    expect(payload?.metrics?.cva_angle).toBe(55.5);
    expect(payload?.sensors.neck.quat.w).toBeCloseTo(0.98);
    expect(payload?.sensors.lower_back.quat.x).toBeCloseTo(0.08);
  });

  it('parses JSON frames', () => {
    const raw = JSON.stringify({
      sensors: {
        neck: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        lower_back: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        left_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
        right_shoulder: { quat: { w: 1, x: 0, y: 0, z: 0 } },
      },
      metrics: { cva_angle: 60 },
    });

    const payload = parseBleTelemetry(raw);
    expect(payload?.metrics?.cva_angle).toBe(60);
    expect(payload?.timestamp).toBeGreaterThan(0);
  });

  it('keeps compact frames valid when CVA is absent or malformed', () => {
    const base =
      'N:1,0,0,0;B:1,0,0,0;L:1,0,0,0;R:1,0,0,0';

    expect(parseBleTelemetry(base)?.metrics).toBeUndefined();
    expect(parseBleTelemetry(`${base};CVA:unknown`)?.metrics).toBeUndefined();
  });
});
