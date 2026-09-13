const mockRegister = jest.fn();
const mockAvailable = jest.fn(() => true);
const mockGetCredential = jest.fn();
const mockSetOwner = jest.fn();
const mockWriteCredential = jest.fn();
const mockClearCredential = jest.fn();
const mockGetRevocations = jest.fn(() => [] as unknown[]);
const mockRevoke = jest.fn();
const installationId = '33333333-3333-4333-8333-333333333333';
const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: (...args: unknown[]) => mockRegister(...args) }));
jest.mock('@/modules/media-extract', () => ({
    isBackgroundImportIntakeAvailable: () => mockAvailable(),
    getBackgroundImportInstallationId: () => '33333333-3333-4333-8333-333333333333',
    getBackgroundImportCredential: () => mockGetCredential(),
    setNativeBackgroundImportOwner: (...args: unknown[]) => mockSetOwner(...args),
    writeBackgroundImportCredential: (...args: unknown[]) => mockWriteCredential(...args),
    clearBackgroundImportCredential: () => mockClearCredential(),
    getPendingBackgroundImportRevocations: () => mockGetRevocations(),
    revokeBackgroundImportCredential: (...args: unknown[]) => mockRevoke(...args),
}));

function load() { return jest.requireActual('../backgroundImportIntake') as typeof import('../backgroundImportIntake'); }
function credential(userId = ownerA) {
    return { credentialId: '44444444-4444-4444-8444-444444444444', token: `nbi_${'a'.repeat(64)}`, userId, installationId,
        endpoint: 'https://example.supabase.co/functions/v1/background-imports', anonKey: 'public-anon-key',
        expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000 };
}
function response() { const c = credential(); return { credential_id: c.credentialId, token: c.token, expires_at: new Date(c.expiresAt).toISOString() }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAvailable.mockReturnValue(true);
    mockGetCredential.mockReturnValue(null);
    mockGetRevocations.mockReturnValue([]);
    mockWriteCredential.mockReturnValue(true);
    mockRevoke.mockResolvedValue(true);
    mockRegister.mockResolvedValue(response());
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'public-anon-key';
});

afterAll(() => {
    if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
});

test('older native builds do not register a credential they cannot use', async () => {
    mockAvailable.mockReturnValue(false);
    const api = load(); api.setBackgroundImportOwner(ownerA);
    await api.ensureBackgroundImportIntake(ownerA);
    expect(mockRegister).not.toHaveBeenCalled();
});

test('healthy same-owner credentials stay stable for pending native uploads', async () => {
    mockGetCredential.mockReturnValue(credential());
    const api = load(); api.setBackgroundImportOwner(ownerA);
    await api.ensureBackgroundImportIntake(ownerA);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockWriteCredential).not.toHaveBeenCalled();
});

test('concurrent refreshes mint once and expose only the scoped credential', async () => {
    const pending = deferred<ReturnType<typeof response>>(); mockRegister.mockReturnValue(pending.promise);
    const api = load(); api.setBackgroundImportOwner(ownerA);
    const first = api.ensureBackgroundImportIntake(ownerA);
    const second = api.ensureBackgroundImportIntake(ownerA);
    expect(first).toBe(second);
    pending.resolve(response()); await first;
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith('background-imports', expect.objectContaining({
        action: 'register_intake', body: { installation_id: installationId, expected_owner_id: ownerA },
    }));
    expect(mockWriteCredential).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerA, installationId, token: `nbi_${'a'.repeat(64)}` }));
});

test('a reply after an account switch is revoked without becoming active', async () => {
    const pending = deferred<ReturnType<typeof response>>(); mockRegister.mockReturnValue(pending.promise);
    const api = load(); api.setBackgroundImportOwner(ownerA);
    const first = api.ensureBackgroundImportIntake(ownerA);
    api.setBackgroundImportOwner(ownerB);
    pending.resolve(response()); await first;
    expect(mockWriteCredential).not.toHaveBeenCalled();
    expect(mockRevoke).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerA }));
    expect(mockSetOwner).toHaveBeenLastCalledWith(ownerB);
});

test('late old-account logout cannot clear the new account credential', async () => {
    const api = load(); api.setBackgroundImportOwner(ownerB);
    await api.unlinkBackgroundImportIntake(ownerA);
    expect(mockClearCredential).not.toHaveBeenCalled();
    expect(mockSetOwner).toHaveBeenLastCalledWith(ownerB);
});

test('logout clears active access before awaiting a slow revocation', async () => {
    const pending = deferred<boolean>(); mockGetRevocations.mockReturnValue([credential()]); mockRevoke.mockReturnValue(pending.promise);
    mockGetCredential.mockReturnValue(credential());
    const api = load(); api.setBackgroundImportOwner(ownerA);
    const logout = api.unlinkBackgroundImportIntake(ownerA);
    expect(mockSetOwner).toHaveBeenLastCalledWith(null);
    expect(mockClearCredential).toHaveBeenCalled();
    pending.resolve(false); await logout;
    await api.flushBackgroundImportRevocations();
    expect(mockRevoke).toHaveBeenCalledTimes(2);
});

test('failed keychain publication revokes the otherwise orphaned server token', async () => {
    mockWriteCredential.mockReturnValue(false);
    const api = load(); api.setBackgroundImportOwner(ownerA);
    await api.ensureBackgroundImportIntake(ownerA);
    expect(mockRevoke).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerA }));
});
