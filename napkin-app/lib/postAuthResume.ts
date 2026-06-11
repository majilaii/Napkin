/**
 * postAuthResume — post-sign-in resume resolver for stash precedence.
 *
 * TICKET-072 ARCH-REVIEW-2 #11:
 *   When both pendingImport and pendingHandoff exist, the most-recent stashedAt wins.
 *   The LOSER is preserved — its store entry is NOT consumed, only the winner's is.
 *   Failed sign-in preserves both (re-stash the winner, loser already intact).
 *
 * Used by app/auth.tsx in place of the direct pendingImport.consume() call.
 * The TICKET-055 consume-before-signin ordering is preserved:
 *   1. consumeWinner() BEFORE signInWithPassword
 *   2. On sign-in failure: re-stash the winner so the next attempt can resume.
 *
 * The TICKET-063 import_nonce threading is preserved:
 *   When the winner is 'import', its full Stash (including import_nonce) is returned
 *   so auth.tsx can thread the nonce through the /import redirect unchanged.
 */
import * as pendingImport from './pendingImport';
import * as pendingHandoff from './pendingHandoff';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ResumeResult =
    | { kind: 'import'; stash: pendingImport.Stash }
    | { kind: 'handoff'; token: string; stashedAt: number }
    | null;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Peek both stores and return the winner (most-recent stashedAt) without removing
 * either entry. Caller uses this to decide which route to go to.
 */
export async function peek(): Promise<ResumeResult> {
    const [imp, hnd] = await Promise.all([
        pendingImport.peek(),
        pendingHandoff.peek(),
    ]);

    if (!imp && !hnd) return null;
    if (!imp) return { kind: 'handoff', token: hnd!.token, stashedAt: hnd!.stashedAt };
    if (!hnd) return { kind: 'import', stash: imp };

    // Both present — newer wins; loser preserved in its store
    if (hnd.stashedAt >= imp.stashedAt) {
        return { kind: 'handoff', token: hnd.token, stashedAt: hnd.stashedAt };
    }
    return { kind: 'import', stash: imp };
}

/**
 * Peek both, consume ONLY the winner's store entry (loser stays).
 * Returns the winner's data so auth.tsx can re-stash on sign-in failure.
 *
 * Call this BEFORE signInWithPassword (TICKET-055 ordering preserved).
 */
export async function consumeWinner(): Promise<ResumeResult> {
    const winner = await peek();
    if (!winner) return null;

    if (winner.kind === 'import') {
        await pendingImport.consume();
    } else {
        await pendingHandoff.consume();
    }

    return winner;
}

/**
 * Re-stash the winner when sign-in fails.
 * The loser is still in its store (untouched by consumeWinner).
 */
export async function restashWinner(winner: ResumeResult): Promise<void> {
    if (!winner) return;
    if (winner.kind === 'import') {
        await pendingImport.stash(winner.stash.url, winner.stash.import_nonce);
    } else {
        await pendingHandoff.stash(winner.token);
    }
}
