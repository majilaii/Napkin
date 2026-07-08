/**
 * peekWho — pure who-row contract for the map peek card (TICKET-140).
 *
 * The peek card's who-row shows who's behind a pin. Three tappable/labelled
 * shapes, mutually exclusive per item (the mappers in mapItems.ts never set more
 * than one of entryId / overlap / gathered on the same item):
 *
 *  - network   — a followee's LOG (entryId present): "«Name»  +N others".
 *                Verb stays a log; the name is the affordance (bold, tappable).
 *  - saved-by  — a single-member table save (overlap.count === 1):
 *                "saved by «Name»" — bold name, tap → that person.
 *  - overlap-many — 2+ members saved it (overlap.count >= 2): "N of you saved
 *                this". No single person → not tappable.
 *
 * `gathered` (group-meal) rows keep their date wording and are rendered by the
 * card directly (they need date formatting); they are not a "who" affordance.
 *
 * Rendering (bold name via nested <Text>, avatar stack, pressable) stays in the
 * component — this module only decides the words + the tap target.
 */

export interface PeekWhoInput {
    /** Presence flips the row to the network (followee's log) variant. */
    entryId?: string;
    author?: { id: string; name: string } | null;
    /** Other distinct followees who also logged here (network variant only). */
    othersCount?: number;
    overlap?: {
        count: number;
        members: { user_id: string; display_name: string | null }[];
    } | null;
}

export type PeekWho =
    | { variant: 'network'; name: string; othersSuffix: string; tapUserId: string | null }
    | { variant: 'saved-by'; name: string; tapUserId: string | null }
    | { variant: 'overlap-many'; label: string }
    | { variant: 'none' };

/** The muted "  +N others" tail after a network author name (empty when none). */
export function networkOthersSuffix(others: number): string {
    if (!others || others <= 0) return '';
    return `  +${others} ${others === 1 ? 'other' : 'others'}`;
}

export function describePeekWho(item: PeekWhoInput): PeekWho {
    if (item.entryId != null) {
        return {
            variant: 'network',
            name: item.author?.name ?? 'Someone',
            othersSuffix: networkOthersSuffix(item.othersCount ?? 0),
            tapUserId: item.author?.id ?? null,
        };
    }
    if (item.overlap != null) {
        const count = item.overlap.count ?? 0;
        if (count >= 2) {
            return { variant: 'overlap-many', label: `${count} of you saved this` };
        }
        const first = item.overlap.members[0];
        return {
            variant: 'saved-by',
            name: first?.display_name ?? 'Someone',
            tapUserId: first?.user_id ?? null,
        };
    }
    return { variant: 'none' };
}
