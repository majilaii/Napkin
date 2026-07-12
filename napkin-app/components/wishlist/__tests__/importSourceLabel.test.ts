/**
 * importSourceLabel/importSourceIcon/isInstagramSource unit tests.
 *
 * Instagram has no first-class source variant (the wishlist_items_source_shape
 * DB CHECK whitelists types) — it saves as { type: 'web', url } and provenance
 * surfaces detect it from the URL host. These tests pin that contract.
 */
import {
    importSourceIcon,
    importSourceLabel,
    isInstagramSource,
    isWatchableClip,
    manifestDisplaySource,
} from '../importSourceLabel';
import type { WishlistSource } from '@/lib/types/wishlistSource';

const IG: WishlistSource = { type: 'web', url: 'https://www.instagram.com/reel/DGaQ0R0sbQ0/?igsh=x' };
const WEB: WishlistSource = { type: 'web', url: 'https://www.eater.com/best-pasta' };
const TIKTOK: WishlistSource = { type: 'tiktok', url: 'https://www.tiktok.com/@topjaw/video/1' };
const MAPS: WishlistSource = { type: 'google_maps', url: 'https://maps.app.goo.gl/abc' };

describe('isInstagramSource', () => {
    it('true for web sources with an instagram URL (incl. instagr.am)', () => {
        expect(isInstagramSource(IG)).toBe(true);
        expect(isInstagramSource({ type: 'web', url: 'https://instagr.am/p/C2NYwjwo-Ui/' })).toBe(true);
    });

    it('false for plain web, tiktok, url-less, and null sources', () => {
        expect(isInstagramSource(WEB)).toBe(false);
        expect(isInstagramSource(TIKTOK)).toBe(false);
        expect(isInstagramSource({ type: 'video' } as WishlistSource)).toBe(false);
        expect(isInstagramSource(null)).toBe(false);
        expect(isInstagramSource(undefined)).toBe(false);
    });
});

describe('importSourceIcon', () => {
    it('instagram web sources get the instagram logo', () => {
        expect(importSourceIcon(IG)).toBe('logo-instagram');
    });

    it('tiktok keeps its logo; maps gets map-outline; the rest fall back', () => {
        expect(importSourceIcon(TIKTOK)).toBe('logo-tiktok');
        expect(importSourceIcon(MAPS)).toBe('map-outline');
        expect(importSourceIcon(WEB)).toBe('download-outline');
        expect(importSourceIcon(null)).toBe('download-outline');
    });
});

describe('importSourceLabel', () => {
    it('instagram web sources read "from Instagram"; plain web stays "from a link"', () => {
        expect(importSourceLabel(IG)).toBe('from Instagram');
        expect(importSourceLabel(WEB)).toBe('from a link');
    });
});

describe('manifestDisplaySource', () => {
    // TICKET-180: the SAME type mapping the drain saves with, synthesized purely for
    // the review card + hub identity line, carrying the manifest-only author_handle.
    it('maps a tiktok manifest → tiktok + persisted handle', () => {
        const s = manifestDisplaySource({
            kind: 'url',
            url: 'https://www.tiktok.com/@topjaw/video/1',
            sourceHandle: 'topjaw',
        });
        expect(s).toEqual({ type: 'tiktok', url: 'https://www.tiktok.com/@topjaw/video/1', author_handle: 'topjaw' });
        // feeds the formatters as a tiktok source
        expect(importSourceLabel(s)).toBe('from TikTok');
        expect(importSourceIcon(s)).toBe('logo-tiktok');
    });

    it('maps an instagram manifest → web + handle (label/icon detect IG from the url)', () => {
        const s = manifestDisplaySource({
            kind: 'url',
            url: 'https://www.instagram.com/reel/DGaQ0R0sbQ0/?igsh=x',
            sourceHandle: 'topjaw',
        });
        expect(s.type).toBe('web');
        expect(s.author_handle).toBe('topjaw');
        expect(importSourceLabel(s)).toBe('from Instagram');
        expect(importSourceIcon(s)).toBe('logo-instagram');
    });

    it('maps a google-maps share manifest → google_maps (no handle key)', () => {
        const s = manifestDisplaySource({ kind: 'url', url: 'https://maps.app.goo.gl/abc' });
        expect(s).toEqual({ type: 'google_maps', url: 'https://maps.app.goo.gl/abc' });
        expect(importSourceLabel(s)).toBe('from Google Maps');
        expect(importSourceIcon(s)).toBe('map-outline');
    });

    it('maps a plain web manifest → web + null handle when none was resolved', () => {
        const s = manifestDisplaySource({ kind: 'url', url: 'https://www.eater.com/best-pasta' });
        expect(s).toEqual({ type: 'web', url: 'https://www.eater.com/best-pasta', author_handle: null });
        expect(importSourceLabel(s)).toBe('from a link');
    });

    it('maps a shared-file (kind video) manifest → video, no url/handle', () => {
        const s = manifestDisplaySource({ kind: 'video' });
        expect(s).toEqual({ type: 'video' });
        expect(importSourceLabel(s)).toBe('from a video');
        expect(importSourceIcon(s)).toBe('download-outline');
    });

    it('falls back to video when kind is url but the url is missing', () => {
        expect(manifestDisplaySource({ kind: 'url' })).toEqual({ type: 'video' });
    });
});

describe('isWatchableClip', () => {
    // Only tiktok/IG clips with a url get the "watch again ↗" tap-out.
    it('true for tiktok + instagram display sources with a url', () => {
        expect(isWatchableClip(manifestDisplaySource({ kind: 'url', url: 'https://www.tiktok.com/@x/video/1' }))).toBe(true);
        expect(isWatchableClip(manifestDisplaySource({ kind: 'url', url: 'https://www.instagram.com/reel/DGaQ0R0sbQ0/' }))).toBe(true);
    });

    it('false for maps, plain web, shared-file video, and url-less sources', () => {
        expect(isWatchableClip(manifestDisplaySource({ kind: 'url', url: 'https://maps.app.goo.gl/abc' }))).toBe(false);
        expect(isWatchableClip(manifestDisplaySource({ kind: 'url', url: 'https://www.eater.com/x' }))).toBe(false);
        expect(isWatchableClip(manifestDisplaySource({ kind: 'video' }))).toBe(false);
        expect(isWatchableClip(null)).toBe(false);
    });
});
