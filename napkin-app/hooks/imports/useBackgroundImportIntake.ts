import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/providers/AuthProvider';
import {
    ensureBackgroundImportIntake,
    flushBackgroundImportRevocations,
    setBackgroundImportOwner,
} from '@/lib/backgroundImportIntake';
import { pokeImportQueue } from '@/lib/importQueue';
import { onBackgroundImportTransfer } from '@/modules/media-extract';

/** Root-mounted lifecycle; no screen must be open to provision URL intake. */
export function useBackgroundImportIntake(): void {
    const { session, isLoading } = useAuth();
    const userId = session?.user.id;
    const refresh = useCallback(() => {
        if (isLoading) return;
        setBackgroundImportOwner(userId);
        // The local queue remains available if a registration/revocation request
        // fails. Retry on foreground rather than prompting or blocking app entry.
        void flushBackgroundImportRevocations().catch(() => {});
        if (userId) void ensureBackgroundImportIntake(userId).catch(() => {});
    }, [isLoading, userId]);

    useEffect(() => {
        refresh();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') refresh();
        });
        const unsubscribeTransfer = onBackgroundImportTransfer(() => pokeImportQueue());
        return () => {
            subscription.remove();
            unsubscribeTransfer();
        };
    }, [refresh]);
}
