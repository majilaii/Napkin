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

export function meanRating(values: number[]): number | null {
    return values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
}

export function buildFriendsSpread(cohort: FriendsCohortMember[]): {
    bins: number[];
    mode: number | null;
    visible: boolean;
} {
    const bins = new Array(10).fill(0);
    for (const member of cohort) {
        const clamped = Math.max(0.5, Math.min(5, member.rating));
        const index = Math.round(clamped * 2) - 1;
        bins[index] += 1;
    }
    const max = Math.max(...bins);
    const modeIndex = max > 0 ? bins.findIndex((count) => count === max) : -1;
    return {
        bins,
        mode: modeIndex >= 0 ? (modeIndex + 1) / 2 : null,
        visible: cohort.length >= 3,
    };
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
            if (a.visited_at !== b.visited_at) return a.visited_at < b.visited_at ? 1 : -1;
            return b.entry_id.localeCompare(a.entry_id);
        });
    }

    let tableId = requestedTableId && groups.has(requestedTableId)
        ? requestedTableId
        : null;
    if (!tableId) {
        tableId = [...groups.entries()]
            .sort(([idA, rowsA], [idB, rowsB]) => {
                const dateA = rowsA[0]?.visited_at ?? '';
                const dateB = rowsB[0]?.visited_at ?? '';
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

export function monthLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
}
