import type { UserProfileResult } from '@/hooks/users/useUserProfile';

export const QUICK_TAKE_PROMPTS = [
    { key: 'best_value', label: 'Best value' },
    { key: 'best_pub', label: 'Best pub' },
    { key: 'best_curry', label: 'Best curry' },
    { key: 'worth_the_hype', label: 'Worth the hype' },
    { key: 'dont_get_the_hype', label: "I don’t get the hype" },
    { key: 'visitors', label: 'Where I take visitors' },
    { key: 'date_night', label: 'Date night' },
    { key: 'late_night', label: 'Late-night rescue' },
    { key: 'worth_crossing_town', label: 'Worth crossing town for' },
    { key: 'forever_order', label: 'My forever order' },
] as const;

export type QuickTakePromptKey = (typeof QUICK_TAKE_PROMPTS)[number]['key'];

export const MAX_PROFILE_QUICK_TAKES = 6;
export const MAX_PROFILE_QUICK_TAKE_NOTE = 140;

export type ProfileQuickTake = {
    prompt_key: QuickTakePromptKey;
    position: number;
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    /** Public-safe Places photo only; the profile API returns null for every other source. */
    photo_url: string | null;
    note: string | null;
};

export type ProfileQuickTakeInput = Pick<
    ProfileQuickTake,
    'prompt_key' | 'position' | 'restaurant_id'
> & {
    note?: string | null;
};

const promptLabels = new Map<QuickTakePromptKey, string>(
    QUICK_TAKE_PROMPTS.map((prompt) => [prompt.key, prompt.label]),
);

export function quickTakePromptLabel(key: QuickTakePromptKey): string {
    return promptLabels.get(key) ?? key;
}

/** Code-point-safe truncation, matching the edge contract for emoji and accents. */
export function trimQuickTakeNote(note: string): string {
    return Array.from(note).slice(0, MAX_PROFILE_QUICK_TAKE_NOTE).join('');
}

export function toProfileQuickTakeInputs(takes: ProfileQuickTake[]): ProfileQuickTakeInput[] {
    return takes.slice(0, MAX_PROFILE_QUICK_TAKES).map((take, index) => ({
        prompt_key: take.prompt_key,
        position: index + 1,
        restaurant_id: take.restaurant_id,
        note: take.note?.trim() || null,
    }));
}

/** Pure cache patch used by the optimistic mutation and its focused tests. */
export function patchProfileQuickTakes(
    previous: UserProfileResult | undefined,
    takes: ProfileQuickTake[],
): UserProfileResult | undefined {
    if (!previous?.data) return previous;
    return {
        ...previous,
        data: {
            ...previous.data,
            quick_takes: takes.map((take, index) => ({ ...take, position: index + 1 })),
        },
    };
}
