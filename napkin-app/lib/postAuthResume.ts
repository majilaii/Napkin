/**
 * postAuthResume — post-sign-in resume resolver for stash precedence.
 *
 * When pendingImport / pendingHandoff / pendingInvite coexist, the most-recent
 * stashedAt wins. The LOSERS are preserved — only the winner's store entry is
 * consumed. Failed sign-in re-stashes the winner (losers already intact).
 *
 * Used by app/auth.tsx in place of a direct pendingImport.consume() call.
 * The TICKET-055 consume-before-signin ordering is preserved:
 *   1. consumeWinner() BEFORE signInWithPassword
 *   2. On sign-in failure: re-stash the winner so the next attempt can resume.
 *
 * The TICKET-063 import_nonce threading is preserved: when the winner is
 * 'import', its full Stash (including import_nonce) is returned so auth.tsx can
 * thread the nonce through the /import redirect unchanged.
 */
import * as pendingImport from './pendingImport';
import * as pendingHandoff from './pendingHandoff';
import * as pendingInvite from './pendingInvite';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ResumeResult =
    | { kind: 'import'; stash: pendingImport.Stash }
    | { kind: 'handoff'; token: string; stashedAt: number }
    | { kind: 'invite'; code: string; stashedAt: number }
    | null;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Peek all three stores and return the winner (most-recent stashedAt) without
 * removing any entry. Caller uses this to decide which route to go to.
 */
export async function peek(): Promise<ResumeResult> {
    const [imp, hnd, inv] = await Promise.all([
        pendingImport.peek(),
        pendingHandoff.peek(),
        pendingInvite.peek(),
    ]);

    const candidates: { result: ResumeResult; stashedAt: number }[] = [];
    if (imp) candidates.push({ result: { kind: 'import', stash: imp }, stashedAt: imp.stashedAt });
    if (hnd) candidates.push({ result: { kind: 'handoff', token: hnd.token, stashedAt: hnd.stashedAt }, stashedAt: hnd.stashedAt });
    if (inv) candidates.push({ result: { kind: 'invite', code: inv.code, stashedAt: inv.stashedAt }, stashedAt: inv.stashedAt });

    if (candidates.length === 0) return null;

    // Newest wins; losers preserved in their stores.
    return candidates.reduce((best, c) => (c.stashedAt >= best.stashedAt ? c : best)).result;
}

/**
 * Peek all three, consume ONLY the winner's store entry (losers stay).
 * Returns the winner's data so auth.tsx can re-stash on sign-in failure.
 *
 * Call this BEFORE signInWithPassword (TICKET-055 ordering preserved).
 */
export async function consumeWinner(): Promise<ResumeResult> {
    const winner = await peek();
    if (!winner) return null;

    if (winner.kind === 'import') {
        await pendingImport.consume();
    } else if (winner.kind === 'handoff') {
        await pendingHandoff.consume();
    } else {
        await pendingInvite.consume();
    }

    return winner;
}

/**
 * Re-stash the winner when sign-in fails.
 * The losers are still in their stores (untouched by consumeWinner).
 */
export async function restashWinner(winner: ResumeResult): Promise<void> {
    if (!winner) return;
    if (winner.kind === 'import') {
        await pendingImport.stash(winner.stash.url, winner.stash.import_nonce);
    } else if (winner.kind === 'handoff') {
        await pendingHandoff.stash(winner.token);
    } else {
        await pendingInvite.stash(winner.code);
    }
}
