/**
 * importsStripUtils — pure helpers behind the profile Imports strip
 * (TICKET-191). No React / native imports (unit-testable, same pattern as
 * listsShelfUtils).
 *
 * plateGlyphFor is the STRICT plate allowlist: only tiktok, instagram
 * (persisted as type 'web' + an IG-host url — see isInstagramSource) and
 * google_maps earn a source glyph plate, because those three glyphs carry real
 * provenance meaning. EVERY other variant (plain web, video, screenshot,
 * vision, handoff, null/unknown) renders pure type — the generic
 * 'download-outline' fallback in importSourceIcon is exactly the decorative
 * placeholder the imagery doctrine bans, so we never fall back to it here.
 */
import { isInstagramSource } from '@/components/wishlist/importSourceLabel';

/** Structural source shape (type + url) — matches importSourceLabel's. */
type SourceLike = { type?: string | null; url?: string | null } | null | undefined;

export type PlateGlyph = 'logo-tiktok' | 'logo-instagram' | 'map-outline';

export function plateGlyphFor(source: SourceLike): PlateGlyph | null {
    const type = (source as { type?: string } | null | undefined)?.type;
    if (type === 'tiktok') return 'logo-tiktok';
    if (isInstagramSource(source)) return 'logo-instagram';
    if (type === 'google_maps') return 'map-outline';
    return null;
}
