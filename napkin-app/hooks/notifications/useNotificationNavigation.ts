import { useEffect, useRef, useState } from 'react';
import { addNotificationResponseListener, configureNotifications, getInitialNotificationUrl } from '@/lib/localNotify';

/** Retain a launching tap until authentication and onboarding can accept it. */
export function useNotificationNavigation(ready: boolean, open: (url: string) => void) {
    const [pendingUrl, setPendingUrl] = useState<string | null>(null);
    const openRef = useRef(open);
    openRef.current = open;
    useEffect(() => {
        let mounted = true;
        let receivedLiveTap = false;
        configureNotifications();
        const unsubscribe = addNotificationResponseListener((url) => {
            receivedLiveTap = true;
            setPendingUrl(url);
        });
        void getInitialNotificationUrl().then((url) => {
            if (mounted && !receivedLiveTap && url) setPendingUrl(url);
        });
        return () => { mounted = false; unsubscribe(); };
    }, []);
    useEffect(() => {
        if (!ready || !pendingUrl) return;
        setPendingUrl(null);
        openRef.current(pendingUrl);
    }, [ready, pendingUrl]);
}
