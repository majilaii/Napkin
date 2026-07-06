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
    // App-Group import queue (TICKET-083 inc3) — synchronous file ops.
    listImportManifests(): string[];
    writeImportManifest(jobId: string, json: string): boolean;
    removeImportManifest(jobId: string): boolean;
    appGroupFileInfo(path: string): { exists: boolean; size: number };
    deleteAppGroupFile(path: string): boolean;
    writeAppGroupSnapshot(json: string): boolean;
    // App-Group shared scalar prefs (TICKET-113 Part B) — synchronous KV on the
    // shared suite, readable by the share extension at launch.
    setSharedDefault(key: string, value: string): boolean;
    getSharedDefault(key: string): string | null;
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

// ── App-Group import queue (TICKET-083 inc3) ────────────────────────────────
// Thin lazy wrappers over the native file ops. They THROW if the native module
// isn't linked — callers (lib/importQueue, useProcessImportQueue) gate on
// isVideoImportAvailable() and/or wrap in try/catch so a missing module degrades
// gracefully instead of crashing.

export function listImportManifests(): string[] {
    return getNative().listImportManifests();
}

export function writeImportManifest(jobId: string, json: string): boolean {
    return getNative().writeImportManifest(jobId, json);
}

export function removeImportManifest(jobId: string): boolean {
    return getNative().removeImportManifest(jobId);
}

export function appGroupFileInfo(path: string): { exists: boolean; size: number } {
    return getNative().appGroupFileInfo(path);
}

export function deleteAppGroupFile(path: string): boolean {
    return getNative().deleteAppGroupFile(path);
}

/** Publish the user's collections (lists + tables) for the share extension's picker. */
export function writeAppGroupSnapshot(json: string): boolean {
    return getNative().writeAppGroupSnapshot(json);
}

// ── App-Group shared scalar prefs (TICKET-113 Part B) ───────────────────────
// Mirror small string prefs (e.g. the import default mode) into the app group so
// the share extension — a separate process that can't read AsyncStorage — can seed
// its UI. THROW if the native module is absent; callers guard (see importQueue.ts).

/** Write a scalar pref to the shared App-Group UserDefaults. */
export function setSharedDefault(key: string, value: string): boolean {
    return getNative().setSharedDefault(key, value);
}

/** Read a scalar pref from the shared App-Group UserDefaults (null if unset). */
export function getSharedDefault(key: string): string | null {
    return getNative().getSharedDefault(key);
}
