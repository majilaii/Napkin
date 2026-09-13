import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { safeRandomUUID } from '@/lib/uuid';
import { getBackgroundImportInstallationId } from '@/modules/media-extract';

const KEY = 'napkin.importPush.installation.v1';
export const IMPORT_PUSH_TIMEOUT_MS = 4_000;
type Installation = {
    id: string; secret: string; enabled: boolean; registeredOwner: string | null;
    pendingOwner?: string | null; revision?: number;
};
type Operation = { signal: AbortSignal; check: () => void };
let owner: string | null = null;
let generation = 0;
let work: Promise<unknown> = Promise.resolve();
let activeOperation: AbortController | null = null;

function notifications(): typeof import('expo-notifications') | null {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('expo-notifications');
    } catch { return null; }
}

function serialize<T>(task: (operation: Operation) => Promise<T>): Promise<T> {
    const run = async () => {
        const controller = new AbortController();
        activeOperation = controller;
        const timeout = setTimeout(() => controller.abort(), IMPORT_PUSH_TIMEOUT_MS);
        const check = () => { if (controller.signal.aborted) throw new Error('IMPORT_PUSH_CANCELLED'); };
        const cancelled = new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error('IMPORT_PUSH_CANCELLED')), { once: true });
        });
        try {
            return await Promise.race([
                task({ signal: controller.signal, check }),
                cancelled,
            ]);
        } finally {
            clearTimeout(timeout);
            if (activeOperation === controller) activeOperation = null;
        }
    };
    const next = work.then(run, run);
    work = next.catch(() => undefined);
    return next;
}

async function readInstallation(): Promise<Installation | null> {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Installation;
    if (typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)) return null;
    return value;
}

async function newInstallation(operation: Operation): Promise<Installation> {
    // safeRandomUUID is only a locator. The ownership credential must use native
    // cryptographic randomness; never fall back to Math.random for this secret.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('expo-crypto') as typeof import('expo-crypto');
    const bytes = await crypto.getRandomBytesAsync(32);
    operation.check();
    // Match the share extension's origin so a completion opens a locally owned
    // import. Older native builds and other platforms have no shared identity.
    let nativeInstallationId: string | null = null;
    try { nativeInstallationId = getBackgroundImportInstallationId(); } catch { /* native unavailable */ }
    const installation: Installation = {
        id: nativeInstallationId ?? safeRandomUUID(),
        secret: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
        enabled: true, registeredOwner: null, pendingOwner: null, revision: 0,
    };
    // Persist before submitting, including when the response is lost.
    await AsyncStorage.setItem(KEY, JSON.stringify(installation));
    return installation;
}

async function reconcile(operation: Operation, expectedOwner: string, expectedGeneration: number, enable: boolean,
    devicePushToken?: import('expo-notifications').DevicePushToken): Promise<void> {
    if (owner !== expectedOwner || generation !== expectedGeneration) return;
    const N = notifications();
    if (!N) return;
    const permission = await N.getPermissionsAsync();
    operation.check();
    if (!permission.granted && permission.status !== 'granted') {
        // Permission changes made in Settings also unlink the remote destination.
        const existing = await readInstallation();
        operation.check();
        if ((existing?.registeredOwner === expectedOwner || existing?.pendingOwner === expectedOwner) && owner === expectedOwner && generation === expectedGeneration) {
            await unregister(operation, existing!, expectedOwner);
        }
        return;
    }
    let installation = await readInstallation();
    operation.check();
    // Existing users can already have import notification permission before
    // upgrading to remote push. Register now so their first closed-app share
    // can notify without requiring another foreground import.
    if (!installation) installation = await newInstallation(operation);
    operation.check();
    if (enable && !installation.enabled) {
        installation.enabled = true;
        await AsyncStorage.setItem(KEY, JSON.stringify(installation));
    }
    if (!installation.enabled || owner !== expectedOwner || generation !== expectedGeneration) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (typeof projectId !== 'string') return;
    // Token-listener refreshes must pass the provided native token. Asking for it
    // again triggers the listener again and can create a registration loop.
    const token = await N.getExpoPushTokenAsync({ projectId, ...(devicePushToken ? { devicePushToken } : {}) });
    operation.check();
    if (owner !== expectedOwner || generation !== expectedGeneration) return;
    installation.revision = (installation.revision ?? 0) + 1;
    installation.pendingOwner = expectedOwner;
    await AsyncStorage.setItem(KEY, JSON.stringify(installation));
    operation.check();
    await callEdgeFn('notifications', {
        action: 'register_import_device',
        signal: operation.signal,
        body: {
            expected_owner_id: expectedOwner, installation_id: installation.id,
            installation_secret: installation.secret, expo_push_token: token.data,
            registration_revision: installation.revision,
        },
    });
    operation.check();
    if (owner !== expectedOwner || generation !== expectedGeneration) return;
    installation.registeredOwner = expectedOwner;
    installation.pendingOwner = null;
    await AsyncStorage.setItem(KEY, JSON.stringify(installation));
}

async function unregister(operation: Operation, installation: Installation, expectedOwner: string): Promise<void> {
    installation.revision = (installation.revision ?? 0) + 1;
    installation.pendingOwner = expectedOwner;
    await AsyncStorage.setItem(KEY, JSON.stringify(installation));
    operation.check();
    await callEdgeFn('notifications', {
        action: 'unregister_import_device',
        signal: operation.signal,
        body: {
            expected_owner_id: expectedOwner, installation_id: installation.id,
            installation_secret: installation.secret,
            registration_revision: installation.revision,
        },
    });
    operation.check();
    installation.registeredOwner = null;
    installation.pendingOwner = null;
    await AsyncStorage.setItem(KEY, JSON.stringify(installation));
}

/** Synchronous identity fence. Launch registers or refreshes the import token
 * when OS permission is already granted; it never requests permission. */
export function setImportPushOwner(nextOwner: string | null | undefined): void {
    const next = nextOwner ?? null;
    if (owner === next) return;
    owner = next;
    generation++;
    activeOperation?.abort();
    if (next) {
        const expected = generation;
        void serialize(operation => reconcile(operation, next, expected, false)).catch(() => undefined);
    }
}

/** Called at the existing import permission moment, only after OS permission is
 * already granted. This function itself never opens a permission prompt. */
export async function registerImportPushForImport(): Promise<void> {
    const expectedOwner = owner, expected = generation;
    if (!expectedOwner) return;
    await serialize(operation => reconcile(operation, expectedOwner, expected, true)).catch(() => undefined);
}

/** Revoke before supabase.auth.signOut while its JWT still exists. Offline
 * failure leaves the credential persisted for account reconciliation; online
 * auth-session deletion also disables the server registration. */
export async function unlinkImportPushDevice(expectedOwner?: string | null): Promise<void> {
    owner = null;
    generation++;
    activeOperation?.abort();
    const expectedGeneration = generation;
    if (!expectedOwner) return;
    await serialize(async operation => {
        if (generation !== expectedGeneration) return;
        const installation = await readInstallation();
        operation.check();
        if (generation !== expectedGeneration) return;
        if (installation?.registeredOwner === expectedOwner || installation?.pendingOwner === expectedOwner) {
            await unregister(operation, installation, expectedOwner);
        }
    }).catch(() => undefined);
    // Dismissing old notices is cosmetic; never delay account signout for it.
    void (async () => { try {
        if (generation !== expectedGeneration) return;
        const N = notifications();
        const presented = await N?.getPresentedNotificationsAsync();
        if (generation !== expectedGeneration) return;
        await Promise.all((presented ?? []).filter(item => {
            const data = item.request.content.data;
            return data?.kind === 'import_ready' ||
                (typeof data?.url === 'string' && data.url.startsWith('/import-progress'));
        }).map(item => N?.dismissNotificationAsync(item.request.identifier)));
    } catch { /* best-effort */ } })();
}

export function watchImportPushRegistration(): () => void {
    let lastNativeToken: string | null = null;
    const refresh = (devicePushToken?: import('expo-notifications').DevicePushToken) => {
        if (devicePushToken) {
            const identity = JSON.stringify(devicePushToken);
            if (identity === lastNativeToken) return;
            lastNativeToken = identity;
        }
        const expectedOwner = owner, expected = generation;
        if (expectedOwner) void serialize(operation => reconcile(operation, expectedOwner, expected, false, devicePushToken)).catch(() => undefined);
    };
    const removers: (() => void)[] = [];
    try {
        const listener = notifications()?.addPushTokenListener(refresh);
        if (listener) removers.push(() => listener.remove());
    } catch { /* old dev client may not have remote push */ }
    try {
        const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
        removers.push(() => listener.remove());
    } catch { /* unavailable outside native */ }
    return () => removers.forEach(remove => remove());
}
