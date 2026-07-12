import type { ListEntry } from '@/hooks/lists/useList';

export interface ListMapPin {
    id: string;
    restaurantId: string;
    name: string;
    latitude: number;
    longitude: number;
    rank: number | null;
}

/** Convert hydrated list entries into the small, trustworthy map projection. */
export function buildListMapPins(entries: ListEntry[], ranked: boolean): ListMapPin[] {
    return entries.flatMap((entry, index) => {
        const latitude = entry.restaurant.lat;
        const longitude = entry.restaurant.lng;
        if (
            typeof latitude !== 'number'
            || typeof longitude !== 'number'
            || !Number.isFinite(latitude)
            || !Number.isFinite(longitude)
            || latitude < -90
            || latitude > 90
            || longitude < -180
            || longitude > 180
        ) {
            return [];
        }

        return [{
            id: entry.id,
            restaurantId: entry.restaurant_id,
            name: entry.restaurant.name,
            latitude,
            longitude,
            rank: ranked ? index + 1 : null,
        }];
    });
}
