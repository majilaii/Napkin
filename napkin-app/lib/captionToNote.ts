/**
 * RN shim — re-exports the canonical captionToNote from the Deno _shared dir
 * (per TICKET-053 [ARCH-REVIEW-H4]: one source of truth, no drift).
 *
 * Consumers inside napkin-app should import from '@/lib/captionToNote'.
 */
export { captionToNote } from '../../supabase/functions/_shared/captionToNote';
