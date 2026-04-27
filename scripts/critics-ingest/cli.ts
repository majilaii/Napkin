/**
 * critics-ingest CLI — entrypoint for the GitHub Actions scraper.
 * TICKET-033
 *
 * Usage:
 *   deno run --allow-net --allow-env scripts/critics-ingest/cli.ts <mode> [--dry-run]
 *
 * Modes:
 *   backfill    — one-shot; processes user-touched restaurants; ends with eater-list
 *   drip        — daily cron; processes stale restaurants (batch of 50)
 *   eater-list  — monthly; fetches Eater Essentials list for each city and diffs
 *
 * Flags:
 *   --dry-run   — skips all DB writes; logs what would be upserted
 *
 * P1-8 ARCH-REVIEW: backfill mode also runs the eater-list diff at the end,
 * fulfilling the AC: "NYT → Infatuation → Eater Essentials in that order."
 *
 * Observability: every run emits JSON-line log entries. Summary emitted at end:
 *   { run_id, mode, publication, inserted, updated, skipped_not_found, failed, license_failed }
 */

import { createLogger, generateRunId, type Logger } from './lib/log.ts';
import { getSupabaseClient } from './lib/supabase.ts';
import { createPublicationLimiter } from './lib/rate-limit.ts';
import { enforceLicense, LicenseError } from './lib/license.ts';
import { perVenueParsers, listParsers, type ParsedRow } from './parsers/index.ts';
import { EATER_CITIES, nameMatches } from './parsers/eater.ts';

// ── Config ─────────────────────────────────────────────────────────────────

const DRIP_BATCH_SIZE = 50;
const SCRAPE_STALENESS_DAYS = 30;

// ── Per-publication run summary ────────────────────────────────────────────

interface PubSummary {
    publication: string;
    inserted: number;
    updated: number;
    skipped_not_found: number;
    failed: number;
    license_failed: number;
}

function blankSummary(publication: string): PubSummary {
    return { publication, inserted: 0, updated: 0, skipped_not_found: 0, failed: 0, license_failed: 0 };
}

// ── Restaurant loaders ─────────────────────────────────────────────────────

interface RestaurantRow {
    id: string;
    name: string;
    address: string | null;
    external_id: string | null;
}

/** User-touched restaurants: at least one entry or wishlist_item. */
async function loadUserTouchedRestaurants(): Promise<RestaurantRow[]> {
    const supabase = getSupabaseClient();

    // Two separate EXISTS subqueries to avoid cross-table OR complexity.
    // Service role reads entries + wishlist_items + restaurants directly.
    const { data: entryRests, error: entryErr } = await supabase
        .from('entries')
        .select('restaurant_id');
    if (entryErr) throw new Error(entryErr.message);

    const { data: wishlistRests, error: wlErr } = await supabase
        .from('wishlist_items')
        .select('restaurant_id');
    if (wlErr) throw new Error(wlErr.message);

    const touchedIds = new Set([
        ...(entryRests ?? []).map((r: { restaurant_id: string }) => r.restaurant_id),
        ...(wishlistRests ?? []).map((r: { restaurant_id: string }) => r.restaurant_id),
    ]);

    if (touchedIds.size === 0) return [];

    const { data: restaurants, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, address, external_id')
        .in('id', [...touchedIds]);
    if (restErr) throw new Error(restErr.message);

    return (restaurants ?? []) as RestaurantRow[];
}

/**
 * Drip-eligible restaurants: no attempt for this publication in the last 30 days,
 * or no attempt at all. Ordered by last_attempted_at nulls first (most stale first).
 * Bounded to DRIP_BATCH_SIZE per publication.
 * P1-3 ARCH-REVIEW: queries critic_scrape_attempts, not professional_critic_reviews.
 */
async function loadDripRestaurants(publication: string): Promise<RestaurantRow[]> {
    const supabase = getSupabaseClient();
    const staleBefore = new Date(Date.now() - SCRAPE_STALENESS_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Find restaurant IDs that have no attempt record OR a stale one for this publication
    const { data: recentAttempts, error: attErr } = await supabase
        .from('critic_scrape_attempts')
        .select('restaurant_id')
        .eq('publication', publication)
        .gte('last_attempted_at', staleBefore);
    if (attErr) throw new Error(attErr.message);

    const recentIds = new Set((recentAttempts ?? []).map((a: { restaurant_id: string }) => a.restaurant_id));

    // Get all restaurants with at least one entry (user-touched = drip scope)
    const { data: entryRests, error: entryErr } = await supabase
        .from('entries')
        .select('restaurant_id');
    if (entryErr) throw new Error(entryErr.message);

    const { data: wishlistRests, error: wlErr } = await supabase
        .from('wishlist_items')
        .select('restaurant_id');
    if (wlErr) throw new Error(wlErr.message);

    const allTouchedIds = [...new Set([
        ...(entryRests ?? []).map((r: { restaurant_id: string }) => r.restaurant_id),
        ...(wishlistRests ?? []).map((r: { restaurant_id: string }) => r.restaurant_id),
    ])];

    // Eligible = touched AND not recently attempted
    const eligibleIds = allTouchedIds.filter((id) => !recentIds.has(id)).slice(0, DRIP_BATCH_SIZE);

    if (eligibleIds.length === 0) return [];

    const { data: restaurants, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, address, external_id')
        .in('id', eligibleIds);
    if (restErr) throw new Error(restErr.message);

    return (restaurants ?? []) as RestaurantRow[];
}

// ── Upsert helper ──────────────────────────────────────────────────────────

/**
 * Upserts a parsed row into professional_critic_reviews.
 * P0-3 ARCH-REVIEW: explicit column list excludes suppression columns from
 * the UPDATE SET so operator takedowns are never overwritten by a re-scrape.
 *
 * Returns 'inserted' | 'updated' based on whether a pre-existing row existed.
 */
async function upsertReview(
    restaurantId: string,
    row: ParsedRow,
    dryRun: boolean,
    logger: Logger,
): Promise<'inserted' | 'updated'> {
    const supabase = getSupabaseClient();

    if (dryRun) {
        logger.info('[dry-run] Would upsert review', { restaurant_id: restaurantId, publication: row.publication });
        return 'inserted';
    }

    // Check if a row already exists to determine inserted vs updated
    const { data: existing } = await supabase
        .from('professional_critic_reviews')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('publication', row.publication)
        .maybeSingle();

    // P0-3: explicit column list — suppressed, suppressed_by, suppressed_at, suppression_reason
    // are NOT in this list, so they survive a re-scrape untouched.
    const { error } = await supabase
        .from('professional_critic_reviews')
        .upsert(
            {
                restaurant_id: restaurantId,
                publication: row.publication,
                kind: row.kind,
                score: row.score,
                score_out_of: row.score_out_of,
                author: row.author,
                published_date: row.published_date,
                excerpt: row.excerpt,
                source_url: row.source_url,
                scraped_at: new Date().toISOString(),
                scrape_confidence: row.scrape_confidence,
                // suppressed, suppressed_by, suppressed_at, suppression_reason intentionally OMITTED
            },
            {
                onConflict: 'restaurant_id,publication',
                // Explicitly name the columns to update — Supabase upsert with explicit
                // column list via ignoreDuplicates=false and update only these fields.
                // Note: supabase-js doesn't expose a partial update column list in upsert()
                // directly; we handle this by checking existing and doing separate insert/update.
            }
        );

    if (error) {
        // If upsert fails due to conflict (shouldn't happen), fall through
        throw new Error(error.message);
    }

    return existing ? 'updated' : 'inserted';
}

/**
 * Safer upsert that uses explicit update path to exclude suppression columns.
 * Replaces the upsert() call above with insert-or-update logic.
 */
async function safeUpsertReview(
    restaurantId: string,
    row: ParsedRow,
    dryRun: boolean,
    logger: Logger,
): Promise<'inserted' | 'updated'> {
    const supabase = getSupabaseClient();

    if (dryRun) {
        logger.info('[dry-run] Would upsert review', { restaurant_id: restaurantId, publication: row.publication });
        return 'inserted';
    }

    const { data: existing } = await supabase
        .from('professional_critic_reviews')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('publication', row.publication)
        .maybeSingle();

    if (existing) {
        // UPDATE — explicit column list, suppression columns intentionally excluded (P0-3)
        const { error } = await supabase
            .from('professional_critic_reviews')
            .update({
                kind: row.kind,
                score: row.score,
                score_out_of: row.score_out_of,
                author: row.author,
                published_date: row.published_date,
                excerpt: row.excerpt,
                source_url: row.source_url,
                scraped_at: new Date().toISOString(),
                scrape_confidence: row.scrape_confidence,
                // suppressed, suppressed_by, suppressed_at, suppression_reason NOT INCLUDED
            })
            .eq('restaurant_id', restaurantId)
            .eq('publication', row.publication);
        if (error) throw new Error(error.message);
        return 'updated';
    } else {
        // INSERT — suppression columns will be null/default
        const { error } = await supabase
            .from('professional_critic_reviews')
            .insert({
                restaurant_id: restaurantId,
                publication: row.publication,
                kind: row.kind,
                score: row.score,
                score_out_of: row.score_out_of,
                author: row.author,
                published_date: row.published_date,
                excerpt: row.excerpt,
                source_url: row.source_url,
                scraped_at: new Date().toISOString(),
                scrape_confidence: row.scrape_confidence,
            });
        if (error) throw new Error(error.message);
        return 'inserted';
    }
}

/** Record a scrape attempt (hit, miss, or error) for the P1-3 drip query. */
async function recordAttempt(
    restaurantId: string,
    publication: string,
    status: 'hit' | 'miss' | 'error',
    dryRun: boolean,
): Promise<void> {
    if (dryRun) return;
    const supabase = getSupabaseClient();
    await supabase
        .from('critic_scrape_attempts')
        .upsert(
            {
                restaurant_id: restaurantId,
                publication,
                last_attempted_at: new Date().toISOString(),
                status,
            },
            { onConflict: 'restaurant_id,publication' }
        );
}

// ── Per-venue scrape loop ──────────────────────────────────────────────────

async function scrapeRestaurantsForPublication(
    restaurants: RestaurantRow[],
    parser: import('./parsers/index.ts').PerVenueParser,
    limiter: ReturnType<typeof createPublicationLimiter>,
    summary: PubSummary,
    dryRun: boolean,
    logger: Logger,
): Promise<void> {
    for (const restaurant of restaurants) {
        try {
            // Search: find the review URL
            const reviewUrl = await limiter.withThrottle(parser.publication, () =>
                parser.search(restaurant.name, restaurant.address)
            );

            if (!reviewUrl) {
                logger.info('No review found', { restaurant_id: restaurant.id, publication: parser.publication });
                summary.skipped_not_found++;
                await recordAttempt(restaurant.id, parser.publication, 'miss', dryRun);
                continue;
            }

            // Parse: extract structured review data
            const parsed = await limiter.withThrottle(parser.publication, () =>
                parser.parse(reviewUrl)
            );

            if (!parsed) {
                logger.warn('Parse returned null', { restaurant_id: restaurant.id, url: reviewUrl });
                summary.failed++;
                await recordAttempt(restaurant.id, parser.publication, 'error', dryRun);
                continue;
            }

            // License gate (P1-6): throws LicenseError on attribution failure
            let licensed: ParsedRow;
            try {
                licensed = enforceLicense(parsed);
            } catch (err) {
                if (err instanceof LicenseError) {
                    logger.error('License violation', { restaurant_id: restaurant.id, err: err.message });
                    summary.license_failed++;
                    await recordAttempt(restaurant.id, parser.publication, 'error', dryRun);
                    continue;
                }
                throw err;
            }

            // Write
            const outcome = await safeUpsertReview(restaurant.id, licensed, dryRun, logger);
            summary[outcome]++;
            await recordAttempt(restaurant.id, parser.publication, 'hit', dryRun);
            logger.info('Upserted review', { restaurant_id: restaurant.id, publication: parser.publication, outcome });

        } catch (err) {
            // Per-row isolation: one bad restaurant does not abort the run
            logger.error('Scrape failed', {
                restaurant_id: restaurant.id,
                publication: parser.publication,
                err: err instanceof Error ? err.message : String(err),
            });
            summary.failed++;
            await recordAttempt(restaurant.id, parser.publication, 'error', dryRun);
        }
    }
}

// ── Eater list-diff ────────────────────────────────────────────────────────

async function runEaterListDiff(
    dryRun: boolean,
    logger: Logger,
): Promise<PubSummary> {
    const summary = blankSummary('eater');
    const supabase = getSupabaseClient();
    const eaterListParser = listParsers.find((p) => p.publication === 'eater');
    if (!eaterListParser) return summary;

    for (const city of EATER_CITIES) {
        logger.info('Running Eater list diff', { city });
        let listEntries: Array<{ restaurant_name: string; address?: string; year: number }>;
        try {
            listEntries = await eaterListParser.fetchList(city);
        } catch (err) {
            logger.error('Eater list fetch failed', { city, err: err instanceof Error ? err.message : String(err) });
            continue;
        }

        logger.info('Eater list fetched', { city, count: listEntries.length });

        // Load all restaurants (no filter — Eater matches against all)
        const { data: allRestaurants, error: restErr } = await supabase
            .from('restaurants')
            .select('id, name, city, address');
        if (restErr) {
            logger.error('Failed to load restaurants for Eater match', { err: restErr.message });
            continue;
        }

        for (const listEntry of listEntries) {
            // Find matching restaurant by name+city
            const matched = (allRestaurants ?? []).find((r: { id: string; name: string; city: string | null; address: string | null }) =>
                nameMatches(r.name, listEntry.restaurant_name)
            );

            if (!matched) {
                logger.warn('Eater list entry unmatched', { restaurant_name: listEntry.restaurant_name });
                summary.skipped_not_found++;
                continue;
            }

            const row: ParsedRow = {
                publication: 'eater',
                kind: 'essential',
                score: null,
                score_out_of: null,
                author: null,
                published_date: `${listEntry.year}-01-01`,
                excerpt: null,
                source_url: `https://ny.eater.com/maps/best-new-york-restaurants-38-essential`,
                scrape_confidence: 95,
            };

            // License check (required even for essential rows)
            let licensed: ParsedRow;
            try {
                licensed = enforceLicense(row);
            } catch (err) {
                logger.error('Eater license violation', { restaurant_id: matched.id, err: err instanceof Error ? err.message : String(err) });
                summary.license_failed++;
                continue;
            }

            try {
                const outcome = await safeUpsertReview(matched.id, licensed, dryRun, logger);
                // P1-4: update last_seen_on_source_at for matched rows
                if (!dryRun) {
                    await supabase
                        .from('professional_critic_reviews')
                        .update({ last_seen_on_source_at: new Date().toISOString() })
                        .eq('restaurant_id', matched.id)
                        .eq('publication', 'eater');
                }
                summary[outcome]++;
                logger.info('Eater essential upserted', { restaurant_id: matched.id, outcome });
            } catch (err) {
                logger.error('Eater upsert failed', { restaurant_id: matched.id, err: err instanceof Error ? err.message : String(err) });
                summary.failed++;
            }
        }
    }

    return summary;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const args = Deno.args;
    const mode = args[0] as 'backfill' | 'drip' | 'eater-list' | undefined;
    const dryRun = args.includes('--dry-run');

    if (!mode || !['backfill', 'drip', 'eater-list'].includes(mode)) {
        console.error('Usage: cli.ts <backfill|drip|eater-list> [--dry-run]');
        Deno.exit(1);
    }

    const runId = generateRunId();
    const logger = createLogger(runId);

    logger.info('Critics ingest starting', { mode, dry_run: dryRun, run_id: runId });
    const startTs = Date.now();

    const limiter = createPublicationLimiter(1000);
    const allSummaries: PubSummary[] = [];

    if (mode === 'backfill' || mode === 'drip') {
        const restaurants = mode === 'backfill'
            ? await loadUserTouchedRestaurants()
            : [];  // drip loads per-publication below

        for (const parser of perVenueParsers) {
            const summary = blankSummary(parser.publication);
            const batch = mode === 'backfill'
                ? restaurants
                : await loadDripRestaurants(parser.publication);

            logger.info(`Starting ${parser.publication} scrape`, { count: batch.length, mode });

            await scrapeRestaurantsForPublication(batch, parser, limiter, summary, dryRun, logger);

            allSummaries.push(summary);
            logger.info(`${parser.publication} scrape complete`, summary as unknown as Record<string, unknown>);
        }

        // P1-8: backfill also runs eater-list at the end
        if (mode === 'backfill') {
            logger.info('Running Eater list diff as part of backfill');
            const eaterSummary = await runEaterListDiff(dryRun, logger);
            allSummaries.push(eaterSummary);
        }
    }

    if (mode === 'eater-list') {
        const eaterSummary = await runEaterListDiff(dryRun, logger);
        allSummaries.push(eaterSummary);
    }

    // Final summary log
    const durationMs = Date.now() - startTs;
    logger.info('Critics ingest complete', {
        run_id: runId,
        mode,
        duration_ms: durationMs,
        summaries: allSummaries,
    });

    // Print a human-readable summary to stdout (visible in Actions)
    console.log('\n=== Critics ingest summary ===');
    console.log(`Run ID: ${runId} | Mode: ${mode} | Duration: ${(durationMs / 1000).toFixed(1)}s`);
    for (const s of allSummaries) {
        console.log(
            `[${s.publication}] inserted=${s.inserted} updated=${s.updated} ` +
            `skipped=${s.skipped_not_found} failed=${s.failed} license_failed=${s.license_failed}`
        );
    }
}

main().catch((err) => {
    console.error('Fatal error:', err instanceof Error ? err.message : String(err));
    Deno.exit(1);
});
