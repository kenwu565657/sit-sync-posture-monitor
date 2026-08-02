import { USER_ID } from '../config';
import { PosturePayload, Quaternion } from '../types';

function quat(w: number, x: number, y: number, z: number): Quaternion {
  return { w, x, y, z };
}

function parseQuat(parts: string[]): Quaternion | null {
  if (parts.length < 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  return quat(nums[0], nums[1], nums[2], nums[3]);
}

/**
 * Supported BLE text formats from firmware:
 *
 * 1) Compact CSV (preferred for HM-10 MTU):
 *    N:w,x,y,z;B:w,x,y,z;L:w,x,y,z;R:w,x,y,z;CVA:55.0
 *
 * 2) Full JSON matching PosturePayload (with or without timestamp/device_id)
 */
export function parseBleTelemetry(
  raw: string,
  deviceId = '',
  userId = USER_ID,
): PosturePayload | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text) as Partial<PosturePayload>;
      if (!json.sensors?.neck || !json.sensors?.lower_back) return null;
      return {
        schema_version: 1,
        timestamp: json.timestamp ?? Date.now(),
        device_id: json.device_id ?? deviceId,
        user_id: json.user_id ?? userId,
        sensors: {
          neck: json.sensors.neck,
          lower_back: json.sensors.lower_back,
          left_shoulder: json.sensors.left_shoulder ?? { quat: quat(1, 0, 0, 0) },
          right_shoulder: json.sensors.right_shoulder ?? { quat: quat(1, 0, 0, 0) },
        },
        metrics: json.metrics,
      };
    } catch {
      return null;
    }
  }

  // Compact: N:w,x,y,z;B:...;L:...;R:...;CVA:55.0
  const fields = Object.fromEntries(
    text
      .split(';')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const idx = chunk.indexOf(':');
        if (idx === -1) return [chunk, ''];
        return [chunk.slice(0, idx).toUpperCase(), chunk.slice(idx + 1)];
      }),
  ) as Record<string, string>;

  const neck = parseQuat((fields.N ?? '').split(','));
  const back = parseQuat((fields.B ?? '').split(','));
  const left = parseQuat((fields.L ?? '').split(','));
  const right = parseQuat((fields.R ?? '').split(','));

  if (!neck || !back) return null;

  const cva = fields.CVA !== undefined ? Number(fields.CVA) : undefined;

  return {
    schema_version: 1,
    timestamp: Date.now(),
    device_id: deviceId,
    user_id: userId,
    sensors: {
      neck: { quat: neck },
      lower_back: { quat: back },
      left_shoulder: { quat: left ?? quat(1, 0, 0, 0) },
      right_shoulder: { quat: right ?? quat(1, 0, 0, 0) },
    },
    metrics: Number.isFinite(cva) ? { cva_angle: cva } : undefined,
  };
}
