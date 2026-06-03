/**
 * table-shares edge function — TICKET-060
 *
 * POST actions:
 *   create_import — single transactional fan-out: validate all table_ids vs
 *     table_members.member_id → fn_create_import writes job + all pending rows →
 *     fire async extract (non-awaited). Returns job_id + pending rows. [R1/R2]
 *
 *   correct — author re-points the job's restaurant and propagates to all
 *     destination rows. [R1]
 *
 *   dismiss_float — mark a float dismissed (saver-set keyed). [R4]
 *
 * Upload validation is the SINGLE allowed pre-extraction block (R9/M1):
 *   size (> 5MB → 413), type (not image/* → 415), dimension clamp done client-side
 *   + server-re-clamped. This runs before any job write.
 *
 * Membership validation: every ticked table_id is checked vs table_members.member_id
 *   before fn_create_import runs. A single invalid table_id fails the WHOLE call. [H2/R2]
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { hashImage, hashTextSource, HASH_VERSION } from '../_shared/contentHash.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CreateImportBody {
    // Source: either an uploaded image path or a URL
    image_path?: string;
    source_url?: string;
    caption?: string;
    // Destination fan-out
    destinations: {
        wishlist: boolean;
        table_ids: string[];
        // list_ids deliberately omitted (R12 — no List rows in v1)
    };
    // Optional note to attach to the share card
    note?: string;
}

interface CorrectImportBody {
    job_id: string;
    restaurant_id: string;     // The correct restaurant's Napkin UUID
    external_id?: string;      // Optional: re-point via external_id if restaurant doesn't exist yet
}

interface DismissFloatBody {
    float_id: string;          // table_float_state.id
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify({ data }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function err(code: string, message: string, status = 400, details?: unknown) {
    return new Response(
        JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
}

// Upload validation constants (R9/M1)
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
]);

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return err('METHOD_NOT_ALLOWED', 'POST only', 405);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
        return err('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
        return err('UNAUTHORIZED', 'Unauthorized', 401);
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { action?: string } & Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return err('INVALID_BODY', 'Request body must be JSON', 400);
    }

    const action = body?.action;
    if (!action) {
        return err('MISSING_ACTION', 'action is required', 400);
    }

    // ── Route ─────────────────────────────────────────────────────────────────
    if (action === 'create_import') {
        return handleCreateImport(supabase, user, body as CreateImportBody & { action: string }, supabaseUrl);
    }
    if (action === 'correct') {
        return handleCorrect(supabase, user, body as CorrectImportBody & { action: string });
    }
    if (action === 'dismiss_float') {
        return handleDismissFloat(supabase, user, body as DismissFloatBody & { action: string });
    }

    return err('UNKNOWN_ACTION', `Unknown action: ${action}`, 400);
});

// ── Action: create_import ─────────────────────────────────────────────────────

async function handleCreateImport(
    supabase: any,
    user: { id: string },
    body: CreateImportBody & { action: string },
    supabaseUrl: string,
): Promise<Response> {
    const { image_path, source_url, caption, destinations, note } = body;
    const { wishlist = true, table_ids = [] } = destinations ?? {};

    // ── Upload validation (R9/M1) — THE SINGLE pre-extraction block ──────────
    // Validate before ANY row is written. Only runs if an image path is provided.
    if (image_path) {
        // Fetch the upload metadata from Storage to check size and type
        const { data: fileData, error: fileErr } = await supabase.storage
            .from('import-uploads')
            .list(image_path.split('/').slice(0, -1).join('/'), {
                search: image_path.split('/').pop(),
                limit: 1,
            });

        if (fileErr || !fileData?.[0]) {
            return err('IMAGE_NOT_FOUND', 'Uploaded image not found', 404);
        }

        const file = fileData[0] as { metadata?: { size?: number; mimetype?: string } };
        const size = file.metadata?.size ?? 0;
        const mimeType = file.metadata?.mimetype ?? '';

        if (size > MAX_UPLOAD_BYTES) {
            return err('UPLOAD_TOO_LARGE', `Image exceeds 5 MB limit (got ${size} bytes)`, 413);
        }
        if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
            return err('INVALID_MIME_TYPE', `Unsupported image type: ${mimeType}`, 415);
        }
    }

    // ── Membership validation (H2/R2) — before any write ────────────────────
    // Every ticked table_id must be a table the caller is a member of.
    // A single invalid table_id fails the WHOLE call (no partial fan-out).
    if (table_ids.length > 0) {
        const { data: memberships } = await supabase
            .from('table_members')
            .select('table_id')
            .eq('member_id', user.id)       // NEVER tm.user_id (CLAUDE.md doctrine)
            .in('table_id', table_ids);

        const memberTableIds = new Set(
            (memberships ?? []).map((m: { table_id: string }) => m.table_id),
        );
        const invalid = table_ids.filter((id: string) => !memberTableIds.has(id));
        if (invalid.length > 0) {
            return err('NOT_MEMBER', `Not a member of table(s): ${invalid.join(', ')}`, 403);
        }
    }

    // ── Compute content hash (R13) ────────────────────────────────────────────
    let contentHash: string | null = null;
    if (image_path) {
        // Image hash: we compute from the actual bytes during extract; store null for now.
        // The async extractor will populate extraction_cache with the image hash.
        // For idempotency on repeated creates with the same image_path, we use
        // a hash of the image_path string as a placeholder.
        const pathBytes = new TextEncoder().encode(image_path);
        const pathHashBuffer = await crypto.subtle.digest('SHA-256', pathBytes);
        const pathHashArr = Array.from(new Uint8Array(pathHashBuffer));
        contentHash = `path_${pathHashArr.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    } else if (source_url) {
        contentHash = await hashTextSource(source_url, caption);
    }

    // Build source jsonb
    const sourcePayload: Record<string, unknown> = {};
    if (image_path) {
        sourcePayload.type = 'screenshot';
        sourcePayload.upload_path = image_path;
        if (caption) sourcePayload.caption = caption;
    } else if (source_url) {
        sourcePayload.type = 'vision';
        sourcePayload.source_url = source_url;
        if (caption) sourcePayload.caption = caption;
    }

    // ── Atomic job + destination writes (R1/R2) ───────────────────────────────
    const { data: fnResult, error: fnError } = await supabase.rpc('fn_create_import', {
        p_user_id: user.id,
        p_content_hash: contentHash,
        p_source: Object.keys(sourcePayload).length > 0 ? sourcePayload : null,
        p_wishlist: wishlist,
        p_table_ids: table_ids,
    });

    if (fnError || !fnResult) {
        console.error('fn_create_import error:', fnError);
        return err('CREATE_FAILED', 'Failed to create import job', 500);
    }

    const jobId = fnResult.job_id as string;
    const wishlistId = fnResult.wishlist_id as string | null;
    const shareIds = fnResult.share_ids as string[];

    // Update table_shares with note + source if provided
    if (shareIds.length > 0 && (note || Object.keys(sourcePayload).length > 0)) {
        await supabase
            .from('table_shares')
            .update({
                ...(note ? { note } : {}),
                ...(Object.keys(sourcePayload).length > 0 ? { source: sourcePayload } : {}),
            })
            .in('id', shareIds);
    }

    // ── Fire async extract (non-awaited) — R1 ────────────────────────────────
    // The extract runs in the background; this request returns immediately.
    // Status: pending → resolved | needs_confirm | failed via PATCHes from resolve-url.
    if (image_path || source_url) {
        const extractUrl = `${supabaseUrl}/functions/v1/resolve-url`;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        // Fire and forget — don't await
        fetch(extractUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Use the service role key for the extract action so it can PATCH the job
                Authorization: `Bearer ${supabaseServiceKey}`,
                apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            },
            body: JSON.stringify({
                action: 'extract',
                job_id: jobId,
            }),
        }).catch((e) => console.error('Async extract fire failed:', e));
    }

    return json({
        job_id: jobId,
        wishlist_id: wishlistId,
        share_ids: shareIds,
        status: 'pending',
    });
}

// ── Action: correct ───────────────────────────────────────────────────────────

async function handleCorrect(
    supabase: any,
    user: { id: string },
    body: CorrectImportBody & { action: string },
): Promise<Response> {
    const { job_id, restaurant_id } = body;
    if (!job_id || !restaurant_id) {
        return err('MISSING_PARAMS', 'job_id and restaurant_id are required', 400);
    }

    // Validate: caller must be the job's author (R1)
    const { data: job } = await supabase
        .from('import_jobs')
        .select('job_id, user_id, status')
        .eq('job_id', job_id)
        .maybeSingle();

    if (!job) {
        return err('NOT_FOUND', 'Import job not found', 404);
    }
    if (job.user_id !== user.id) {
        return err('FORBIDDEN', 'Not your import job', 403);
    }

    // Validate the target restaurant exists and is accessible
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id, verification, created_by')
        .eq('id', restaurant_id)
        .maybeSingle();

    if (!restaurant) {
        return err('RESTAURANT_NOT_FOUND', 'Restaurant not found', 404);
    }

    // Re-point the job and all destination rows (R1 — job-level propagation)
    await supabase
        .from('import_jobs')
        .update({ restaurant_id, status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('job_id', job_id);

    await supabase
        .from('wishlist_items')
        .update({ restaurant_id, extraction_status: 'resolved' })
        .eq('job_id', job_id);

    await supabase
        .from('table_shares')
        .update({ restaurant_id, extraction_status: 'resolved' })
        .eq('job_id', job_id);

    return json({ job_id, restaurant_id, status: 'resolved' });
}

// ── Action: dismiss_float ─────────────────────────────────────────────────────

async function handleDismissFloat(
    supabase: any,
    user: { id: string },
    body: DismissFloatBody & { action: string },
): Promise<Response> {
    const { float_id } = body;
    if (!float_id) {
        return err('MISSING_PARAMS', 'float_id is required', 400);
    }

    // Validate: caller must be a member of the float's table
    const { data: floatRow } = await supabase
        .from('table_float_state')
        .select('id, table_id, saver_set_hash')
        .eq('id', float_id)
        .maybeSingle();

    if (!floatRow) {
        return err('NOT_FOUND', 'Float not found', 404);
    }

    // Membership check
    const { data: membership } = await supabase
        .from('table_members')
        .select('member_id')
        .eq('table_id', floatRow.table_id)
        .eq('member_id', user.id)    // NEVER tm.user_id
        .maybeSingle();

    if (!membership) {
        return err('FORBIDDEN', 'Not a member of this table', 403);
    }

    // Dismiss and suppress for 30 days (R4)
    const suppressedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
        .from('table_float_state')
        .update({
            dismissed_at: new Date().toISOString(),
            suppressed_until: suppressedUntil,
        })
        .eq('id', float_id);

    return json({ float_id, dismissed: true, suppressed_until: suppressedUntil });
}
