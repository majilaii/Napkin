import { useCallback, useEffect, useRef, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';

import { LAUNCH_TIMING, type LaunchMode, type LaunchPhase } from './launchState';

interface Options {
    mode: LaunchMode;
    /** Everything the app needed has resolved and the navigator has settled. */
    ready: boolean;
    /** Called once the exit has finished and the cover can unmount. */
    onDone: () => void;
}

/**
 * Drives the cover through splash → intro → waiting → exiting → done.
 *
 * Phase changes run on JS timers matched to the animation durations, so the
 * sequence is deterministic under test and never waits on an animation
 * callback that might not fire. The intro always completes before the exit,
 * even when the app is ready first, so the rules never cut off mid-stroke.
 */
export function useLaunchSequence({ mode, ready, onDone }: Options) {
    const [phase, setPhase] = useState<LaunchPhase>(mode === 'launch' ? 'splash' : 'intro');
    const [slow, setSlow] = useState(false);
    const splashHidden = useRef(mode !== 'launch');
    const onDoneRef = useRef(onDone);
    useEffect(() => {
        onDoneRef.current = onDone;
    }, [onDone]);

    const hideNativeSplash = useCallback(() => {
        if (splashHidden.current) return;
        splashHidden.current = true;
        // The launch screen is painted underneath with the same image, so the
        // native splash can go without a fade.
        void SplashScreen.hideAsync().catch(() => {});
        setPhase((current) => (current === 'splash' ? 'intro' : current));
    }, []);

    /**
     * Called when the wordmark image has loaded. Two frames later it is on
     * screen, and the native splash above it can be removed invisibly.
     */
    const onWordmarkLoaded = useCallback(() => {
        requestAnimationFrame(() => requestAnimationFrame(hideNativeSplash));
    }, [hideNativeSplash]);

    // Never strand the native splash if the image load event is missed.
    useEffect(() => {
        if (phase !== 'splash') return;
        const timer = setTimeout(hideNativeSplash, LAUNCH_TIMING.splashFallbackMs);
        return () => clearTimeout(timer);
    }, [phase, hideNativeSplash]);

    useEffect(() => {
        if (phase !== 'intro') return;
        const duration = mode === 'launch' ? LAUNCH_TIMING.introMs : LAUNCH_TIMING.resumeFadeMs;
        const timer = setTimeout(() => setPhase('waiting'), duration);
        return () => clearTimeout(timer);
    }, [phase, mode]);

    // The slow line is measured from when the cover became visible.
    const visible = phase !== 'splash';
    useEffect(() => {
        if (!visible) return;
        const timer = setTimeout(() => setSlow(true), LAUNCH_TIMING.slowAfterMs);
        return () => clearTimeout(timer);
    }, [visible]);

    useEffect(() => {
        if (phase === 'waiting' && ready) setPhase('exiting');
    }, [phase, ready]);

    useEffect(() => {
        if (phase !== 'exiting') return;
        const timer = setTimeout(() => {
            setPhase('done');
            onDoneRef.current();
        }, LAUNCH_TIMING.exitMs);
        return () => clearTimeout(timer);
    }, [phase]);


    return { phase, slow, onWordmarkLoaded };
}
