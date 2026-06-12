/**
 * Composer pure helpers — payload builders + utility functions extracted
 * from create-entry.tsx for jest coverage.
 *
 * These functions have zero React / UI dependencies so they run
 * cleanly in a node test environment.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface ComposerPhotoSlot {
    publicUrl: string | null;
}

export interface ComposerBreakdown {
    vibe: number;
    flavor: number;
    service: number;
    value: number;
}

export interface ComposerCompanion {
    user_id: string;
}

/** State slice fed to buildEntryPayload (solo/table entries). */
export interface SoloEntryState {
    rating: number;
    notes: string;
    /**
     * TICKET-075: dish removed from the logger UI. Kept optional here so older
     * callers / tests don't break; the live loggers no longer set it.
     */
    dish?: string;
    selectedTableIds: string[];
    visitedAt: Date;
    photos: ComposerPhotoSlot[];
    breakdown: ComposerBreakdown;
    selectedCompanions?: ComposerCompanion[];
    /** TICKET-075: Letterboxd-style like — distinct from the rating. */
    liked?: boolean;
}

export interface SoloEntryPayload {
    rating: number;
    content?: string;
    dish_description?: string;
    table_ids: string[];
    visibility: 'table' | 'private';
    visited_at: string;
    photo_urls?: string[];
    companion_ids?: string[];
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    /** TICKET-075: like flag, always present (false when not hearted). */
    liked: boolean;
}

/** State slice fed to buildRoundPayload (round/group entries). */
export interface RoundEntryState {
    rating: number;
    notes: string;
    dish: string;
    photos: ComposerPhotoSlot[];
    breakdown: ComposerBreakdown;
    selectedParticipantIds: string[];
}

export interface RoundEntryPayload {
    rating: number;
    notes?: string;
    dish_description?: string;
    photo_urls?: string[];
    participant_ids: string[];
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function secondaryFromBreakdown(breakdown: ComposerBreakdown) {
    return {
        vibe_rating: breakdown.vibe > 0 ? breakdown.vibe : null,
        flavor_rating: breakdown.flavor > 0 ? breakdown.flavor : null,
        service_rating: breakdown.service > 0 ? breakdown.service : null,
        value_rating: breakdown.value > 0 ? breakdown.value : null,
    };
}

function uploadedUrls(photos: ComposerPhotoSlot[]): string[] {
    return photos.filter(p => p.publicUrl !== null).map(p => p.publicUrl as string);
}

// ── buildEntryPayload ─────────────────────────────────────────────────────

/**
 * Build the frozen solo/table entry payload.
 *
 * Invariants (frozen — do NOT change):
 *   - table_ids[] is passed through as-is (multi-Table TICKET-043 contract)
 *   - visibility = 'table' when ≥1 table, else 'private'
 *   - rating is rounded to half-steps
 *   - photo_urls omitted when no uploaded photos
 *   - secondaryRatings keys are null when sub-score is 0
 *   - companion_ids omitted when no companions
 */
export function buildEntryPayload(state: SoloEntryState): SoloEntryPayload {
    const ratingValue = Math.round(state.rating * 2) / 2;
    const photoUrls = uploadedUrls(state.photos);

    const payload: SoloEntryPayload = {
        rating: ratingValue,
        table_ids: state.selectedTableIds,
        visibility: state.selectedTableIds.length > 0 ? 'table' : 'private',
        visited_at: state.visitedAt.toISOString(),
        liked: state.liked ?? false,
        ...secondaryFromBreakdown(state.breakdown),
    };

    if (state.notes.trim()) payload.content = state.notes.trim();
    if (state.dish?.trim()) payload.dish_description = state.dish.trim();
    if (photoUrls.length > 0) payload.photo_urls = photoUrls;
    if (state.selectedCompanions && state.selectedCompanions.length > 0) {
        payload.companion_ids = state.selectedCompanions.map(c => c.user_id);
    }

    return payload;
}

// ── buildRoundPayload ─────────────────────────────────────────────────────

/**
 * Build the round-mode submit payload.
 * Uses `notes` (not `content`) and `participant_ids` instead of `table_ids`.
 */
export function buildRoundPayload(state: RoundEntryState): RoundEntryPayload {
    const ratingValue = Math.round(state.rating * 2) / 2;
    const photoUrls = uploadedUrls(state.photos);

    const payload: RoundEntryPayload = {
        rating: ratingValue,
        participant_ids: state.selectedParticipantIds,
        ...secondaryFromBreakdown(state.breakdown),
    };

    if (state.notes.trim()) payload.notes = state.notes.trim();
    if (state.dish.trim()) payload.dish_description = state.dish.trim();
    if (photoUrls.length > 0) payload.photo_urls = photoUrls;

    return payload;
}

// ── toggleTableId ─────────────────────────────────────────────────────────

/**
 * Toggle a table id in an array: add when absent, remove when present.
 * Preserves order, guarantees no duplicates.
 */
export function toggleTableId(ids: string[], id: string): string[] {
    if (ids.includes(id)) {
        return ids.filter(x => x !== id);
    }
    return [...ids, id];
}

// ── ratingDescriptor ──────────────────────────────────────────────────────

/**
 * Map a 0–5 (half-step) rating to a Heirloom Journal adjective.
 * Returns empty string for rating ≤ 0.
 */
const RATING_DESCRIPTORS: Array<[number, string]> = [
    [5, 'Outstanding'],
    [4.5, 'Really good'],
    [4, 'Good'],
    [3.5, 'Pretty good'],
    [3, 'Fair'],
    [2.5, 'Decent'],
    [2, 'Below average'],
    [1.5, 'Not great'],
    [0.5, 'Disliked'],
];

export function ratingDescriptor(rating: number): string {
    if (rating <= 0) return '';
    for (const [threshold, label] of RATING_DESCRIPTORS) {
        if (rating >= threshold) return label;
    }
    return '';
}
