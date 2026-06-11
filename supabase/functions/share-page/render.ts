/**
 * render.ts — pure HTML builders for the public share-page.
 *
 * TICKET-072 ARCH-REVIEW-2 #10:
 *   - escapeText / escapeAttr / safeHref on EVERY interpolated value
 *   - render context contains EXACTLY { sharer_name, created_at, spots[{name,city,cuisine,rating}] }
 *     — restaurant_id and all uuids are stripped before this module is called
 *   - TESTFLIGHT_PUBLIC_URL whitelisted to https: only via safeHref
 *   - CTA scheme link is generated (napkin://handoff?t=<validated-token>), not interpolated from input
 *
 * TICKET-072 Codex #6 uuid-absence:
 *   No restaurant_id, owner_id, or token echo appears in the rendered HTML.
 *   The token IS used in the scheme-link href (generated, not reflected from body/DB).
 *
 * No serve(), no Deno.env — fully testable without a live server.
 */

import { escapeText, escapeAttr, safeHref } from '../_shared/htmlEscape.ts';

// ── Types (reuse from snapshot.ts, but standalone here to avoid the dep) ──────

export interface RenderContext {
    sharer_name: string;
    created_at: string;
    spots: Array<{
        name: string;
        city: string | null;
        cuisine: string | null;
        rating: number | null;
    }>;
}

// ── Page render ───────────────────────────────────────────────────────────────

/**
 * Render the warm-paper share page.
 *
 * token:          the share token — validated to [A-Za-z0-9_-]{22} by the caller;
 *                 used ONLY in the scheme-link CTA (generated, never reflected from input).
 * testflightUrl:  from TESTFLIGHT_PUBLIC_URL env; null → invite-only murmur.
 */
export function renderPage(
    ctx: RenderContext,
    token: string,
    testflightUrl: string | null,
): string {
    const N = ctx.spots.length;
    const spotLabel = N === 1 ? 'spot' : 'spots';

    // All user-supplied strings through the correct escaper
    const nameText = escapeText(ctx.sharer_name);
    const nameAttr = escapeAttr(ctx.sharer_name);

    // OG description: first 3 spot names — use RAW names here, then escape ONCE
    // at attribute interpolation below (via escapeAttr).  Calling escapeText first
    // then escapeAttr would double-encode: "Bar & Grill" → "Bar &amp; Grill" →
    // "Bar &amp;amp; Grill", causing unfurls to show "Bar &amp; Grill".
    const ogDesc = ctx.spots
        .slice(0, 3)
        .map((s) => s.name)
        .join(', ');

    // CTA scheme link: GENERATED (never interpolated from user input); token validated base64url
    const schemeHref = `napkin://handoff?t=${escapeAttr(token)}`;

    // Install murmur
    let installHtml: string;
    const safeTestflight = safeHref(testflightUrl ?? '');
    if (safeTestflight) {
        installHtml = `<a href="${safeTestflight}" rel="noopener noreferrer" style="color:#b5451b;text-decoration:underline;font-size:13px;">get Napkin</a>`;
    } else {
        installHtml = `<span style="font-size:13px;">napkin is invite-only for now &mdash; ask ${nameText} for a seat.</span>`;
    }

    // Spots list
    const spotsHtml = ctx.spots.map((s) => {
        const metaParts = [s.city, s.cuisine]
            .filter(Boolean)
            .map((v) => escapeText(v!));
        const metaStr = metaParts.join(' · ');
        const ratingStr = s.rating != null
            ? `<span style="font-size:15px;color:#1c1c19;opacity:0.55;">${escapeText(String(s.rating))}</span>`
            : '';
        return `
        <li style="padding:14px 0;border-bottom:1px solid rgba(28,28,25,0.08);list-style:none;display:flex;align-items:flex-start;gap:8px;">
            <div style="flex:1;">
                <div style="font-family:'Newsreader',Georgia,serif;font-style:italic;font-size:17px;color:#1c1c19;line-height:1.3;">${escapeText(s.name)}</div>
                ${metaStr ? `<div style="font-size:12px;color:#1c1c19;opacity:0.45;margin-top:3px;">${metaStr}</div>` : ''}
            </div>
            ${ratingStr}
        </li>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${nameAttr}'s napkin</title>
    <meta property="og:title" content="${nameAttr}'s napkin &middot; ${N} ${spotLabel}">
    <meta property="og:description" content="${escapeAttr(ogDesc)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${nameAttr}'s napkin &middot; ${N} ${spotLabel}">
    <meta name="twitter:description" content="${escapeAttr(ogDesc)}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400;1,6..72,600&display=swap">
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#fffdf8;color:#1c1c19;font-family:-apple-system,'Manrope',sans-serif;padding:48px 24px 64px;max-width:480px;margin:0 auto;}
    </style>
</head>
<body>
    <p style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1c1c19;opacity:0.38;margin-bottom:8px;font-weight:600;">${nameText}'s napkin</p>
    <h1 style="font-family:'Newsreader',Georgia,serif;font-style:italic;font-weight:400;font-size:30px;color:#1c1c19;margin-bottom:6px;line-height:1.15;">${nameText}'s napkin</h1>
    <p style="font-size:14px;color:#1c1c19;opacity:0.45;margin-bottom:28px;font-weight:400;">${N} ${spotLabel}</p>
    <div style="border-top:0.25px solid rgba(28,28,25,0.2);margin-bottom:4px;"></div>
    <ul style="padding:0;margin-bottom:36px;">
        ${spotsHtml}
    </ul>
    <a href="${schemeHref}" style="display:block;background:#b5451b;color:#fff;text-align:center;padding:15px 20px;border-radius:14px;font-size:17px;font-family:-apple-system,sans-serif;text-decoration:none;font-weight:600;margin-bottom:14px;letter-spacing:-0.01em;">Open in Napkin</a>
    <p style="text-align:center;color:#1c1c19;opacity:0.38;">${installHtml}</p>
    <p style="font-size:10px;color:#1c1c19;opacity:0.25;text-align:center;margin-top:48px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;">napkin</p>
</body>
</html>`;
}

// ── Tombstone ─────────────────────────────────────────────────────────────────

/**
 * Uniform 410 tombstone — nameless, no PII, no list content.
 * Served for invalid / malformed / unknown / revoked tokens (Codex #8).
 * Journal voice per UX spec.
 */
export function renderTombstone(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>napkin</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@1,6..72,400&display=swap">
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#fffdf8;color:#1c1c19;font-family:-apple-system,sans-serif;padding:80px 24px;max-width:420px;margin:0 auto;text-align:center;}
    </style>
</head>
<body>
    <h1 style="font-family:'Newsreader',Georgia,serif;font-style:italic;font-weight:400;font-size:26px;color:#1c1c19;margin-bottom:18px;line-height:1.3;">this napkin's been folded away.</h1>
    <p style="font-size:14px;color:#1c1c19;opacity:0.45;line-height:1.6;">&mdash; the link's closed. ask whoever shared it for a fresh one.</p>
    <p style="font-size:10px;color:#1c1c19;opacity:0.22;margin-top:64px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;">napkin</p>
</body>
</html>`;
}
