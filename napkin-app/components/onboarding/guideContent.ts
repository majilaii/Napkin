import type { Href } from 'expo-router';
import type { DiscoveryTopic } from '@/lib/discoveryGuide';

export interface GuideChapter {
    id: DiscoveryTopic;
    label: string;
    title: string;
    body: string;
    detail: string;
    action: string;
    route: Href;
    icon: 'book-outline' | 'bookmark-outline' | 'restaurant-outline' | 'albums-outline' | 'people-outline' | 'share-outline';
}

export const GUIDE_CHAPTERS: readonly GuideChapter[] = [
    {
        id: 'journal', label: 'Your journal', title: 'A journal of good meals.',
        body: 'Check in, leave a rating, or keep a few words and photos to remember it by.',
        detail: 'Find a restaurant in Places to check in or write a review. Your meals collect in the diary on your profile.',
        action: 'Find a place', route: '/(tabs)/places', icon: 'book-outline',
    },
    {
        id: 'places', label: 'Your next meal', title: 'Keep your next good find.',
        body: 'Pin places you want to try. Find them again on your map or in your saved places.',
        detail: 'Search in Places, then tap the heart to pin a restaurant. Switch between your map and list to find it again.',
        action: 'Open Places', route: '/(tabs)/places?view=list&layer=pinned', icon: 'bookmark-outline',
    },
    {
        id: 'sharing', label: 'From your feed', title: 'Turn clips into places.',
        body: 'Find a restaurant on TikTok or Instagram? Share it to Napkin, review the places, and keep your picks on the map.',
        detail: 'Tap Share, then More in TikTok or Share to in Instagram. Choose Napkin from the iPhone share sheet, or find it under More. Add for review, then open your clip tray in Places to check and save the restaurants.',
        action: 'Open Places', route: '/(tabs)/places?view=list&layer=pinned', icon: 'share-outline',
    },
    {
        id: 'tables', label: 'Your people', title: 'A Table for your people.',
        body: 'A private group for shared meals, trusted opinions, and places you all want to try.',
        detail: 'Your personal pins come together on the Table map. See where your tastes overlap, then keep everyone’s take on the meals that follow.',
        action: 'Explore Tables', route: '/(tabs)/tables', icon: 'restaurant-outline',
    },
    {
        id: 'lists', label: 'Your collections', title: 'A list for every appetite.',
        body: 'Weekend bakeries, a trip to Lisbon, or your favourite late dinners. Give your places a collection of their own.',
        detail: 'Create lists from your profile. Choose who can see each list, and save other people’s public lists for later.',
        action: 'Open lists', route: '/lists', icon: 'albums-outline',
    },
    {
        id: 'friends', label: 'Your food world', title: 'Find people with good taste.',
        body: 'Follow people to see their meals and finds in your Feed. A Table is for your closer circle.',
        detail: 'Find someone by name in Places search. For You in the Feed is another way to discover people and lists.',
        action: 'Find people', route: '/(tabs)/places?mode=people', icon: 'people-outline',
    },
];

export function findGuideChapter(topic: unknown): GuideChapter | undefined {
    return GUIDE_CHAPTERS.find((chapter) => chapter.id === topic);
}

/** Keep the first-run selection explicit as the replayable guide grows. */
export const INTRO_CHAPTERS = GUIDE_CHAPTERS.filter((chapter) => ['journal', 'places', 'sharing', 'tables'].includes(chapter.id));
