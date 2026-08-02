import { PostureAlert } from '../src/alerts/postureAlert';
import { buildPostureNotificationBody } from '../src/background/androidMonitoring';
import { PosturePayload } from '../src/types';

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannels: jest.fn(),
    displayNotification: jest.fn(),
  },
  AndroidImportance: { HIGH: 4 },
}));

jest.mock('react-native-background-actions', () => ({
  __esModule: true,
  default: {
    isRunning: jest.fn(() => false),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));

describe('Android posture notification detail', () => {
  const alert: PostureAlert = {
    level: 'warning',
    kind: 'prediction',
    title: 'Posture warning',
    detail: 'Posture risk is rising.',
  };

  it('includes estimated RULA and labeled derived CVA-like context', () => {
    expect(
      buildPostureNotificationBody(
        alert,
        payload({ rula_score: 4, cva_angle: 41.56 }),
      ),
    ).toBe(
      'Posture risk is rising. Estimated RULA: 4. Derived CVA-like: 41.6° (lower is worse).',
    );
  });

  it('uses an em dash when derived CVA-like is unavailable', () => {
    expect(buildPostureNotificationBody(alert, payload({}))).toContain(
      'Derived CVA-like: — (lower is worse).',
    );
  });
});

function payload(metrics: PosturePayload['metrics']): PosturePayload {
  const sensor = { quat: { x: 0, y: 0, z: 0, w: 1 } };
  return {
    schema_version: 1,
    timestamp: 1,
    device_id: 'gateway-1',
    user_id: 'user-1',
    sensors: {
      neck: sensor,
      lower_back: sensor,
      left_shoulder: sensor,
      right_shoulder: sensor,
    },
    metrics,
  };
}
