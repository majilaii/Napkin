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

const TRUE_VALUE = '1';
const FALSE_VALUE = '0';

/** Read the durable flag. Never throws; unreadable storage reads as false. */
export async function readGuestMode(): Promise<boolean> {
    try {
        const raw = await AsyncStorage.getItem(GUEST_MODE_KEY);
        return raw === TRUE_VALUE;
    } catch {
        return false;
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
