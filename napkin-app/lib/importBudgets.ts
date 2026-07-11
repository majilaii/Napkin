/**
 * importBudgets — the ONE place the link-import stage budgets live (TICKET-164).
 *
 * The escalated perception ladder (download → OCR → STT) was unbounded: a long
 * clip could stream 50–150MB, OCR 240 frames sequentially, then transcribe a
 * 5-minute voiceover near real-time — and a stalled recognizer hung the import
 * forever. These budgets cap every stage so an import can never hang; a stage that
 * expires returns whatever it has (partial OCR lines / the latest partial STT).
 *
 * Two consumers:
 *   • the JS download timeout (useProcessImportQueue → downloadTikTokVideo), and
 *   • the native OCR/STT budgets, threaded through media-extract's extractFromVideo
 *     as call params behind the apiVersion capability gate (R4) — the Swift side
 *     mirrors these values as fallbacks for a nil arg, but JS is authoritative.
 *
 * All four are "tune on device during build" (Open Q a) — provisional numbers
 * chosen so the common single-restaurant clip finishes in seconds, not minutes.
 */

/**
 * Stage-wide download deadline (R8): shared across BOTH retry attempts AND the
 * page/VTT re-fetches — NOT 2×N. A signed CDN URL that stalls past this is
 * abandoned (partial file cleaned up) and the import falls back to caption text.
 *
 * TICKET-175: 30s (sized to the "~12MB" assumption) killed every multi-minute
 * TopJaw download → OCR never ran → the review sheet held ASR garbles (Ep.245
 * repro, 2026-07-11 22:03 — cheap-tier row, no fused row). 90s fits real
 * 50–150MB clips while staying bounded.
 */
export const VIDEO_DOWNLOAD_TIMEOUT_MS = 90_000;

/**
 * OCR wall-clock budget: bounds the frame-GENERATION phase AND the 240-frame
 * `.accurate` Vision pass together. On expiry the generator is cancelled and the
 * lines gathered so far are returned (partial OCR still carries most spots).
 */
export const OCR_WALLCLOCK_BUDGET_MS = 45_000;

/**
 * STT hard timeout: cancels the SFSpeechRecognitionTask and resumes with the
 * latest partial transcript. Without it a recognizer that never reports `isFinal`
 * hangs the whole import.
 */
export const STT_TIMEOUT_MS = 90_000;

/**
 * Skip STT entirely above this clip duration (seconds). A long voiceover's
 * real-time recognition tail dominates wall clock with little marginal recall —
 * OCR still carries the on-screen names.
 */
export const STT_MAX_DURATION_SEC = 300;
