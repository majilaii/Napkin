import type { ExtractResult } from '@/modules/media-extract/src/MediaExtract.types';

// Leaves room for the server's separately budgeted 3,000-character caption.
// Keep speech in its own allowance so a busy scene cannot evict the voiceover.
export const VIDEO_EVIDENCE_CAP = 4800;

function cleanLine(value: string): string {
    // Native/platform text is content, never a new section of the evidence.
    return value.trim().replace(/^\[/, '(').replace(/\]$/, ')');
}

function keepEnds(text: string, cap: number): string {
    if (text.length <= cap) return text;
    const gap = '\n[... omitted text ...]\n';
    const head = Math.floor((cap - gap.length) / 2);
    return text.slice(0, head) + gap + text.slice(-(cap - gap.length - head));
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
        blocks.push(label + lines.join('\n'));
    }
    const screen = blocks.join('\n');
    const speech = (platformTranscript?.trim() || result.transcript || '')
        .split('\n').map(cleanLine).join('\n').trim();
    const screenHeader = '[on-screen text]\n';
    const speechHeader = '[spoken words]\n';
    if (!screen && !speech) return '';
    if (!screen) return speechHeader + keepEnds(speech, VIDEO_EVIDENCE_CAP - speechHeader.length);
    if (!speech) return screenHeader + keepEnds(screen, VIDEO_EVIDENCE_CAP - screenHeader.length);
    const available = VIDEO_EVIDENCE_CAP - screenHeader.length - speechHeader.length - 2;
    const speechCap = Math.min(speech.length, Math.floor(available * 0.4));
    const screenCap = Math.min(screen.length, available - speechCap);
    return screenHeader + keepEnds(screen, screenCap) + '\n\n' +
        speechHeader + keepEnds(speech, available - screenCap);
}
