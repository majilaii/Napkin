import { validateUrl } from '../_shared/urlValidation.ts';
import type { WishlistSource } from '../_shared/wishlistSource.ts';

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;
const SOURCE_SAMPLE_LIMIT = 50;

/** Recover only public source identity, never return internal client facts. */
function sourceIdentity(value: unknown): WishlistSource | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (!['tiktok', 'web', 'google_maps'].includes(String(raw.type)) || typeof raw.url !== 'string') return null;
    const url = raw.url.trim();
    const checked = validateUrl(url);
    if (!checked.ok || checked.url.username || checked.url.password) return null;
    if (raw.type === 'tiktok') {
        const host = checked.url.hostname.toLowerCase();
        if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) return null;
    }
    return { type: raw.type, url } as WishlistSource;
}

function sourceIdentities(rows: Array<{ source?: unknown }>): WishlistSource[] {
    const sources = new Map<string, WishlistSource>();
    for (const row of rows) {
        const source = sourceIdentity(row.source);
        if (source && 'url' in source) sources.set(`${source.type}:${source.url}`, source);
    }
    return [...sources.values()];
}

/** Owner-only detail: legacy v2 jobs kept the original link on their queue rows. */
export async function listImportItems(supabase: SupabaseLike, ownerId: string, jobId: string) {
    const { data: job, error: jobErr } = await supabase
        .from('import_jobs')
        .select('job_id, source, status, created_at')
        .eq('job_id', jobId)
        .eq('user_id', ownerId)
        .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return null;

    const { data: itemRows, error: itemsErr } = await supabase
        .from('wishlist_items')
        .select(`
            id, note, created_at, source,
            restaurant:restaurants (
                id, name, address, city, country, photo_url, cuisine,
                google_rating, price_level, external_id, lat, lng
            )
        `)
        .eq('user_id', ownerId)
        .eq('job_id', jobId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
    if (itemsErr) throw itemsErr;
    const rows = (itemRows ?? []) as Array<{ source?: unknown; [key: string]: unknown }>;
    // Keep the item response contract unchanged.
    const items = rows.map(({ source: _source, ...item }) => item);
    if (job.source) return { job, items };

    // A wishlist pin can later move to another import. The owner/job-scoped queue
    // preserves this clip's source even when there are no surviving saved pins.
    // Read a sentinel beyond the cap: never select from an incomplete/conflicting
    // sample. No state filter, so dismissing a check does not lose the original.
    const { data: checks, error: sourceErr } = await supabase
        .from('restaurant_completeness_queue')
        .select('source:client_facts->source')
        .eq('owner_id', ownerId)
        .eq('job_id', jobId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(SOURCE_SAMPLE_LIMIT + 1);
    if (sourceErr) {
        console.warn('wishlist original-source lookup unavailable');
        return { job, items };
    }
    const checkRows = (checks ?? []) as Array<{ source?: unknown }>;
    if (checkRows.length > SOURCE_SAMPLE_LIMIT) return { job, items };
    const fromChecks = sourceIdentities(checkRows);
    if (fromChecks.length > 1) return { job, items };
    if (fromChecks.length === 1) return { job: { ...job, source: fromChecks[0] }, items };

    const fromItems = sourceIdentities(rows);
    return { job: { ...job, source: fromItems.length === 1 ? fromItems[0] : null }, items };
}
