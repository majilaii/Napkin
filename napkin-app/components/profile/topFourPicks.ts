/**
 * topFourPicks — pure payload builder for the profile Top-4 save (TICKET-144 pt2).
 *
 * Extracted so the write-path consent contract is unit-tested, not eyeballed:
 * each pick carries EXACTLY position · restaurant_id · hero_entry_photo_id —
 * never the preview-only fields (name, hero_photo_url). A slot with a hero sends
 * its photo-row id (publish); a slot without one sends null (typographic /
 * un-publish). The server RPC re-validates that the id is the owner's own photo
 * at that restaurant; this only shapes what the client is allowed to send.
 */
import type { ProfileTopFourPickInput } from '@/hooks/users/useSetProfileTopFour';

export interface TopFourSlotLike {
    restaurant_id: string;
    hero_entry_photo_id: string | null;
}

export function toProfileTopFourPicks(filled: TopFourSlotLike[]): ProfileTopFourPickInput[] {
    return filled.map((d, i) => ({
        position: (i + 1) as 1 | 2 | 3 | 4,
        restaurant_id: d.restaurant_id,
        hero_entry_photo_id: d.hero_entry_photo_id,
    }));
}
