/**
 * useCheckUsername — debounced username uniqueness check.
 *
 * Used by the first-flip warning modal and username editor.
 * Exposes a mutateAsync call (not useQuery) so it can be triggered
 * on blur or button press, not on every keystroke.
 */
import { useMutation } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';

type CheckUsernameResult = {
    available: boolean;
    reason?: 'invalid_format';
};

async function checkUsername(username: string): Promise<CheckUsernameResult> {
    return callEdgeFn<CheckUsernameResult>('user-profile', {
        action: 'check_username',
        body: { username },
    });
}

export function useCheckUsername() {
    return useMutation<CheckUsernameResult, Error, string>({
        mutationFn: (username: string) => checkUsername(username),
    });
}
