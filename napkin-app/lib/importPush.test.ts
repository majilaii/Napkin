const mockStorage = new Map<string, string>();
const mockCall = jest.fn();
const mockPermission = jest.fn();
const mockPermissionPrompt = jest.fn();
const mockToken = jest.fn();
const mockRandom = jest.fn();
const mockInstallationId = jest.fn();
const mockDismiss = jest.fn();
let mockAppActive: ((state: string) => void) | undefined;
let mockTokenChanged: ((token: { type: 'ios'; data: string }) => void) | undefined;

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
}));
jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    AppState: { addEventListener: (_: string, fn: (state: string) => void) => { mockAppActive = fn; return { remove: jest.fn() }; } },
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project-id' } } } } }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: (...args: unknown[]) => mockRandom(...args) }));
jest.mock('expo-notifications', () => ({
    getPermissionsAsync: () => mockPermission(),
    requestPermissionsAsync: () => mockPermissionPrompt(),
    getExpoPushTokenAsync: (...args: unknown[]) => mockToken(...args),
    addPushTokenListener: (fn: typeof mockTokenChanged) => { mockTokenChanged = fn; return { remove: jest.fn() }; },
    getPresentedNotificationsAsync: async () => [
        { request: { identifier: 'import-notice', content: { data: { kind: 'import_ready' } } } },
        { request: { identifier: 'gather-reminder', content: { data: { url: '/gather/one' } } } },
    ],
    dismissNotificationAsync: (id: string) => mockDismiss(id),
}));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: (...args: unknown[]) => mockCall(...args) }));
jest.mock('@/lib/uuid', () => ({ safeRandomUUID: () => '11111111-2222-4333-8444-555555555555' }));
jest.mock('@/modules/media-extract', () => ({ getBackgroundImportInstallationId: () => mockInstallationId() }));

const KEY = 'napkin.importPush.installation.v1';
const stored = { id: 'install-1', secret: 'ab'.repeat(32), enabled: true, registeredOwner: 'alice' };
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function load(): typeof import('./importPush') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./importPush');
}

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockStorage.clear();
    mockAppActive = undefined;
    mockTokenChanged = undefined;
    mockPermission.mockResolvedValue({ granted: true, status: 'granted' });
    mockToken.mockResolvedValue({ data: 'ExpoPushToken[fixture_token]' });
    mockRandom.mockResolvedValue(new Uint8Array(32).fill(171));
    mockInstallationId.mockReturnValue(null);
    mockCall.mockResolvedValue({ ok: true });
});
afterEach(() => { jest.useRealTimers(); });

test('an upgrade with granted permission registers its native origin at launch without prompting', async () => {
    const nativeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    mockInstallationId.mockReturnValue(nativeId);
    const push = load();
    push.setImportPushOwner('alice');
    await settle();
    expect(mockCall).toHaveBeenCalledWith('notifications', expect.objectContaining({
        action: 'register_import_device',
        body: expect.objectContaining({ expected_owner_id: 'alice', installation_id: nativeId }),
    }));
    expect(JSON.parse(mockStorage.get(KEY)!)).toEqual(expect.objectContaining({ id: nativeId, registeredOwner: 'alice' }));
    expect(mockPermissionPrompt).not.toHaveBeenCalled();
});

test.each(['undetermined', 'denied'])('launch with %s permission neither registers nor prompts', async status => {
    mockPermission.mockResolvedValue({ granted: false, status });
    const push = load();
    push.setImportPushOwner('alice');
    await settle();
    expect(mockPermissionPrompt).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(0);
});

test('the granted import moment persists a cryptographic credential before authenticated registration', async () => {
    mockPermission.mockResolvedValue({ granted: false, status: 'undetermined' });
    const push = load();
    push.setImportPushOwner('alice');
    await settle();
    mockPermission.mockResolvedValue({ granted: true, status: 'granted' });
    await push.registerImportPushForImport();
    expect(mockRandom).toHaveBeenCalledWith(32);
    expect(mockToken).toHaveBeenCalledWith({ projectId: 'project-id' });
    expect(mockCall).toHaveBeenCalledWith('notifications', expect.objectContaining({
        action: 'register_import_device',
        body: expect.objectContaining({
            expected_owner_id: 'alice', installation_secret: 'ab'.repeat(32),
            installation_id: '11111111-2222-4333-8444-555555555555',
        }),
    }));
    expect(JSON.parse(mockStorage.get(KEY)!)).toEqual(expect.objectContaining({ registeredOwner: 'alice', enabled: true }));
});

test('native background imports and push registration use the same installation identity', async () => {
    const nativeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    mockInstallationId.mockReturnValue(nativeId);
    const push = load();
    push.setImportPushOwner('alice');
    await push.registerImportPushForImport();
    expect(mockCall).toHaveBeenCalledWith('notifications', expect.objectContaining({
        action: 'register_import_device', body: expect.objectContaining({ installation_id: nativeId }),
    }));
    expect(JSON.parse(mockStorage.get(KEY)!).id).toBe(nativeId);
});

test('denied permission neither acquires a token nor prompts the OS', async () => {
    mockPermission.mockResolvedValue({ granted: false, status: 'denied' });
    const push = load();
    push.setImportPushOwner('alice');
    await push.registerImportPushForImport();
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
});

test('an account switch while obtaining a token fences off the old account registration', async () => {
    let resolveToken: ((value: { data: string }) => void) | undefined;
    mockToken.mockReturnValueOnce(new Promise(resolve => { resolveToken = resolve; }));
    const push = load();
    push.setImportPushOwner('alice');
    const registration = push.registerImportPushForImport();
    await settle();
    push.setImportPushOwner('bob');
    resolveToken?.({ data: 'ExpoPushToken[fixture_token]' });
    await registration;
    await settle();
    expect(mockCall.mock.calls.every(([, opts]) => opts.body.expected_owner_id === 'bob')).toBe(true);
});

test('logout unlinks the registered owner and dismisses only import notifications', async () => {
    mockStorage.set(KEY, JSON.stringify(stored));
    const push = load();
    push.setImportPushOwner('alice');
    await settle();
    mockCall.mockClear();
    await push.unlinkImportPushDevice('alice');
    expect(mockCall).toHaveBeenCalledWith('notifications', expect.objectContaining({
        action: 'unregister_import_device', body: expect.objectContaining({ expected_owner_id: 'alice' }),
    }));
    expect(JSON.parse(mockStorage.get(KEY)!).registeredOwner).toBeNull();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockDismiss).toHaveBeenCalledWith('import-notice');
});

test('Settings permission revocation unlinks an opted-in device on foreground refresh', async () => {
    mockStorage.set(KEY, JSON.stringify(stored));
    const push = load();
    push.setImportPushOwner('alice');
    await settle();
    const cleanup = push.watchImportPushRegistration();
    mockPermission.mockResolvedValue({ granted: false, status: 'denied' });
    mockCall.mockClear();
    mockAppActive?.('active');
    await settle();
    expect(mockCall).toHaveBeenCalledWith('notifications', expect.objectContaining({ action: 'unregister_import_device' }));
    cleanup();
});

test('offline unlink preserves installation proof for subsequent account reassignment', async () => {
    mockStorage.set(KEY, JSON.stringify(stored));
    mockCall.mockRejectedValue(new Error('offline'));
    const push = load();
    await expect(push.unlinkImportPushDevice('alice')).resolves.toBeUndefined();
    expect(JSON.parse(mockStorage.get(KEY)!).secret).toBe(stored.secret);
    mockCall.mockResolvedValue({ ok: true });
    push.setImportPushOwner('bob');
    await settle();
    expect(mockCall).toHaveBeenLastCalledWith('notifications', expect.objectContaining({
        action: 'register_import_device', body: expect.objectContaining({ expected_owner_id: 'bob', installation_secret: stored.secret }),
    }));
});

test('token rotation forwards the native token so Expo cannot recursively trigger the listener', async () => {
    mockStorage.set(KEY, JSON.stringify(stored));
    const push = load();
    push.setImportPushOwner('alice');
    await settle();
    push.watchImportPushRegistration();
    mockToken.mockClear();
    const rotated = { type: 'ios' as const, data: 'native-rotated-token' };
    mockTokenChanged?.(rotated);
    await settle();
    expect(mockToken).toHaveBeenCalledWith({ projectId: 'project-id', devicePushToken: rotated });
    mockTokenChanged?.(rotated);
    await settle();
    expect(mockToken).toHaveBeenCalledTimes(1);
});

test('logout cancels a hanging Expo-token lookup and its late answer cannot register the old account', async () => {
    jest.useFakeTimers();
    let resolveToken: ((value: { data: string }) => void) | undefined;
    mockToken.mockReturnValueOnce(new Promise(resolve => { resolveToken = resolve; }));
    const push = load();
    push.setImportPushOwner('alice');
    const registration = push.registerImportPushForImport();
    await settle();
    expect(mockToken).toHaveBeenCalledTimes(1);
    await push.unlinkImportPushDevice('alice');
    await registration;
    resolveToken?.({ data: 'ExpoPushToken[too_late]' });
    await settle();
    expect(mockCall).not.toHaveBeenCalled();
    expect(JSON.parse(mockStorage.get(KEY)!).registeredOwner).toBeNull();
});

test('a hanging token lookup expires so it cannot monopolize the registration queue', async () => {
    jest.useFakeTimers();
    mockToken.mockReturnValueOnce(new Promise(() => undefined));
    const push = load();
    push.setImportPushOwner('alice');
    const registration = push.registerImportPushForImport();
    await settle();
    await jest.advanceTimersByTimeAsync(push.IMPORT_PUSH_TIMEOUT_MS);
    await registration;
    push.setImportPushOwner('bob');
    await settle();
    expect(mockCall).toHaveBeenCalledWith('notifications', expect.objectContaining({
        body: expect.objectContaining({ expected_owner_id: 'bob' }),
    }));
});

test('logout bounds hanging registration and revocation requests, keeps proof, and ignores both late responses', async () => {
    jest.useFakeTimers();
    let resolveRegistration: ((value: unknown) => void) | undefined;
    let resolveRevocation: ((value: unknown) => void) | undefined;
    mockCall
        .mockReturnValueOnce(new Promise(resolve => { resolveRegistration = resolve; }))
        .mockReturnValueOnce(new Promise(resolve => { resolveRevocation = resolve; }));
    const push = load();
    push.setImportPushOwner('alice');
    const registration = push.registerImportPushForImport();
    await settle();
    expect(mockCall.mock.calls[0][1].body.registration_revision).toBe(1);
    const unlink = push.unlinkImportPushDevice('alice');
    await settle();
    expect(mockCall.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mockCall.mock.calls[1][1].body.registration_revision).toBe(2);
    await jest.advanceTimersByTimeAsync(push.IMPORT_PUSH_TIMEOUT_MS);
    await unlink;
    await registration;
    const unresolved = JSON.parse(mockStorage.get(KEY)!);
    expect(unresolved.pendingOwner).toBe('alice');
    expect(unresolved.secret).toBe('ab'.repeat(32));
    expect(mockCall.mock.calls[1][1].signal.aborted).toBe(true);

    push.setImportPushOwner('bob');
    await settle();
    expect(mockCall.mock.calls[2][1].body.registration_revision).toBe(3);
    resolveRegistration?.({ ok: true });
    resolveRevocation?.({ ok: true });
    await settle();
    const current = JSON.parse(mockStorage.get(KEY)!);
    expect(current.registeredOwner).toBe('bob');
    expect(current.pendingOwner).toBeNull();
    expect(current.revision).toBe(3);
});
