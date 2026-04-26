/**
 * RN shim — re-exports validateUrl from the canonical Deno _shared file.
 * Consumers inside napkin-app should import from '@/lib/urlValidation'.
 */
export type { ValidateUrlResult } from '../../supabase/functions/_shared/urlValidation';
export { validateUrl } from '../../supabase/functions/_shared/urlValidation';
