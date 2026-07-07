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
