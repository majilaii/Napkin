/**
 * handoffSheetUtils — pure logic for HandoffSheet (TICKET-074).
 *
 * Extracted into a separate module so unit tests can import real implementations
 * without pulling in React Native dependencies (same pattern as candidatePickerUtils).
 *
 * No I/O, no React, no native imports.
 */

/**
 * Map HandoffSheet props → useCreateHandoff input.
 * listId present → per-list share ({ list_id }); absent → wishlist share (undefined).
 */
export function buildCreateInput(listId?: string): { list_id: string } | undefined {
    return listId ? { list_id: listId } : undefined;
}

/**
 * Native share-sheet message. List shares lead with the frozen list name;
 * wishlist shares keep the TICKET-072 copy. URL on its own line so iMessage /
 * WhatsApp unfurl cleanly.
 */
export function buildShareMessage(opts: {
    listName?: string | null;
    count: number;
    shareUrl: string;
}): string {
    const { listName, count, shareUrl } = opts;
    if (listName) {
        return `my ${listName}, folded for you.\n${shareUrl}`;
    }
    return `my napkin — ${count} spot${count !== 1 ? 's' : ''}, folded for you.\n${shareUrl}`;
}

/** Sheet header title: the list name (brand-voice italic serif) or "your napkin". */
export function sheetTitle(listName?: string | null): string {
    return listName || 'your napkin';
}

/**
 * Toast copy when handoff?action=create fails (fix-pass).
 *
 * EMPTY_WISHLIST / EMPTY_LIST mean every pinned spot is still unverified —
 * the snapshot freezes verified spots only, so there is nothing to share yet.
 * Specific journal-voice murmur instead of the generic failure toast.
 * (The affordances gate on verified counts now, but the wishlist hero stays
 * gated on pinned count — accepted pre-existing — so this path is reachable.)
 */
export function createErrorToast(code?: string | null): string {
    if (code === 'EMPTY_WISHLIST' || code === 'EMPTY_LIST') {
        return '— nothing confirmed to share yet. spots need a real match first.';
    }
    return 'could not create share link';
}

/** Primary CTA label: "share this list" for lists, "share my napkin" for the wishlist. */
export function primaryCtaLabel(listName?: string | null): string {
    return listName ? 'share this list' : 'share my napkin';
}
