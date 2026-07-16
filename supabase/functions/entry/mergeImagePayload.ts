/**
 * Preserve the complete image payload for merge-with entry creation.
 *
 * The composer sends multi-photo picks as `photo_urls`; the SQL writer also
 * needs a single `photo_url` hero so it can bind both the entry_hero sink and
 * every entry_photos sink in one transaction.
 */
export function normalizeMergeImagePayload(input: {
  photo_url?: unknown;
  photo_urls?: unknown;
}): { photo_url?: unknown; photo_urls?: unknown[] } {
  const photoUrls = Array.isArray(input.photo_urls) ? input.photo_urls : [];
  const heroPhoto = input.photo_url || photoUrls[0] || null;

  return {
    ...(heroPhoto ? { photo_url: heroPhoto } : {}),
    ...(photoUrls.length > 0 ? { photo_urls: photoUrls } : {}),
  };
}
