import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const priorities: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredPriority = priorities[config.logLevel as Level] ?? priorities.info;

function write(level: Level, event: string, fields: Record<string, unknown> = {}): void {
    if (priorities[level] < configuredPriority) return;
    const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...fields,
    });
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(entry);
}

export const logger = {
    debug: (event: string, fields?: Record<string, unknown>) => write('debug', event, fields),
    info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};

export function errorFields(error: unknown): Record<string, unknown> {
    return error instanceof Error
        ? { error: error.message, stack: error.stack }
        : { error: String(error) };
}
