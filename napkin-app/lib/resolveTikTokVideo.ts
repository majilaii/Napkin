import type { ExtractOptions, ExtractResult } from '@/modules/media-extract/src/MediaExtract.types';
import type { ResolveUrlData } from '@/hooks/wishlist/useResolveUrl';
import type { TikTokPerception } from './tiktokPerception';
import { evaluateFastPath } from './importFastPath';
import { buildVideoImportEvidence } from './videoImportEvidence';
import { OCR_WALLCLOCK_BUDGET_MS } from './importBudgets';
import { classifyImportFailure } from './importFailureCopy';

export const SHEET_VIDEO_DOWNLOAD_MS = 30_000;
export const SHEET_VIDEO_STT_MS = 30_000;

export interface TikTokResolveDependencies {
    perceive(url: string, deadlineAt?: number): Promise<TikTokPerception | null>;
    download(address: string, pageUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null>;
    extract(uri: string, options: ExtractOptions): Promise<ExtractResult>;
    remove(uri: string): Promise<void>;
    resolve(body: Record<string, unknown>, signal: AbortSignal): Promise<ResolveUrlData>;
    available(): boolean;
    /** Reuse the edge transport's JWT/auth predicate without loading RN here. */
    isAuthFailure?(error: unknown): boolean;
}

function assertActive(signal: AbortSignal): void {
    if (!signal.aborted) return;
    const error = new Error('Import cancelled');
    error.name = 'AbortError';
    throw error;
}

/** The pasted-link path must inspect video when caption/ASR cannot identify it. */
export async function resolveTikTokVideo(
    url: string,
    signal: AbortSignal,
    deps: TikTokResolveDependencies,
    captionOverride?: string,
): Promise<ResolveUrlData | null> {
    assertActive(signal);
    let page = await deps.perceive(url);
    assertActive(signal);
    // Photo posts retain their established route; this ladder reads video.
    if (!page || page.isPhotoPost) return null;
    let caption = captionOverride || page.desc;
    let transcript = page.transcript;
    let cheap: ResolveUrlData | null = null;
    let lastResolvedBody: string | null = null;
    let lastResolveFailed = false;
    let lastResolveError: unknown;
    const textBody = (text: string) => ({
        ...(caption ? { caption } : {}),
        ...(text ? { extracted_text: text } : {}),
    });
    const resolveEvidence = async (evidence?: ExtractResult) => {
        assertActive(signal);
        const text = buildVideoImportEvidence(evidence ?? { ocr: [], transcript }, transcript);
        const body = textBody(text);
        if (!caption && !text) return cheap;
        const fingerprint = JSON.stringify(body);
        if (fingerprint === lastResolvedBody) {
            if (lastResolveFailed) throw lastResolveError;
            return cheap;
        }
        // A failed extraction can already have spent its rate slot. Remember
        // attempts, not only successes, so an unchanged fallback never rebills.
        lastResolvedBody = fingerprint;
        try {
            const result = await deps.resolve(body, signal);
            assertActive(signal);
            lastResolveFailed = false;
            cheap = result;
            return result;
        } catch (error) {
            lastResolveFailed = true;
            lastResolveError = error;
            throw error;
        }
    };
    const resolveWithoutVideo = async () => {
        const result = await resolveEvidence();
        // With no usable video evidence, keep the established URL/thumbnail
        // recovery available to the hook. A genuine OCR zero-result below is
        // authoritative and must not be replaced by a weaker thumbnail guess.
        return result?.candidates.length ? result : null;
    };
    if (caption || transcript) {
        try {
            cheap = await resolveEvidence();
        } catch (error) {
            assertActive(signal);
            const typed = error as { code?: string; cause?: { status?: number }; name?: string } | null;
            const status = typed?.cause?.status;
            const reason = classifyImportFailure(error).reason;
            if (typed?.name === 'AbortError' || typed?.code === 'session_expired' ||
                status === 401 || status === 403 || status === 408 || deps.isAuthFailure?.(error) ||
                reason === 'offline' || reason === 'rate_limited' || reason === 'server') throw error;
            // Deterministic cheap extraction failure is recoverable when OCR
            // adds evidence. Otherwise resolveEvidence rethrows the original.
        }
        assertActive(signal);
        if (cheap && evaluateFastPath({
            provider: 'tiktok', candidates: cheap.candidates,
            listCountRaw: cheap.list_count_raw, transcriptChars: transcript.length, caption,
        }) === 'pass') return cheap;
    }
    if (!deps.available()) return resolveWithoutVideo();

    const deadline = Date.now() + SHEET_VIDEO_DOWNLOAD_MS;
    let file: string | null = null;
    for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
        assertActive(signal);
        if (page.playAddr) {
            file = await deps.download(page.playAddr, url, deadline - Date.now(), signal);
        }
        if (file) break;
        assertActive(signal);
        if (attempt === 0 && Date.now() < deadline) {
            const refreshed = await deps.perceive(url, deadline);
            assertActive(signal);
            if (!refreshed || refreshed.isPhotoPost) break;
            page = refreshed;
            // Preserve channels a degraded refresh lacks, but accept newly
            // recovered/full text. A refresh can rescue the only venue name
            // even if downloading or native OCR subsequently fails.
            caption = captionOverride || refreshed.desc || caption;
            transcript = refreshed.transcript || transcript;
        }
    }
    if (!file) return resolveWithoutVideo();

    try {
        assertActive(signal);
        let evidence: ExtractResult;
        try {
            evidence = await deps.extract(file, {
                signal, transcribe: !transcript, ocrBudgetMs: OCR_WALLCLOCK_BUDGET_MS,
                sttTimeoutMs: SHEET_VIDEO_STT_MS,
            });
        } catch (error) {
            assertActive(signal);
            if (error instanceof Error && error.name === 'AbortError') throw error;
            return await resolveWithoutVideo();
        }
        assertActive(signal);
        // Compare the complete body, not only OCR character counts: refreshed
        // caption/ASR and v4 frame evidence can add information independently.
        return buildVideoImportEvidence(evidence)
            ? await resolveEvidence(evidence)
            : await resolveWithoutVideo();
    } finally {
        // Native work is not forcibly cancellable: it has settled before this
        // file can be removed. The shared wrapper serializes native extractions.
        await deps.remove(file);
    }
}
