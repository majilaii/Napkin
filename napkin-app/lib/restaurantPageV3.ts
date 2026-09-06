import { visitDateLabel, visitOrderDate } from '@/lib/visitDates';
import { todaysHoursLine } from '@/lib/restaurantHours';
import type {
    PublicReviewCard,
    RestaurantPageData,
    RestaurantPageRestaurant,
    TableNoteRow,
} from '@/hooks/restaurants/useRestaurantPage';

export type FriendsCohortMember = {
    user_id: string;
    rating: number;
    review: PublicReviewCard;
};

export function deriveFriendsCohort(
    reviews: PublicReviewCard[],
    viewerUserId: string | null | undefined,
): FriendsCohortMember[] {
    const byUser = new Map<string, FriendsCohortMember>();
    for (const review of reviews) {
        if (!review.is_followee || review.user_id === viewerUserId || byUser.has(review.user_id)) {
            continue;
        }
        if (!Number.isFinite(review.rating)) continue;
        byUser.set(review.user_id, {
            user_id: review.user_id,
            rating: Math.max(0.5, Math.min(5, Number(review.rating))),
            review,
        });
    }
    return [...byUser.values()];
}

/** How many public review cards the restaurant page previews before the folio doorway. */
export const REVIEW_PREVIEW_COUNT = 3;

/**
 * Cards for the REVIEWS preview: followee cards first, then any other public
 * review, never the viewer's own, deduped by entry, capped at REVIEW_PREVIEW_COUNT.
 */
export function previewReviews(
    cohort: FriendsCohortMember[],
    reviews: PublicReviewCard[],
    viewerUserId: string | null | undefined,
): PublicReviewCard[] {
    const seen = new Set<string>();
    const picked: PublicReviewCard[] = [];
    for (const review of [...cohort.map((member) => member.review), ...reviews]) {
        if (seen.has(review.entry_id) || review.user_id === viewerUserId) continue;
        if (!review.note_excerpt?.trim()) continue;
        seen.add(review.entry_id);
        picked.push(review);
        if (picked.length === REVIEW_PREVIEW_COUNT) break;
    }
    return picked;
}

export function meanRating(values: number[]): number | null {
    return values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
}

export type SpreadRing = 'friends' | 'napkin';

export type RestaurantSpread = {
    bins: number[];
    mode: number | null;
    visible: boolean;
    ring: SpreadRing;
    count: number;
};

/** Minimum ratings before a ring paints bars; below it the histogram is noise. */
export const SPREAD_FRIENDS_MIN = 3;
export const SPREAD_NAPKIN_MIN = 2;

function spreadFromBins(bins: number[], ring: SpreadRing, count: number, min: number): RestaurantSpread {
    const max = Math.max(...bins);
    const modeIndex = max > 0 ? bins.findIndex((value) => value === max) : -1;
    return {
        bins,
        mode: modeIndex >= 0 ? (modeIndex + 1) / 2 : null,
        visible: count >= min,
        ring,
        count,
    };
}

export function buildFriendsSpread(cohort: FriendsCohortMember[]): RestaurantSpread {
    const bins = new Array(10).fill(0);
    for (const member of cohort) {
        const clamped = Math.max(0.5, Math.min(5, member.rating));
        const index = Math.round(clamped * 2) - 1;
        bins[index] += 1;
    }
    return spreadFromBins(bins, 'friends', cohort.length, SPREAD_FRIENDS_MIN);
}

/**
 * The histogram the founder asked back (2026-09-06): friends when at least three
 * followees rated, otherwise every visible Napkin rating at this restaurant
 * (`distributions_half.napkin`, ten half-star bins gated server-side by
 * `fn_visible_entry_ids`). Hidden only when both rings are too thin.
 */
export function buildRestaurantSpread(
    cohort: FriendsCohortMember[],
    napkinBins: number[] | null | undefined,
): RestaurantSpread {
    const friends = buildFriendsSpread(cohort);
    if (friends.visible) return friends;
    const bins = Array.isArray(napkinBins) && napkinBins.length === 10
        ? napkinBins.map((value) => Math.max(0, Math.floor(Number(value) || 0)))
        : new Array(10).fill(0);
    const count = bins.reduce((sum, value) => sum + value, 0);
    return spreadFromBins(bins, 'napkin', count, SPREAD_NAPKIN_MIN);
}

export function formatGoogleRatingCount(count: number | null): string {
    if (!count) return 'no ratings';
    if (count >= 1000) {
        const compact = (count / 1000).toFixed(1).replace(/\.0$/, '');
        return `${compact}k ratings`;
    }
    return `${count} rating${count === 1 ? '' : 's'}`;
}

export function deriveNumberTiers(
    page: RestaurantPageData | undefined,
    viewerUserId: string | null | undefined,
) {
    const friends = deriveFriendsCohort(page?.public_reviews ?? [], viewerUserId);
    const selfCount = page?.self_log?.length ?? page?.personal?.visit_count ?? 0;
    const personalAverage = page?.personal?.average;
    return {
        you: {
            value: personalAverage == null ? null : Math.max(0.5, Math.min(5, personalAverage)),
            meta: `${selfCount} visit${selfCount === 1 ? '' : 's'}`,
        },
        friends: {
            value: meanRating(friends.map((friend) => friend.rating)),
            meta: `${friends.length} been`,
        },
        friendsCohort: friends,
    };
}

export function restaurantClosingTime(
    hours: RestaurantPageRestaurant['hours'],
    date: Date,
): string | null {
    const line = todaysHoursLine(hours, date);
    if (!line || line === 'closed' || line.includes('open 24 hours')) return null;
    const normalized = line.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const pieces = normalized.split(/\s*[–-]\s*/);
    const raw = pieces.at(-1)?.trim() ?? '';
    const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
    if (!match) return raw || null;
    let hour = Number(match[1]);
    const minute = match[2] ?? '00';
    const meridiem = match[3].toLowerCase();
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${minute}`;
}

export function buildRestaurantPhotoMeta(
    restaurant: RestaurantPageRestaurant,
): string {
    const price = restaurant.price_level == null
        ? null
        : '£'.repeat(Math.max(1, Math.min(4, restaurant.price_level)));
    return [
        restaurant.cuisine?.toLowerCase() || null,
        restaurant.city?.toLowerCase() || null,
        price,
    ].filter((part): part is string => !!part).join(' · ');
}

/** The no-photo masthead keeps its pre-TICKET-235 open-status copy unchanged. */
export function buildRestaurantMeta(
    restaurant: RestaurantPageRestaurant,
    date: Date = new Date(),
    openNow?: boolean | null,
): string {
    const core = buildRestaurantPhotoMeta(restaurant);
    const closes = restaurantClosingTime(restaurant.hours, date);
    return [
        core || null,
        closes && openNow === true ? `open until ${closes}` : null,
    ].filter((part): part is string => !!part).join(' · ');
}

export type TableNotesGroup = {
    table_id: string;
    table_name: string;
    rows: TableNoteRow[];
    visibleRows: TableNoteRow[];
};

export function chooseTableNotesGroup(
    rows: TableNoteRow[],
    requestedTableId?: string | null,
): TableNotesGroup | null {
    const groups = new Map<string, TableNoteRow[]>();
    for (const row of rows) {
        const group = groups.get(row.table_id) ?? [];
        group.push(row);
        groups.set(row.table_id, group);
    }
    if (groups.size === 0) return null;

    for (const groupRows of groups.values()) {
        groupRows.sort((a, b) => {
            if (visitOrderDate(a) !== visitOrderDate(b)) return visitOrderDate(a) < visitOrderDate(b) ? 1 : -1;
            return b.entry_id.localeCompare(a.entry_id);
        });
    }

    let tableId = requestedTableId && groups.has(requestedTableId)
        ? requestedTableId
        : null;
    if (!tableId) {
        tableId = [...groups.entries()]
            .sort(([idA, rowsA], [idB, rowsB]) => {
                const dateA = visitOrderDate(rowsA[0] ?? {});
                const dateB = visitOrderDate(rowsB[0] ?? {});
                if (dateA !== dateB) return dateA < dateB ? 1 : -1;
                return idA.localeCompare(idB);
            })[0][0];
    }
    const groupRows = groups.get(tableId)!;
    return {
        table_id: tableId,
        table_name: groupRows[0]?.table_name ?? '',
        rows: groupRows,
        visibleRows: groupRows.slice(0, 2),
    };
}

export function monthLabel(date: string | null): string {
    return visitDateLabel(date, { month: 'short' }, 'en-US').toLowerCase();
}
