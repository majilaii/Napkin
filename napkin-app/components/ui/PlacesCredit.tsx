import { parsePlacesAttribution } from '@/lib/parsePlacesAttribution';

export interface PlacesPhotoCredit {
    label: string;
    href: string | null;
    /** Stable comparison key; never display this value. */
    normalizedLabel: string;
    /** True only when the author label repeats the photographed restaurant name. */
    redundant: boolean;
}

export interface SourcedPhotoInput {
    url: string | null | undefined;
    photoSource: string | null | undefined;
    attributionHtml?: string | null;
    restaurantName?: string | null;
}

export interface ResolvedSourcedPhoto {
    /** The URL a render surface may safely display. */
    url: string | null;
    /** Present exactly when `url` is an attributed Places photo. */
    credit: PlacesPhotoCredit | null;
    isPlaces: boolean;
}

/**
 * A comparison-only form for attribution labels and restaurant names.
 * NFKC folds compatibility variants; whitespace and case should not make a
 * restaurant look like a distinct author on its own page.
 */
export function normalizePlacesCreditLabel(value: string | null | undefined): string {
    return (value ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        // Author identity must not depend on the device locale (for example,
        // Turkish casing would otherwise split otherwise-identical `I` labels).
        .toLowerCase();
}

/**
 * The single photo-rendering boundary for source-aware restaurant images.
 * Places images fail closed when their stored attribution cannot be parsed;
 * user/Table images remain uncredited, and stale/unknown source values do not
 * get to smuggle a potentially-Places URL onto screen.
 */
export function resolveSourcedPhoto(input: SourcedPhotoInput): ResolvedSourcedPhoto {
    const url = input.url?.trim() || null;
    const source = input.photoSource?.toLowerCase() ?? null;

    if (!url) return { url: null, credit: null, isPlaces: source === 'places' };

    if (source === 'places') {
        const parsed = parsePlacesAttribution(input.attributionHtml);
        if (!parsed) return { url: null, credit: null, isPlaces: true };

        const normalizedLabel = normalizePlacesCreditLabel(parsed.label);
        return {
            url,
            isPlaces: true,
            credit: {
                ...parsed,
                normalizedLabel,
                redundant: normalizedLabel.length > 0
                    && normalizedLabel === normalizePlacesCreditLabel(input.restaurantName),
            },
        };
    }

    if (source === 'user' || source === 'table') {
        return { url, credit: null, isPlaces: false };
    }

    return { url: null, credit: null, isPlaces: false };
}

/** Stable-first dedupe. A later duplicate may contribute a safe href. */
export function dedupePlacesCredits(
    credits: readonly (PlacesPhotoCredit | null | undefined)[],
): PlacesPhotoCredit[] {
    const deduped: PlacesPhotoCredit[] = [];
    const indices = new Map<string, number>();

    for (const credit of credits) {
        if (!credit?.normalizedLabel) continue;
        const existingIndex = indices.get(credit.normalizedLabel);
        if (existingIndex == null) {
            indices.set(credit.normalizedLabel, deduped.length);
            deduped.push({ ...credit });
            continue;
        }

        const existing = deduped[existingIndex];
        deduped[existingIndex] = {
            ...existing,
            href: existing.href ?? credit.href,
            // Minimize only when every photo represented by this label is the
            // matching restaurant itself.
            redundant: existing.redundant && credit.redundant,
        };
    }

    return deduped;
}
