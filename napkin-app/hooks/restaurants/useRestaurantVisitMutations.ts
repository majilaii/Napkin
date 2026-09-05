import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateEntryTasteCaches } from '@/hooks/entries/invalidateEntryTaste';
import type { RestaurantPageData, SelfLogRow } from './useRestaurantPage';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

export type VisitPatch = {
    rating?: number | null;
    content?: string | null;
    visited_at?: string | null;
    photo_urls?: string[];
};
export type SavedVisit = {
    id: string;
    restaurant_id: string;
    created_at: string;
    visited_at: string | null;
    rating: number | null;
    content: string | null;
    photo_url?: string | null;
    photos: { id: string; url: string }[];
    is_bare: boolean;
    supper_id?: string | null;
};
type VisitResult = { entry: SavedVisit; was_dedup?: boolean };
type RecordInput = { client_nonce: string; restaurant_id?: string; restaurant?: RestaurantPayload };

export function useRestaurantVisitMutations(userId: string | undefined, pageId: string) {
    const qc = useQueryClient();
    const patchPage = (entry: SavedVisit | null, entryId: string, restaurantId: string) => {
        qc.setQueriesData<RestaurantPageData>({ queryKey: queryKeys.restaurants.pageAll() }, (page) => {
            if (!page?.restaurant || (![restaurantId, pageId].includes(page.restaurant.id) && page.restaurant.external_id !== pageId)) return page;
            const old = page.self_log ?? [];
            const previous = old.find((row) => row.entry_id === entryId);
            const rows = old.filter((row) => row.entry_id !== entryId);
            if (entry) rows.push({
                ...previous, id: previous?.id ?? `entry:${entry.id}`, entry_id: entry.id, table_night_id: null, source: 'solo',
                created_at: entry.created_at, visited_at: entry.visited_at, rating: entry.rating,
                note: entry.content, photos: entry.photo_url && !entry.photos.some((photo) => photo.url === entry.photo_url)
                    ? [{ id: `hero:${entry.id}`, url: entry.photo_url }, ...entry.photos] : entry.photos, is_bare: entry.is_bare,
                supper_id: entry.supper_id ?? null, companions: previous?.companions ?? [],
            } as SelfLogRow);
            return { ...page, self_log: rows, personal: { ...page.personal, visit_count: rows.length } };
        });
    };
    const reconcile = (entryId: string, restaurantId: string) => {
        if (!userId) return;
        invalidateEntryTasteCaches(qc, userId, { restaurantId });
        // The open route may still be the Places ID that was just persisted.
        qc.invalidateQueries({ queryKey: queryKeys.restaurants.page(pageId) });
        const keys = [
            queryKeys.entries.detail(entryId), queryKeys.entryDetail.photos(entryId),
            queryKeys.entryDetail.publicEligibility(entryId), queryKeys.entries.mySolo(userId),
            queryKeys.entries.list(userId), queryKeys.entries.forDayAll(userId),
            queryKeys.feed.rootAll(), queryKeys.tables.activityAll(),
            queryKeys.members.profileAll(), queryKeys.atlas.all(),
            queryKeys.users.diary(userId), queryKeys.users.reviews(userId),
            queryKeys.users.restaurantPhotos(userId, restaurantId),
            queryKeys.users.networkMapPins(userId), queryKeys.restaurants.peekCardForRestaurant(userId, restaurantId),
            queryKeys.topFours.availableCities(userId), queryKeys.topFours.profileEligible(userId),
            queryKeys.notifications.all(userId),
        ];
        for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    };
    const record = useMutation({
        mutationFn: (input: RecordInput) => callEdgeFn<VisitResult>('entry', { action: 'record_visit', body: input }),
        onSuccess: ({ entry }) => { patchPage(entry, entry.id, entry.restaurant_id); reconcile(entry.id, entry.restaurant_id); },
    });
    const save = useMutation({
        mutationFn: (input: { entry_id: string; patch: VisitPatch }) =>
            callEdgeFn<VisitResult>('entry', { action: 'save_visit', body: input }),
        onSuccess: ({ entry }) => { patchPage(entry, entry.id, entry.restaurant_id); reconcile(entry.id, entry.restaurant_id); },
    });
    const undo = useMutation({
        mutationFn: (entryId: string) => callEdgeFn<{ deleted: true; entry_id: string; restaurant_id: string }>('entry', {
            action: 'undo_visit', body: { entry_id: entryId },
        }),
        onSuccess: (result) => { patchPage(null, result.entry_id, result.restaurant_id); reconcile(result.entry_id, result.restaurant_id); },
    });
    return { record, save, undo };
}
