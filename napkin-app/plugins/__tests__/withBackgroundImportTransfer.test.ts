import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { syncBackgroundImportTransfer } from '../withBackgroundImportTransfer';

test('prebuild copies the canonical native source and refreshes an older generated copy', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napkin-import-source-'));
    try {
        const source = path.join(root, 'modules/media-extract/ios/BackgroundImportTransfer.swift');
        const target = path.join(root, 'targets/share/BackgroundImportTransfer.generated.swift');
        await fs.mkdir(path.dirname(source), { recursive: true });
        await fs.writeFile(source, 'native source one');
        await syncBackgroundImportTransfer(root);
        expect(await fs.readFile(target, 'utf8')).toBe('native source one');
        await fs.writeFile(source, 'native source two');
        await syncBackgroundImportTransfer(root);
        expect(await fs.readFile(target, 'utf8')).toBe('native source two');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
