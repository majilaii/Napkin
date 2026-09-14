/**
 * pendingIdentity — carries the provider-supplied name across sign-in → onboarding.
 *
 * WHY THIS EXISTS (App Store Guideline 4, rejection 2026-09-14):
 * Sign in with Apple hands back the user's full name in the native credential,
 * but `supabase.auth.signInWithIdToken` has NO parameter that seeds user
 * metadata (see SignInWithIdTokenCredentials — only provider/token/access_token/
 * nonce/captchaToken). The Apple identity JWT carries no name claim either, so
 * `handle_new_user` coalesces display_name down to 'New User' and the onboarding
 * name step then DEMANDED a name Apple had already given us. Apple rejected that.
 *
 * APPLE GIVES THE NAME EXACTLY ONCE — on the first authorization for that Apple
 * ID + app, and never again (the user must revoke the app under Settings → Apple
 * ID → Sign in with Apple to reset it). So the name must be captured on that one
 * pass and made durable immediately. Two sinks, deliberately redundant:
 *   1. `supabase.auth.updateUser({ data: { full_name } })` — the SERVER sink,
 *      survives reinstall. auth.tsx fires it on the same tick.
 *   2. this stash — the SYNCHRONOUS local sink. RootLayoutNav redirects to
 *      /onboarding the instant the session flips, which races the updateUser
 *      round-trip, and offline that round-trip may never land at all.
 *
 * Scoped to `userId`: a stash written for one account is never readable by
 * another (per-user cache isolation — a device-global user-private store must
 * never bleed across an auth-identity change).
 *
 * TTL 30 minutes: onboarding normally runs seconds after sign-in, but an
 * import/handoff/invite resume wins the redirect first (RootLayoutNav's
 * `inResume` branch), so the user can legitimately reach the name step several
 * minutes later.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'napkin.pendingIdentity';
const TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface IdentityStash {
    /** The account this identity belongs to. Reads from any other user miss. */
    userId: string;
    /** Provider-supplied human name, already trimmed. Null when the provider withheld it. */
    fullName: string | null;
    /** Provider-supplied email (may be an Apple private-relay address). */
    email: string | null;
    /** Unix epoch in milliseconds. */
    stashedAt: number;
}

/**
 * In-memory mirror. AsyncStorage is async, and the onboarding name step may
 * mount in the SAME tick as the session flip — too early for a read to have
 * resolved. This lets that first render already know the name, so the step can
 * be skipped without flashing a name form the user must not be asked to fill.
 */
let memo: IdentityStash | null = null;

/** Write the provider identity for `userId`. Memo is set synchronously. */
export async function stash(
    userId: string,
    identity: { fullName: string | null; email: string | null },
): Promise<void> {
    const payload: IdentityStash = {
        userId,
        fullName: identity.fullName?.trim() || null,
        email: identity.email?.trim() || null,
        stashedAt: Date.now(),
    };
    memo = payload;
    try {
        await AsyncStorage.setItem(KEY, JSON.stringify(payload));
    } catch {
        // Memo still serves this app session; a lost write only costs the
        // cold-restart recovery path, which updateUser already covers.
    }
}

/** Synchronous read of the in-memory mirror. Null when it is absent, expired, or another user's. */
export function peekSync(userId: string): IdentityStash | null {
    if (!memo || memo.userId !== userId) return null;
    if (Date.now() - memo.stashedAt > TTL_MS) {
        memo = null;
        return null;
    }
    return memo;
}

/**
 * Read the stash for `userId` without removing it, falling back to AsyncStorage
 * when the memo is cold (app restarted between sign-in and onboarding).
 * Returns null if absent, expired, or written for a different user.
 */
export async function peek(userId: string): Promise<IdentityStash | null> {
    const fromMemo = peekSync(userId);
    if (fromMemo) return fromMemo;
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<IdentityStash>;
        if (!parsed.userId || parsed.userId !== userId) return null;
        if (!parsed.stashedAt || Date.now() - parsed.stashedAt > TTL_MS) {
            await AsyncStorage.removeItem(KEY);
            return null;
        }
        const found: IdentityStash = {
            userId: parsed.userId,
            fullName: typeof parsed.fullName === 'string' ? parsed.fullName : null,
            email: typeof parsed.email === 'string' ? parsed.email : null,
            stashedAt: parsed.stashedAt,
        };
        memo = found;
        return found;
    } catch {
        return null;
    }
}

/** Drop the stash (onboarding finished, or the user signed out). */
export async function clear(): Promise<void> {
    memo = null;
    try {
        await AsyncStorage.removeItem(KEY);
    } catch {
        // Best-effort; the userId scope and TTL both already fence a stale entry.
    }
}
