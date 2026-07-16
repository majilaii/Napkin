import {
    ImportOwnerChangedError,
    requireActiveImportOwner,
    runWithActiveImportOwner,
} from '../importOwnerGuard';

describe('durable import owner fence', () => {
    it('accepts only the account bound to the manifest', () => {
        expect(requireActiveImportOwner('owner-a', 'owner-a')).toBe('owner-a');
        expect(() => requireActiveImportOwner('owner-a', 'owner-b')).toThrow(
            ImportOwnerChangedError,
        );
        expect(() => requireActiveImportOwner(null, 'owner-a')).toThrow(
            ImportOwnerChangedError,
        );
    });

    it('does not start an owner-bound call after an account switch', async () => {
        const operation = jest.fn(async () => 'unreachable');

        await expect(
            runWithActiveImportOwner('owner-a', () => 'owner-b', operation),
        ).rejects.toBeInstanceOf(ImportOwnerChangedError);
        expect(operation).not.toHaveBeenCalled();
    });

    it('rejects an old-account response before local manifest mutation', async () => {
        let activeOwner = 'owner-a';
        const operation = jest.fn(async (expectedOwnerId: string) => {
            expect(expectedOwnerId).toBe('owner-a');
            activeOwner = 'owner-b';
            return 'old-owner-result';
        });

        await expect(
            runWithActiveImportOwner('owner-a', () => activeOwner, operation),
        ).rejects.toBeInstanceOf(ImportOwnerChangedError);
        expect(operation).toHaveBeenCalledTimes(1);
    });
});
