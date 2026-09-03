export const PINNED_PLACES_ROUTE = '/(tabs)/places?view=list&layer=pinned' as const;
export const HANDOFF_FALLBACK_ROUTE = PINNED_PLACES_ROUTE;

interface HandoffRouter {
    canGoBack: () => boolean;
    back: () => void;
    replace: (route: typeof HANDOFF_FALLBACK_ROUTE) => void;
}

export function dismissHandoff(router: HandoffRouter): void {
    if (router.canGoBack()) {
        router.back();
        return;
    }
    router.replace(HANDOFF_FALLBACK_ROUTE);
}
