const TOKEN_KEY = 'sit_sync_token';
const USER_KEY = 'sit_sync_user';

export interface WebUser {
    id: string;
    name: string;
    email: string;
}

export function saveWebSession(token: string, user: WebUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getWebToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function getWebUser(): WebUser | null {
    const stored = localStorage.getItem(USER_KEY);
    if (!stored) return null;
    try {
        const user = JSON.parse(stored) as Partial<WebUser>;
        return typeof user.id === 'string' &&
            typeof user.name === 'string' &&
            typeof user.email === 'string'
            ? { id: user.id, name: user.name, email: user.email }
            : null;
    } catch {
        return null;
    }
}

export function clearWebSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}
