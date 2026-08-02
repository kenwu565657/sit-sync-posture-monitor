import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearSession,
  enrollGateway,
  loadSession,
  login,
  resetPostureCalibration,
} from '../src/auth/mobileSession';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('mobileSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs in and persists the user session', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'user-token',
          user: { id: 'user-1', name: 'Alex' },
        }),
      }),
    });

    const session = await login(
      'http://localhost:8787',
      'alex@example.com',
      'password123',
    );

    expect(session.user.id).toBe('user-1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@sitsync/mobile-session/v1',
      JSON.stringify(session),
    );
  });

  it('enrolls the generated gateway with the user token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'device-token' }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });

    await expect(
      enrollGateway('http://localhost:8787', 'user-token', 'mobile-123'),
    ).resolves.toBe('device-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/auth/device/enroll',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer user-token',
        }),
      }),
    );
  });

  it('loads and clears a stored session', async () => {
    const session = {
      token: 'token',
      user: { id: 'user-1', name: 'Alex' },
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify(session),
    );

    await expect(loadSession()).resolves.toEqual(session);
    await clearSession();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@sitsync/mobile-session/v1',
    );
  });

  it('resets normal posture using the authenticated user', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instruction: 'Sit upright and remain still for 5 seconds.',
      }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });

    await expect(
      resetPostureCalibration(
        'http://localhost:8787',
        'user-token',
        'mobile-123',
      ),
    ).resolves.toContain('remain still');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/calibration/reset',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer user-token',
        }),
        body: JSON.stringify({ device_id: 'mobile-123' }),
      }),
    );
  });
});
