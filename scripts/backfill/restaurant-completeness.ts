/**
 * TICKET-195 restaurant-completeness backfill.
 *
 * Dry-run is the default. Production writes require --execute plus explicit
 * row and per-SKU currency ceilings. This script deliberately uses the same
 * DB freeze, attestation cache, media claims, and weighted budgets as Edge.
 *
 * Example (still dry-run):
 *   deno run --allow-env --allow-net --allow-read \
 *     scripts/backfill/restaurant-completeness.ts --max-rows 100
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
    CompletenessPaidPathError,
    CompletenessProvider,
} from '../../supabase/functions/_shared/completenessProvider.ts';
import { scoreDeferredCandidates } from '../../supabase/functions/_shared/candidateDedupe.ts';

export const SKU_USD = {
    details: 0.017,
    textsearch: 0.032,
    media: 0.007,
} as const;

export interface BackfillOptions {
    execute: boolean;
    maxRows: number;
    maxDetailsUsd: number;
    maxMediaUsd: number;
    maxTextSearchUsd: number;
    watermark: string | null;
    watermarkFile: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE_HOLDERS = [
    'wishlist_items',
    'list_entries',
    'list_items',
    'entries',
    'visits',
    'table_shares',
    'table_nights',
    'user_restaurant_status',
    'table_top_4',
    'user_top_4',
    'user_profile_top_4',
    'user_profile_takes',
    'gatherings',
    'suppers',
    'table_float_state',
    'professional_critic_reviews',
] as const;
const SOFT_DELETE_HOLDERS = new Set<string>(['wishlist_items', 'table_shares']);

function positiveNumber(value: string | undefined, flag: string, integer = false): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
        throw new Error(`${flag} requires a positive ${integer ? 'integer' : 'number'}`);
    }
    return parsed;
}

export function parseBackfillArgs(args: string[]): BackfillOptions {
    const options: BackfillOptions = {
        execute: false,
        maxRows: 100,
        maxDetailsUsd: 0,
        maxMediaUsd: 0,
        maxTextSearchUsd: 0,
        watermark: null,
        watermarkFile: null,
    };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        const value = args[index + 1];
        if (flag === '--execute') options.execute = true;
        else if (flag === '--max-rows') {
            options.maxRows = positiveNumber(value, flag, true);
            index += 1;
        } else if (flag === '--max-details-usd') {
            options.maxDetailsUsd = positiveNumber(value, flag);
            index += 1;
        } else if (flag === '--max-media-usd') {
            options.maxMediaUsd = positiveNumber(value, flag);
            index += 1;
        } else if (flag === '--max-textsearch-usd') {
            options.maxTextSearchUsd = positiveNumber(value, flag);
            index += 1;
        } else if (flag === '--watermark') {
            if (!value || !UUID_RE.test(value)) throw new Error('--watermark requires a UUID cursor');
            options.watermark = value;
            index += 1;
        } else if (flag === '--watermark-file') {
            if (!value) throw new Error('--watermark-file requires a path');
            options.watermarkFile = value;
            index += 1;
        } else if (flag !== '--dry-run') {
            throw new Error(`unknown argument: ${flag}`);
        }
    }
    if (options.execute && (
        options.maxDetailsUsd <= 0 || options.maxMediaUsd <= 0 || options.maxTextSearchUsd <= 0
    )) {
        throw new Error(
            '--execute requires --max-details-usd, --max-media-usd, and --max-textsearch-usd',
        );
    }
    return options;
}

type SkuKind = keyof typeof SKU_USD;

export class SpendMeter {
    readonly calls: Record<SkuKind, number> = { details: 0, textsearch: 0, media: 0 };

    constructor(private readonly options: BackfillOptions) {}

    spend(kind: SkuKind): number {
        return this.calls[kind] * SKU_USD[kind];
    }

    private ceiling(kind: SkuKind): number {
        if (kind === 'details') return this.options.maxDetailsUsd;
        if (kind === 'media') return this.options.maxMediaUsd;
        return this.options.maxTextSearchUsd;
    }

    record(kind: SkuKind): void {
        if (this.spend(kind) + SKU_USD[kind] > this.ceiling(kind) + Number.EPSILON) {
            throw new Error(`CURRENCY_CEILING:${kind}`);
        }
        this.calls[kind] += 1;
    }

    report() {
        return {
            calls: { ...this.calls },
            estimated_usd: {
                details: this.spend('details'),
                textsearch: this.spend('textsearch'),
                media: this.spend('media'),
                total: this.spend('details') + this.spend('textsearch') + this.spend('media'),
            },
        };
    }
}

function meteredFetch(meter: SpendMeter): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;
        if (url.includes('places:searchText')) meter.record('textsearch');
        else if (url.includes('/media')) meter.record('media');
        else if (url.includes('places.googleapis.com/v1/places/')) meter.record('details');
        return await fetch(input, init);
    }) as typeof fetch;
}

export function isPermanentBackfillOutcome(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith('UNMATCHABLE_');
}

export async function loadReferencedRestaurantIds(supabase: any): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (const table of REFERENCE_HOLDERS) {
        for (let from = 0;; from += 1000) {
            let query = supabase
                .from(table)
                .select('restaurant_id')
                .not('restaurant_id', 'is', null);
            // These holders retain invisible tombstones for audit/idempotency;
            // they are not active product references and must never authorize
            // paid backfill work.
            if (SOFT_DELETE_HOLDERS.has(table)) query = query.is('deleted_at', null);
            const { data, error } = await query.range(from, from + 999);
            if (error) throw new Error(`${table} scope read failed: ${error.message}`);
            for (const row of data ?? []) {
                if (typeof row.restaurant_id === 'string') referenced.add(row.restaurant_id);
            }
            if (!data || data.length < 1000) break;
        }
    }
    return referenced;
}

async function readWatermark(options: BackfillOptions): Promise<string | null> {
    if (options.watermark) return options.watermark;
    if (!options.watermarkFile) return null;
    try {
        const value = (await Deno.readTextFile(options.watermarkFile)).trim();
        if (value && UUID_RE.test(value)) return value;
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return null;
}

async function writeWatermark(path: string | null, value: string): Promise<void> {
    if (!path) return;
    await Deno.writeTextFile(path, `${value}\n`);
}

export interface BackfillRow {
    id: string;
    external_id: string | null;
    name: string | null;
    city: string | null;
    address: string | null;
    photo_source: string | null;
}

interface BackfillProviderLike {
    attest(ownerId: string, externalId: string, claimant: string): Promise<any>;
    searchText(ownerId: string, input: Record<string, unknown>): Promise<any[]>;
    persistAttestedRestaurant(
        ownerId: string,
        restaurantId: string,
        projection: any,
        claimant: string,
        persistHero: boolean,
        allowCanonicalize: boolean,
    ): Promise<unknown>;
}

export function buildDryRunReport(
    referencedRows: number,
    candidateRows: BackfillRow[],
    options: BackfillOptions,
    watermark: string | null,
) {
    const selected = candidateRows.slice(0, options.maxRows);
    const estimated = {
        details: selected.filter((row) => row.external_id && !row.external_id.startsWith('ghost_')).length,
        textsearch: selected.filter((row) => !row.external_id || row.external_id.startsWith('ghost_')).length,
        media: selected.filter((row) => row.photo_source == null).length,
    };
    const estimatedUsd = {
        details: estimated.details * SKU_USD.details,
        textsearch: estimated.textsearch * SKU_USD.textsearch,
        media: estimated.media * SKU_USD.media,
    };
    return {
        mode: 'dry-run' as const,
        referenced_rows: referencedRows,
        incomplete_rows: candidateRows.length,
        selected_rows: selected.length,
        watermark,
        estimated_calls: estimated,
        estimated_usd: {
            ...estimatedUsd,
            total: estimatedUsd.details + estimatedUsd.textsearch + estimatedUsd.media,
        },
    };
}

export async function executeBackfillRows(input: {
    options: BackfillOptions;
    budgetUserId: string;
    candidateRows: BackfillRow[];
    provider: BackfillProviderLike;
    initialWatermark: string | null;
    persistWatermark?: (value: string) => Promise<void>;
    logger?: Pick<Console, 'warn' | 'error'>;
}) {
    const selected = input.candidateRows.slice(0, input.options.maxRows);
    const logger = input.logger ?? console;
    let completed = 0;
    let permanentlyUnmatchable = 0;
    let retryable = input.candidateRows.length - selected.length;
    let lastWatermark = input.initialWatermark;
    const persistWatermark = input.persistWatermark ?? (() => Promise.resolve());

    for (const row of selected) {
        try {
            let externalId = typeof row.external_id === 'string' && !row.external_id.startsWith('ghost_')
                ? row.external_id
                : null;
            let projection;
            const claimant = crypto.randomUUID();
            if (externalId) {
                try {
                    projection = await input.provider.attest(input.budgetUserId, externalId, claimant);
                } catch (error) {
                    if (!(error instanceof CompletenessPaidPathError) || error.providerStatus !== 404) throw error;
                    externalId = null;
                }
            }
            if (!externalId) {
                if (!row.name || !row.city) throw new Error('UNMATCHABLE_MISSING_NAME_OR_CITY');
                const candidates = await input.provider.searchText(input.budgetUserId, {
                    name: row.name,
                    city: row.city,
                    address: row.address,
                });
                const scored = scoreDeferredCandidates(
                    { name: row.name, city: row.city },
                    candidates.map((candidate) => ({
                        externalId: candidate.externalId,
                        name: candidate.name,
                        city: candidate.city,
                        formattedAddress: candidate.formattedAddress,
                    })),
                );
                if (scored.decision !== 'matched' || !scored.match) {
                    throw new Error(`UNMATCHABLE_${scored.decision.toUpperCase()}`);
                }
                externalId = scored.match.externalId;
                projection = await input.provider.attest(input.budgetUserId, externalId, claimant);
            }
            await input.provider.persistAttestedRestaurant(
                input.budgetUserId,
                row.id,
                projection!,
                claimant,
                true,
                true,
            );
            completed += 1;
            lastWatermark = row.id;
            await persistWatermark(row.id);
        } catch (error) {
            if (isPermanentBackfillOutcome(error)) {
                permanentlyUnmatchable += 1;
                lastWatermark = row.id;
                await persistWatermark(row.id);
                logger.warn(`backfill left genuinely unmatchable ${row.id}:`, error);
                continue;
            }
            retryable += 1;
            logger.error(`backfill stopped at ${row.id}:`, error);
            break;
        }
    }

    return {
        selected_rows: selected.length,
        completed_rows: completed,
        permanently_unmatchable_rows: permanentlyUnmatchable,
        retryable_rows: retryable,
        watermark: lastWatermark,
    };
}

async function main(): Promise<void> {
    const options = parseBackfillArgs(Deno.args);
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRole) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    const budgetUserId = Deno.env.get('BACKFILL_BUDGET_USER_ID') ?? '';
    if (options.execute && !UUID_RE.test(budgetUserId)) {
        throw new Error('BACKFILL_BUDGET_USER_ID must be a real profile UUID for --execute');
    }

    const supabase = createClient(supabaseUrl, serviceRole);
    const referenced = await loadReferencedRestaurantIds(supabase);
    const watermark = await readWatermark(options);
    const ids = [...referenced].sort().filter((id) => !watermark || id > watermark);
    const candidateRows: BackfillRow[] = [];
    for (let index = 0; index < ids.length; index += 500) {
        const chunk = ids.slice(index, index + 500);
        const { data, error } = await supabase
            .from('restaurants')
            .select('id,external_id,name,city,address,lat,lng,photo_source,verification,merged_into')
            .in('id', chunk)
            .is('merged_into', null)
            .or('lat.is.null,lng.is.null,photo_source.is.null');
        if (error) throw error;
        candidateRows.push(...(data ?? []));
    }
    candidateRows.sort((left, right) => left.id.localeCompare(right.id));

    if (!options.execute) {
        console.log(JSON.stringify(
            buildDryRunReport(referenced.size, candidateRows, options, watermark),
            null,
            2,
        ));
        if (candidateRows.length > 0) Deno.exit(3);
        return;
    }

    const meter = new SpendMeter(options);
    const provider = new CompletenessProvider(supabase, {
        googleApiKey: Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '',
        fetchImpl: meteredFetch(meter),
        // DB completeness_control remains the authoritative kill-switch.
        spendFrozen: Deno.env.get('COMPLETENESS_SPEND_FROZEN') === 'true',
    });
    const execution = await executeBackfillRows({
        options,
        budgetUserId,
        candidateRows,
        provider,
        initialWatermark: watermark,
        persistWatermark: (value) => writeWatermark(options.watermarkFile, value),
    });

    console.log(JSON.stringify({
        mode: 'execute',
        ...execution,
        ...meter.report(),
    }, null, 2));
    if (execution.retryable_rows > 0) Deno.exit(3);
}

if (import.meta.main) {
    await main();
}
