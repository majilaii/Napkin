/**
 * Tests for lib/postAuthResume.ts — TICKET-072 ARCH-REVIEW-2 #11
 *
 * Verifies stash precedence:
 *   - both present → newer stashedAt wins; loser preserved
 *   - only import → import wins
 *   - only handoff → handoff wins
 *   - none → null
 *   - consumeWinner removes winner only; loser stays
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// We import the public API for stash/clear to set up state
import { stash as stashImport, clear as clearImport } from '../pendingImport';
import { stash as stashHandoff, clear as clearHandoff } from '../pendingHandoff';
import { stash as stashInvite, clear as clearInvite } from '../pendingInvite';
import { peek, consumeWinner, restashWinner } from '../postAuthResume';

const IMPORT_KEY = 'napkin.pendingImportUrl';
const HANDOFF_KEY = 'napkin.pendingHandoffToken';
const INVITE_KEY = 'napkin.pendingInviteCode';

beforeEach(async () => {
    await AsyncStorage.clear();
});

// ── peek ──────────────────────────────────────────────────────────────────────

describe('peek: none present', () => {
    it('returns null when no stash exists', async () => {
        const result = await peek();
        expect(result).toBeNull();
    });
});

describe('peek: only import', () => {
    it('returns import when only import stash exists', async () => {
        await stashImport('https://maps.google.com/abc', 'test-nonce-001');
        const result = await peek();
        expect(result?.kind).toBe('import');
        if (result?.kind === 'import') {
            expect(result.stash.url).toBe('https://maps.google.com/abc');
            expect(result.stash.import_nonce).toBe('test-nonce-001');
        }
    });
});

describe('peek: only handoff', () => {
    it('returns handoff when only handoff stash exists', async () => {
        await stashHandoff('my_share_token_123');
        const result = await peek();
        expect(result?.kind).toBe('handoff');
        if (result?.kind === 'handoff') {
            expect(result.token).toBe('my_share_token_123');
        }
    });
});

describe('peek: both present — newer wins', () => {
    it('handoff wins when handoff is newer', async () => {
        // Stash import first (older)
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            IMPORT_KEY,
            JSON.stringify({ url: 'https://tiktok.com/v/1', import_nonce: 'nonce-A', stashedAt: olderAt }),
        );
        // Stash handoff now (newer)
        await stashHandoff('newer_token');
        const result = await peek();
        expect(result?.kind).toBe('handoff');
    });

    it('import wins when import is newer', async () => {
        // Stash handoff first (older)
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            HANDOFF_KEY,
            JSON.stringify({ token: 'older_token', stashedAt: olderAt }),
        );
        // Stash import now (newer)
        await stashImport('https://maps.google.com/abc', 'nonce-B');
        const result = await peek();
        expect(result?.kind).toBe('import');
    });

    it('peek does not remove either stash', async () => {
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            IMPORT_KEY,
            JSON.stringify({ url: 'https://tiktok.com/v/1', import_nonce: 'nonce-C', stashedAt: olderAt }),
        );
        await stashHandoff('token_both_peek');
        await peek();
        // Both should still be present after peek
        const importRaw = await AsyncStorage.getItem(IMPORT_KEY);
        const handoffRaw = await AsyncStorage.getItem(HANDOFF_KEY);
        expect(importRaw).not.toBeNull();
        expect(handoffRaw).not.toBeNull();
    });
});

describe('peek: only invite', () => {
    it('returns invite when only invite stash exists', async () => {
        await stashInvite('inviteCode0000000000AB');
        const result = await peek();
        expect(result?.kind).toBe('invite');
        if (result?.kind === 'invite') {
            expect(result.code).toBe('inviteCode0000000000AB');
        }
    });
});

describe('peek: invite vs others — newest wins', () => {
    it('invite wins when invite is newest', async () => {
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            HANDOFF_KEY,
            JSON.stringify({ token: 'older_token', stashedAt: olderAt }),
        );
        await AsyncStorage.setItem(
            IMPORT_KEY,
            JSON.stringify({ url: 'https://tiktok.com/v/1', import_nonce: 'nonce-X', stashedAt: olderAt }),
        );
        // Invite stashed now (newest)
        await stashInvite('newestInviteCode0000AB');
        const result = await peek();
        expect(result?.kind).toBe('invite');
    });

    it('invite loses when it is older than a handoff', async () => {
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            INVITE_KEY,
            JSON.stringify({ code: 'olderInviteCode00000AB', stashedAt: olderAt }),
        );
        await stashHandoff('newer_handoff_token');
        const result = await peek();
        expect(result?.kind).toBe('handoff');
    });
});

// ── consumeWinner ─────────────────────────────────────────────────────────────

describe('consumeWinner: removes winner, preserves loser', () => {
    it('when handoff wins: handoff removed, import preserved', async () => {
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            IMPORT_KEY,
            JSON.stringify({ url: 'https://eater.com/1', import_nonce: 'nonce-D', stashedAt: olderAt }),
        );
        await stashHandoff('winner_token_handoff');

        const winner = await consumeWinner();
        expect(winner?.kind).toBe('handoff');

        // Handoff removed
        const handoffRaw = await AsyncStorage.getItem(HANDOFF_KEY);
        expect(handoffRaw).toBeNull();

        // Import still present
        const importRaw = await AsyncStorage.getItem(IMPORT_KEY);
        expect(importRaw).not.toBeNull();
    });

    it('when import wins: import removed, handoff preserved', async () => {
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            HANDOFF_KEY,
            JSON.stringify({ token: 'loser_token', stashedAt: olderAt }),
        );
        await stashImport('https://maps.google.com/winner', 'nonce-E');

        const winner = await consumeWinner();
        expect(winner?.kind).toBe('import');

        // Import removed
        const importRaw = await AsyncStorage.getItem(IMPORT_KEY);
        expect(importRaw).toBeNull();

        // Handoff still present
        const handoffRaw = await AsyncStorage.getItem(HANDOFF_KEY);
        expect(handoffRaw).not.toBeNull();
    });

    it('returns null when nothing stashed', async () => {
        const result = await consumeWinner();
        expect(result).toBeNull();
    });

    it('only-import: returns import winner', async () => {
        await stashImport('https://maps.google.com/only', 'nonce-F');
        const winner = await consumeWinner();
        expect(winner?.kind).toBe('import');
        // Removed
        const importRaw = await AsyncStorage.getItem(IMPORT_KEY);
        expect(importRaw).toBeNull();
    });

    it('only-handoff: returns handoff winner', async () => {
        await stashHandoff('only_handoff_token');
        const winner = await consumeWinner();
        expect(winner?.kind).toBe('handoff');
        expect((winner as any)?.token).toBe('only_handoff_token');
        // Removed
        const handoffRaw = await AsyncStorage.getItem(HANDOFF_KEY);
        expect(handoffRaw).toBeNull();
    });

    it('when invite wins: invite removed, others preserved', async () => {
        const olderAt = Date.now() - 5000;
        await AsyncStorage.setItem(
            IMPORT_KEY,
            JSON.stringify({ url: 'https://eater.com/1', import_nonce: 'nonce-INV', stashedAt: olderAt }),
        );
        await stashInvite('winnerInviteCode0000AB');

        const winner = await consumeWinner();
        expect(winner?.kind).toBe('invite');
        expect((winner as any)?.code).toBe('winnerInviteCode0000AB');

        // Invite removed, import preserved
        expect(await AsyncStorage.getItem(INVITE_KEY)).toBeNull();
        expect(await AsyncStorage.getItem(IMPORT_KEY)).not.toBeNull();
    });
});

// ── restashWinner ─────────────────────────────────────────────────────────────

describe('restashWinner: re-stashes after auth failure', () => {
    it('re-stashes import winner with its original nonce', async () => {
        await stashImport('https://eater.com/restash', 'nonce-RESTASH');
        const winner = await consumeWinner();
        expect(winner?.kind).toBe('import');

        // Auth fails → restash
        await restashWinner(winner);
        const importRaw = await AsyncStorage.getItem(IMPORT_KEY);
        expect(importRaw).not.toBeNull();
        const parsed = JSON.parse(importRaw!);
        expect(parsed.url).toBe('https://eater.com/restash');
        expect(parsed.import_nonce).toBe('nonce-RESTASH');
    });

    it('re-stashes handoff winner with its token', async () => {
        await stashHandoff('restash_handoff_token');
        const winner = await consumeWinner();
        expect(winner?.kind).toBe('handoff');

        await restashWinner(winner);
        const handoffRaw = await AsyncStorage.getItem(HANDOFF_KEY);
        expect(handoffRaw).not.toBeNull();
        const parsed = JSON.parse(handoffRaw!);
        expect(parsed.token).toBe('restash_handoff_token');
    });

    it('re-stashes invite winner with its code', async () => {
        await stashInvite('restashInviteCode000AB');
        const winner = await consumeWinner();
        expect(winner?.kind).toBe('invite');

        await restashWinner(winner);
        const inviteRaw = await AsyncStorage.getItem(INVITE_KEY);
        expect(inviteRaw).not.toBeNull();
        const parsed = JSON.parse(inviteRaw!);
        expect(parsed.code).toBe('restashInviteCode000AB');
    });

    it('restashWinner(null) is a no-op', async () => {
        await expect(restashWinner(null)).resolves.toBeUndefined();
    });
});
