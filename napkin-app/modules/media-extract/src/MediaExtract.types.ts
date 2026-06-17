export interface ExtractOptions {
    /** Max frames to sample across the whole clip (default 60). */
    maxFrames?: number;
    /** Sampling rate ceiling in frames/sec (default 1). Even-spread caps at maxFrames. */
    fps?: number;
    /** Run on-device voiceover transcription too (default true). */
    transcribe?: boolean;
}

export interface ExtractResult {
    /** Deduped on-screen text lines, in appearance order (Vision OCR). */
    ocr: string[];
    /** Voiceover transcript (SFSpeechRecognizer); '' when unavailable/denied. */
    transcript: string;
    /** Clip duration in seconds. */
    durationSec: number;
}
