/**
 * SheetHeader — modal/sheet header row: Cancel / upright title / Save.
 *
 * Matches the Heirloom kit `SheetHeader` from logger-canvas:
 *  - Left: "Cancel" (Manrope 500 15px, textSecondary)
 *  - Center: functional Manrope screen title, ink-primary
 *  - Right: "Save" / "Post" — terracotta Manrope 600 15px
 *  - Hairline divider underneath (ruleWarmSoft / dividerSoft)
 *
 * Disabled right action renders muted with no press feedback.
 */
import React from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    useWindowDimensions,
} from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface SheetHeaderProps {
    title: string;
    leftLabel?: string;
    rightLabel?: string;
    onLeftPress?: () => void;
    onRightPress?: () => void;
    rightDisabled?: boolean;
    rightPending?: boolean;
    /** Show a centered grabber handle above the row (sheet-presentation only). */
    showHandle?: boolean;
}

export function SheetHeader({
    title,
    leftLabel = 'Cancel',
    rightLabel = 'Save',
    onLeftPress,
    onRightPress,
    rightDisabled = false,
    rightPending = false,
    showHandle = false,
}: SheetHeaderProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { fontScale } = useWindowDimensions();
    const usesStackedLayout = fontScale >= 1.5;

    const rightColor = rightDisabled ? palette.textMuted : palette.primary;

    const leftAction = (
        <Pressable
            onPress={onLeftPress}
            hitSlop={12}
            style={({ pressed }) => [
                styles.sideWrap,
                usesStackedLayout ? styles.sideWrapStacked : null,
                { opacity: pressed ? 0.6 : 1 },
            ]}
            accessibilityRole="button"
        >
            <Text style={[Type.body, { color: palette.textSecondary }]}>{leftLabel}</Text>
        </Pressable>
    );

    const rightAction = rightLabel ? (
        <Pressable
            onPress={onRightPress}
            disabled={rightDisabled || rightPending}
            hitSlop={12}
            style={({ pressed }) => [
                styles.sideWrap,
                usesStackedLayout ? styles.sideWrapStacked : null,
                styles.rightWrap,
                { opacity: pressed ? 0.6 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: rightDisabled || rightPending }}
        >
            {rightPending ? (
                <ActivityIndicator size="small" color={palette.primary} />
            ) : (
                <Text
                    style={[
                        Type.body,
                        { color: rightColor, fontFamily: 'Manrope_600SemiBold' },
                    ]}
                >
                    {rightLabel}
                </Text>
            )}
        </Pressable>
    ) : (
        <View style={[styles.sideWrap, styles.rightWrap]} />
    );

    const titleText = (
        <Text
            style={[Type.screenTitle, styles.title, { color: palette.text }]}
            numberOfLines={usesStackedLayout ? undefined : 2}
            accessibilityRole="header"
        >
            {title}
        </Text>
    );

    return (
        <View>
            {showHandle ? (
                <View style={styles.handleWrapper}>
                    <View
                        style={[styles.handle, { backgroundColor: palette.outlineVariant }]}
                    />
                </View>
            ) : null}
            {usesStackedLayout ? (
                <View style={[styles.stacked, { borderBottomColor: palette.dividerSoft }]}>
                    <View style={styles.stackedTitle} pointerEvents="none">
                        {titleText}
                    </View>
                    <View style={styles.actionRow}>
                        {leftAction}
                        {rightAction}
                    </View>
                </View>
            ) : (
                <View style={[styles.row, { borderBottomColor: palette.dividerSoft }]}>
                    {leftAction}
                    <View style={styles.centerWrap} pointerEvents="none">
                        {titleText}
                    </View>
                    {rightAction}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    handleWrapper: {
        alignItems: 'center',
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.xs,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 9999,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sideWrap: {
        width: 72,
        minHeight: 44,
        paddingVertical: Spacing.xs,
        justifyContent: 'center',
    },
    sideWrapStacked: {
        width: 'auto',
        minWidth: 120,
    },
    rightWrap: {
        alignItems: 'flex-end',
    },
    centerWrap: {
        flex: 1,
        minWidth: 0,
        paddingHorizontal: Spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        textAlign: 'center',
    },
    stacked: {
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    stackedTitle: {
        paddingHorizontal: Spacing.lg,
        alignItems: 'center',
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        marginTop: Spacing.xs,
    },
});
