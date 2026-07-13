export type ReviewFolioMode = 'photos' | 'writing' | 'ledger';

interface ReviewWritingState {
    content?: string | null;
    dishDescription?: string | null;
    hasCategoryRatings: boolean;
    ownerEditing: boolean;
    isEditingNote: boolean;
    isEditingDish: boolean;
    isEditingBreakdown: boolean;
}

export function hasReviewWriting({
    content,
    dishDescription,
    hasCategoryRatings,
    ownerEditing,
    isEditingNote,
    isEditingDish,
    isEditingBreakdown,
}: ReviewWritingState): boolean {
    return Boolean(
        content?.trim() ||
            dishDescription?.trim() ||
            hasCategoryRatings ||
            ownerEditing ||
            isEditingNote ||
            isEditingDish ||
            isEditingBreakdown,
    );
}

export function getReviewFolioMode(hasPhotos: boolean, hasWriting: boolean): ReviewFolioMode {
    if (hasPhotos) return 'photos';
    if (hasWriting) return 'writing';
    return 'ledger';
}
