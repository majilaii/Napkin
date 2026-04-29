#!/usr/bin/env tsx
/**
 * lint-tm-member-id.ts — TICKET-043 pre-merge safety check.
 *
 * Scans SQL/TypeScript files for `tm.user_id` references in table_members joins.
 * The column is `table_members.member_id`, NOT `table_members.user_id`.
 * Using `tm.user_id` silently allows or denies everything (column does not exist
 * → RLS predicate is always NULL → no rows returned). See CLAUDE.md doctrine.
 *
 * Usage:
 *   npx tsx scripts/lint-tm-member-id.ts [--changed-only]
 *
 * Flags:
 *   --changed-only  Only check files changed vs main branch (CI mode).
 *
 * Exit code:
 *   0  No violations found.
 *   1  One or more violations found (prints file:line for each).
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');

// Pattern: tm.user_id — alias `tm` (common alias for table_members join)
// We also check raw `table_members.user_id` column references.
const PATTERNS = [
    /\btm\.user_id\b/,
    /\btable_members\.user_id\b/,
];

// File extensions to scan.
const SCAN_EXTS = new Set(['.sql', '.ts', '.tsx']);

// Directories to skip.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.expo']);

function shouldScan(filePath: string): boolean {
    const ext = path.extname(filePath);
    return SCAN_EXTS.has(ext);
}

function getChangedFiles(): string[] {
    try {
        const output = execSync('git diff --name-only origin/main...HEAD', {
            cwd: REPO_ROOT,
            encoding: 'utf-8',
        });
        return output
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.length > 0)
            .map(f => path.join(REPO_ROOT, f))
            .filter(f => fs.existsSync(f) && shouldScan(f));
    } catch {
        console.error('lint-tm-member-id: could not get changed files from git diff');
        process.exit(1);
    }
}

function walkDir(dir: string, result: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return result;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, result);
        } else if (entry.isFile() && shouldScan(fullPath)) {
            result.push(fullPath);
        }
    }
    return result;
}

function scanFile(filePath: string): Array<{ line: number; text: string }> {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }
    const lines = content.split('\n');
    const violations: Array<{ line: number; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment lines (SQL -- and JS //).
        const stripped = line.trim();
        if (stripped.startsWith('--') || stripped.startsWith('//') || stripped.startsWith('*')) {
            continue;
        }
        for (const pat of PATTERNS) {
            if (pat.test(line)) {
                violations.push({ line: i + 1, text: line.trim() });
                break; // don't double-report same line
            }
        }
    }
    return violations;
}

function main() {
    const args = process.argv.slice(2);
    const changedOnly = args.includes('--changed-only');

    const files = changedOnly
        ? getChangedFiles()
        : walkDir(REPO_ROOT);

    const allViolations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
        const violations = scanFile(file);
        for (const v of violations) {
            allViolations.push({ file, ...v });
        }
    }

    if (allViolations.length === 0) {
        console.log('lint-tm-member-id: no violations found.');
        process.exit(0);
    }

    console.error(`lint-tm-member-id: ${allViolations.length} violation(s) found:`);
    console.error('');
    console.error('  table_members join uses .user_id — the column is .member_id (TICKET-034 doctrine)');
    console.error('  See CLAUDE.md "member_id vs user_id" section.');
    console.error('');
    for (const v of allViolations) {
        const rel = path.relative(REPO_ROOT, v.file);
        console.error(`  ${rel}:${v.line}  ${v.text}`);
    }
    console.error('');
    process.exit(1);
}

main();
