/**
 * focusBridge — the AppState → TanStack Query focusManager bridge (TICKET-189).
 *
 * WHY THIS EXISTS (Codex P1, design review R2): `refetchOnWindowFocus` is
 * INERT on React Native — TanStack's focusManager relies on the browser
 * `visibilitychange` event, which RN lacks, and nothing in Napkin ever called
 * `focusManager.setFocused` (ConnectivityProvider only bridges NetInfo to
 * onlineManager). So any query that opted into focus revalidation silently
 * never revalidated — a privacy bug for the socials module, whose stage-2
 * viewer pass (blocks / public→private flips) must re-run when the app
 * foregrounds, not an hour later.
 *
 * Wired ONCE app-wide (ConnectivityProvider mounts it), which also makes any
 * other query's local `refetchOnWindowFocus: true` override meaningful. The
 * global default stays `refetchOnWindowFocus: false` (lib/queryClient.ts), so
 * this bridge changes behavior ONLY for queries that explicitly opt in.
 *
 * 'active' → focused; 'background'/'inactive' → unfocused (the background→
 * active transition is what fires the focus refetch).
 */
import { AppState, type AppStateStatus } from 'react-native';
import { focusManager } from '@tanstack/react-query';

/** Exported for tests — the pure state mapping. */
export function applyAppStateFocus(status: AppStateStatus): void {
    focusManager.setFocused(status === 'active');
}

/**
 * Subscribe the focusManager to AppState. Returns the unsubscribe. Mount once
 * (ConnectivityProvider); safe to call again in isolated tests.
 */
export function bindQueryFocusToAppState(): () => void {
    const sub = AppState.addEventListener('change', applyAppStateFocus);
    return () => sub.remove();
}
