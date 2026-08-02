import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = '@sitsync/mobile-session/v1';

export interface MobileSession {
  token: string;
  user: {
    id: string;
    name: string;
  };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<MobileSession> {
  const response = await fetch(endpoint(baseUrl, '/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Login failed'));
  }
  const body = (await response.json()) as {
    token?: unknown;
    user?: { id?: unknown; name?: unknown };
  };
  if (
    typeof body.token !== 'string' ||
    typeof body.user?.id !== 'string' ||
    typeof body.user.name !== 'string'
  ) {
    throw new Error('Server returned an invalid login response');
  }
  const session: MobileSession = {
    token: body.token,
    user: { id: body.user.id, name: body.user.name },
  };
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function loadSession(): Promise<MobileSession | null> {
  const stored = await AsyncStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as MobileSession;
    return typeof session.token === 'string' &&
      typeof session.user?.id === 'string' &&
      typeof session.user.name === 'string'
      ? session
      : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function enrollGateway(
  baseUrl: string,
  userToken: string,
  deviceId: string,
): Promise<string> {
  const response = await fetch(endpoint(baseUrl, '/api/auth/device/enroll'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(
        response,
        `Gateway enrollment failed (${response.status})`,
      ),
    );
  }
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string') {
    throw new Error('Enrollment response did not include a device token');
  }
  return body.access_token;
}

export async function resetPostureCalibration(
  baseUrl: string,
  userToken: string,
  deviceId: string,
): Promise<string> {
  const response = await fetch(endpoint(baseUrl, '/api/calibration/reset'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, 'Could not set normal posture'),
    );
  }
  const body = (await response.json()) as { instruction?: unknown };
  return typeof body.instruction === 'string'
    ? body.instruction
    : 'Sit upright and remain still for 5 seconds.';
}
