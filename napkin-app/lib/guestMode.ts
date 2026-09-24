/**
 * Guest mode flag (TICKET-247, Guideline 5.1.1(v)).
 *
 * A client-side "look around first" state with no Supabase session behind it.
 * Durable across relaunches so a guest who browsed yesterday is not bounced to
 * /auth today. Storage failures fall back quietly: reading returns false (the
 * fail-closed default sends the launch to /auth), writing is a no-op.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const GUEST_MODE_KEY = 'napkin.guest.v1';

/**
 * The launch cover waits for this read. A native storage call that never
 * settles would hold it forever with no retry, so give up and read false
 * (the fail-closed default: /auth, where Look around is one tap away).
 */
export const GUEST_MODE_READ_TIMEOUT_MS = 1500;

const TRUE_VALUE = '1';
const FALSE_VALUE = '0';

/** Read the durable flag. Never throws or hangs; unreadable storage reads as false. */
export async function readGuestMode(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), GUEST_MODE_READ_TIMEOUT_MS);
    });
    const read = AsyncStorage.getItem(GUEST_MODE_KEY)
        .then((raw) => raw === TRUE_VALUE)
        .catch(() => false);
    try {
        return await Promise.race([read, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Persist the flag best-effort. Never throws. */
export async function writeGuestMode(value: boolean): Promise<void> {
    try {
        await AsyncStorage.setItem(GUEST_MODE_KEY, value ? TRUE_VALUE : FALSE_VALUE);
    } catch {
        // The in-memory state in AuthProvider still applies for this session.
    }
}
