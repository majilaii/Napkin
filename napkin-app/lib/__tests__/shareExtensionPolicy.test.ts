/**
 * The native share extension is not part of the Jest/Expo bundle, so CI would
 * otherwise have no guard for its product contract. Keep this deliberately
 * small: Swift compilation is checked separately; this pins the review-first
 * manifest and the absence of the removed destination controls.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
    resolve(__dirname, '../../targets/share/ShareViewController.swift'),
    'utf8',
);

describe('native share extension policy', () => {
    it('always queues a review-mode import', () => {
        expect(source).toContain('"mode": "review"');
        expect(source).not.toContain('autoSaveOn');
        expect(source).not.toContain('UISwitch()');
    });

    it('leaves list and table organisation to the app', () => {
        expect(source).toContain('"listIds": []');
        expect(source).toContain('"newListTitles": []');
        expect(source).toContain('"tableIds": []');
        expect(source).toContain('"tableId": NSNull()');
        expect(source).not.toContain('buildAllPicker');
        expect(source).not.toContain('promptNewList');
    });

    it('explains the confirmation gate before the action', () => {
        expect(source).toContain('review before saving');
        expect(source).toContain('Nothing is saved until you review the import in Napkin.');
        expect(source).toContain('add for review');
    });

    it('keeps only the card surface over the source app', () => {
        expect(source).toContain('view.backgroundColor = .clear');
        expect(source).toContain('view.isOpaque = false');
        expect(source).not.toContain('view.backgroundColor = UIColor.black');
    });
});
