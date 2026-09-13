import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[a-f0-9]{64}$/;
export const EXPO_PUSH_TOKEN = /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

/** Only call after getUser has authenticated this exact JWT. Its signed owner and
 * session claims must be passed together; the session FK refuses revoked sessions. */
export function verifiedTokenSessionId(token: string): string | null {
    try {
        const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const { session_id } = JSON.parse(atob(encoded));
        return typeof session_id === 'string' && UUID.test(session_id) ? session_id : null;
    } catch { return null; }
}

export async function handleImportPushDevice(
    supabase: SupabaseClient,
    userId: string,
    sessionId: string | null,
    body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
    const reject = (status: number, code: string, message: string) => ({
        status, payload: { error: { code, message } },
    });
    if (body.expected_owner_id !== userId) {
        return reject(403, 'EXPECTED_OWNER_MISMATCH', 'Import notifications belong to a different account');
    }
    const id = body.installation_id;
    const secret = body.installation_secret;
    const revision = body.registration_revision;
    if (typeof id !== 'string' || !UUID.test(id) || typeof secret !== 'string' || !SECRET.test(secret)) {
        return reject(400, 'INVALID_INPUT', 'A valid installation credential is required');
    }
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
        return reject(400, 'INVALID_INPUT', 'A valid registration revision is required');
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    const secretHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    if (body.action === 'unregister_import_device') {
        const { data, error } = await supabase.rpc('fn_revoke_import_push_device', {
            p_installation_id: id, p_user_id: userId, p_secret_hash: secretHash,
            p_registration_revision: revision,
        });
        if (error) return reject(503, 'PUSH_REGISTRATION_UNAVAILABLE', 'Could not unlink import notifications');
        if (data !== true) return reject(409, 'STALE_REGISTRATION', 'Import notification registration has changed');
        return { status: 200, payload: { data: { ok: true } } };
    }
    const pushToken = body.expo_push_token;
    if (!sessionId || typeof pushToken !== 'string' || !EXPO_PUSH_TOKEN.test(pushToken)) {
        return reject(400, 'INVALID_INPUT', 'A valid session and Expo push token are required');
    }
    const { data, error } = await supabase.rpc('fn_register_import_push_device', {
        p_installation_id: id, p_secret_hash: secretHash, p_user_id: userId,
        p_session_id: sessionId, p_expo_push_token: pushToken,
        p_registration_revision: revision,
    });
    if (error) return reject(503, 'PUSH_REGISTRATION_UNAVAILABLE', 'Could not register import notifications');
    if (data !== true) return reject(403, 'INVALID_INSTALLATION', 'The installation or session could not be verified');
    return { status: 200, payload: { data: { ok: true } } };
}
