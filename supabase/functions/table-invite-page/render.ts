/**
 * render.ts — pure HTML builders for the public table-invite page.
 *
 * Mirrors share-page/render.ts security posture:
 *   - escapeText / escapeAttr / safeHref on EVERY interpolated value
 *   - render input is EXACTLY { table_name } — no uuids, no owner, no member list
 *   - TESTFLIGHT_PUBLIC_URL whitelisted to https: only via safeHref
 *   - the CTA scheme link (napkin://join-table?code=<code>) is generated from a
 *     validated code, not reflected from arbitrary input
 *
 * No serve(), no Deno.env — fully testable without a live server.
 */

import { escapeText, escapeAttr, safeHref } from '../_shared/htmlEscape.ts';

/**
 * Render the warm-paper invite page.
 *
 * tableName:      the table's display name — user-supplied, escaped here.
 * code:           the invite code — validated to [A-Za-z0-9_-]{22} by the caller;
 *                 used ONLY in the scheme-link CTA (generated, never reflected).
 * testflightUrl:  from TESTFLIGHT_PUBLIC_URL env; null → invite-only murmur.
 */
export function renderPage(
    tableName: string,
    code: string,
    testflightUrl: string | null,
): string {
    const nameText = escapeText(tableName);
    const nameAttr = escapeAttr(tableName);

    // CTA scheme link: GENERATED (never interpolated from user input); code validated base64url.
    const schemeHref = `napkin://join-table?code=${escapeAttr(code)}`;

    let installHtml: string;
    const safeTestflight = safeHref(testflightUrl ?? '');
    if (safeTestflight) {
        installHtml = `<a href="${safeTestflight}" rel="noopener noreferrer" style="color:#b5451b;text-decoration:underline;font-size:13px;">get Napkin</a>`;
    } else {
        installHtml = `<span style="font-size:13px;">napkin is invite-only for now.</span>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>join ${nameAttr} on Napkin</title>
    <meta property="og:title" content="join ${nameAttr} on Napkin">
    <meta property="og:description" content="you're invited to join this table on Napkin.">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="join ${nameAttr} on Napkin">
    <meta name="twitter:description" content="you're invited to join this table on Napkin.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400;1,6..72,600&display=swap">
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#fffdf8;color:#1c1c19;font-family:-apple-system,'Manrope',sans-serif;padding:64px 24px;max-width:440px;margin:0 auto;text-align:center;}
    </style>
</head>
<body>
    <p style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1c1c19;opacity:0.38;margin-bottom:14px;font-weight:600;">you're invited to join this table on Napkin</p>
    <h1 style="font-family:'Newsreader',Georgia,serif;font-style:italic;font-weight:400;font-size:34px;color:#1c1c19;margin-bottom:36px;line-height:1.15;">${nameText}</h1>
    <a href="${schemeHref}" style="display:block;background:#b5451b;color:#fff;text-align:center;padding:15px 20px;border-radius:14px;font-size:17px;font-family:-apple-system,sans-serif;text-decoration:none;font-weight:600;margin-bottom:14px;letter-spacing:-0.01em;">Open in Napkin</a>
    <p style="color:#1c1c19;opacity:0.38;">${installHtml}</p>
    <p style="font-size:10px;color:#1c1c19;opacity:0.25;text-align:center;margin-top:48px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;">napkin</p>
</body>
</html>`;
}

/**
 * Uniform 410 tombstone — nameless, no table content.
 * Served for invalid / malformed / unknown / revoked codes. Same voice as share-page.
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
    <h1 style="font-family:'Newsreader',Georgia,serif;font-style:italic;font-weight:400;font-size:26px;color:#1c1c19;margin-bottom:18px;line-height:1.3;">this invite's been folded away.</h1>
    <p style="font-size:14px;color:#1c1c19;opacity:0.45;line-height:1.6;">&mdash; the link's closed. ask whoever shared it for a fresh one.</p>
    <p style="font-size:10px;color:#1c1c19;opacity:0.22;margin-top:64px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;">napkin</p>
</body>
</html>`;
}
