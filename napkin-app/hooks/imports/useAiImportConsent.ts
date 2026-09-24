/**
 * The signed-in user's answer to "read imports with the model provider?"
 * (TICKET-250, lib/aiConsent). `allowed` is undefined until the stored answer
 * is read; it follows grants and withdrawals made anywhere in the app.
 */
import { useCallback, useEffect, useState } from 'react';

import {
    hasAiImportConsent,
    requestAiImportConsent,
    setAiImportConsent,
    subscribeAiImportConsent,
} from '@/lib/aiConsent';

export function useAiImportConsent(userId: string | null | undefined) {
    const [allowed, setAllowedState] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        let alive = true;
        const read = () => {
            void hasAiImportConsent(userId).then((value) => {
                if (alive) setAllowedState(value);
            });
        };
        read();
        const unsubscribe = subscribeAiImportConsent(read);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, [userId]);

    /** Ask (or confirm an existing grant). Resolves to the answer. */
    const request = useCallback(async () => (await requestAiImportConsent(userId)).granted, [userId]);

    /** Grant or withdraw directly, from Settings. */
    const setAllowed = useCallback(async (value: boolean) => {
        if (userId) await setAiImportConsent(userId, value);
    }, [userId]);

    return { allowed, request, setAllowed };
}
