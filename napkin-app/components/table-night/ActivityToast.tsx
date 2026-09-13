/** A paper notice above the navigation. The visible notice owns its lifetime. */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';

export interface ToastAction { label: string; onPress: () => void; }
export interface ToastOptions {
    title?: string;
    icon?: React.ComponentProps<typeof Ionicons>['name'];
}
export interface Toast extends ToastOptions {
    id: string;
    message: string;
    timestamp: number;
    action?: ToastAction;
}
type Palette = { text: string; [key: string]: string | number };
interface ActivityToastProps { toasts: Toast[]; onDismiss: (id: string) => void; palette: Palette; }
export const TOAST_DURATION_MS = 4000;
export const ACTION_TOAST_DURATION_MS = 8000;

function ToastItem({ toast, onDismiss, palette }: { toast: Toast; onDismiss: (id: string) => void; palette: Palette }) {
    const opacity = useRef(new Animated.Value(0)).current;
    const dismissed = useRef(false);
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;
    const colors = { ...Colors.light, ...palette } as typeof Colors.light;
    useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        const duration = toast.action ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS;
        const schedule = (screenReader: boolean) => {
            if (!active || (screenReader && toast.action)) return;
            timer = setTimeout(() => {
                Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
                    if (active && !dismissed.current) {
                        dismissed.current = true;
                        onDismissRef.current(toast.id);
                    }
                });
            }, duration);
        };
        AccessibilityInfo.isScreenReaderEnabled().then(schedule, () => schedule(false));
        return () => { active = false; clearTimeout(timer); opacity.stopAnimation(); };
    }, [toast.id, toast.action, opacity]);
    const dismiss = () => {
        if (dismissed.current) return false;
        dismissed.current = true;
        onDismissRef.current(toast.id);
        return true;
    };
    const content = <>
        {toast.icon ? <View style={[styles.icon, { backgroundColor: colors.primaryMuted }]}>
            <Ionicons name={toast.icon} size={IconSize.lg} color={colors.primary} />
        </View> : null}
        <View style={styles.copy}>
            {toast.title ? <Text style={[Type.sectionKicker, { color: colors.textMuted }]}>{toast.title}</Text> : null}
            <Text style={[Type.body, { color: colors.text }]}>{toast.message}</Text>
            {toast.action ? <View style={styles.actionLine}>
                <Text style={[Type.metadata, { color: colors.primary }]}>{toast.action.label}</Text>
                <Ionicons name="arrow-forward-outline" size={IconSize.sm} color={colors.primary} />
            </View> : null}
        </View>
    </>;
    return <Animated.View style={[styles.notice, { backgroundColor: colors.card, opacity }]} accessibilityLiveRegion="polite">
        {toast.action ? <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${toast.title ? `${toast.title}. ` : ''}${toast.message}. ${toast.action.label}`}
            onPress={() => { if (dismiss()) toast.action?.onPress(); }}
            style={({ pressed }) => [styles.main, { opacity: pressed ? 0.8 : 1 }]}
        >{content}</Pressable> : <View style={styles.main}>{content}</View>}
        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss notification" style={styles.close}>
            <Ionicons name="close-outline" size={IconSize.md} color={colors.textMuted} />
        </Pressable>
    </Animated.View>;
}
export function ActivityToast({ toasts, onDismiss, palette }: ActivityToastProps) {
    const insets = useSafeAreaInsets();
    if (!toasts.length) return null;
    return <View style={[styles.container, { bottom: Math.max(96, insets.bottom + 80) }]} pointerEvents="box-none">
        <ToastItem key={toasts[0].id} toast={toasts[0]} onDismiss={onDismiss} palette={palette} />
    </View>;
}
const styles = StyleSheet.create({
    container: { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 100 },
    notice: { ...Shadow.ambient, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'flex-start' },
    main: { flex: 1, minHeight: Spacing.hitTarget, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, paddingRight: 0 },
    icon: { width: Spacing.hitTarget, height: Spacing.hitTarget, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
    copy: { flex: 1, minWidth: 0, gap: Spacing.xs },
    actionLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    close: { minWidth: Spacing.hitTarget, minHeight: Spacing.hitTarget, alignItems: 'center', justifyContent: 'center' },
});
