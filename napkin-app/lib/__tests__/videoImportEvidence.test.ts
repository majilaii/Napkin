import { buildVideoImportEvidence, VIDEO_EVIDENCE_CAP } from '../videoImportEvidence';

test('ending-first native execution paints chronological evidence, retaining final context', () => {
    const text = buildVideoImportEvidence({
        ocr: [], transcript: '', durationSec: 16,
        frames: [
            { timeSec: 15.8, lines: ['another restaurant', '* LOTTA'] },
            { timeSec: 0, lines: ['ABATILLES', 'another restaurant'] },
        ],
    });
    expect(text.indexOf('ABATILLES')).toBeLessThan(text.indexOf('* LOTTA'));
    expect(text).toContain('[frame 15.8s; ending]\nanother restaurant\n* LOTTA');
    expect(text.match(/another restaurant/g)).toHaveLength(2);
});

test('repeated middle-frame text collapses but a repeated ending survives truncation', () => {
    const text = buildVideoImportEvidence({
        ocr: [], transcript: '', durationSec: 30,
        frames: [
            { timeSec: 0, lines: Array.from({ length: 180 }, (_, i) => `opening scene ${i} with long noise`) },
            { timeSec: 10, lines: ['* LOTTA', 'persistent caption'] },
            { timeSec: 11, lines: ['persistent caption'] },
            { timeSec: 15, lines: Array.from({ length: 180 }, (_, i) => `middle scene ${i} with long noise`) },
            { timeSec: 29, lines: ['* LOTTA', '* LOTTA'] },
        ],
    });
    expect(text.length).toBeLessThanOrEqual(VIDEO_EVIDENCE_CAP);
    expect(text).toContain('[frame 29.0s; ending]\n* LOTTA');
    expect(text.match(/\* LOTTA/g)).toHaveLength(1);
    const small = buildVideoImportEvidence({ ocr: [], transcript: '', durationSec: 30,
        frames: [{ timeSec: 10, lines: ['same'] }, { timeSec: 11, lines: ['same'] }] });
    expect(small.match(/same/g)).toHaveLength(1);
});

test('large incidental OCR cannot evict the ending or the spoken channel', () => {
    const text = buildVideoImportEvidence({
        ocr: ['OPENING', ...Array.from({ length: 600 }, (_, i) => `menu item ${i} with a long description`), '* LOTTA'],
        transcript: 'A spoken recommendation: Lotta in Paris.',
    });
    expect(text.length).toBeLessThanOrEqual(VIDEO_EVIDENCE_CAP);
    expect(text).toContain('OPENING');
    expect(text).toContain('* LOTTA');
    expect(text).toContain('[spoken words]\nA spoken recommendation: Lotta in Paris.');
});

test('legacy native results work; platform speech replaces rather than duplicates device speech', () => {
    const text = buildVideoImportEvidence({ ocr: ['Lotta'], transcript: 'device' }, 'platform');
    expect(text).toBe('[on-screen text]\nLotta\n\n[spoken words]\nplatform');
});

test('speech-only and empty results do not invent an OCR channel', () => {
    expect(buildVideoImportEvidence({ ocr: [], transcript: 'Lotta is excellent' }))
        .toBe('[spoken words]\nLotta is excellent');
    expect(buildVideoImportEvidence({ ocr: [], transcript: '' })).toBe('');
});

test('text that resembles a section delimiter stays inside its source', () => {
    expect(buildVideoImportEvidence({ ocr: ['[caption]', 'LOTTA'], transcript: '' }))
        .toBe('[on-screen text]\n(caption)\nLOTTA');
});
