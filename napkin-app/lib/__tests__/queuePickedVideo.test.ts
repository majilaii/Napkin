import { queuePickedVideo } from '../queuePickedVideo';

const mockCopy = jest.fn();
const mockInfo = jest.fn();
const mockDelete = jest.fn();
const mockEnqueue = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///Documents/Napkin%20App/',
    makeDirectoryAsync: jest.fn(async () => {}),
    copyAsync: (...args: unknown[]) => mockCopy(...args),
    getInfoAsync: (...args: unknown[]) => mockInfo(...args),
    deleteAsync: (...args: unknown[]) => mockDelete(...args),
}));
jest.mock('../importQueue', () => ({ enqueueVideoImport: (...args: unknown[]) => mockEnqueue(...args) }));
jest.mock('../uuid', () => ({ safeRandomUUID: () => 'owned-video' }));

const source = 'file:///Caches/Photos/video.mp4';
const owned = 'file:///Documents/Napkin%20App/video-imports/owned-video.mp4';
let activeOwner: string;
let captureActive: boolean;
const capture = () => queuePickedVideo(source, 'owner-a', () => activeOwner, () => captureActive);

beforeEach(() => {
    activeOwner = 'owner-a';
    captureActive = true;
    mockCopy.mockReset().mockResolvedValue(undefined);
    mockInfo.mockReset().mockResolvedValue({ exists: true, isDirectory: false, size: 400 });
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockEnqueue.mockReset().mockImplementation(async (videoPath: string, owner: string, beforeCommit: () => void) => {
        beforeCommit();
        return { jobId: 'job-1', videoPath, userId: owner, mode: 'review' };
    });
});

it('owns and verifies a durable copy, then queues an absolute path for owner-bound review', async () => {
    const result = await capture();
    expect(mockCopy).toHaveBeenCalledWith({ from: source, to: owned });
    expect(mockInfo).toHaveBeenCalledWith(owned);
    expect(result).toMatchObject({ videoPath: '/Documents/Napkin App/video-imports/owned-video.mp4', userId: 'owner-a', mode: 'review' });
    expect(mockDelete).not.toHaveBeenCalled(); // root queue now owns this copy
});

it.each(['copy', 'empty', 'manifest'])('cleans only its own copy on %s failure and never reports a queued import', async (failure) => {
    if (failure === 'copy') mockCopy.mockRejectedValue(new Error('copy failed'));
    if (failure === 'empty') mockInfo.mockResolvedValue({ exists: true, isDirectory: false, size: 0 });
    if (failure === 'manifest') mockEnqueue.mockRejectedValue(new Error('native write failed'));
    await expect(capture()).rejects.toThrow();
    expect(mockDelete).toHaveBeenCalledWith(owned, { idempotent: true });
    expect(mockDelete).not.toHaveBeenCalledWith(source, expect.anything());
    if (failure !== 'manifest') expect(mockEnqueue).not.toHaveBeenCalled();
});

it.each(['cancel', 'account switch'])('refuses a copy completed after %s and removes the abandoned owned file', async (reason) => {
    let finish!: () => void;
    mockCopy.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const result = capture();
    await Promise.resolve();
    expect(mockCopy).toHaveBeenCalledTimes(1);
    if (reason === 'cancel') captureActive = false;
    else activeOwner = 'owner-b';
    finish();
    await expect(result).rejects.toThrow();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(owned, { idempotent: true });
});

it('rechecks ownership inside the serialized enqueue commit', async () => {
    mockEnqueue.mockImplementation(async (_path: string, _owner: string, beforeCommit: () => void) => {
        activeOwner = 'owner-b';
        beforeCommit();
        throw new Error('must never reach the native write');
    });
    await expect(capture()).rejects.toThrow('signed-in account changed');
    expect(mockDelete).toHaveBeenCalledWith(owned, { idempotent: true });
});
