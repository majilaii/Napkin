/**
 * Structured JSON-line logger for the critics ingest scraper.
 * TICKET-033
 *
 * Each log call emits one JSON object per line to stdout/stderr.
 * GitHub Actions log viewer renders these well; future log-shipping is trivial.
 *
 * Usage:
 *   const logger = createLogger('some-run-id');
 *   logger.info('Scraping restaurant', { restaurant_id, publication });
 *   logger.error('Parse failed', { url, err: err.message });
 */

export interface LogEntry {
    run_id: string;
    ts: string;
    level: 'info' | 'warn' | 'error';
    msg: string;
    [key: string]: unknown;
}

export interface Logger {
    info(msg: string, extra?: Record<string, unknown>): void;
    warn(msg: string, extra?: Record<string, unknown>): void;
    error(msg: string, extra?: Record<string, unknown>): void;
    runId: string;
}

export function createLogger(runId: string): Logger {
    function emit(level: LogEntry['level'], msg: string, extra?: Record<string, unknown>) {
        const entry: LogEntry = {
            run_id: runId,
            ts: new Date().toISOString(),
            level,
            msg,
            ...extra,
        };
        // Use stderr for errors so they appear highlighted in Actions
        const stream = level === 'error' ? console.error : console.log;
        stream(JSON.stringify(entry));
    }

    return {
        runId,
        info: (msg, extra) => emit('info', msg, extra),
        warn: (msg, extra) => emit('warn', msg, extra),
        error: (msg, extra) => emit('error', msg, extra),
    };
}

/** Generates a short unique run ID for a scrape run. */
export function generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
