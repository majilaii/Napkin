export function isListOnlyImportOutcome(pinWishlist: boolean, ghost: number): boolean {
    return pinWishlist === false && ghost > 0;
}

export function importCompletionToastCopy(input: {
    queued: number;
    saved: number;
    ghost: number;
    done: number;
    listOnly: boolean;
    fastPathName: string | null;
    truncationNote: string | null;
    listNoun: string;
    singleSpotName: string | null;
    spotCount: number;
}): string {
    const {
        queued,
        saved,
        ghost,
        done,
        listOnly,
        fastPathName,
        truncationNote,
        listNoun,
        singleSpotName,
        spotCount,
    } = input;
    if (queued > 0) {
        return `${queued} ${queued === 1 ? 'spot is' : 'spots are'} completing…`;
    }
    if (saved > 0) {
        if (fastPathName) return `pinned ${fastPathName}`;
        if (truncationNote) return `pinned ${saved} · ${truncationNote}`;
        return `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`;
    }
    if (listOnly) {
        return ghost === 1 && spotCount === 1 && singleSpotName
            ? `saved ${singleSpotName} to ${listNoun}`
            : `saved ${ghost} to ${listNoun}`;
    }
    // Wishlist-routed ghosts are fresh pins, not re-drains — say so.
    if (ghost > 0) {
        return ghost === 1 && spotCount === 1 && singleSpotName
            ? `pinned ${singleSpotName}`
            : `pinned ${ghost} ${ghost === 1 ? 'spot' : 'spots'}`;
    }
    if (done > 0) {
        return truncationNote
            ? `already in your wishlist · ${truncationNote}`
            : 'already in your wishlist';
    }
    return "couldn't import that";
}
