/**
 * importFastPath — the caption+ASR "cheap text was enough" gate (TICKET-164).
 *
 * Pure + unit-tested (mirrors importTruncation / largeImportJob): the whole
 * conservative skip-the-video decision lives here so it is testable without RN or
 * native mocks. useProcessImportQueue runs `evaluateFastPath` on the cheap-tier
 * resolve response — a 'pass' auto-saves WITHOUT downloading the video; any other
 * verdict escalates into today's download → OCR → STT ladder.
 *
 * Bias (ticket): uncertain ⇒ escalate. The fast path must EARN its skip — every
 * gate is "sufficient-or-escalate", never "probably fine". The removed corroborating
 * channels (OCR overlay + full voiceover) are why a passing/comparative mention or
 * a short-of-count list is NOT trusted from text alone. Asymmetry favours safety: a
 * false escalate costs today's slow import; a false pass costs one visible, one-tap-
 * fixable pin — the user is the backstop, never a confirmation gate.
 */

/** The recorded outcome — 'pass' skips the video; every other value escalates. */
export type FastPathGate =
    | 'pass'
    | 'old_server' //        structural: list_count_raw absent (pre-164 server, mid-rollout)
    | 'no_candidates' //     the cheap tier found nothing — OCR may still find spots
    | 'count_short' //       content: fewer candidates than the caption advertised
    | 'ghost' //             content: a candidate never resolved to a real Place
    | 'low_conf' //          content: a candidate resolved at 'low' confidence
    | 'stance' //            content: a candidate is neutral / warned / missing stance
    | 'no_asr_ambiguous'; // structural: multi-candidate with no corroborating ASR

/**
 * The CONTENT-reason rejections. R3: a content-reason reject that escalation could
 * not add perception text to must NOT auto-save (the re-extraction would only
 * reproduce the same rejected candidates). Structural rejects (old_server /
 * no_asr_ambiguous) and the never-ran/no-candidates cases save as today.
 */
const CONTENT_GATES: ReadonlySet<string> = new Set([
    'count_short',
    'ghost',
    'low_conf',
    'stance',
]);

/** True when the gate rejected for a content reason (feeds the R3 guard). */
export function isContentGate(gate: string): boolean {
    return CONTENT_GATES.has(gate);
}

/** The candidate fields the gate reads — a structural subset of ResolvedCandidate. */
export interface FastPathCandidate {
    restaurant_id: string | null;
    restaurant: { external_id: string | null };
    confidence: 'exact' | 'high' | 'low';
    stance?: 'recommended' | 'warned' | 'neutral' | null;
}

export interface FastPathInput {
    provider: 'tiktok' | 'instagram';
    candidates: FastPathCandidate[];
    /** The server's UNCLAMPED, caption-first list count. undefined = old server. */
    listCountRaw: number | null | undefined;
    /** Chars of platform ASR transcript INCLUDED in the cheap tier. TikTok only —
     * always 0 for Instagram (no platform ASR). */
    transcriptChars: number;
}

/**
 * Evaluate the gates IN ORDER; the FIRST failure is the recorded gate. Order:
 * old_server → no_candidates → count_short → ghost → low_conf → stance →
 * no_asr_ambiguous.
 */
export function evaluateFastPath(input: FastPathInput): FastPathGate {
    const { provider, candidates, listCountRaw, transcriptChars } = input;

    // 1. Old server (field absent mid-rollout) → escalate [structural]. The server
    //    ships first, so after rollout list_count_raw is always present.
    if (listCountRaw === undefined) return 'old_server';

    // 2. Zero candidates → escalate; the ladder may still find spots via OCR.
    if (candidates.length < 1) return 'no_candidates';

    // 3. Fewer candidates than the caption advertised (UNCLAMPED) → escalate
    //    [content]. list_count_raw null = no marker → the count gate passes.
    if (candidates.length < (listCountRaw ?? 0)) return 'count_short';

    // 4. Any ghost (unresolved Place) → escalate [content]; then any non-'high'
    //    confidence → escalate [content]. resolveCandidateToPlace only clears the
    //    namesOverlap gate at 'high' (video path emits high|low, exact→high), so a
    //    ghost means the name never matched a real Place.
    for (const c of candidates) {
        const resolved = c.restaurant_id != null || c.restaurant.external_id != null;
        if (!resolved) return 'ghost';
    }
    for (const c of candidates) {
        if (c.confidence !== 'high') return 'low_conf';
    }

    // 5. Any non-'recommended' stance (a neutral comparison / passing mention, a
    //    warned anti-rec, or a missing stance) → escalate [content]. `warned` never
    //    auto-saves on either path — it fails here.
    for (const c of candidates) {
        if (c.stance !== 'recommended') return 'stance';
    }

    // 6. Ambiguity [structural].
    //    TikTok: SINGLE candidate only (TICKET-175). The original ≥80-transcript-
    //    chars multi-candidate allowance trusted Haiku's confidence to catch ASR
    //    garbles — it doesn't ("Tishun", "Elmersym", "Lockdown Bakery" all rated
    //    'high'; 2026-07-11 prod evidence). Multi-spot TikToks always earn the
    //    fused OCR pass, whose on-screen spellings anchor the names.
    //    Instagram (typed captions, no ASR): a single candidate OR a caption list
    //    marker whose count is fully satisfied (guaranteed by step 3 when
    //    listCountRaw is non-null, so this only bites multi-candidate IG with NO
    //    marker).
    if (provider === 'tiktok') {
        if (candidates.length !== 1) return 'no_asr_ambiguous';
    } else {
        const markerSatisfied = listCountRaw != null && candidates.length >= listCountRaw;
        if (candidates.length !== 1 && !markerSatisfied) return 'no_asr_ambiguous';
    }

    return 'pass';
}
