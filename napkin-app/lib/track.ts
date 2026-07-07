/**
 * track — TICKET-088 loop-metrics events (the launch gate).
 *
 * Fire-and-forget by contract: tracking must NEVER block or break UX, so every
 * path swallows errors. Events buffer in memory and flush as one batched
 * insert (500ms debounce + on app-foreground), straight into public.events via
 * the user's own session (insert-own RLS; reads are service-role scripts only
 * — see scripts/metrics.sql).
 *
 * Rules (ticket): no PII in props, no third-party SDK.
 * (TICKET-121 sanctioned exception: Sentry, wired separately in lib/sentry.ts —
 * track.ts itself still imports no SDK.)
 */
import { AppState } from 'react-native';
import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';

// No client timestamp on purpose (review P1): the server default now() stamps
// rows, so a skewed device clock can't corrupt the D1/D7/D30 cohort math.
// Batch order is preserved by array order; day-level granularity is all the
// gate metrics need.
interface PendingEvent {
    name: string;
    props: Record<string, unknown>;
}

// TICKET-121: stamp every event with the app version so "which build broke"
// is answerable from the events table. Merged at flush time — props stays the
// same jsonb column, no schema change.
function readVersionProps(): Record<string, unknown> {
    try {
        const out: Record<string, unknown> = {};
        const version = Constants.expoConfig?.version;
        const build = Constants.expoConfig?.ios?.buildNumber;
        if (version) out.app_version = version;
        if (build) out.app_build = build;
        return out;
    } catch {
        return {};
    }
}
const versionProps = readVersionProps();

const queue: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_DELAY_MS = 500;
const MAX_QUEUE = 100; // runaway guard — drop oldest beyond this

async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user?.id;
        if (!userId) return; // signed out — drop silently (no PII orphan rows)
        await supabase.from('events').insert(
            batch.map((e) => ({
                user_id: userId,
                name: e.name,
                props: { ...e.props, ...versionProps },
            })),
        );
    } catch {
        // Fire-and-forget: a lost event is always better than a broken flow.
    }
}

function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
    }, FLUSH_DELAY_MS);
}

// Flush whatever's buffered when the app comes back to the foreground (and
// opportunistically when it backgrounds, before iOS suspends the JS thread).
// Registered lazily on first track() — module-load side effects break jest
// suites that mock react-native without AppState.
let appStateHooked = false;
function hookAppState(): void {
    if (appStateHooked) return;
    appStateHooked = true;
    try {
        AppState.addEventListener('change', (state) => {
            if (state === 'active' || state === 'background') void flush();
        });
    } catch {
        /* test envs / partial mocks — debounce flush still covers us */
    }
}

/** Immediate flush — for fatal-error paths where the debounce would never fire. */
export function flushNow(): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    void flush();
}

/** Record a loop event. Synchronous from the caller's perspective; never throws. */
export function track(name: string, props: Record<string, unknown> = {}): void {
    try {
        hookAppState();
        queue.push({ name, props });
        if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
        scheduleFlush();
    } catch {
        /* never throw */
    }
}

/**
 * Record a client error (render crash, fatal JS error) as an event so
 * production breakage is visible in our own table — there is no crash SDK yet.
 * Truncated hard; no user content ever goes in.
 */
export function trackError(error: unknown, context: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    track('client_error', {
        context,
        message: (err.message ?? '').slice(0, 300),
        stack: (err.stack ?? '').slice(0, 1200),
    });
}
