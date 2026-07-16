/**
 * Public-list presentation rules for For You.
 *
 * This is deliberately a presentation eligibility check, not an editorial
 * ranking system. A recent list may appear in the rail, but it must never wear
 * the lead treatment simply because it happened to be edited last.
 */
import type { PublicListResult } from '@/hooks/lists/useSearchPublicLists';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';

export interface ListPresentation {
    showcase: PublicListResult | null;
    rail: PublicListResult[];
}

export function isDisplayablePublicList(list: PublicListResult): boolean {
    return list.title.trim().length >= 2 && list.entry_count > 0;
}

export function earnsShowcaseTreatment(list: PublicListResult): boolean {
    const cover = resolveSourcedPhoto({
        url: list.cover_photo_url,
        photoSource: list.photo_source === 'places' ? 'places' : null,
        attributionHtml: list.attribution_html,
        restaurantName: list.cover_restaurant_name,
    });
    return !!cover.url && list.entry_count >= 3;
}

export function arrangePublicLists(lists: PublicListResult[]): ListPresentation {
    const visible = lists.filter(isDisplayablePublicList);
    const showcase = visible.find(earnsShowcaseTreatment) ?? null;

    return {
        showcase,
        rail: showcase ? visible.filter((list) => list.id !== showcase.id) : visible,
    };
}
