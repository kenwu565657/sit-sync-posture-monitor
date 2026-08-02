/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('test-gateway'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => ({
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    connectToDevice: jest.fn(),
    cancelDeviceConnection: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock('../src/net/telemetrySocket', () => ({
  TelemetrySocket: jest.fn().mockImplementation(() => ({
    onStateChange: jest.fn(),
    onTelemetry: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    setHost: jest.fn(),
    send: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn(),
  })),
}));

jest.mock('../src/background/androidMonitoring', () => ({
  requestNotificationPermission: jest.fn().mockResolvedValue(true),
  showPostureSystemNotification: jest.fn().mockResolvedValue(undefined),
  startAndroidMonitoring: jest.fn().mockResolvedValue(undefined),
  stopAndroidMonitoring: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/components/PilotRecordingCard', () => ({
  PilotRecordingCard: () => null,
}));

jest.mock('../src/auth/mobileSession', () => ({
  clearSession: jest.fn().mockResolvedValue(undefined),
  enrollGateway: jest.fn().mockResolvedValue('device-token'),
  loadSession: jest.fn().mockResolvedValue({
    token: 'user-token',
    user: { id: 'user-1', name: 'Test User' },
  }),
  login: jest.fn(),
}));

test('renders correctly', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await ReactTestRenderer.act(async () => {
    renderer.unmount();
  });
});
