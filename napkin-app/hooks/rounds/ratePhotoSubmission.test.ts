import { submitRateWithSettledPhotos } from './ratePhotoSubmission';

describe('submitRateWithSettledPhotos', () => {
    it('does not invoke rate_round or clear selected slots while a photo is staging or moderating', async () => {
        const submit = jest.fn(async (_photoUrls: string[]) => undefined);
        const onCommitted = jest.fn();

        await expect(submitRateWithSettledPhotos({
            getPhotos: () => [
                {
                    publicUrl: 'https://project.test/entry-photos/approved/u/ready.jpg',
                    uploading: false,
                },
                { publicUrl: null, uploading: true },
            ],
            submit,
            onCommitted,
        })).resolves.toBe(false);

        expect(submit).not.toHaveBeenCalled();
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('submits every settled approved photo and clears slots only after commit', async () => {
        const order: string[] = [];
        const submit = jest.fn(async (_photoUrls: string[]) => {
            order.push('submit');
        });
        const onCommitted = jest.fn(() => {
            order.push('clear');
        });

        await expect(submitRateWithSettledPhotos({
            getPhotos: () => [
                {
                    publicUrl: 'https://project.test/entry-photos/approved/u/one.jpg',
                    uploading: false,
                },
                { publicUrl: null, uploading: false },
                {
                    publicUrl: 'https://project.test/entry-photos/approved/u/two.jpg',
                    uploading: false,
                },
            ],
            submit,
            onCommitted,
        })).resolves.toBe(true);

        expect(submit).toHaveBeenCalledWith([
            'https://project.test/entry-photos/approved/u/one.jpg',
            'https://project.test/entry-photos/approved/u/two.jpg',
        ]);
        expect(order).toEqual(['submit', 'clear']);
    });

    it('preserves selected slots when rate_round fails', async () => {
        const submit = jest.fn(async (_photoUrls: string[]) => {
            throw new Error('rate_round failed');
        });
        const onCommitted = jest.fn();

        await expect(submitRateWithSettledPhotos({
            getPhotos: () => [{ publicUrl: null, uploading: false }],
            submit,
            onCommitted,
        })).rejects.toThrow('rate_round failed');

        expect(onCommitted).not.toHaveBeenCalled();
    });
});
