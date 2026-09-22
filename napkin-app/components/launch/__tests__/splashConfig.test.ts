import fs from 'node:fs';
import path from 'node:path';

import appConfig from '../../../app.config';
import { Colors } from '@/constants/theme';
import { SPLASH_WORDMARK_SIZE } from '../launchLayout';

type SplashOptions = {
    image: string;
    imageWidth: number;
    backgroundColor: string;
    dark?: { backgroundColor?: string; image?: string };
};

function splashOptions(): SplashOptions {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    const entry = (config.plugins ?? []).find(
        (plugin): plugin is [string, SplashOptions] =>
            Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );
    if (!entry) throw new Error('expo-splash-screen plugin is not configured');
    return entry[1];
}

function pngSize(file: string): { width: number; height: number } {
    const bytes = fs.readFileSync(file);
    // IHDR is always the first chunk: width and height are big-endian at 16 and 20.
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('native splash ↔ launch screen parity', () => {
    it('draws the same wordmark square the launch screen animates from', () => {
        const splash = splashOptions();
        expect(splash.image).toBe('./assets/images/splash-wordmark.png');
        expect(splash.imageWidth).toBe(SPLASH_WORDMARK_SIZE);
    });

    it('sits on the app paper in both appearances, never white or black', () => {
        const splash = splashOptions();
        expect(splash.backgroundColor.toLowerCase()).toBe(Colors.light.background);
        // The app is light-only; a dark variant would flash before the cream app.
        expect(splash.dark?.backgroundColor ?? splash.backgroundColor).toBe(splash.backgroundColor);
        expect(splash.dark?.image).toBeUndefined();
    });

    it('ships the wordmark as a square @3x image', () => {
        const file = path.join(__dirname, '../../../assets/images/splash-wordmark.png');
        expect(pngSize(file)).toEqual({
            width: SPLASH_WORDMARK_SIZE * 3,
            height: SPLASH_WORDMARK_SIZE * 3,
        });
    });
});
