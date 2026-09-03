export type LedgerLinePart = {
    kind: 'label' | 'rating' | 'metadata' | 'bridge';
    text: string;
};

export type LedgerLineModel = {
    copy: string;
    parts: LedgerLinePart[];
    visitCount: number;
};

export type LedgerLineInput = {
    youRating: number | null | undefined;
    visitCount: number;
    friendsRating: number | null | undefined;
    friendsCount: number;
};

function displayRating(value: number | null | undefined): string | null {
    if (value == null || !Number.isFinite(value)) return null;
    return Math.max(0.5, Math.min(5, value)).toFixed(1);
}

export function formatLedgerLine({
    youRating,
    visitCount,
    friendsRating,
    friendsCount,
}: LedgerLineInput): LedgerLineModel | null {
    const visits = Math.max(0, Math.floor(visitCount));
    const friendCohortSize = Math.max(0, Math.floor(friendsCount));
    const friendAverage = friendCohortSize > 0 ? displayRating(friendsRating) : null;
    const parts: LedgerLinePart[] = [];

    if (visits > 0) {
        parts.push({ kind: 'label', text: 'you' });
        const selfRating = displayRating(youRating);
        if (selfRating) parts.push({ kind: 'rating', text: selfRating });
        parts.push({
            kind: 'metadata',
            text: `· ${visits} visit${visits === 1 ? '' : 's'}`,
        });
    }

    if (friendAverage) {
        if (parts.length > 0) parts.push({ kind: 'bridge', text: '·' });
        parts.push(
            { kind: 'label', text: 'friends' },
            { kind: 'rating', text: friendAverage },
            { kind: 'metadata', text: `· ${friendCohortSize} been` },
        );
    }

    if (parts.length === 0) return null;
    return {
        copy: parts.map((part) => part.text).join(' '),
        parts,
        visitCount: visits,
    };
}
