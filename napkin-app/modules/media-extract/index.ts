import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

import type {
    ExtractOptions,
    ExtractResult,
    ImageExtractOptions,
    ImageExtractResult,
} from './src/MediaExtract.types';
// TICKET-164: the four stage budgets live in ONE place (lib/importBudgets); the
// native OCR/STT budgets are threaded here so they are never scattered magic
// numbers. The Swift side mirrors these as nil-arg fallbacks, but JS is
// authoritative on an apiVersion >= 2 binary.
import {
    OCR_WALLCLOCK_BUDGET_MS,
    STT_TIMEOUT_MS,
    STT_MAX_DURATION_SEC,
} from '@/lib/importBudgets';

export * from './src/MediaExtract.types';

// LAZY native binding. requireNativeModule throws if the native module isn't
// present in the build — so we resolve it on first CALL, never at import time.
// This keeps a missing/failed-to-link native module from crashing app launch
// (ImportLinkSheet imports this barrel at the top level); video import just
// fails gracefully instead.
type NativeMediaExtract = {
    /**
     * TICKET-164 [R4]: capability constant. Present + >= 2 on a native build that
     * accepts the OCR/STT budget params; absent (undefined) on the pre-164 binary.
     * The JS wrapper gates the grown 7-arg call on it — a blind positional grow
     * throws an ExpoModulesCore arg-count mismatch on every un-updated binary.
     * TICKET-176: >= 3 additionally exposes extractFromImages (photo-slide OCR);
     * the wrapper below never touches that function on a < 3 binary (it's absent).
     */
    apiVersion?: number;
    extractFromVideo(
        uri: string,
        maxFrames: number,
        fps: number,
        transcribe: boolean,
        // apiVersion >= 2 only — see extractFromVideo() below.
        ocrBudgetMs?: number,
        sttTimeoutMs?: number,
        sttMaxDurationSec?: number,
    ): Promise<ExtractResult>;
    /**
     * TICKET-176: OCR a set of photo-mode slide images. apiVersion >= 3 ONLY —
     * absent on a v2 binary, so extractFromImages() below gates on apiVersion
     * before calling (a missing function would throw, same skew law as R4).
     */
    extractFromImages(uris: string[], ocrBudgetMs?: number): Promise<ImageExtractResult>;
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
    // Background-runtime grant (TICKET-120) — buys ~30s after backgrounding so a
    // drain that finished while suspended can post its notification.
    beginBackgroundTask(): number;
    endBackgroundTask(taskId: number): boolean;
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
    // MediaExtract is backed exclusively by Apple Vision/Speech + App Groups.
    // Do not ask Expo's module registry for it on Android, even if a stale CNG
    // output accidentally advertises the package there.
    if (Platform.OS !== 'ios') return false;
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
    const native = getNative();
    const maxFrames = opts?.maxFrames ?? 60;
    const fps = opts?.fps ?? 1;
    const transcribe = opts?.transcribe ?? true;
    // R4: the native module grew OCR/STT budget params in apiVersion 2. On an
    // OLDER binary (OTA JS ahead of native) the 7-arg call throws an arg-count
    // mismatch and poisons video imports — so gate the grown signature on the
    // capability constant and fall back to the legacy 4-arg call. The defaults
    // come from importBudgets so every apiVersion-2 call gets real budgets even
    // when a caller omits opts (e.g. the shared-file video path).
    if ((native.apiVersion ?? 0) >= 2) {
        return native.extractFromVideo(
            uri,
            maxFrames,
            fps,
            transcribe,
            opts?.ocrBudgetMs ?? OCR_WALLCLOCK_BUDGET_MS,
            opts?.sttTimeoutMs ?? STT_TIMEOUT_MS,
            opts?.sttMaxDurationSec ?? STT_MAX_DURATION_SEC,
        );
    }
    return native.extractFromVideo(uri, maxFrames, fps, transcribe);
}

/**
 * TICKET-176: OCR a set of photo-mode slide images entirely on-device — the same
 * Vision pass as extractFromVideo's frame OCR. Feature-detected on apiVersion >= 3
 * (mirrors the extractFromVideo v2 gate EXACTLY): on an OLDER binary (OTA JS ahead
 * of native) the native function is ABSENT, so calling it would throw — return
 * null instead and the caller falls back to the {url} resolve (167 behavior). The
 * budget default comes from importBudgets so every call gets a real deadline even
 * when opts is omitted.
 */
export async function extractFromImages(
    uris: string[],
    opts?: ImageExtractOptions,
): Promise<ImageExtractResult | null> {
    const native = getNative();
    if ((native.apiVersion ?? 0) < 3) return null;
    return native.extractFromImages(uris, opts?.ocrBudgetMs ?? OCR_WALLCLOCK_BUDGET_MS);
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

// ── Background-runtime grant (TICKET-120) ───────────────────────────────────
// iOS suspends JS a few seconds after backgrounding. beginBackgroundTask asks
// UIApplication for ~30s more so an in-flight import drain can post its
// completion notification before suspension. THROW if the native module is absent;
// callers guard (see useProcessImportQueue's drain — acquire at start, end in finally).

/** Request background runtime; returns an opaque task id to release later (-1 = invalid). */
export function beginBackgroundTask(): number {
    return getNative().beginBackgroundTask();
}

/** Release a background-task grant. No-op-safe on an invalid/expired id. */
export function endBackgroundTask(taskId: number): boolean {
    return getNative().endBackgroundTask(taskId);
}
