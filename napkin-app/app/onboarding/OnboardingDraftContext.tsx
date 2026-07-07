/**
 * OnboardingDraftContext (TICKET-126).
 *
 * The onboarding stack grew from 3 → 5 screens (Name → Photo → City → Follows →
 * Teach) with a conditional middle step, which makes the old name→city→teach
 * route-param chain fragile (a 4-hop chain carrying a long avatar_url, plus a
 * step that's sometimes skipped). This tiny Context lives at the stack _layout
 * so every screen reads/writes one draft; teach.tsx stays a thin complete()
 * caller (TICKET-122 will replace that screen, so it must not own the state).
 *
 * Not persisted — onboarding is a single uninterrupted session; the atomic
 * complete_onboarding write is the only durable sink.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface OnboardingDraft {
    display_name: string;
    avatar_url: string | null;
    home_city: string | null;
}

interface OnboardingDraftContextValue {
    draft: OnboardingDraft;
    patch: (partial: Partial<OnboardingDraft>) => void;
}

const OnboardingDraftContext = createContext<OnboardingDraftContextValue | null>(null);

const EMPTY_DRAFT: OnboardingDraft = {
    display_name: '',
    avatar_url: null,
    home_city: null,
};

export function OnboardingDraftProvider({ children }: { children: React.ReactNode }) {
    const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);

    const patch = useCallback((partial: Partial<OnboardingDraft>) => {
        setDraft((prev) => ({ ...prev, ...partial }));
    }, []);

    const value = useMemo(() => ({ draft, patch }), [draft, patch]);

    return (
        <OnboardingDraftContext.Provider value={value}>
            {children}
        </OnboardingDraftContext.Provider>
    );
}

export function useOnboardingDraft(): OnboardingDraftContextValue {
    const ctx = useContext(OnboardingDraftContext);
    if (!ctx) {
        throw new Error('useOnboardingDraft must be used within OnboardingDraftProvider');
    }
    return ctx;
}
