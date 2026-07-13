jest.mock('@/lib/avatarPicker', () => ({
    chooseAvatarAsset: jest.fn(),
}));
jest.mock('@/lib/imageUpload', () => ({
    compressAndUploadAvatar: jest.fn(),
    removeUploadedAvatar: jest.fn(),
}));

import { chooseAvatarAsset } from '@/lib/avatarPicker';
import { compressAndUploadAvatar, removeUploadedAvatar } from '@/lib/imageUpload';
import {
    chooseAndSaveNewProfilePhoto,
    shouldBlockProfilePhotoPicker,
} from './profilePhoto';

const mockChooseAvatarAsset = chooseAvatarAsset as jest.MockedFunction<
    typeof chooseAvatarAsset
>;
const mockCompressAndUploadAvatar = compressAndUploadAvatar as jest.MockedFunction<
    typeof compressAndUploadAvatar
>;
const mockRemoveUploadedAvatar = removeUploadedAvatar as jest.MockedFunction<
    typeof removeUploadedAvatar
>;

describe('chooseAndSaveNewProfilePhoto', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('treats picker cancellation as a no-op', async () => {
        mockChooseAvatarAsset.mockResolvedValue(null);
        const saveAvatarUrl = jest.fn();

        await expect(
            chooseAndSaveNewProfilePhoto({
                userId: 'user-1',
                onSourceChosen: jest.fn(),
                saveAvatarUrl,
            }),
        ).resolves.toBe(false);

        expect(mockCompressAndUploadAvatar).not.toHaveBeenCalled();
        expect(saveAvatarUrl).not.toHaveBeenCalled();
    });

    it('uploads and saves the selected avatar', async () => {
        mockChooseAvatarAsset.mockResolvedValue({ uri: 'file:///photo.jpg' } as never);
        mockCompressAndUploadAvatar.mockResolvedValue('https://cdn.example/avatar.jpg');
        const saveAvatarUrl = jest.fn().mockResolvedValue(undefined);

        await expect(
            chooseAndSaveNewProfilePhoto({
                userId: 'user-1',
                onSourceChosen: jest.fn(),
                saveAvatarUrl,
            }),
        ).resolves.toBe(true);

        expect(mockCompressAndUploadAvatar).toHaveBeenCalledWith(
            'file:///photo.jpg',
            'user-1',
        );
        expect(saveAvatarUrl).toHaveBeenCalledWith('https://cdn.example/avatar.jpg');
        expect(mockRemoveUploadedAvatar).not.toHaveBeenCalled();
    });

    it('removes a fresh upload when the profile save fails', async () => {
        mockChooseAvatarAsset.mockResolvedValue({ uri: 'file:///photo.jpg' } as never);
        mockCompressAndUploadAvatar.mockResolvedValue('https://cdn.example/orphan.jpg');
        mockRemoveUploadedAvatar.mockResolvedValue(undefined);
        const saveError = new Error('save failed');

        await expect(
            chooseAndSaveNewProfilePhoto({
                userId: 'user-1',
                onSourceChosen: jest.fn(),
                saveAvatarUrl: jest.fn().mockRejectedValue(saveError),
            }),
        ).rejects.toBe(saveError);

        expect(mockRemoveUploadedAvatar).toHaveBeenCalledWith(
            'https://cdn.example/orphan.jpg',
        );
    });

    it('waits for orphan cleanup before completing the failed save', async () => {
        mockChooseAvatarAsset.mockResolvedValue({ uri: 'file:///photo.jpg' } as never);
        mockCompressAndUploadAvatar.mockResolvedValue('https://cdn.example/orphan.jpg');
        let finishCleanup!: () => void;
        mockRemoveUploadedAvatar.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishCleanup = resolve;
                }),
        );
        const saveError = new Error('save failed');
        let settled = false;
        const result = chooseAndSaveNewProfilePhoto({
            userId: 'user-1',
            onSourceChosen: jest.fn(),
            saveAvatarUrl: jest.fn().mockRejectedValue(saveError),
        }).then(
            () => {
                settled = true;
                return null;
            },
            (error: unknown) => {
                settled = true;
                return error;
            },
        );

        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        expect(mockRemoveUploadedAvatar).toHaveBeenCalledWith(
            'https://cdn.example/orphan.jpg',
        );
        expect(settled).toBe(false);

        finishCleanup();
        await expect(result).resolves.toBe(saveError);
    });
});

describe('shouldBlockProfilePhotoPicker', () => {
    it('blocks only a definitive offline state', () => {
        expect(shouldBlockProfilePhotoPicker('offline')).toBe(true);
        expect(shouldBlockProfilePhotoPicker('checking')).toBe(false);
        expect(shouldBlockProfilePhotoPicker('online')).toBe(false);
    });
});
