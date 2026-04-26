/**
 * URL helpers for ghost (Google Places) restaurant photos.
 *
 * The `places-photo` edge function proxies Google Places media references
 * (which require an API key the client doesn't hold) into bytes a plain
 * <Image src=...> can render. Returned bytes are cached for 30 days.
 *
 * Used for:
 *  - Ghost restaurants (the row hasn't been upserted to `restaurants` yet,
 *    so there's no Storage-mirrored `photo_url`). We render the proxy URL
 *    directly on the hero / search thumbnail.
 *  - FastLogForm thumbnail when the user is logging from a search result.
 *
 * Once a restaurant is upserted, `_shared/restaurant.ts::_storeHeroPhoto`
 * mirrors the bytes into Supabase Storage and writes `photo_url` — that
 * direct URL is preferred over the proxy.
 */

import { supabase } from './supabase';

export function placesPhotoProxyUrl(
    photoReference: string | null | undefined,
    opts?: { width?: number; height?: number },
): string | null {
    if (!photoReference) return null;
    const supabaseUrl = (supabase as any).supabaseUrl as string | undefined;
    if (!supabaseUrl) return null;
    const params = new URLSearchParams({ ref: photoReference });
    if (opts?.width) params.set('w', String(opts.width));
    if (opts?.height) params.set('h', String(opts.height));
    return `${supabaseUrl}/functions/v1/places-photo?${params.toString()}`;
}
