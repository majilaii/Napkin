jest.mock('@/lib/imageStaging', () => ({
    stageAndModerate: jest.fn(),
    PhotoUploadError: class PhotoUploadError extends Error {},
    isModerationRejected: jest.fn(),
}));
jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));

import { stageAndModerate } from '@/lib/imageStaging';
import { compressAndUpload, compressAndUploadAvatar } from './imageUpload';

const mockStage = stageAndModerate as jest.MockedFunction<typeof stageAndModerate>;

describe('legacy imageUpload entry points', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStage.mockResolvedValue({
            approved_url: 'https://cdn.test/approved.jpg',
            storage_path: 'approved/u/sha.jpg',
            bucket: 'entry-photos',
            sha256: 'sha',
            verdict: 'pass',
        });
    });

    it('routes meal-photo callers through moderated entry staging', async () => {
        await expect(compressAndUpload('file:///meal.jpg', 'untrusted-user-id')).resolves.toBe(
            'https://cdn.test/approved.jpg',
        );
        expect(mockStage).toHaveBeenCalledWith('file:///meal.jpg', 'entry_photo');
    });

    it('routes avatar callers through moderated avatar staging', async () => {
        mockStage.mockResolvedValueOnce({
            approved_url: 'https://cdn.test/avatar.jpg',
            storage_path: 'approved/u/avatar.jpg',
            bucket: 'avatars',
            sha256: 'avatar-sha',
            verdict: 'pass',
        });

        await expect(compressAndUploadAvatar('file:///face.jpg', 'untrusted-user-id')).resolves.toBe(
            'https://cdn.test/avatar.jpg',
        );
        expect(mockStage).toHaveBeenCalledWith('file:///face.jpg', 'avatar');
    });
});
