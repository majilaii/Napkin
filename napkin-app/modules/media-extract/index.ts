import MediaExtractModule from './src/MediaExtractModule';
import type { ExtractOptions, ExtractResult } from './src/MediaExtract.types';

export * from './src/MediaExtract.types';
export { default } from './src/MediaExtractModule';

/**
 * Extract text from a video entirely on-device:
 *   • Vision OCR of frames sampled across the clip (on-screen overlay text)
 *   • SFSpeechRecognizer transcript of the voiceover (best-effort)
 * Returns the raw text for the server-side restaurant extractor. No network,
 * no per-import API cost.
 */
export async function extractFromVideo(
    uri: string,
    opts?: ExtractOptions,
): Promise<ExtractResult> {
    return MediaExtractModule.extractFromVideo(
        uri,
        opts?.maxFrames ?? 60,
        opts?.fps ?? 1,
        opts?.transcribe ?? true,
    );
}
