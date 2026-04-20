/**
 * Mocked "Around town" trending posters.
 *
 * Temporary: used until we wire a Places-nearby-search endpoint that picks
 * well-rated restaurants close to the user and maps them into TrendingPoster
 * shape. IDs are fake — do not write queries against them.
 *
 * Photos: Unsplash direct CDN URLs with fixed photo IDs (stable).
 */
import type { TrendingPoster } from './useFeed';

export const TOWN_TRENDING_MOCK: TrendingPoster[] = [
    {
        rank: 1,
        restaurant: {
            id: 'mock-dept-culture',
            name: 'Dept. of Culture',
            photo_url: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&q=80',
        },
        logger_count: 42,
        average_rating: 4.7,
    },
    {
        rank: 2,
        restaurant: {
            id: 'mock-brat',
            name: 'Brat',
            photo_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80',
        },
        logger_count: 38,
        average_rating: 4.6,
    },
    {
        rank: 3,
        restaurant: {
            id: 'mock-kiln',
            name: 'Kiln',
            photo_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80',
        },
        logger_count: 34,
        average_rating: 4.5,
    },
    {
        rank: 4,
        restaurant: {
            id: 'mock-st-john',
            name: 'St. JOHN',
            photo_url: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80',
        },
        logger_count: 29,
        average_rating: 4.5,
    },
    {
        rank: 5,
        restaurant: {
            id: 'mock-lyles',
            name: "Lyle's",
            photo_url: 'https://images.unsplash.com/photo-1537047902294-62a40c20a6ae?w=600&q=80',
        },
        logger_count: 24,
        average_rating: 4.4,
    },
    {
        rank: 6,
        restaurant: {
            id: 'mock-rochelle',
            name: 'Rochelle Canteen',
            photo_url: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600&q=80',
        },
        logger_count: 22,
        average_rating: 4.4,
    },
];
