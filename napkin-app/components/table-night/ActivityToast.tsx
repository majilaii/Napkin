/**
 * ActivityToast — ephemeral slide-in notifications for round events.
 * Shows "[Name] locked in" and similar toasts, max 2 visible, auto-dismiss after 3s.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, Radius, Shadow, Type } from '@/constants/theme';

export interface Toast {
    id: string;
    message: string;
    timestamp: number;
}

type Palette = {
    surfaceContainerLow: string;
    text: string;
    [key: string]: string;
};

interface ActivityToastProps {
    toasts: Toast[];
    onDismiss: (id: string) => void;
    palette: Palette;
}

function ToastItem({
    toast,
    onDismiss,
    palette,
    index,
}: {
    toast: Toast;
    onDismiss: (id: string) => void;
    palette: Palette;
    index: number;
}) {
    const translateY = useRef(new Animated.Value(-60)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    useEffect(() => {
        // Slide in
        Animated.parallel([
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 80,
                friction: 12,
            }),
            Animated.timing(opacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start();

        // Auto-dismiss after 3s
        const timer = setTimeout(() => {
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: -60,
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

    return (
        <Animated.View
            style={[
                styles.toast,
                Shadow.ambient,
                {
                    backgroundColor: palette.surfaceContainerLow,
                    transform: [{ translateY }],
                    opacity,
                    marginTop: index > 0 ? Spacing.xs : 0,
                },
            ]}
        >
            <Text
                style={[
                    Type.titleSmall,
                    { color: palette.text },
                ]}
            >
                {toast.message}
            </Text>
        </Animated.View>
    );
}

export function ActivityToast({ toasts, onDismiss, palette }: ActivityToastProps) {
    const insets = useSafeAreaInsets();

    if (toasts.length === 0) return null;

    return (
        <View style={[styles.container, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
            {toasts.slice(0, 2).map((toast, index) => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                    onDismiss={onDismiss}
                    palette={palette}
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
    toast: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderRadius: Radius.sm,
        alignSelf: 'center',
    },
});
