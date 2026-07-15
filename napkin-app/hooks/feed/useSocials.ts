/**
 * useSocials — the "on socials" For You module read (TICKET-189).
 *
 * Backed by the feed-socials edge fn: stage-1 global candidate cache (1h TTL
 * lives SERVER-SIDE only) + stage-2 per-viewer live privacy pass (blocks both
 * directions, public→private flips, self-exclusion). Because stage 2 is
 * viewer-dependent, this query is VIEWER-KEYED and PRIVACY-FRESH:
 *
 *   - staleTime: 0 + refetchOnMount: 'always' — every mount re-runs the
 *     viewer pass (the server candidate cache keeps that cheap).
 *   - refetchOnWindowFocus: true — meaningful because the app-wide AppState →
 *     focusManager bridge (lib/focusBridge.ts, mounted in
 *     ConnectivityProvider) fires focus on foreground. A saver who blocked
 *     the viewer (or flipped private) while the app was backgrounded is gone
 *     on foreground without a manual refresh.
 *   - gcTime: default (30 min) retained — cached rows still render offline
 *     (§6: offline with cached data keeps module content visible).
 *
 * NEVER add a client staleTime here to "help" performance — the 1h TTL lives
 * in stage 1 (socials_cache) ONLY; this viewer-filtered read must stay live.
 *
 * Flag-gated: FOR_YOU_SOCIALS off → enabled:false (the query never fires; the
 * arbiter drops the block).
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { FOR_YOU_SOCIALS } from '@/constants/flags';

/** One socials card — counts-or-creator-content only; never a Napkin saver. */
export interface SocialsCard {
    restaurant_id: string;
    name: string;
    neighborhood: string | null;
    rung: 1 | 2 | 3;
    window: 'week' | 'month' | null;
    count: number | null;
    platform: 'tiktok' | 'instagram' | 'socials';
    /** Platform creator handle (rung-3 provenance) — never the saver. */
    creator_handle: string | null;
    /** Durable clip_thumbs storage URL, or null → degrade down the chain. */
    thumb_url: string | null;
    photo_url: string | null;
    photo_source: string | null;
    attribution_html: string | null;
}

async function fetchSocials(): Promise<SocialsCard[]> {
    // callEdgeFn strips the outer { data } envelope → { rows, kicker } here.
    const data = await callEdgeFn<{ rows: SocialsCard[] }>('feed-socials', {
        body: {},
    });
    return data?.rows ?? [];
}

export function useSocials(userId: string | null | undefined) {
    return useQuery<SocialsCard[], Error>({
        queryKey: queryKeys.feed.socials(userId ?? ''),
        queryFn: fetchSocials,
        enabled: !!userId && FOR_YOU_SOCIALS,
        // Privacy-fresh (see header) — do not add staleTime.
        staleTime: 0,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
    });
}
