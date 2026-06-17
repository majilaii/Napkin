import { requireNativeModule } from 'expo';

import type { ExtractOptions, ExtractResult } from './src/MediaExtract.types';

export * from './src/MediaExtract.types';

// LAZY native binding. requireNativeModule throws if the native module isn't
// present in the build — so we resolve it on first CALL, never at import time.
// This keeps a missing/failed-to-link native module from crashing app launch
// (ImportLinkSheet imports this barrel at the top level); video import just
// fails gracefully instead.
type NativeMediaExtract = {
    extractFromVideo(
        uri: string,
        maxFrames: number,
        fps: number,
        transcribe: boolean,
    ): Promise<ExtractResult>;
};

let cached: NativeMediaExtract | null = null;

function getNative(): NativeMediaExtract {
    if (!cached) {
        cached = requireNativeModule<NativeMediaExtract>('MediaExtract');
    }
    return cached;
}

/**
 * True when the native module is present in this build. Safe to call at any time
 * (never throws). Used to gate the "import a video" affordance — if the module
 * didn't link, we hide the entry point rather than show a button that errors.
 */
export function isVideoImportAvailable(): boolean {
    try {
        getNative();
        return true;
    } catch {
        return false;
    }
}

/**
 * Extract text from a video entirely on-device:
 *   • Vision OCR of frames sampled across the clip (on-screen overlay text)
 *   • SFSpeechRecognizer transcript of the voiceover (best-effort)
 * Returns the raw text for the server-side restaurant extractor. No network,
 * no per-import API cost. Rejects (never crashes the app) if the native module
 * is unavailable on this build.
 */
export async function extractFromVideo(
    uri: string,
    opts?: ExtractOptions,
): Promise<ExtractResult> {
    return getNative().extractFromVideo(
        uri,
        opts?.maxFrames ?? 60,
        opts?.fps ?? 1,
        opts?.transcribe ?? true,
    );
}
