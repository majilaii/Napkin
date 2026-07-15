/**
 * socialHost — exact-hostname Instagram URL predicate, TS copy #2 of the
 * TWO SYNCED COPIES pair (the fn_user_taste junk-list pattern):
 *
 *   SQL:  public.fn_is_instagram_url(text)
 *         (supabase/migrations/20260715180000_socials_module.sql)   ← copy #1
 *   TS:   isInstagramUrl() — THIS FILE                              ← copy #2
 *
 * Parity contract (TICKET-189, Codex P1 — the two copies MUST return
 * byte-identical verdicts across the shared fixture table below, asserted by
 * socialHost.test.ts on this copy and supabase/tests/socials_privacy.spec.sql
 * on the SQL copy):
 *   (1) only absolute http(s):// URLs qualify — scheme-less input is FALSE
 *       (stored import sources are always absolute; the RAW string must start
 *       with the scheme — no trimming, matching the SQL regex anchor);
 *   (2) authority = the substring between '://' and the first '/', '?' or '#';
 *   (3) host = the part of the authority after the LAST '@' (userinfo
 *       stripped — 'https://instagram.com@evil.com/x' is host evil.com, NOT
 *       instagram), then strip a trailing ':port', lowercase, strip a leading
 *       'www.' (all of which `new URL().hostname` + the www-strip below do);
 *   (4) match host === 'instagram.com' || endsWith('.instagram.com')
 *       || host === 'instagr.am'.
 *
 * Substring matching is BANNED — this predicate must reject
 * 'notinstagram.com', 'example.com/?next=instagram.com', and
 * 'instagram.com.evil.com'. Any edit here must be mirrored in the SQL copy
 * and re-asserted against SOCIAL_HOST_FIXTURES.
 *
 * Consumers: feed-socials (module source filter parity) and restaurant-history
 * action=social_clippings (which replaced its inline /instagram\.com|instagr\.am/
 * substring regex with this exact-hostname predicate — TICKET-189).
 */

export function isInstagramUrl(url: string): boolean {
    // (1) absolute http(s):// only, checked on the RAW string (new URL() would
    // silently trim whitespace and accept other schemes — the SQL copy won't).
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false; // malformed → false
    }
    // (2)+(3): WHATWG parsing yields the authority host — userinfo stripped at
    // the LAST '@', port stripped, lowercased. Strip a leading 'www.'.
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    // (4) exact-hostname match.
    return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am';
}

/**
 * The SHARED parity fixture table — every row asserted byte-identical against
 * BOTH copies (TS via socialHost.test.ts; SQL via
 * supabase/tests/socials_privacy.spec.sql, which duplicates these rows with a
 * sync-comment pointing here). Add rows in BOTH places.
 */
export const SOCIAL_HOST_FIXTURES: ReadonlyArray<readonly [url: string, expected: boolean]> = [
    // PASS — real Instagram hosts
    ['https://instagram.com/reel/x', true],
    ['https://www.instagram.com/p/x', true],
    ['http://instagr.am/p/x', true],
    ['https://m.instagram.com/p/x', true],
    ['https://instagram.com:443/reel/x', true],            // explicit port stripped
    ['https://user:pass@instagram.com/p/x', true],         // userinfo before a real IG host
    ['HTTPS://INSTAGRAM.COM/reel/x', true],                // scheme + host case-insensitive
    // FAIL — the deception / non-qualifying set
    ['instagram.com/reel/x', false],                       // scheme-less (contract (1))
    ['https://instagram.com@evil.com/x', false],           // userinfo deception → host evil.com
    ['https://notinstagram.com/x', false],                 // substring trap
    ['https://example.com/?next=instagram.com/x', false],  // IG only in the query
    ['https://instagram.com.evil.com/x', false],           // suffix-spoof host
    ['https://tiktok.com/@x/video/1', false],              // wrong platform
    ['ftp://instagram.com/p/x', false],                    // non-http(s) scheme
    ['instagramXcom', false],                              // garbage
    ['https://', false],                                   // empty authority
    ['', false],                                           // empty
] as const;
