jest.mock('expo-image-manipulator', () => ({
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: jest.fn(),
}));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import * as ImageManipulator from 'expo-image-manipulator';
import { callEdgeFn } from '@/lib/edgeInvoke';
import {
    PhotoUploadError,
    stageAndModerate,
} from './imageStaging';

const mockManipulate = ImageManipulator.manipulateAsync as jest.MockedFunction<
    typeof ImageManipulator.manipulateAsync
>;
const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

const APPROVED = {
    approved_url: 'https://project.test/storage/v1/object/public/entry-photos/approved/u/sha.jpg',
    storage_path: 'approved/u/sha.jpg',
    bucket: 'entry-photos' as const,
    sha256: 'sha',
    verdict: 'pass' as const,
};

describe('stageAndModerate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockManipulate
            .mockResolvedValueOnce({ uri: 'file:///source.jpg', width: 1800, height: 1200 })
            .mockResolvedValueOnce({
                uri: 'file:///compressed.jpg',
                width: 1024,
                height: 683,
                base64: 'aGVsbG8=',
            });
        mockCallEdgeFn.mockImplementation(async (_name, options) => {
            const opts = options!;
            if (opts.action === 'begin_stage') {
                return { staging_path: 'image-staging/u/reservation', generation: 7 } as never;
            }
            if (opts.action === 'finish_stage') {
                return {
                    staging_path: 'image-staging/u/reservation',
                    generation: 8,
                    state: 'staged',
                } as never;
            }
            if (opts.action === 'moderate') return APPROVED as never;
            throw new Error(`unexpected action ${opts.action}`);
        });
    });

    it('uses the complete begin -> raw finish -> moderate saga', async () => {
        await expect(stageAndModerate('file:///source.jpg', 'entry_photo')).resolves.toEqual(
            APPROVED,
        );

        expect(mockCallEdgeFn).toHaveBeenNthCalledWith(1, 'moderate-image', {
            action: 'begin_stage',
            body: { kind: 'entry_photo' },
        });

        const finishOptions = mockCallEdgeFn.mock.calls[1][1]!;
        expect(finishOptions).toMatchObject({
            action: 'finish_stage',
            params: {
                staging_path: 'image-staging/u/reservation',
                generation: 7,
            },
            contentType: 'image/jpeg',
            signal: expect.anything(),
        });
        expect(finishOptions.rawBody).toBeInstanceOf(ArrayBuffer);
        expect((finishOptions.rawBody as ArrayBuffer).byteLength).toBe(5);

        expect(mockCallEdgeFn).toHaveBeenNthCalledWith(3, 'moderate-image', {
            action: 'moderate',
            body: {
                staging_path: 'image-staging/u/reservation',
                kind: 'entry_photo',
            },
        });
    });

    it('fails closed when the server does not mint a reservation', async () => {
        mockCallEdgeFn.mockResolvedValueOnce({ generation: 1 } as never);

        await expect(stageAndModerate('file:///source.jpg', 'entry_photo')).rejects.toMatchObject({
            code: 'upload_failed',
        });
        expect(mockCallEdgeFn).toHaveBeenCalledTimes(1);
    });

    it('does not moderate when finish_stage fails the consumed-generation fence', async () => {
        mockCallEdgeFn.mockImplementation(async (_name, options) => {
            const opts = options!;
            if (opts.action === 'begin_stage') {
                return { staging_path: 'image-staging/u/reservation', generation: 7 } as never;
            }
            if (opts.action === 'finish_stage') {
                return {
                    staging_path: 'image-staging/u/reservation',
                    generation: 7,
                    state: 'staged',
                } as never;
            }
            throw new Error('moderate must not run');
        });

        await expect(stageAndModerate('file:///source.jpg', 'entry_photo')).rejects.toMatchObject({
            code: 'upload_failed',
        });
        expect(mockCallEdgeFn).toHaveBeenCalledTimes(2);
    });

    it('surfaces a terminal SafeSearch rejection with a typed code', async () => {
        const rejected = new Error('rejected') as Error & { cause?: { code: string } };
        rejected.cause = { code: 'moderation_rejected' };
        mockCallEdgeFn.mockImplementation(async (_name, options) => {
            const opts = options!;
            if (opts.action === 'begin_stage') {
                return { staging_path: 'image-staging/u/reservation', generation: 7 } as never;
            }
            if (opts.action === 'finish_stage') {
                return {
                    staging_path: 'image-staging/u/reservation',
                    generation: 8,
                    state: 'staged',
                } as never;
            }
            throw rejected;
        });

        let caught: unknown;
        try {
            await stageAndModerate('file:///source.jpg', 'entry_photo');
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PhotoUploadError);
        expect(caught).toMatchObject({ code: 'moderation_rejected' });
    });

    it('preserves the avatar square-crop before staging', async () => {
        mockManipulate.mockReset();
        mockManipulate
            .mockResolvedValueOnce({ uri: 'file:///source.jpg', width: 1200, height: 1800 })
            .mockResolvedValueOnce({ uri: 'file:///resized.jpg', width: 512, height: 768 })
            .mockResolvedValueOnce({
                uri: 'file:///avatar.jpg',
                width: 512,
                height: 512,
                base64: 'aGVsbG8=',
            });
        mockCallEdgeFn.mockImplementation(async (_name, options) => {
            const opts = options!;
            if (opts.action === 'begin_stage') {
                return { staging_path: 'image-staging/u/avatar', generation: 1 } as never;
            }
            if (opts.action === 'finish_stage') {
                return {
                    staging_path: 'image-staging/u/avatar',
                    generation: 2,
                    state: 'staged',
                } as never;
            }
            return { ...APPROVED, bucket: 'avatars' } as never;
        });

        await stageAndModerate('file:///source.jpg', 'avatar');

        expect(mockManipulate).toHaveBeenNthCalledWith(
            3,
            'file:///resized.jpg',
            [{ crop: { originX: 0, originY: 128, width: 512, height: 512 } }],
            expect.objectContaining({ base64: true }),
        );
    });
});
