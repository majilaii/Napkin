// Jest setup file - runs before each test file

// Global test timeout
jest.setTimeout(10000);

// Suppress react-test-renderer deprecation warning (React 19 issue)
// @testing-library/react-native still uses it internally
const originalError = console.error;
console.error = (...args) => {
    if (args[0]?.includes?.('react-test-renderer is deprecated')) {
        return;
    }
    originalError.call(console, ...args);
};

// Mock react-native
jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: jest.fn((obj) => obj.ios) },
    NativeModules: {},
    NativeEventEmitter: jest.fn(),
    StyleSheet: {
        create: jest.fn((styles) => styles),
    },
}));

// Mock expo modules
jest.mock('expo-constants', () => ({
    expoConfig: { extra: {} },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-linking', () => ({
    createURL: jest.fn(),
    parse: jest.fn(),
}));

jest.mock('react-native-reanimated', () => ({}));
