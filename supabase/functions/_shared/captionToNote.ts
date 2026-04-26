/**
 * captionToNote — sanitizes a raw TikTok (or other) caption into a clean note.
 * Canonical impl shared between Deno edge functions and the RN app
 * (per TICKET-053 [ARCH-REVIEW-H4] cross-boundary import pattern).
 *
 * Rules (per TICKET-053 spec + TICKET-052 findings):
 * 1. Remove @mention tokens (including the handle) entirely.
 * 2. Strip #hashtag tokens entirely (they're metadata, not notes).
 * 3. Collapse runs of whitespace (space, tab, newline) to single spaces.
 * 4. Trim leading/trailing whitespace.
 * 5. Truncate at word boundary ≤280 chars, no ellipsis.
 */

// Matches a hashtag token: # followed by word characters (letters, digits, underscore)
const HASHTAG_RE = /#\w+/g;
// Matches a mention token: @ followed by word characters + dots/hyphens (handles)
const MENTION_RE = /@[\w.−-]+/g;

export function captionToNote(caption: string): string {
    if (!caption || typeof caption !== 'string') return '';

    let text = caption.replace(MENTION_RE, '');
    text = text.replace(HASHTAG_RE, '');
    text = text.replace(/\s+/g, ' ');
    text = text.trim();

    if (text.length <= 280) return text;

    const truncated = text.slice(0, 280);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 0) {
        return truncated.slice(0, lastSpace).trimEnd();
    }
    return truncated;
}
