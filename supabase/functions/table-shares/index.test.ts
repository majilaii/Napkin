/**
 * Tests for table-shares edge function utilities.
 *
 * Run with: deno test --allow-env supabase/functions/table-shares/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { isUuid } from './utils.ts';

Deno.test('isUuid — correct action restaurant_id guard', async (t) => {
    await t.step('accepts a Napkin restaurant UUID (any case)', () => {
        assertEquals(isUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), true);
        assertEquals(isUuid('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'), true);
    });

    await t.step('rejects a Google Place id — the CorrectModal regression', () => {
        // The wishlist CorrectModal used to send the raw text-search result id
        // (a Places id) as restaurant_id; the RPC's uuid coercion 500ed and the
        // correction silently no-oped. handleCorrect must 400 this shape.
        assertEquals(isUuid('ChIJN1t_tDeuEmsRUsoyG83frY4'), false);
    });

    await t.step('rejects non-string / malformed input', () => {
        assertEquals(isUuid(undefined), false);
        assertEquals(isUuid(null), false);
        assertEquals(isUuid(42), false);
        assertEquals(isUuid(''), false);
        assertEquals(isUuid('a1b2c3d4e5f67890abcdef1234567890'), false); // no dashes
        assertEquals(isUuid('a1b2c3d4-e5f6-7890-abcd-ef123456789'), false); // short
        assertEquals(isUuid('ghijklmn-e5f6-7890-abcd-ef1234567890'), false); // non-hex
    });
});
