import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    PROFILE_TAKE_PROMPT_KEYS,
    replaceProfileTakes,
    validateProfileTakes,
} from './profileTakes.ts';

const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';

Deno.test('profile takes: accepts the stable prompt bank and restaurant reuse', () => {
    assertEquals(PROFILE_TAKE_PROMPT_KEYS.length, 10);
    assertEquals(validateProfileTakes([
        { prompt_key: 'best_value', position: 1, restaurant_id: R1, note: '  Lunch set.  ' },
        { prompt_key: 'best_curry', position: 2, restaurant_id: R1 },
        { prompt_key: 'date_night', position: 3, restaurant_id: R2, note: null },
    ]), {
        ok: true,
        takes: [
            { prompt_key: 'best_value', position: 1, restaurant_id: R1, note: 'Lunch set.' },
            { prompt_key: 'best_curry', position: 2, restaurant_id: R1, note: null },
            { prompt_key: 'date_night', position: 3, restaurant_id: R2, note: null },
        ],
    });
});

Deno.test('profile takes: empty array clears and six is the cap', () => {
    assertEquals(validateProfileTakes([]), { ok: true, takes: [] });
    const seven = Array.from({ length: 7 }, (_, i) => ({
        prompt_key: PROFILE_TAKE_PROMPT_KEYS[i],
        position: i + 1,
        restaurant_id: R1,
    }));
    assertEquals(validateProfileTakes(seven), { ok: false, message: 'takes must have at most 6 elements' });
});

Deno.test('profile takes: rejects unknown/duplicate prompts and gapped positions', () => {
    assertEquals(validateProfileTakes([
        { prompt_key: 'best_breakfast', position: 1, restaurant_id: R1 },
    ]), { ok: false, message: 'invalid profile take prompt_key: best_breakfast' });

    assertEquals(validateProfileTakes([
        { prompt_key: 'best_value', position: 1, restaurant_id: R1 },
        { prompt_key: 'best_value', position: 2, restaurant_id: R2 },
    ]), { ok: false, message: 'duplicate prompt_key in takes' });

    assertEquals(validateProfileTakes([
        { prompt_key: 'best_value', position: 1, restaurant_id: R1 },
        { prompt_key: 'best_pub', position: 3, restaurant_id: R2 },
    ]), { ok: false, message: 'take positions must be contiguous 1..2' });
});

Deno.test('profile takes: note cap counts Unicode code points and trims empty notes', () => {
    assertEquals(validateProfileTakes([
        { prompt_key: 'best_value', position: 1, restaurant_id: R1, note: ' '.repeat(4) },
    ]), {
        ok: true,
        takes: [{ prompt_key: 'best_value', position: 1, restaurant_id: R1, note: null }],
    });

    assertEquals(validateProfileTakes([
        { prompt_key: 'best_value', position: 1, restaurant_id: R1, note: '🍜'.repeat(141) },
    ]), { ok: false, message: 'take note must be at most 140 characters' });
});

Deno.test('profile takes: handler seam validates then calls the atomic RPC exactly', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const runRpc: Parameters<typeof replaceProfileTakes>[0] = (name, args) => {
        calls.push({ name, args });
        return Promise.resolve({ error: null });
    };

    const input = [
        { prompt_key: 'best_value', position: 1, restaurant_id: R1, note: '  Lunch.  ' },
    ];
    assertEquals(await replaceProfileTakes(runRpc, 'user-1', input), { ok: true });
    assertEquals(calls, [{
        name: 'set_user_profile_takes',
        args: {
            p_user_id: 'user-1',
            p_takes: [{
                prompt_key: 'best_value',
                position: 1,
                restaurant_id: R1,
                note: 'Lunch.',
            }],
        },
    }]);

    assertEquals(await replaceProfileTakes(runRpc, 'user-1', [
        { prompt_key: 'unknown', position: 1, restaurant_id: R1 },
    ]), {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'invalid profile take prompt_key: unknown',
    });
    assertEquals(calls.length, 1);
});

Deno.test('profile takes: handler seam maps RPC errors to the stable envelope', async () => {
    const runRpc: Parameters<typeof replaceProfileTakes>[0] = () =>
        Promise.resolve({ error: { message: 'database unavailable' } });
    assertEquals(await replaceProfileTakes(runRpc, 'user-1', [
        { prompt_key: 'best_value', position: 1, restaurant_id: R1 },
    ]), {
        ok: false,
        code: 'RPC_ERROR',
        message: 'database unavailable',
    });
});
