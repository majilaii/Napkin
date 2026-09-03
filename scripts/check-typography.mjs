#!/usr/bin/env node

/**
 * Typography policy guard.
 *
 * Hard gates:
 *   - Profile typography is upright except for named rating and direct-quote slots.
 *   - Profile has no literal font size below 11.
 *   - Central semantic tokens keep their legibility floors.
 *   - Muted text keeps WCAG AA contrast on every Profile paper surface in both schemes.
 *
 * Incremental gate:
 *   - Existing direct italic and tiny-literal debt in app/components may fall,
 *     but may not exceed the per-file budget in typography-baseline.json.
 *   - A file absent from the baseline has a zero budget.
 *
 * Usage:
 *   node scripts/check-typography.mjs
 *   node scripts/check-typography.mjs --update-baseline
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_PATH = path.join(SCRIPT_DIR, 'typography-baseline.json');
const THEME_PATH = path.join(REPO_ROOT, 'napkin-app/constants/theme.ts');
const PROFILE_COMPONENTS = path.join(REPO_ROOT, 'napkin-app/components/profile');
const MEMBER_COMPONENTS = path.join(REPO_ROOT, 'napkin-app/components/members');
const APP_ROOT = path.join(REPO_ROOT, 'napkin-app/app');
const UI_ROOTS = [APP_ROOT, path.join(REPO_ROOT, 'napkin-app/components')];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const MIN_LITERAL_FONT_SIZE = 11;
const BASELINE_VERSION = 1;

const args = new Set(process.argv.slice(2));
const updateBaseline = args.delete('--update-baseline');
const showHelp = args.delete('--help') || args.delete('-h');

if (showHelp) {
    console.log(`Typography policy guard

Usage:
  npm run check:typography
  npm run check:typography -- --update-baseline

--update-baseline  Bank the currently reviewed app-wide debt counts. Profile
                   and theme hard-gate failures are still reported.`);
    process.exit(0);
}

if (args.size > 0) {
    console.error(`Unknown argument${args.size === 1 ? '' : 's'}: ${[...args].join(', ')}`);
    process.exit(2);
}

function toRepoPath(absolutePath) {
    return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

function walkSourceFiles(root) {
    if (!fs.existsSync(root)) return [];

    const files = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const absolutePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkSourceFiles(absolutePath));
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            files.push(absolutePath);
        }
    }
    return files;
}

function uniqueSorted(paths) {
    return [...new Set(paths)].sort((a, b) => toRepoPath(a).localeCompare(toRepoPath(b)));
}

/** Mask comments while preserving character offsets, newlines, and strings. */
function maskComments(source) {
    // split('') keeps UTF-16 code-unit offsets aligned with String#indexOf;
    // spreading would collapse surrogate pairs and shift diagnostics after emoji.
    const chars = source.split('');
    let state = 'code';

    for (let i = 0; i < chars.length; i += 1) {
        const char = chars[i];
        const next = chars[i + 1];

        if (state === 'line-comment') {
            if (char === '\n') state = 'code';
            else chars[i] = ' ';
            continue;
        }

        if (state === 'block-comment') {
            if (char === '*' && next === '/') {
                chars[i] = ' ';
                chars[i + 1] = ' ';
                i += 1;
                state = 'code';
            } else if (char !== '\n') {
                chars[i] = ' ';
            }
            continue;
        }

        if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
            if (char === '\\') {
                i += 1;
                continue;
            }
            if (
                (state === 'single-quote' && char === "'") ||
                (state === 'double-quote' && char === '"') ||
                (state === 'template' && char === '`')
            ) {
                state = 'code';
            }
            continue;
        }

        if (char === '/' && next === '/') {
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i += 1;
            state = 'line-comment';
        } else if (char === '/' && next === '*') {
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i += 1;
            state = 'block-comment';
        } else if (char === "'") {
            state = 'single-quote';
        } else if (char === '"') {
            state = 'double-quote';
        } else if (char === '`') {
            state = 'template';
        }
    }

    return chars.join('');
}

function skipQuotedValue(source, start) {
    const quote = source[start];
    for (let i = start + 1; i < source.length; i += 1) {
        if (source[i] === '\\') {
            i += 1;
        } else if (source[i] === quote) {
            return i;
        }
    }
    return source.length - 1;
}

/**
 * Return object-property expressions without needing a TypeScript parser.
 * Stops at a comma or closing brace at the property's starting depth, while
 * respecting strings and nested arrays/objects/calls.
 */
function findPropertyExpressions(source, propertyName) {
    const expressions = [];
    const pattern = new RegExp(`\\b${propertyName}\\s*:`, 'g');
    let match;

    while ((match = pattern.exec(source)) !== null) {
        const valueStart = pattern.lastIndex;
        let round = 0;
        let square = 0;
        let curly = 0;
        let end = source.length;

        for (let i = valueStart; i < source.length; i += 1) {
            const char = source[i];
            if (char === "'" || char === '"' || char === '`') {
                i = skipQuotedValue(source, i);
                continue;
            }
            if (char === '(') round += 1;
            else if (char === ')') round = Math.max(0, round - 1);
            else if (char === '[') square += 1;
            else if (char === ']') square = Math.max(0, square - 1);
            else if (char === '{') curly += 1;
            else if (char === '}') {
                if (round === 0 && square === 0 && curly === 0) {
                    end = i;
                    break;
                }
                curly = Math.max(0, curly - 1);
            } else if (char === ',' && round === 0 && square === 0 && curly === 0) {
                end = i;
                break;
            }
        }

        expressions.push({
            propertyStart: match.index,
            valueStart,
            end,
            value: source.slice(valueStart, end),
        });
        pattern.lastIndex = Math.max(pattern.lastIndex, end);
    }

    return expressions;
}

function lineAt(source, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) {
        if (source.charCodeAt(i) === 10) line += 1;
    }
    return line;
}

function diagnostic(rule, filePath, source, index, message) {
    return {
        rule,
        file: toRepoPath(filePath),
        line: lineAt(source, index),
        message,
    };
}

function italicFamilies(source) {
    const occurrences = [];

    for (const expression of findPropertyExpressions(source, 'fontFamily')) {
        const quotedRanges = [];
        const quotedPattern = /(['"`])([^'"`\r\n]*italic[^'"`\r\n]*)\1/gi;
        let match;
        while ((match = quotedPattern.exec(expression.value)) !== null) {
            const familyOffset = match.index + 1;
            quotedRanges.push([match.index, quotedPattern.lastIndex]);
            occurrences.push({
                index: expression.valueStart + familyOffset,
                family: match[2],
            });
        }

        // Also catch a directly imported family identifier used without a
        // string literal. Ignore identifiers already captured inside quotes.
        const identifierPattern = /\b[A-Z][A-Za-z0-9_]*Italic[A-Za-z0-9_]*\b/g;
        while ((match = identifierPattern.exec(expression.value)) !== null) {
            const insideQuotedFamily = quotedRanges.some(([start, end]) => match.index >= start && match.index < end);
            if (insideQuotedFamily) continue;
            occurrences.push({
                index: expression.valueStart + match.index,
                family: match[0],
            });
        }
    }
    return occurrences.sort((a, b) => a.index - b.index);
}

function italicFontStyles(source) {
    const occurrences = [];
    const italicPattern = /(['"])italic\1/g;
    for (const expression of findPropertyExpressions(source, 'fontStyle')) {
        let match;
        while ((match = italicPattern.exec(expression.value)) !== null) {
            occurrences.push({ index: expression.valueStart + match.index });
        }
        italicPattern.lastIndex = 0;
    }
    return occurrences;
}

function headlineItalicTokens(source) {
    return [...source.matchAll(/\bType\s*\.\s*headlineItalic\b/g)].map((match) => ({
        index: match.index,
    }));
}

function quoteTokens(source) {
    return [...source.matchAll(/\bType\s*\.\s*quote\b/g)].map((match) => ({
        index: match.index,
    }));
}

function ratingTokens(source) {
    return [...source.matchAll(/\bType\s*\.\s*rating(?:Compact|Large)?\b/g)].map((match) => ({
        index: match.index,
        token: match[0].replace(/\s/g, ''),
    }));
}

function literalFontSizes(source) {
    const occurrences = [];
    const numberPattern = /^\s*\(?\s*(-?\d+(?:\.\d+)?)\b/;
    for (const expression of findPropertyExpressions(source, 'fontSize')) {
        const match = expression.value.match(numberPattern);
        if (!match) continue;
        const offset = expression.value.indexOf(match[1]);
        occurrences.push({
            index: expression.valueStart + offset,
            value: Number(match[1]),
        });
    }

    const jsxPattern = /\bfontSize\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\b/g;
    let jsxMatch;
    while ((jsxMatch = jsxPattern.exec(source)) !== null) {
        occurrences.push({
            index: jsxMatch.index + jsxMatch[0].lastIndexOf(jsxMatch[1]),
            value: Number(jsxMatch[1]),
        });
    }
    return occurrences;
}

function styleSlotAt(source, index) {
    // Profile StyleSheet objects use the repository's four-space indentation.
    // Limiting this to top-level slots prevents a nested `name`/`label` object
    // from borrowing a rating exception.
    const pattern = /^ {4}([A-Za-z_$][\w$]*):\s*\{/gm;
    let slot = null;
    let match;
    while ((match = pattern.exec(source)) !== null && match.index < index) {
        slot = match[1];
    }
    return slot;
}

function isAllowedProfileItalic(filePath, source, occurrence, occurrenceIndex) {
    const relativePath = toRepoPath(filePath);

    const allowedSlots = {
        'napkin-app/components/profile/RatingHistogram.tsx': new Set(['avg', 'spineNum']),
        'napkin-app/components/profile/MarqueePlate.tsx': new Set(['rating', 'ratingPhoto']),
    };
    const slots = allowedSlots[relativePath];
    return slots?.has(styleSlotAt(source, occurrence.index)) ?? false;
}

function isAllowedProfileQuote(filePath, source, occurrence) {
    return (
        toRepoPath(filePath) === 'napkin-app/components/profile/QuickTakes.tsx' &&
        styleSlotAt(source, occurrence.index) === 'note'
    );
}

function textElementAt(source, occurrence) {
    const textStart = source.lastIndexOf('<Text', occurrence.index);
    const openingEnd = source.indexOf('>', occurrence.index);
    const textEnd = source.indexOf('</Text>', openingEnd + 1);
    if (textStart < 0 || openingEnd < occurrence.index || textEnd < openingEnd) return null;
    return {
        opening: source.slice(textStart, openingEnd + 1),
        content: source.slice(openingEnd + 1, textEnd),
    };
}

function tokenStylesOnlyExpression(source, occurrence, valueExpression) {
    const element = textElementAt(source, occurrence);
    if (!element) return false;
    const normalizedContent = element.content.replace(/\s+/g, '');
    const normalizedExpected = `{${valueExpression}}`.replace(/\s+/g, '');
    return normalizedContent === normalizedExpected;
}

function openingContains(source, occurrence, expression) {
    const element = textElementAt(source, occurrence);
    if (!element) return false;
    return element.opening.replace(/\s+/g, '').includes(expression.replace(/\s+/g, ''));
}

function ratingTokenHasSizeOverride(source, occurrence) {
    const element = textElementAt(source, occurrence);
    return element ? /\bfontSize\s*(?::|=)/.test(element.opening) : false;
}

function isAllowedProfileRatingToken(filePath, source, occurrence, occurrenceIndex) {
    const relativePath = toRepoPath(filePath);
    if (relativePath === 'napkin-app/components/profile/Rating.tsx') {
        return (
            occurrenceIndex === 0 &&
            occurrence.token === 'Type.ratingCompact' &&
            tokenStylesOnlyExpression(source, occurrence, 'value.toFixed(1)')
        );
    }
    if (relativePath === 'napkin-app/components/profile/TablePreviewCard.tsx') {
        return (
            occurrenceIndex === 0 &&
            occurrence.token === 'Type.rating' &&
            tokenStylesOnlyExpression(
                source,
                occurrence,
                "preview.avg != null ? preview.avg.toFixed(1) : '—'",
            )
        );
    }
    if (relativePath === 'napkin-app/components/profile/TasteSignature.tsx') {
        return (
            occurrenceIndex === 0 &&
            occurrence.token === 'Type.rating' &&
            tokenStylesOnlyExpression(
                source,
                occurrence,
                "averageRating != null ? averageRating.toFixed(1) : '—'",
            )
        );
    }
    if (relativePath === 'napkin-app/components/members/MemberStatsStrip.tsx') {
        return (
            occurrenceIndex === 0 &&
            occurrence.token === 'Type.rating' &&
            openingContains(
                source,
                occurrence,
                'isRating ? Type.rating : Type.editorialTitle',
            ) &&
            tokenStylesOnlyExpression(source, occurrence, 'value')
        );
    }
    if (relativePath === 'napkin-app/components/members/TopEntriesList.tsx') {
        return (
            occurrenceIndex === 0 &&
            occurrence.token === 'Type.rating' &&
            tokenStylesOnlyExpression(source, occurrence, 'entry.rating.toFixed(1)')
        );
    }
    if (relativePath === 'napkin-app/components/members/RecentActivityList.tsx') {
        return (
            occurrenceIndex === 0 &&
            occurrence.token === 'Type.ratingCompact' &&
            tokenStylesOnlyExpression(source, occurrence, 'item.rating.toFixed(1)')
        );
    }
    return false;
}

function checkRatingGuardFixtures() {
    const ratingFile = path.join(PROFILE_COMPONENTS, 'Rating.tsx');
    const profileHeaderFile = path.join(PROFILE_COMPONENTS, 'ProfileHeader.tsx');
    const fixtures = [
        {
            name: 'compact numeric render is allowed',
            file: ratingFile,
            source: '<Text style={Type.ratingCompact}>{value.toFixed(1)}</Text>',
            allowed: true,
            sizeOverride: false,
        },
        {
            name: 'an inherited suffix is rejected',
            file: ratingFile,
            source: "<Text style={Type.ratingCompact}>{value.toFixed(1)}{' / 5'}</Text>",
            allowed: false,
            sizeOverride: false,
        },
        {
            name: 'a local rating size override is detected',
            file: ratingFile,
            source: '<Text style={[Type.ratingCompact, { fontSize: 12 }]}>{value.toFixed(1)}</Text>',
            allowed: true,
            sizeOverride: true,
        },
        {
            name: 'rating token use on a Profile label is rejected',
            file: profileHeaderFile,
            source: '<Text style={Type.ratingCompact}>Followers</Text>',
            allowed: false,
            sizeOverride: false,
        },
    ];
    const diagnostics = [];
    for (const fixture of fixtures) {
        const [occurrence] = ratingTokens(fixture.source);
        const allowed = occurrence
            ? isAllowedProfileRatingToken(fixture.file, fixture.source, occurrence, 0)
            : false;
        const sizeOverride = occurrence
            ? ratingTokenHasSizeOverride(fixture.source, occurrence)
            : false;
        if (allowed !== fixture.allowed || sizeOverride !== fixture.sizeOverride) {
            diagnostics.push({
                rule: 'guard/rating-regression-fixture',
                file: 'scripts/check-typography.mjs',
                line: 1,
                message: `${fixture.name} produced allowed=${allowed}, sizeOverride=${sizeOverride}.`,
            });
        }
    }
    return { count: fixtures.length, diagnostics };
}

function isProfileRoute(filePath) {
    const relativePath = toRepoPath(filePath);
    if (!relativePath.startsWith('napkin-app/app/')) return false;
    const appRelative = relativePath.slice('napkin-app/app/'.length);
    if (appRelative.startsWith('u/')) return true;
    if (appRelative.startsWith('member/')) return true;
    return appRelative.split('/').some((segment) => /^profile(?:[.\[_-]|$)/i.test(segment));
}

function isStrictProfileFile(filePath) {
    const relativePath = toRepoPath(filePath);
    return (
        relativePath.startsWith('napkin-app/components/profile/') ||
        relativePath.startsWith('napkin-app/components/members/') ||
        isProfileRoute(filePath)
    );
}

function profileFiles() {
    const componentFiles = [
        ...walkSourceFiles(PROFILE_COMPONENTS),
        ...walkSourceFiles(MEMBER_COMPONENTS),
    ];
    const routeFiles = walkSourceFiles(APP_ROOT).filter(isProfileRoute);
    return uniqueSorted([...componentFiles, ...routeFiles]);
}

function checkProfile() {
    const files = profileFiles();
    const diagnostics = [];

    for (const filePath of files) {
        const rawSource = fs.readFileSync(filePath, 'utf8');
        const source = maskComments(rawSource);

        for (const occurrence of italicFontStyles(source)) {
            diagnostics.push(diagnostic(
                'profile/no-font-style-italic',
                filePath,
                rawSource,
                occurrence.index,
                "Profile forbids `fontStyle: 'italic'`; choose an upright semantic token.",
            ));
        }

        for (const occurrence of headlineItalicTokens(source)) {
            diagnostics.push(diagnostic(
                'profile/no-headline-italic',
                filePath,
                rawSource,
                occurrence.index,
                'Profile forbids `Type.headlineItalic`; use upright Newsreader or Manrope semantics.',
            ));
        }

        for (const occurrence of quoteTokens(source)) {
            if (isAllowedProfileQuote(filePath, source, occurrence)) continue;
            diagnostics.push(diagnostic(
                'profile/quote-token-allowlist',
                filePath,
                rawSource,
                occurrence.index,
                'Type.quote is allowed only on a named direct-quote render. Names, labels, and structural copy stay upright.',
            ));
        }

        const semanticRatings = ratingTokens(source);
        semanticRatings.forEach((occurrence, index) => {
            if (!isAllowedProfileRatingToken(filePath, source, occurrence, index)) {
                diagnostics.push(diagnostic(
                    'profile/rating-token-allowlist',
                    filePath,
                    rawSource,
                    occurrence.index,
                    `${occurrence.token} is allowed only on a named isolated Profile rating render. Labels, names, and suffixes stay upright.`,
                ));
            }
            if (ratingTokenHasSizeOverride(source, occurrence)) {
                diagnostics.push(diagnostic(
                    'profile/rating-token-size-override',
                    filePath,
                    rawSource,
                    occurrence.index,
                    `${occurrence.token} cannot be locally resized; choose the compact, standard, or large semantic token.`,
                ));
            }
        });

        const families = italicFamilies(source);
        families.forEach((occurrence, index) => {
            if (isAllowedProfileItalic(filePath, source, occurrence, index)) return;
            diagnostics.push(diagnostic(
                'profile/italic-family-allowlist',
                filePath,
                rawSource,
                occurrence.index,
                `${occurrence.family} is allowed only for RatingHistogram.avg/spineNum or MarqueePlate.rating/ratingPhoto. Names and labels stay upright.`,
            ));
        });

        for (const occurrence of literalFontSizes(source)) {
            if (occurrence.value >= MIN_LITERAL_FONT_SIZE) continue;
            diagnostics.push(diagnostic(
                'profile/min-literal-font-size',
                filePath,
                rawSource,
                occurrence.index,
                `Literal fontSize ${occurrence.value} is below the Profile floor of ${MIN_LITERAL_FONT_SIZE}.`,
            ));
        }
    }

    return { files, diagnostics };
}

const TYPE_FLOORS = {
    screenTitle: 20,
    editorialTitle: 20,
    editorialBody: 17,
    quote: 16,
    body: 16,
    bodySmall: 14,
    caption: 13,
    metadata: 13,
    feedMeta: 13,
    feedMetaStrong: 13,
    feedNoteRestaurant: 16,
    feedCardRestaurant: 17,
    feedNoteRating: 16,
    feedCardRating: 17,
    feedQuote: 15,
    feedLedger: 15,
    feedLedgerRating: 15,
    feedPhotoCount: 14,
    label: 11,
    labelSmall: 11,
    sectionKicker: 11,
    sectionTitle: 18,
    ratingCompact: 16,
    rating: 24,
    ratingLarge: 36,
    restaurantName: 34,
    restaurantPrimaryAction: 13,
    restaurantUtilityAction: 13,
    restaurantLedgerRating: 22,
    restaurantSectionAction: 13,
    restaurantQuote: 16,
    restaurantQuoteName: 13,
    restaurantRatingInline: 15,
    restaurantListTitle: 15,
    restaurantDetail: 15,
    restaurantDetailAction: 13,
    restaurantHistoryVisits: 16,
    restaurantHistoryDateline: 11,
    restaurantHistoryNote: 16,
};
const ALLOWED_ITALIC_TYPE_TOKENS = new Set([
    'headlineItalic', // Legacy: app-wide per-file debt prevents new callers.
    'quote',
    'ratingCompact',
    'rating',
    'ratingLarge',
    // TICKET-226 founder-approved artboard: italic ratings and pull-quotes are brand carve-outs.
    'feedNoteRating',
    'feedCardRating',
    'feedQuote',
    'feedLedgerRating',
    // TICKET-227 founder-approved restaurant quotes and inline rating numerals.
    'restaurantQuote',
    'restaurantRatingInline',
    // TICKET-235 founder-approved ledger-line rating numerals.
    'restaurantLedgerRating',
]);

function italicTypeTokens(themeSource) {
    const source = maskComments(themeSource);
    const tokenPattern = /(?:^|\n) {2}([A-Za-z_$][\w$]*):\s*\{([\s\S]*?)\}\s*as\s+TextStyle/g;
    const tokens = [];
    let match;
    while ((match = tokenPattern.exec(source)) !== null) {
        if (
            /\bfontFamily\s*:\s*['"][^'"]*Italic[^'"]*['"]/.test(match[2]) ||
            /\bfontStyle\s*:\s*(['"])italic\1/.test(match[2])
        ) {
            tokens.push({ token: match[1], index: match.index });
        }
    }
    return tokens;
}

function checkItalicTokenGuardFixtures() {
    const fixtures = [
        {
            name: 'italic family token is detected',
            source: "  sectionAccent: { fontFamily: 'Newsreader_400Regular_Italic' } as TextStyle",
            detected: true,
        },
        {
            name: 'fontStyle italic token is detected',
            source: "  sectionAccent: { fontFamily: 'Newsreader_400Regular', fontStyle: 'italic' } as TextStyle",
            detected: true,
        },
        {
            name: 'upright token is not flagged',
            source: "  sectionTitle: { fontFamily: 'Manrope_700Bold' } as TextStyle",
            detected: false,
        },
    ];
    const diagnostics = fixtures.flatMap((fixture) => {
        const detected = italicTypeTokens(fixture.source).length > 0;
        return detected === fixture.detected ? [] : [{
            rule: 'guard/italic-token-regression-fixture',
            file: 'scripts/check-typography.mjs',
            line: 1,
            message: `${fixture.name} produced detected=${detected}.`,
        }];
    });
    return { count: fixtures.length, diagnostics };
}

function readTypeTokenFontSize(themeSource, token) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenPattern = new RegExp(
        `(?:^|\\n)\\s{2}${escapedToken}:\\s*\\{([\\s\\S]*?)\\}\\s*as\\s+TextStyle`,
    );
    const tokenMatch = themeSource.match(tokenPattern);
    if (!tokenMatch) return null;
    const fontSizeMatch = tokenMatch[1].match(/\bfontSize\s*:\s*(\d+(?:\.\d+)?)/);
    return fontSizeMatch ? Number(fontSizeMatch[1]) : null;
}

function readSchemeColor(themeSource, scheme, token) {
    const schemeStart = themeSource.indexOf(`${scheme}: {`);
    if (schemeStart === -1) return null;
    const nextSchemeStart = scheme === 'light'
        ? themeSource.indexOf('dark: {', schemeStart + 1)
        : -1;
    const schemeSource = themeSource.slice(
        schemeStart,
        nextSchemeStart === -1 ? themeSource.length : nextSchemeStart,
    );
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = schemeSource.match(new RegExp(`\\b${escapedToken}\\s*:\\s*['\"](#[0-9a-fA-F]{6})['\"]`));
    return match?.[1] ?? null;
}

function relativeLuminance(hex) {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) => (
        channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(first, second) {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

function checkTheme() {
    const source = fs.readFileSync(THEME_PATH, 'utf8');
    const diagnostics = [];
    const floors = [];
    const contrasts = [];

    for (const [token, floor] of Object.entries(TYPE_FLOORS)) {
        const value = readTypeTokenFontSize(source, token);
        floors.push({ token, floor, value });
        if (value === null) {
            diagnostics.push(diagnostic(
                'theme/token-present',
                THEME_PATH,
                source,
                0,
                `Type.${token} must declare a literal fontSize so its ${floor}pt floor can be checked.`,
            ));
        } else if (value < floor) {
            const index = source.indexOf(`${token}:`);
            diagnostics.push(diagnostic(
                'theme/legibility-floor',
                THEME_PATH,
                source,
                Math.max(0, index),
                `Type.${token} is ${value}; minimum is ${floor}.`,
            ));
        }
    }

    for (const { token, index } of italicTypeTokens(source)) {
        if (ALLOWED_ITALIC_TYPE_TOKENS.has(token)) continue;
        diagnostics.push(diagnostic(
            'theme/italic-token-allowlist',
            THEME_PATH,
            source,
            index,
            `Type.${token} introduces a new italic semantic role. Add it only after explicit design review and checker allowlist review.`,
        ));
    }

    const contrastSurfaces = [
        'background',
        'surfaceContainer',
        'surfaceContainerLow',
        'surfaceContainerHigh',
        'card',
        'plateAmber',
        'plateOlive',
        'plateRose',
        'plateGrey',
        'plateSlate',
        'plateSand',
    ];
    for (const scheme of ['light', 'dark']) {
        const textMuted = readSchemeColor(source, scheme, 'textMuted');
        for (const surface of contrastSurfaces) {
            const surfaceColor = readSchemeColor(source, scheme, surface);
            const ratio = textMuted && surfaceColor ? contrastRatio(textMuted, surfaceColor) : null;
            contrasts.push({ scheme, surface, textMuted, surfaceColor, ratio });
            if (ratio === null) {
                diagnostics.push(diagnostic(
                    'theme/static-contrast-colors',
                    THEME_PATH,
                    source,
                    0,
                    `Colors.${scheme}.textMuted and Colors.${scheme}.${surface} must be static six-digit hex colors.`,
                ));
            } else if (ratio + Number.EPSILON < 4.5) {
                const index = source.indexOf(`${scheme}: {`);
                diagnostics.push(diagnostic(
                    'theme/muted-text-contrast',
                    THEME_PATH,
                    source,
                    Math.max(0, index),
                    `Colors.${scheme}.textMuted ${textMuted} is ${ratio.toFixed(2)}:1 on ${surface} ${surfaceColor}; minimum is 4.50:1.`,
                ));
            }
        }
    }

    return { diagnostics, floors, contrasts };
}

const ZERO_DEBT = Object.freeze({
    fontStyleItalic: 0,
    headlineItalicToken: 0,
    italicFamily: 0,
    tinyFontSize: 0,
});

function scanDebt(filePath) {
    const rawSource = fs.readFileSync(filePath, 'utf8');
    const source = maskComments(rawSource);
    const families = italicFamilies(source);
    const countedFamilies = (
        isStrictProfileFile(filePath)
            ? families.filter((occurrence, index) => !isAllowedProfileItalic(filePath, source, occurrence, index))
            : families
    );
    return {
        fontStyleItalic: italicFontStyles(source).length,
        headlineItalicToken: headlineItalicTokens(source).length,
        italicFamily: countedFamilies.length,
        tinyFontSize: literalFontSizes(source).filter(({ value }) => value < MIN_LITERAL_FONT_SIZE).length,
    };
}

function hasDebt(counts) {
    return Object.values(counts).some((count) => count > 0);
}

function allUiFiles() {
    return uniqueSorted(UI_ROOTS.flatMap(walkSourceFiles));
}

function currentDebtByFile() {
    const entries = {};
    for (const filePath of allUiFiles()) {
        const counts = scanDebt(filePath);
        if (hasDebt(counts)) entries[toRepoPath(filePath)] = counts;
    }
    return entries;
}

const DEBT_CATEGORIES = Object.keys(ZERO_DEBT);

function baselineDocument(files) {
    return {
        version: BASELINE_VERSION,
        description: 'Per-file ceilings for legacy direct italic and sub-11pt literal typography debt.',
        scope: ['napkin-app/app', 'napkin-app/components'],
        minimumLiteralFontSize: MIN_LITERAL_FONT_SIZE,
        categories: DEBT_CATEGORIES,
        files: Object.fromEntries(
            Object.entries(files)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([file, counts]) => [file, DEBT_CATEGORIES.map((category) => counts[category] ?? 0)]),
        ),
    };
}

function writeBaseline(files) {
    const baseline = baselineDocument(files);
    const entries = Object.entries(baseline.files);
    const fileLines = entries.map(([file, counts], index) => (
        `    ${JSON.stringify(file)}: [${counts.join(', ')}]${index === entries.length - 1 ? '' : ','}`
    ));
    const serialized = [
        '{',
        `  "version": ${baseline.version},`,
        `  "description": ${JSON.stringify(baseline.description)},`,
        `  "scope": ${JSON.stringify(baseline.scope)},`,
        `  "minimumLiteralFontSize": ${baseline.minimumLiteralFontSize},`,
        `  "categories": ${JSON.stringify(baseline.categories)},`,
        '  "files": {',
        ...fileLines,
        '  }',
        '}',
        '',
    ].join('\n');
    fs.writeFileSync(BASELINE_PATH, serialized);
}

function readBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) {
        throw new Error('Missing scripts/typography-baseline.json. Run with --update-baseline after reviewing current debt.');
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    if (
        baseline.version !== BASELINE_VERSION ||
        typeof baseline.files !== 'object' ||
        baseline.files === null ||
        !Array.isArray(baseline.categories) ||
        baseline.categories.length !== DEBT_CATEGORIES.length ||
        DEBT_CATEGORIES.some((category, index) => baseline.categories[index] !== category)
    ) {
        throw new Error(`Unsupported typography baseline format; expected version ${BASELINE_VERSION}.`);
    }
    const files = {};
    for (const [file, values] of Object.entries(baseline.files)) {
        if (!Array.isArray(values) || values.length !== DEBT_CATEGORIES.length || values.some((value) => !Number.isInteger(value) || value < 0)) {
            throw new Error(`Invalid typography baseline counts for ${file}.`);
        }
        files[file] = Object.fromEntries(DEBT_CATEGORIES.map((category, index) => [category, values[index]]));
    }
    return { ...baseline, files };
}

function sumDebt(files) {
    const total = { ...ZERO_DEBT };
    for (const counts of Object.values(files)) {
        for (const key of Object.keys(total)) total[key] += counts[key] ?? 0;
    }
    return total;
}

function compareDebt(current, baseline) {
    const diagnostics = [];
    const reductions = [];
    const allPaths = [...new Set([...Object.keys(current), ...Object.keys(baseline.files)])].sort();

    for (const relativePath of allPaths) {
        const actual = current[relativePath] ?? ZERO_DEBT;
        const budget = baseline.files[relativePath] ?? ZERO_DEBT;
        for (const category of Object.keys(ZERO_DEBT)) {
            const actualCount = actual[category] ?? 0;
            const budgetCount = budget[category] ?? 0;
            if (actualCount > budgetCount) {
                diagnostics.push({
                    rule: `debt/${category}`,
                    file: relativePath,
                    line: 1,
                    message: `${category} is ${actualCount}; per-file baseline is ${budgetCount} (+${actualCount - budgetCount}). New files have a zero budget.`,
                });
            } else if (actualCount < budgetCount) {
                reductions.push({
                    file: relativePath,
                    category,
                    count: budgetCount - actualCount,
                });
            }
        }
    }

    return { diagnostics, reductions };
}

function formatDebt(counts) {
    return [
        `${counts.italicFamily} family`,
        `${counts.headlineItalicToken} token`,
        `${counts.fontStyleItalic} fontStyle`,
        `${counts.tinyFontSize} tiny`,
    ].join(' · ');
}

function printDiagnostics(diagnostics) {
    const sorted = [...diagnostics].sort((a, b) => (
        a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule)
    ));
    for (const item of sorted) {
        console.error(`  ${item.file}:${item.line}  [${item.rule}] ${item.message}`);
    }
}

function main() {
    const ratingFixtures = checkRatingGuardFixtures();
    const italicTokenFixtures = checkItalicTokenGuardFixtures();
    const profile = checkProfile();
    const theme = checkTheme();
    const currentDebt = currentDebtByFile();
    const currentTotal = sumDebt(currentDebt);
    let baseline = null;
    let debtComparison = { diagnostics: [], reductions: [] };
    let baselineError = null;

    if (updateBaseline) {
        writeBaseline(currentDebt);
        baseline = { files: currentDebt };
    } else {
        try {
            baseline = readBaseline();
            debtComparison = compareDebt(currentDebt, baseline);
        } catch (error) {
            baselineError = error instanceof Error ? error.message : String(error);
        }
    }

    const baselineTotal = baseline ? sumDebt(baseline.files) : { ...ZERO_DEBT };
    const diagnostics = [
        ...ratingFixtures.diagnostics,
        ...italicTokenFixtures.diagnostics,
        ...profile.diagnostics,
        ...theme.diagnostics,
        ...debtComparison.diagnostics,
    ];
    if (baselineError) {
        diagnostics.push({
            rule: 'debt/baseline',
            file: 'scripts/typography-baseline.json',
            line: 1,
            message: baselineError,
        });
    }

    console.log('Typography policy guard');
    console.log(`  Rating regression fixtures: ${ratingFixtures.count - ratingFixtures.diagnostics.length}/${ratingFixtures.count} pass`);
    console.log(`  Italic-token regression fixtures: ${italicTokenFixtures.count - italicTokenFixtures.diagnostics.length}/${italicTokenFixtures.count} pass`);
    console.log(`  Profile strict: ${profile.files.length} files · ${profile.diagnostics.length} violation${profile.diagnostics.length === 1 ? '' : 's'}`);
    console.log(`  Theme floors: ${theme.floors.filter(({ value, floor }) => value !== null && value >= floor).length}/${theme.floors.length} pass`);
    const contrastSummary = ['light', 'dark'].map((scheme) => {
        const values = theme.contrasts.filter((item) => item.scheme === scheme && item.ratio !== null);
        const worst = values.reduce((current, item) => (
            !current || item.ratio < current.ratio ? item : current
        ), null);
        return worst ? `${scheme} ${worst.ratio.toFixed(2)}:1 on ${worst.surface}` : `${scheme} unreadable`;
    });
    console.log(`  Muted contrast minimums: ${contrastSummary.join(' · ')}`);
    console.log(`  Current UI debt: ${formatDebt(currentTotal)} across ${Object.keys(currentDebt).length} files`);
    if (!updateBaseline && baseline) {
        console.log(`  Baseline ceiling: ${formatDebt(baselineTotal)} across ${Object.keys(baseline.files).length} files`);
    }

    if (updateBaseline) {
        console.log(`  Updated ${toRepoPath(BASELINE_PATH)} with reviewed per-file ceilings.`);
    } else if (debtComparison.reductions.length > 0) {
        const reducedCount = debtComparison.reductions.reduce((sum, item) => sum + item.count, 0);
        console.log(`  Improvement: ${reducedCount} debt occurrence${reducedCount === 1 ? '' : 's'} below baseline; refresh it after review to bank the reduction.`);
    }

    if (diagnostics.length > 0) {
        console.error(`\nFAIL: ${diagnostics.length} typography policy violation${diagnostics.length === 1 ? '' : 's'}\n`);
        printDiagnostics(diagnostics);
        if (updateBaseline) {
            console.error('\nThe incremental baseline was updated, but it cannot waive Profile or theme hard gates.');
        }
        process.exitCode = 1;
        return;
    }

    console.log(updateBaseline ? '\nPASS: baseline updated and hard gates pass.' : '\nPASS: typography policy holds.');
}

main();
