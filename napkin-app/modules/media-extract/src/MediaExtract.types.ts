export interface ExtractOptions {
    /** Max frames to sample across the whole clip (default 60). */
    maxFrames?: number;
    /** Sampling rate ceiling in frames/sec (default 1). Even-spread caps at maxFrames. */
    fps?: number;
    /** Run on-device voiceover transcription too (default true). */
    transcribe?: boolean;
    /**
     * TICKET-164: wall-clock budget (ms) for the whole OCR stage — bounds frame
     * GENERATION plus the Vision pass; partial lines returned on expiry. Applied
     * only on a native binary that advertises apiVersion >= 2 (else ignored).
     */
    ocrBudgetMs?: number;
    /**
     * TICKET-164: hard cap (ms) on STT — cancels the recognition task and resumes
     * with the latest partial. apiVersion >= 2 only.
     */
    sttTimeoutMs?: number;
    /**
     * TICKET-164: skip STT entirely above this clip duration (seconds).
     * apiVersion >= 2 only.
     */
    sttMaxDurationSec?: number;
}

export interface ExtractResult {
    /** Deduped on-screen text lines, in appearance order (Vision OCR). */
    ocr: string[];
    /** Voiceover transcript (SFSpeechRecognizer); '' when unavailable/denied. */
    transcript: string;
    /** Clip duration in seconds. */
    durationSec: number;
}
