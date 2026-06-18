/**
 * usePendingReviewImports — resolved review-mode imports awaiting confirmation.
 *
 * Backs the wishlist "to review" band. Reads the App-Group import queue on mount,
 * on foreground, and whenever the queue is poked (the drain pokes after it
 * resolves a review manifest, so the band appears live).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { listReviewPendingImports, onImportEnqueued, type ImportManifest } from '@/lib/importQueue';

export function usePendingReviewImports(): ImportManifest[] {
    const { session } = useAuth();
    const userId = session?.user?.id;
    const [items, setItems] = useState<ImportManifest[]>([]);

    const refresh = useCallback(() => {
        setItems(listReviewPendingImports(userId));
    }, [userId]);

    useEffect(() => {
        refresh();
        const sub = AppState.addEventListener('change', (s) => {
            if (s === 'active') refresh();
        });
        const unsub = onImportEnqueued(() => refresh());
        return () => {
            sub.remove();
            unsub();
        };
    }, [refresh]);

    return items;
}
