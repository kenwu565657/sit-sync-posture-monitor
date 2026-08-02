const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const defaultApiUrl = import.meta.env.DEV
    ? 'http://localhost:8787'
    : window.location.origin;

const apiBaseUrl = trimTrailingSlash(
    import.meta.env.VITE_API_BASE_URL?.trim() || defaultApiUrl,
);

const defaultWebSocketUrl = apiBaseUrl.replace(/^http/, 'ws');

const positiveNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const env = Object.freeze({
    apiBaseUrl,
    webSocketUrl: trimTrailingSlash(
        import.meta.env.VITE_WS_URL?.trim() || defaultWebSocketUrl,
    ),
    heartbeatIntervalMs: positiveNumber(
        import.meta.env.VITE_WS_HEARTBEAT_INTERVAL_MS,
        25_000,
    ),
    staleAfterMs: positiveNumber(
        import.meta.env.VITE_WS_STALE_AFTER_MS,
        15_000,
    ),
});

export const apiUrl = (path: string) =>
    `${env.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
