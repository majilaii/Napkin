/**
 * usePublishCollectionsSnapshot — publishes the user's collections (lists + tables)
 * into the App-Group container so the iOS share EXTENSION can render its
 * destination picker (the extension is a separate process and can't read the
 * app's TanStack cache or Supabase session). TICKET-083 Part B inc3.2.
 *
 * The snapshot carries IDENTIFIERS + display names only — no secrets. The app
 * still does the actual save with its own auth, and the RPCs enforce
 * ownership/membership, so a stale or tampered snapshot can't escalate access.
 *
 * Refreshed whenever the data changes and on every foreground.
 */
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useTables } from '@/hooks/tables/useTables';
import { writeAppGroupSnapshot, isVideoImportAvailable } from '@/modules/media-extract';

export function usePublishCollectionsSnapshot() {
    const { session } = useAuth();
    const userId = session?.user?.id;
    const { data: lists } = useMyLists(userId);
    const { data: memberships } = useTables(userId);

    const publish = useCallback(() => {
        if (!isVideoImportAvailable()) return; // native module absent → skip
        try {
            // Signed out → publish an EMPTY snapshot so the extension can't offer a
            // previous account's lists/tables (which would fail a legit import after
            // an account switch). Signed in → publish this user's collections.
            const snapshot = userId
                ? {
                      userId,
                      lists: (lists ?? []).map((l) => ({ id: l.id, title: l.title })),
                      tables: (memberships ?? []).map((m) => ({
                          id: m.tables.id,
                          name: m.tables.name,
                      })),
                  }
                : { userId: null, lists: [], tables: [] };
            writeAppGroupSnapshot(JSON.stringify(snapshot));
        } catch {
            /* best-effort */
        }
    }, [userId, lists, memberships]);

    // Re-publish whenever the collections change.
    useEffect(() => {
        publish();
    }, [publish]);

    // And on foreground (they may have changed in another session / device).
    useEffect(() => {
        const sub = AppState.addEventListener('change', (s) => {
            if (s === 'active') publish();
        });
        return () => sub.remove();
    }, [publish]);
}
