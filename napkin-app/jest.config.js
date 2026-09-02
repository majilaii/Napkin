/** @type {import('jest').Config} */
module.exports = {
    // Use babel-jest for all JS/TS files
    testEnvironment: 'node',

    // Transform TypeScript files using babel
    transform: {
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
    },

    // IMPORTANT: Transform these node_modules that use ESM
    // supercluster + kdbush (TICKET-153) are ESM-only (`type: module`), so the
    // CJS jest runner must transpile them via babel-jest (Metro handles them
    // natively in the app bundle — this allowlist is jest-only).
    transformIgnorePatterns: [
        'node_modules/(?!(@testing-library|@supabase|@tanstack|react-native|@react-native|expo|@expo|react-native-safe-area-context|react-native-reanimated|react-native-gesture-handler|react-native-screens|supercluster|kdbush)/)',
    ],

    // Module resolution
    moduleNameMapper: {
        // The real media-extract imports the native 'expo' package at module
        // top level, which the jest environment cannot evaluate (__DEV__).
        '^@/modules/media-extract$': '<rootDir>/__mocks__/mediaExtract.js',
        '^@/(.*)$': '<rootDir>/$1',
    },

    // Test files can be in __tests__ folders or have .test.ts extension
    testMatch: [
        '**/__tests__/**/*.test.ts?(x)',
        '**/*.test.ts?(x)',
    ],

    // Setup
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

    // Coverage
    collectCoverageFrom: [
        'hooks/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        '!**/__tests__/**',
        '!**/node_modules/**',
    ],

    // Performance
    clearMocks: true,
    maxWorkers: '50%',

    // Extensions
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
