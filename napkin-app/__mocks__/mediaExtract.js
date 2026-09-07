/**
 * Jest stand-in for @/modules/media-extract: the real module imports the
 * native 'expo' package at top level (__DEV__-dependent), which the jest env
 * cannot evaluate. Mirrors the public surface with inert defaults.
 */
module.exports = {
    isVideoImportAvailable: () => false,
    isBackgroundVideoCaptureAvailable: () => false,
    pickVideoForImport: async () => { throw new Error('native module unavailable in jest'); },
    onVideoImportPrepared: () => () => {},
    extractFromVideo: async () => { throw new Error('native module unavailable in jest'); },
    extractFromImages: async () => { throw new Error('native module unavailable in jest'); },
    listImportManifests: () => [],
    writeImportManifest: () => false,
    removeImportManifest: () => false,
    appGroupFileInfo: () => ({ exists: false, size: 0 }),
    deleteAppGroupFile: () => false,
    writeAppGroupSnapshot: () => false,
};
