/**
 * useFocusAfterTransition — raise the keyboard only once the push animation
 * has actually finished.
 *
 * InteractionManager.runAfterInteractions is unreliable on the New
 * Architecture (interaction handles resolve immediately), so the keyboard
 * rose MID-push and the card visibly jumped — the "flicker" on Settings →
 * Name/Username/Bio. The native stack emits `transitionEnd`; listen for it,
 * with a timeout fallback so the field always focuses even if the event
 * never fires (e.g. replace instead of push).
 */
import React from 'react';
import type { TextInput } from 'react-native';
import { useNavigation } from 'expo-router';

export function useFocusAfterTransition(ref: React.RefObject<TextInput | null>) {
    const navigation = useNavigation();

    React.useEffect(() => {
        let done = false;
        const focus = () => {
            if (done) return;
            done = true;
            ref.current?.focus();
        };

        // Native-stack event; typed maps vary across navigator kinds — cast.
        const unsubscribe = (navigation as any).addListener?.('transitionEnd', focus);
        const fallback = setTimeout(focus, 600);

        return () => {
            done = true;
            unsubscribe?.();
            clearTimeout(fallback);
        };
    }, [navigation, ref]);
}
