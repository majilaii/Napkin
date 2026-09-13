const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// One canonical extension-safe source is compiled by both native targets.
async function syncBackgroundImportTransfer(projectRoot) {
    const source = path.join(projectRoot, 'modules/media-extract/ios/BackgroundImportTransfer.swift');
    const target = path.join(projectRoot, 'targets/share/BackgroundImportTransfer.generated.swift');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
}

module.exports = (config) => withDangerousMod(config, ['ios', async (mod) => {
    await syncBackgroundImportTransfer(mod.modRequest.projectRoot);
    return mod;
}]);
module.exports.syncBackgroundImportTransfer = syncBackgroundImportTransfer;
