/**
 * useLargeImportKickoffTrigger — routes to the kickoff sheet when a large Maps
 * list finishes enumerating (TICKET-152). Mounted once in RootLayoutNav beside
 * the drain.
 *
 * The drain enumerates a >20 Maps list into a `phase:'kickoff'` job and holds
 * (no Places spend yet). This surfaces that moment: the highest-intent beat a
 * new user has — their want-to-go map migrating in — deserves the sheet up
 * front, not a silent background job.
 *
 * Fires ONCE per job (a `surfaced` ref). If the user backs out without
 * confirming, the job stays in kickoff and is re-enterable via the "start
 * import" CTA on /import-progress — we never re-nag by auto-routing again.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';

import { useActiveImports } from './useActiveImports';

export function useLargeImportKickoffTrigger() {
    const router = useRouter();
    const active = useActiveImports();
    const surfaced = useRef<Set<string>>(new Set());

    useEffect(() => {
        const kickoff = active.find((a) => a.phase === 'kickoff');
        if (!kickoff) return;
        if (surfaced.current.has(kickoff.jobId)) return;
        surfaced.current.add(kickoff.jobId);
        router.push(`/import-kickoff?jobId=${kickoff.jobId}` as any);
    }, [active, router]);
}
