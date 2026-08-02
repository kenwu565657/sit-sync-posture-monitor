import {
  BODY_POSITIONS,
  BodyPosition,
  PosturePayload,
  QuaternionSample,
  SensorPlacementMode,
} from '../types';

export class SensorFrameAggregator {
  private latest: Partial<Record<BodyPosition, QuaternionSample>> = {};

  constructor(
    private deviceId = '',
    private userId = '',
    private readonly maximumSampleAgeMs = 250,
    private mountingMode: SensorPlacementMode = 'shoulder_top',
  ) {}

  setIdentity(deviceId: string, userId: string): void {
    this.deviceId = deviceId;
    this.userId = userId;
  }

  setMountingMode(mode: SensorPlacementMode): void {
    if (mode === this.mountingMode) return;
    this.mountingMode = mode;
    this.reset();
  }

  add(sample: QuaternionSample): void {
    this.latest[sample.position] = sample;
  }

  snapshot(timestamp = Date.now()): PosturePayload | null {
    if (!BODY_POSITIONS.every((position) => this.latest[position])) {
      return null;
    }

    const samples = BODY_POSITIONS.map(
      (position) => this.latest[position] as QuaternionSample,
    );
    if (
      samples.some(
        sample =>
          timestamp < sample.timestamp ||
          timestamp - sample.timestamp > this.maximumSampleAgeMs,
      )
    ) {
      return null;
    }

    return {
      schema_version: 1,
      timestamp,
      device_id: this.deviceId,
      user_id: this.userId,
      mounting_mode: this.mountingMode,
      sensors: {
        neck: { quat: (this.latest.neck as QuaternionSample).quaternion },
        lower_back: {
          quat: (this.latest.lower_back as QuaternionSample).quaternion,
        },
        left_shoulder: {
          quat: (this.latest.left_shoulder as QuaternionSample).quaternion,
        },
        right_shoulder: {
          quat: (this.latest.right_shoulder as QuaternionSample).quaternion,
        },
      },
    };
  }

  remove(position: BodyPosition): void {
    delete this.latest[position];
  }

  reset(): void {
    this.latest = {};
  }
}

