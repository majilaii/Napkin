/**
 * RN shim — re-exports the canonical WishlistSource type union and validator
 * from the Deno _shared directory.
 *
 * Architecture decision [ARCH-REVIEW-H4]: canonical type lives on the Deno side
 * at supabase/functions/_shared/wishlistSource.ts (dependency-free).
 * RN/Metro resolves relative paths fine since both directories are under the
 * same repo root (/Users/jacky/Napkin/).
 *
 * Consumers inside napkin-app should import from '@/lib/types/wishlistSource'.
 */
export type {
    WishlistSource,
    WishlistSourceType,
    WishlistSourceTikTok,
    WishlistSourceGoogleMaps,
    WishlistSourceWeb,
    WishlistSourceScreenshot,
    WishlistSourceVision,
    WishlistSourceHandoff,
} from '../../../supabase/functions/_shared/wishlistSource';

export { validateWishlistSource } from '../../../supabase/functions/_shared/wishlistSource';
