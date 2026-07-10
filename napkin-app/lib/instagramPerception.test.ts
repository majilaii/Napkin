/**
 * instagramPerception unit tests — pure parsers only (no network).
 *
 * Fixtures are trimmed from a REAL embed/captioned page fetched logged-out
 * (reel/DGaQ0R0sbQ0, topjaw, 2026-07-07) so the escaping layers and markup
 * shapes match what Instagram actually serves — not an idealized guess.
 */
import {
    isInstagramUrl,
    extractInstagramShortcode,
    parseInstagramEmbed,
    parseOgDescriptionCaption,
    parseInstagramThumbnail,
    parseInstagramAuthorHandle,
} from './instagramPerception';

// ── isInstagramUrl ────────────────────────────────────────────────────────────

describe('isInstagramUrl', () => {
    it('matches reel share links (with tracking params)', () => {
        expect(isInstagramUrl('https://www.instagram.com/reel/DGaQ0R0sbQ0/?igsh=abc123')).toBe(true);
    });

    it('matches instagr.am short links', () => {
        expect(isInstagramUrl('https://instagr.am/p/DGaQ0R0sbQ0/')).toBe(true);
    });

    it('rejects tiktok + null', () => {
        expect(isInstagramUrl('https://www.tiktok.com/@topjaw/video/123')).toBe(false);
        expect(isInstagramUrl(null)).toBe(false);
        expect(isInstagramUrl(undefined)).toBe(false);
    });
});

// ── extractInstagramShortcode ─────────────────────────────────────────────────

describe('extractInstagramShortcode', () => {
    it('extracts from /reel/, /reels/, /p/, /tv/', () => {
        expect(extractInstagramShortcode('https://www.instagram.com/reel/DGaQ0R0sbQ0/')).toBe('DGaQ0R0sbQ0');
        expect(extractInstagramShortcode('https://www.instagram.com/reels/DGaQ0R0sbQ0/')).toBe('DGaQ0R0sbQ0');
        expect(extractInstagramShortcode('https://www.instagram.com/p/C2NYwjwo-Ui/')).toBe('C2NYwjwo-Ui');
        expect(extractInstagramShortcode('https://www.instagram.com/tv/CFnVQ3TFxyz/')).toBe('CFnVQ3TFxyz');
    });

    it('extracts from username-prefixed paths + query params', () => {
        expect(extractInstagramShortcode('https://www.instagram.com/topjaw/reel/C2136FhILzm/?utm_source=x')).toBe('C2136FhILzm');
        expect(extractInstagramShortcode('https://www.instagram.com/reel/DGaQ0R0sbQ0/?igsh=MWtx')).toBe('DGaQ0R0sbQ0');
    });

    it('returns null for /share/ indirection + profiles', () => {
        expect(extractInstagramShortcode('https://www.instagram.com/share/reel/_abcDEF')).toBe(null);
        expect(extractInstagramShortcode('https://instagr.am/share/reel/_abcDEF')).toBe(null);
        expect(extractInstagramShortcode('https://www.instagram.com/topjaw/')).toBe(null);
    });
});

// ── parseInstagramEmbed ───────────────────────────────────────────────────────

// video_url exactly as it appears inside the embed page's contextJSON blob:
// backslash-escaped quote boundaries, `\\\/`-encoded slashes (byte-for-byte
// from the real page — decode verified in node against the full HTML).
const EMBED_VIDEO_FRAGMENT =
    '\\"edge_followed_by\\":{\\"count\\":1030174}},\\"video_url\\":\\"https:\\\\\\/\\\\\\/instagram.flhr4-3.fna.fbcdn.net\\\\\\/o1\\\\\\/v\\\\\\/t2\\\\\\/AQMi0JL2odBQ.mp4?_nc_cat=106&efg=eyJ2ZW5jb2RlX3RhZyI6MTA5OTl9\\",\\"has_audio\\":true';

// Real .Caption markup shape: username anchor, <br/>s, @-mention anchor
// (&#064; entity), hashtag anchor, trailing CaptionComments block.
const EMBED_CAPTION_FRAGMENT =
    '<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/topjaw/?utm_source=ig_embed" target="_blank">topjaw</a><br /><br />There’s no way we could’ve fit <a href="/jamiedemetriou/?utm_source=ig_embed">&#064;jamiedemetriou</a> into one reel… Part 2 Best of <a href="/explore/tags/London/?utm_source=ig_embed">#London</a><div class="CaptionComments"><a class="CaptionCommentsExpand" href="https://www.instagram.com/reel/DGaQ0R0sbQ0/">View all 126 comments</a></div></div><div class="Footer">';

describe('parseInstagramEmbed', () => {
    it('decodes the double-escaped video_url', () => {
        const { videoUrl } = parseInstagramEmbed(EMBED_VIDEO_FRAGMENT);
        expect(videoUrl).toBe(
            'https://instagram.flhr4-3.fna.fbcdn.net/o1/v/t2/AQMi0JL2odBQ.mp4?_nc_cat=106&efg=eyJ2ZW5jb2RlX3RhZyI6MTA5OTl9',
        );
    });

    it('decodes a single-escaped video_url fallback', () => {
        const html = '{"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v\\/clip.mp4?sig=1"}';
        expect(parseInstagramEmbed(html).videoUrl).toBe(
            'https://scontent.cdninstagram.com/v/clip.mp4?sig=1',
        );
    });

    it('extracts the caption EXACTLY — no markup residue, comments stripped', () => {
        const { caption } = parseInstagramEmbed(EMBED_CAPTION_FRAGMENT);
        expect(caption).toBe(
            'topjaw\nThere’s no way we could’ve fit @jamiedemetriou into one reel… Part 2 Best of #London',
        );
    });

    it('cuts cleanly at a Footer boundary when there is no comments block', () => {
        const html =
            '<div class="Caption"><a class="CaptionUsername" href="/x/">chef</a><br />best pasta 🍝 in <a href="/explore/tags/rome/">#rome</a><div class="Footer"><a>footer junk</a></div></div>';
        expect(parseInstagramEmbed(html).caption).toBe('chef\nbest pasta 🍝 in #rome');
    });

    it('survives out-of-range numeric entities without throwing', () => {
        const html = '<div class="Caption">ok &#x110000; fine<div class="Footer">';
        expect(parseInstagramEmbed(html).caption).toBe('ok fine');
    });

    it('returns nulls on markup with neither field', () => {
        expect(parseInstagramEmbed('<html><body>Log in to continue</body></html>')).toEqual({
            caption: null,
            videoUrl: null,
        });
    });

    it('never returns a non-http video_url', () => {
        expect(parseInstagramEmbed('{"video_url":"about:blank"}').videoUrl).toBe(null);
    });
});

// ── parseOgDescriptionCaption ─────────────────────────────────────────────────

describe('parseOgDescriptionCaption', () => {
    it('strips the engagement prefix from a real og:description', () => {
        const html =
            '<meta property="og:description" content="14K likes, 126 comments - topjaw on February 22, 2026: &quot;There&#x2019;s no way we could&#x2019;ve fit &#064;jamiedemetriou into one reel&#x2026; Part 2 Best of #London&quot;" />';
        const caption = parseOgDescriptionCaption(html);
        expect(caption).toContain('@jamiedemetriou');
        expect(caption).toContain('Part 2 Best of #London');
        expect(caption).not.toContain('126 comments');
    });

    it('returns null when the meta tag is absent', () => {
        expect(parseOgDescriptionCaption('<html></html>')).toBe(null);
    });
});

// ── parseInstagramAuthorHandle (TICKET-156) ───────────────────────────────────

describe('parseInstagramAuthorHandle', () => {
    it('extracts the author handle from the caption username anchor', () => {
        // Real .Caption markup: the first instagram.com/{handle}/ anchor is the author.
        expect(parseInstagramAuthorHandle(EMBED_CAPTION_FRAGMENT)).toBe('topjaw');
    });

    it('skips reserved path segments (reel/p/explore) and returns the real handle', () => {
        const html =
            '<a href="https://www.instagram.com/reel/DGaQ0R0sbQ0/">view</a>' +
            '<a href="https://www.instagram.com/chef_ann/?utm_source=ig_embed">chef_ann</a>';
        expect(parseInstagramAuthorHandle(html)).toBe('chef_ann');
    });

    it('returns null when no profile anchor is present', () => {
        expect(parseInstagramAuthorHandle('<div>Log in to continue</div>')).toBe(null);
    });
});

// ── parseInstagramThumbnail (TICKET-156) ──────────────────────────────────────

describe('parseInstagramThumbnail', () => {
    it('extracts the og:image cover URL (entities decoded)', () => {
        const html =
            '<meta property="og:image" content="https://scontent.cdninstagram.com/v/t51/cover.jpg?stp=x&amp;_nc_cat=1" />';
        expect(parseInstagramThumbnail(html)).toBe(
            'https://scontent.cdninstagram.com/v/t51/cover.jpg?stp=x&_nc_cat=1',
        );
    });

    it('returns null when og:image is absent or non-http', () => {
        expect(parseInstagramThumbnail('<html></html>')).toBe(null);
        expect(parseInstagramThumbnail('<meta property="og:image" content="about:blank" />')).toBe(null);
    });
});
