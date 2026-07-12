export const PROFILE_TAKE_PROMPT_KEYS = [
    'best_value',
    'best_pub',
    'best_curry',
    'worth_the_hype',
    'dont_get_the_hype',
    'visitors',
    'date_night',
    'late_night',
    'worth_crossing_town',
    'forever_order',
] as const;

export type ProfileTakePromptKey = typeof PROFILE_TAKE_PROMPT_KEYS[number];

export type ProfileTakeInput = {
    prompt_key: ProfileTakePromptKey;
    position: number;
    restaurant_id: string;
    note: string | null;
};

type ValidationResult =
    | { ok: true; takes: ProfileTakeInput[] }
    | { ok: false; message: string };

const PROMPT_KEYS = new Set<string>(PROFILE_TAKE_PROMPT_KEYS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edge-layer validation for fast, stable error envelopes. The database RPC
 * repeats every invariant so replacement remains atomic and safe if another
 * trusted service calls it later.
 */
export function validateProfileTakes(input: unknown): ValidationResult {
    if (!Array.isArray(input)) return { ok: false, message: 'takes must be an array' };
    if (input.length > 6) return { ok: false, message: 'takes must have at most 6 elements' };

    const takes: ProfileTakeInput[] = [];
    const prompts = new Set<string>();
    const positions = new Set<number>();

    for (const raw of input) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { ok: false, message: 'each take must be an object' };
        }
        const take = raw as Record<string, unknown>;
        const promptKey = take.prompt_key;
        const position = take.position;
        const restaurantId = take.restaurant_id;

        if (typeof promptKey !== 'string' || !PROMPT_KEYS.has(promptKey)) {
            return { ok: false, message: `invalid profile take prompt_key: ${String(promptKey)}` };
        }
        if (prompts.has(promptKey)) return { ok: false, message: 'duplicate prompt_key in takes' };
        prompts.add(promptKey);

        if (!Number.isInteger(position) || (position as number) < 1 || (position as number) > input.length) {
            return { ok: false, message: `take positions must be contiguous 1..${input.length}` };
        }
        if (positions.has(position as number)) return { ok: false, message: 'duplicate position in takes' };
        positions.add(position as number);

        if (typeof restaurantId !== 'string' || !UUID.test(restaurantId)) {
            return { ok: false, message: 'take restaurant_id must be a UUID' };
        }

        if (take.note !== undefined && take.note !== null && typeof take.note !== 'string') {
            return { ok: false, message: 'take note must be a string or null' };
        }
        const note = typeof take.note === 'string' ? take.note.trim() : '';
        if ([...note].length > 140) {
            return { ok: false, message: 'take note must be at most 140 characters' };
        }

        takes.push({
            prompt_key: promptKey as ProfileTakePromptKey,
            position: position as number,
            restaurant_id: restaurantId,
            note: note || null,
        });
    }

    return { ok: true, takes };
}

export type ReplaceProfileTakesResult =
    | { ok: true }
    | { ok: false; code: 'BAD_REQUEST' | 'RPC_ERROR'; message: string };

type RunProfileTakesRpc = (
    name: 'set_user_profile_takes',
    args: { p_user_id: string; p_takes: ProfileTakeInput[] },
) => PromiseLike<{ error: { message: string } | null }>;

/**
 * Handler seam for the deployed mutation: validates once, then calls the one
 * atomic SQL write path with the authenticated user id. Kept outside index.ts
 * so the route-to-RPC contract is unit-testable without starting Deno.serve.
 */
export async function replaceProfileTakes(
    runRpc: RunProfileTakesRpc,
    userId: string,
    input: unknown,
): Promise<ReplaceProfileTakesResult> {
    const validation = validateProfileTakes(input);
    if (validation.ok === false) {
        return { ok: false, code: 'BAD_REQUEST', message: validation.message };
    }

    try {
        const { error } = await runRpc('set_user_profile_takes', {
            p_user_id: userId,
            p_takes: validation.takes,
        });
        if (error) {
            return { ok: false, code: 'RPC_ERROR', message: error.message };
        }
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            code: 'RPC_ERROR',
            message: error instanceof Error ? error.message : String(error),
        };
    }
}
