import type { ExtractResult } from '@/modules/media-extract/src/MediaExtract.types';

// Leaves room for the server's separately budgeted 3,000-character caption.
// Keep speech in its own allowance so a busy scene cannot evict the voiceover.
export const VIDEO_EVIDENCE_CAP = 24000;

function cleanLine(value: string): string {
    // Native/platform text is content, never a new section of the evidence.
    return value.trim().replace(/^\[/, '(').replace(/\]$/, ')');
}

/** Spend the bound across every frame, never delete the middle of a tour. */
function fitBlocks(blocks: string[], cap: number): string {
    if (blocks.join('\n').length <= cap) return blocks.join('\n');
    // Native OCR has at most 240 frames. Bound pathological legacy arrays too,
    // keeping samples across the entire source instead of only its endpoints.
    const maxBlocks = Math.max(1, Math.floor(cap / 48));
    if (blocks.length > maxBlocks) {
        blocks = Array.from({ length: maxBlocks }, (_, i) =>
            blocks[Math.round(i * (blocks.length - 1) / Math.max(1, maxBlocks - 1))]);
    }
    let remaining = cap - Math.max(0, blocks.length - 1);
    const quotas = new Map<number, number>();
    // Small frames keep all their text and donate unused room to busy frames.
    const ordered = blocks.map((text, index) => ({ text, index }))
        .sort((a, b) => a.text.length - b.text.length);
    ordered.forEach(({ text, index }, i) => {
        const quota = Math.min(text.length, Math.floor(remaining / (ordered.length - i)));
        quotas.set(index, quota);
        remaining -= quota;
    });
    return blocks.map((text, i) => {
        const quota = quotas.get(i) ?? 0;
        if (text.length <= quota) return text;
        const gap = '\n[…]\n';
        if (quota <= gap.length) return text.slice(0, quota);
        // Any omission is confined to this frame, with its heading and ending
        // retained. A noisy menu cannot evict a different numbered stop.
        const head = Math.ceil((quota - gap.length) / 2);
        const tail = quota - gap.length - head;
        return text.slice(0, head) + gap + (tail ? text.slice(-tail) : '');
    }).join('\n');
}

/** Preserve source and chronological context, including a late location card. */
export function buildVideoImportEvidence(
    result: Pick<ExtractResult, 'ocr' | 'transcript'> & Partial<Pick<ExtractResult, 'frames' | 'durationSec'>>,
    platformTranscript?: string,
): string {
    const seen = new Set<string>();
    const blocks: string[] = [];
    const frames = result.frames?.length
        ? [...result.frames].sort((a, b) => a.timeSec - b.timeSec)
        : [{ timeSec: -1, lines: result.ocr }];
    const keyFor = (line: string) => line.toLocaleLowerCase().replace(/\s+/g, ' ');
    const lastOccurrence = new Map<string, number>();
    frames.forEach((frame, index) => frame.lines.forEach(raw => {
        lastOccurrence.set(keyFor(cleanLine(raw)), index);
    }));
    for (const [index, frame] of frames.entries()) {
        const ending = typeof result.durationSec === 'number' &&
            frame.timeSec >= Math.max(0, result.durationSec - 8);
        const lines: string[] = [];
        const inFrame = new Set<string>();
        for (const raw of frame.lines) {
            const line = cleanLine(raw);
            const key = keyFor(line);
            // Keep the last ending occurrence as well as the first: otherwise
            // dedupe can delete the reveal and truncation can delete its only
            // earlier occurrence. Repeated middle frames still collapse.
            if (!line || inFrame.has(key) ||
                (seen.has(key) && !(ending && lastOccurrence.get(key) === index))) continue;
            inFrame.add(key);
            seen.add(key);
            lines.push(line);
        }
        if (!lines.length) continue;
        const label = frame.timeSec < 0 ? ''
            : `[frame ${frame.timeSec.toFixed(1)}s${ending ? '; ending' : ''}]\n`;
        if (frame.timeSec < 0) blocks.push(...lines);
        else blocks.push(label + lines.join('\n'));
    }
    const screen = blocks.join('\n');
    const speech = (platformTranscript?.trim() || result.transcript || '')
        .split('\n').map(cleanLine).join('\n').trim();
    const screenHeader = '[on-screen text]\n';
    const speechHeader = '[spoken words]\n';
    if (!screen && !speech) return '';
    const speechBlocks = speech.match(/[\s\S]{1,400}/g) ?? [];
    // Joining speech chunks would invent whitespace inside a word. Only split
    // when compaction is actually required.
    const fitSpeech = (cap: number) => speech.length <= cap ? speech : fitBlocks(speechBlocks, cap);
    if (!screen) return speechHeader + fitSpeech(VIDEO_EVIDENCE_CAP - speechHeader.length);
    if (!speech) return screenHeader + fitBlocks(blocks, VIDEO_EVIDENCE_CAP - screenHeader.length);
    const available = VIDEO_EVIDENCE_CAP - screenHeader.length - speechHeader.length - 2;
    const speechCap = Math.min(speech.length, Math.floor(available * 0.4));
    const screenCap = Math.min(screen.length, available - speechCap);
    return screenHeader + fitBlocks(blocks, screenCap) + '\n\n' +
        speechHeader + fitSpeech(available - screenCap);
}
