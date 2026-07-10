/**
 * sentry — TICKET-121 crash/error reporting, gated on EXPO_PUBLIC_SENTRY_DSN.
 *
 * The ONLY module that imports @sentry/react-native for reporting. Everything
 * no-ops until the DSN env var exists (founder activation step), so the app
 * behaves identically with no Sentry account. Errors + sessions only — no
 * performance tracing.
 */
import type { ComponentType } from 'react';

import * as Sentry from '@sentry/react-native';

let initialized = false;

export function initSentry(): void {
    if (initialized) return;
    const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    try {
        Sentry.init({
            dsn,
            sendDefaultPii: false,
            enableAutoSessionTracking: true,
        });
        initialized = true;
    } catch {
        /* reporting must never break the app */
    }
}

export function isSentryEnabled(): boolean {
    return initialized;
}

export function captureError(
    err: unknown,
    ctx?: { context?: string; tags?: Record<string, string> },
): void {
    if (!initialized) return;
    try {
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
            tags: ctx?.tags,
            extra: ctx?.context ? { context: ctx.context } : undefined,
        });
    } catch {
        /* never throw */
    }
}

export function addBreadcrumb(crumb: {
    category: string;
    message: string;
    data?: Record<string, unknown>;
}): void {
    if (!initialized) return;
    try {
        Sentry.addBreadcrumb(crumb);
    } catch {
        /* never throw */
    }
}

/** Wrap the root component when Sentry is live; identity otherwise. */
export function wrapRootComponent<P extends Record<string, unknown>>(
    component: ComponentType<P>,
): ComponentType<P> {
    if (!initialized) return component;
    try {
        return Sentry.wrap(component);
    } catch {
        return component;
    }
}
