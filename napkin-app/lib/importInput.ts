/**
 * importInput: decide what a paste into the import field is.
 *
 * A single link (optionally with a short label around it, as the Maps and
 * TikTok share sheets add) resolves as that link. Anything else with words in
 * it is a message or list of places, which the resolver reads as text.
 */
import { validateUrl } from '@/lib/urlValidation';

export type ImportInput =
    | { kind: 'url'; url: string }
    | { kind: 'text'; text: string }
    | { kind: 'empty' };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
// "Dishoom Covent Garden https://maps.app.goo.gl/x" is a link share, not a list.
const LINK_LABEL_MAX_CHARS = 80;
const MIN_TEXT_CHARS = 3;

export function classifyImportInput(raw: string): ImportInput {
    const trimmed = raw.trim();
    if (!trimmed) return { kind: 'empty' };
    if (!/\s/.test(trimmed) && validateUrl(trimmed).ok) return { kind: 'url', url: trimmed };

    const urls = trimmed.match(URL_PATTERN) ?? [];
    if (urls.length === 1) {
        const url = urls[0].replace(/[.,;:!?)\]]+$/, '');
        const label = trimmed.replace(urls[0], '').trim();
        if (label.length <= LINK_LABEL_MAX_CHARS && validateUrl(url).ok) {
            return { kind: 'url', url };
        }
    }

    if (trimmed.length < MIN_TEXT_CHARS) return { kind: 'empty' };
    return { kind: 'text', text: trimmed };
}
