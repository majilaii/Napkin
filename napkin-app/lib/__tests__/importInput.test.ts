import { classifyImportInput } from '../importInput';

describe('classifyImportInput', () => {
    it('treats a bare link as a link', () => {
        expect(classifyImportInput('  https://vm.tiktok.com/ZMabc123/ \n')).toEqual({
            kind: 'url',
            url: 'https://vm.tiktok.com/ZMabc123/',
        });
    });

    it('treats a share-sheet label plus one link as that link', () => {
        expect(classifyImportInput('Dishoom Covent Garden\nhttps://maps.app.goo.gl/AbC123')).toEqual({
            kind: 'url',
            url: 'https://maps.app.goo.gl/AbC123',
        });
    });

    it('treats a pasted list of names as text', () => {
        const list = 'ok here are my faves in london:\n1. Bao Soho\n2. Kiln\n3. Brat\n4. Barrafina, dean st\nskip Sketch honestly';
        expect(classifyImportInput(list)).toEqual({ kind: 'text', text: list });
    });

    it('treats a long message that happens to carry one link as text', () => {
        const message = `${'We went to Lyle\'s, St John, Rochelle Canteen and then Quality Wines for a nightcap. '.repeat(2)}https://example.com/x`;
        expect(classifyImportInput(message).kind).toBe('text');
    });

    it('treats a message with several links as text', () => {
        expect(classifyImportInput('https://a.com/x and https://b.com/y').kind).toBe('text');
    });

    it('ignores empty and near-empty input', () => {
        expect(classifyImportInput('   ')).toEqual({ kind: 'empty' });
        expect(classifyImportInput('ab')).toEqual({ kind: 'empty' });
    });
});
