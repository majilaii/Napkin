import {
    MAX_PROFILE_QUICK_TAKES,
    patchProfileQuickTakes,
    toProfileQuickTakeInputs,
    trimQuickTakeNote,
    type ProfileQuickTake,
} from '../profileQuickTakes';
import type { UserProfileResult } from '@/hooks/users/useUserProfile';

const take = (index: number): ProfileQuickTake => ({
    prompt_key: index % 2 === 0 ? 'best_value' : 'best_pub',
    position: index + 4,
    restaurant_id: `r-${index}`,
    name: `Restaurant ${index}`,
    city: 'London',
    cuisine: null,
    photo_url: null,
    note: index === 0 ? '  keep it simple  ' : null,
});

describe('profile quick take helpers', () => {
    it('truncates notes by code point, not UTF-16 code unit', () => {
        const input = `${'🍜'.repeat(140)}extra`;
        const output = trimQuickTakeNote(input);
        expect(Array.from(output)).toHaveLength(140);
        expect(output).toBe('🍜'.repeat(140));
    });

    it('caps at six, compacts positions, and trims empty notes', () => {
        const output = toProfileQuickTakeInputs(Array.from({ length: 8 }, (_, index) => take(index)));
        expect(output).toHaveLength(MAX_PROFILE_QUICK_TAKES);
        expect(output.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(output[0].note).toBe('keep it simple');
        expect(output[1].note).toBeNull();
    });

    it('patches only the nested profile result and leaves the snapshot untouched', () => {
        const previous = {
            data: { quick_takes: [take(0)] },
            isNotFound: false,
        } as UserProfileResult;
        const nextTakes = [take(1)];
        const patched = patchProfileQuickTakes(previous, nextTakes)!;

        expect(patched).not.toBe(previous);
        expect(patched.data?.quick_takes?.[0].restaurant_id).toBe('r-1');
        expect(patched.data?.quick_takes?.[0].position).toBe(1);
        expect(previous.data?.quick_takes?.[0].restaurant_id).toBe('r-0');
    });
});
