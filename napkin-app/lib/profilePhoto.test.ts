jest.mock('@/lib/avatarPicker', () => ({
    chooseAvatarAsset: jest.fn(),
}));
jest.mock('@/lib/imageStaging', () => ({
    stageAndModerate: jest.fn(),
}));

import { chooseAvatarAsset } from '@/lib/avatarPicker';
import { stageAndModerate } from '@/lib/imageStaging';
import {
    chooseAndSaveNewProfilePhoto,
    shouldBlockProfilePhotoPicker,
} from './profilePhoto';

const mockChooseAvatarAsset = chooseAvatarAsset as jest.MockedFunction<
    typeof chooseAvatarAsset
>;
const mockStageAndModerate = stageAndModerate as jest.MockedFunction<typeof stageAndModerate>;

describe('chooseAndSaveNewProfilePhoto', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    it('treats picker cancellation as a no-op', async () => {
        mockChooseAvatarAsset.mockResolvedValue(null);
        const saveAvatarUrl = jest.fn();

        await expect(
            chooseAndSaveNewProfilePhoto({
                onSourceChosen: jest.fn(),
                saveAvatarUrl,
            }),
        ).resolves.toBe(false);

        expect(mockStageAndModerate).not.toHaveBeenCalled();
        expect(saveAvatarUrl).not.toHaveBeenCalled();
    });

    it('moderates and commits the approved replacement URL', async () => {
        mockChooseAvatarAsset.mockResolvedValue({ uri: 'file:///photo.jpg' } as never);
        mockStageAndModerate.mockResolvedValue({
            approved_url: 'https://cdn.example/avatar.jpg',
            storage_path: 'approved/user-1/sha.jpg',
            bucket: 'avatars',
            sha256: 'sha',
            verdict: 'pass',
        });
        const saveAvatarUrl = jest.fn().mockResolvedValue(undefined);

        await expect(
            chooseAndSaveNewProfilePhoto({
                onSourceChosen: jest.fn(),
                saveAvatarUrl,
            }),
        ).resolves.toBe(true);

        expect(mockStageAndModerate).toHaveBeenCalledWith('file:///photo.jpg', 'avatar');
        expect(saveAvatarUrl).toHaveBeenCalledWith('https://cdn.example/avatar.jpg');
    });

    it('leaves an unbound approved object to fenced TTL GC when commit fails', async () => {
        mockChooseAvatarAsset.mockResolvedValue({ uri: 'file:///photo.jpg' } as never);
        mockStageAndModerate.mockResolvedValue({
            approved_url: 'https://cdn.example/orphan.jpg',
            storage_path: 'approved/user-1/orphan.jpg',
            bucket: 'avatars',
            sha256: 'orphan',
            verdict: 'pass',
        });
        const saveError = new Error('save failed');

        await expect(
            chooseAndSaveNewProfilePhoto({
                onSourceChosen: jest.fn(),
                saveAvatarUrl: jest.fn().mockRejectedValue(saveError),
            }),
        ).rejects.toBe(saveError);
    });

    it('surfaces moderation rejection without calling the profile writer', async () => {
        mockChooseAvatarAsset.mockResolvedValue({ uri: 'file:///photo.jpg' } as never);
        const rejection = Object.assign(new Error('rejected'), {
            code: 'moderation_rejected' as const,
        });
        mockStageAndModerate.mockRejectedValue(rejection);
        const saveAvatarUrl = jest.fn();

        await expect(
            chooseAndSaveNewProfilePhoto({
                onSourceChosen: jest.fn(),
                saveAvatarUrl,
            }),
        ).rejects.toBe(rejection);
        expect(saveAvatarUrl).not.toHaveBeenCalled();
    });
});

describe('shouldBlockProfilePhotoPicker', () => {
    it('blocks only a definitive offline state', () => {
        expect(shouldBlockProfilePhotoPicker('offline')).toBe(true);
        expect(shouldBlockProfilePhotoPicker('checking')).toBe(false);
        expect(shouldBlockProfilePhotoPicker('online')).toBe(false);
    });
});
