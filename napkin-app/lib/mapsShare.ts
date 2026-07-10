/**
 * Host-anchored Google Maps share-link detection — mirrors the server's
 * detectSourceType (supabase/functions/resolve-url): maps.app.goo.gl,
 * maps.google.com, legacy goo.gl short links, and google.com only with a
 * /maps path. Host-anchored so a random URL that merely CONTAINS
 * "maps.google." in a path/query never counts.
 *
 * Keep in sync with the server — the queue drain uses this for save
 * provenance ({type:'google_maps'}), and a disagreement mislabels the
 * "saved from …" line on the restaurant page.
 */
export function isMapsShareUrl(url: string | null | undefined): boolean {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if (host === 'maps.app.goo.gl' || host === 'maps.google.com' || host === 'goo.gl') {
            return true;
        }
        return (
            (host === 'www.google.com' || host === 'google.com') &&
            parsed.pathname.startsWith('/maps')
        );
    } catch {
        return false;
    }
}
