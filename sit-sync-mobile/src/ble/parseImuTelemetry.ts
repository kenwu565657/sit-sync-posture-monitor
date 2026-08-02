import { BodyPosition, QuaternionSample } from '../types';

const BINARY_PACKET_SIZE = 20;
const MAGIC_0 = 0x53;
const MAGIC_1 = 0x53;
const QUATERNION_SCALE = 32767;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/**
 * Parse the fixed 20-byte firmware packet. It fits in one notification even
 * at the minimum 23-byte ATT MTU, so samples cannot be partially assembled.
 */
export function parseBinaryImuTelemetry(
  bytes: Uint8Array,
  deviceId: string,
  deviceName: string,
  position: BodyPosition,
  timestamp = Date.now(),
): QuaternionSample | null {
  if (
    bytes.byteLength !== BINARY_PACKET_SIZE ||
    bytes[0] !== MAGIC_0 ||
    bytes[1] !== MAGIC_1 ||
    bytes[2] !== 1 ||
    bytes[3] > 3
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const quaternion = {
    x: view.getInt16(12, true) / QUATERNION_SCALE,
    y: view.getInt16(14, true) / QUATERNION_SCALE,
    z: view.getInt16(16, true) / QUATERNION_SCALE,
    w: view.getInt16(18, true) / QUATERNION_SCALE,
  };
  const magnitude = Math.hypot(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w,
  );
  if (magnitude < 0.5 || magnitude > 1.5) return null;

  return {
    schemaVersion: 1,
    timestamp,
    sensorTimestamp: view.getUint32(8, true),
    sequence: view.getUint32(4, true),
    accuracy: bytes[3],
    raw: `binary:${bytesToHex(bytes)}`,
    deviceId,
    deviceName,
    sensorId: deviceName,
    position,
    quaternion,
  };
}

/**
 * Parse one versioned newline-delimited packet from firmware/firmware.ino.
 * Retained temporarily so the app can still read boards running the previous
 * JSON firmware during migration.
 */
export function parseImuTelemetry(
  raw: string,
  deviceId: string,
  deviceName: string,
  position: BodyPosition,
  timestamp = Date.now(),
): QuaternionSample | null {
  let packet: {
    v?: unknown;
    sensor?: unknown;
    seq?: unknown;
    ts?: unknown;
    accuracy?: unknown;
    q?: { x?: unknown; y?: unknown; z?: unknown; w?: unknown };
  };
  try {
    packet = JSON.parse(raw.trim());
  } catch {
    return null;
  }

  const values = [packet.q?.x, packet.q?.y, packet.q?.z, packet.q?.w];
  if (
    packet.v !== 1 ||
    typeof packet.sensor !== 'string' ||
    !packet.sensor ||
    typeof packet.ts !== 'number' ||
    !Number.isFinite(packet.ts) ||
    typeof packet.seq !== 'number' ||
    !Number.isInteger(packet.seq) ||
    packet.seq < 0 ||
    typeof packet.accuracy !== 'number' ||
    !Number.isInteger(packet.accuracy) ||
    packet.accuracy < 0 ||
    packet.accuracy > 3 ||
    values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    return null;
  }
  const [x, y, z, w] = values as number[];
  const magnitude = Math.hypot(x, y, z, w);
  if (magnitude < 0.5 || magnitude > 1.5) return null;

  return {
    schemaVersion: 1,
    timestamp,
    sensorTimestamp: packet.ts,
    sequence: packet.seq,
    accuracy: packet.accuracy,
    raw: raw.trim(),
    deviceId,
    deviceName,
    sensorId: packet.sensor,
    position,
    quaternion: { x, y, z, w },
  };
}

