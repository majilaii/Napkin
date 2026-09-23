/**
 * TICKET-248 pin for patches/expo-file-system+19.0.22.patch.
 *
 * Expo calls UIKit's background-session completion handler only after every app
 * delegate subscriber finishes. Unpatched, expo-file-system retains the handler
 * for sessions it does not own (the share-wake session) and never calls it, so
 * iOS is never told Napkin finished handling the wake. If an Expo upgrade drops
 * or reshapes the patch, this fails before a build ships without it.
 */
import fs from 'node:fs';
import path from 'node:path';

test('expo-file-system releases background-session handlers it does not own', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../../../node_modules/expo-file-system/ios/Legacy/FileSystemBackgroundSessionHandler.swift'),
        'utf8',
    );
    const handler = source.slice(source.indexOf('handleEventsForBackgroundURLSession identifier'));
    expect(handler).toMatch(/guard UUID\(uuidString: identifier\) != nil else \{\s*completionHandler\(\)\s*return\s*\}/);
    // The share wake's identifier is never a bare UUID, so it is always released.
    const transfer = fs.readFileSync(path.join(__dirname, '../ios/BackgroundImportTransfer.swift'), 'utf8');
    expect(transfer).toContain('static let sessionPrefix = "com.majilaii.napkin.import-intake."');
});
