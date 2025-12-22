/** @type {import('jest').Config} */
module.exports = {
    // Use babel-jest for all JS/TS files
    testEnvironment: 'node',

    // Transform TypeScript files using babel
    transform: {
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
    },

    // IMPORTANT: Transform these node_modules that use ESM
    transformIgnorePatterns: [
        'node_modules/(?!(@testing-library|@supabase|@tanstack)/)',
    ],

    // Module resolution
    moduleNameMapper: {
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
