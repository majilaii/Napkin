import { useEffect, useRef, useState } from 'react';
import { useCreateList, type CreateListInput } from '@/hooks/lists/useCreateList';

export interface ListDraft {
    title: string;
    description: string;
    ranked: boolean;
    privacy: 'public' | 'private';
    emoji: string | null;
}

export function useListComposer({ userId, initial, onCreated, onCancel }: {
    userId: string | null | undefined;
    initial?: Pick<CreateListInput, 'table_id' | 'initial_restaurant_id' | 'initial_restaurant'>;
    onCreated: (id: string) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState<ListDraft>({ title: '', description: '', ranked: false, privacy: 'public', emoji: null });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const viewer = useRef(userId);
    viewer.current = userId;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const create = useCreateList(userId);
    const valid = !!userId && draft.title.trim().length > 0 && draft.title.trim().length <= 60;

    const submit = async () => {
        if (!valid || inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        const submittingUser = userId;
        try {
            const list = await create.mutateAsync({
                ...initial,
                title: draft.title.trim(),
                description: draft.description.trim() || undefined,
                ranked: draft.ranked,
                privacy: initial?.table_id ? 'private' : draft.privacy,
                emoji: draft.emoji,
            });
            if (mounted.current && viewer.current === submittingUser) onCreated(list.id);
        } catch {
            if (mounted.current && viewer.current === submittingUser) setError("Couldn't create this list. Try again.");
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    return {
        draft, busy, error, canSubmit: valid && !busy,
        change: (patch: Partial<ListDraft>) => {
            if (!inFlight.current) setDraft((current) => ({ ...current, ...patch }));
        },
        submit,
        cancel: () => { if (!inFlight.current) onCancel(); },
    };
}
