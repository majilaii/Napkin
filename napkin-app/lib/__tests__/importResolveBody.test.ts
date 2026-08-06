import { buildVideoTextResolveBody } from '../importResolveBody';
import type { PhotoImportContext } from '../photoImportFusion';

const PHOTO: PhotoImportContext = { source_kind: 'photo', slide_count: 4 };
const URL = 'https://www.tiktok.com/@topjaw/video/7670828280068508950';

function build(overrides: Partial<Parameters<typeof buildVideoTextResolveBody>[0]> = {}) {
    return buildVideoTextResolveBody({
        extractedText: null,
        mergedDesc: '',
        photoImportContext: null,
        photoPost: false,
        url: URL,
        ...overrides,
    });
}

describe('buildVideoTextResolveBody — channel bodies', () => {
    it('both channels → caption rides SEPARATELY, never inside extracted_text', () => {
        const { body, sentVideoTextResolve } = build({
            extractedText: 'CASA UROLA\nBar Txepetxa, Parte Vieja',
            mergedDesc: '10 San Sebastián food spots that I LOVED last weekend: Casa Urola…',
        });
        expect(body).toEqual({
            extracted_text: 'CASA UROLA\nBar Txepetxa, Parte Vieja',
            caption: '10 San Sebastián food spots that I LOVED last weekend: Casa Urola…',
        });
        expect(String(body.extracted_text)).not.toContain('San Sebastián food spots');
        expect(sentVideoTextResolve).toBe(true);
    });

    it('OCR only, no caption → caption key omitted entirely (never an empty string)', () => {
        const { body } = build({ extractedText: 'CASA UROLA' });
        expect(body.caption).toBeUndefined();
        expect(Object.keys(body)).toEqual(['extracted_text', 'caption']);
        expect(JSON.parse(JSON.stringify(body))).toEqual({ extracted_text: 'CASA UROLA' });
    });

    it('caption-only body when both perception channels are empty', () => {
        const { body, sentVideoTextResolve } = build({ mergedDesc: '3 spots in Shoreditch: A, B, C' });
        expect(body).toEqual({ caption: '3 spots in Shoreditch: A, B, C' });
        expect(sentVideoTextResolve).toBe(true);
    });

    it('nothing at all → the legacy {url} fallback, unchanged', () => {
        const { body, sentVideoTextResolve } = build();
        expect(body).toEqual({ url: URL, supports_large_lists: true });
        expect(sentVideoTextResolve).toBe(false);
    });
});

describe('buildVideoTextResolveBody — photo path stays byte-identical', () => {
    it('photo carousel body is extracted_text + photo context, with NO caption field', () => {
        const { body } = build({
            extractedText: '[slide 1 of 4]\nBrat, Shoreditch\n[caption]\nLondon faves',
            mergedDesc: 'London faves',
            photoImportContext: PHOTO,
            photoPost: true,
        });
        // fusePhotoSlideText already embeds a labeled [caption] section — adding
        // the field would double-fuse it.
        expect(body).toEqual({
            extracted_text: '[slide 1 of 4]\nBrat, Shoreditch\n[caption]\nLondon faves',
            source_kind: 'photo',
            slide_count: 4,
        });
    });

    it('zero-slide photo post keeps the {url} tier (oEmbed + thumbnail vision)', () => {
        const { body, sentVideoTextResolve } = build({
            mergedDesc: 'my favourite spots in Tokyo',
            photoImportContext: null,
            photoPost: true,
        });
        expect(body).toEqual({ url: URL, supports_large_lists: true });
        expect(sentVideoTextResolve).toBe(false);
    });
});

describe('buildVideoTextResolveBody — regression guards', () => {
    it('IG reel: caption + failed download + no OCR → caption-only, NEVER the {url} no-op', () => {
        // Instagram's url tier is login-walled and returns zero candidates, so a
        // {url} body here would kill the import outright.
        const { body, sentVideoTextResolve } = build({
            extractedText: null,
            mergedDesc: '5 pasta places in Rome you actually need: A B C D E',
        });
        expect(body).toEqual({ caption: '5 pasta places in Rome you actually need: A B C D E' });
        expect(body.url).toBeUndefined();
        expect(sentVideoTextResolve).toBe(true);
    });

    it('TICKET-175 R5: a caption-only body still ARMS the zero-candidate {url} recovery', () => {
        // The old guard term was `extractedText &&` — empty on a caption-only
        // body, which would have silently disabled the recovery tier.
        const { extractedText, sentVideoTextResolve } = {
            ...build({ mergedDesc: 'one spot in Lisbon' }),
            extractedText: null,
        };
        expect(extractedText).toBeNull();
        expect(sentVideoTextResolve).toBe(true);
    });
});
