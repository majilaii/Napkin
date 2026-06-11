/**
 * ActivityToast — TICKET-069 canvas restyle (P · TOAST).
 *
 * Canvas spec:
 *   position: bottom 96px
 *   background: var(--ink-primary)  (#1c1c19)
 *   text: #fffdf8 italic serif 16
 *   border-radius: 9999px (full pill)
 *   padding: 10px 22px
 *
 * Shows max 1 toast at a time (bottom placement, pills stack upward if needed).
 * Auto-dismiss after 3s with a slide-up / fade-out animation.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';

export interface ToastAction {
    label: string;
    onPress: () => void;
}

export interface Toast {
    id: string;
    message: string;
    timestamp: number;
    action?: ToastAction;
}

type Palette = {
    text: string;
    [key: string]: string | number;
};

interface ActivityToastProps {
    toasts: Toast[];
    onDismiss: (id: string) => void;
    palette: Palette;
}

function ToastItem({
    toast,
    onDismiss,
    index,
}: {
    toast: Toast;
    onDismiss: (id: string) => void;
    index: number;
}) {
    const translateY = useRef(new Animated.Value(40)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    useEffect(() => {
        // Slide up from below
        Animated.parallel([
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 80,
                friction: 12,
            }),
            Animated.timing(opacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
            }),
        ]).start();

        // Auto-dismiss
        const timer = setTimeout(() => {
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: 40,
                    duration: 200,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                onDismissRef.current(toast.id);
            });
        }, 3000);

        return () => clearTimeout(timer);
    }, [toast.id, translateY, opacity]);

    // Stack pills upward: each subsequent toast is offset above the previous
    const bottomOffset = index * 48;

    return (
        <Animated.View
            style={[
                styles.pill,
                {
                    transform: [{ translateY }],
                    opacity,
                    marginBottom: bottomOffset,
                },
            ]}
            pointerEvents="none"
        >
            <Text style={styles.pillText}>{toast.message}</Text>
        </Animated.View>
    );
}

export function ActivityToast({ toasts, onDismiss }: ActivityToastProps) {
    const insets = useSafeAreaInsets();

    if (toasts.length === 0) return null;

    // Canvas: bottom 96px. Respect safe-area so it doesn't overlap home indicator.
    const bottomPos = Math.max(96, insets.bottom + 80);

    return (
        <View
            style={[styles.container, { bottom: bottomPos }]}
            pointerEvents="box-none"
        >
            {toasts.slice(0, 2).map((toast, index) => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                    onDismiss={onDismiss}
                    index={index}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: Spacing.lg,
        right: Spacing.lg,
        zIndex: 100,
        alignItems: 'center',
    },
    pill: {
        // Canvas: ink-primary (#1c1c19) background, white-warm text, radius-full
        backgroundColor: '#1c1c19',
        borderRadius: 9999,
        paddingHorizontal: 22,
        paddingVertical: 10,
        alignSelf: 'center',
    },
    pillText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 22,
        color: '#fffdf8',
    },
});
