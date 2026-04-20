/**
 * useCheckUsername — debounced username uniqueness check.
 *
 * Used by the first-flip warning modal and username editor.
 * Exposes a mutateAsync call (not useQuery) so it can be triggered
 * on blur or button press, not on every keystroke.
 */
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type CheckUsernameResult = {
    available: boolean;
    reason?: 'invalid_format';
};

async function checkUsername(username: string): Promise<CheckUsernameResult> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'check_username', username },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data as CheckUsernameResult;
}

export function useCheckUsername() {
    return useMutation<CheckUsernameResult, Error, string>({
        mutationFn: (username: string) => checkUsername(username),
    });
}
