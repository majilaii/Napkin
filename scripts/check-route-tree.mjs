#!/usr/bin/env node
/**
 * Route-tree bundle guard (2026-07-16 postmortem).
 *
 * Expo Router bundles EVERY file under napkin-app/app/ into the production
 * app. A jest test committed there (app/onboarding/useFinishOnboarding.test.ts)
 * pulled @testing-library/react-native into the store bundle and killed the
 * TestFlight build at EAGER_BUNDLE ("Unable to resolve module console").
 * tsc, eslint, and jest are all structurally blind to that failure — this
 * check makes it instant, and the expo-export CI step makes it airtight.
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const appDir = join(repoRoot, 'napkin-app', 'app');

const BANNED_DIRS = new Set(['__tests__', '__mocks__', '__fixtures__']);
const BANNED_FILE = /\.(test|spec)\.[jt]sx?$|\.stories\.[jt]sx?$/;

const offenders = [];
function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (BANNED_DIRS.has(entry.name)) {
                offenders.push(relative(repoRoot, full) + '/');
                continue;
            }
            walk(full);
        } else if (BANNED_FILE.test(entry.name)) {
            offenders.push(relative(repoRoot, full));
        }
    }
}
walk(appDir);

if (offenders.length > 0) {
    console.error('✖ Test/story files inside the Expo Router route tree:\n');
    for (const o of offenders) console.error(`   ${o}`);
    console.error(
        '\nExpo Router bundles ALL of napkin-app/app/ into the production app —',
    );
    console.error(
        'move tests out of the route tree (e.g. napkin-app/hooks/**/__tests__/).',
    );
    console.error('Context: TestFlight EAGER_BUNDLE failure, PR #297.');
    process.exit(1);
}
console.log('route-tree guard: napkin-app/app/ is clean');
