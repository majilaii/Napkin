/**
 * SheetHeader — modal/sheet header row: Cancel / italic-serif title / Save.
 *
 * Matches the Heirloom kit `SheetHeader` from logger-canvas:
 *  - Left: "Cancel" (Manrope 500 15px, textSecondary)
 *  - Center: italic Newsreader title, 18px, ink-primary
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
} from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
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

    const rightColor = rightDisabled ? palette.textMuted : palette.primary;

    return (
        <View>
            {showHandle ? (
                <View style={styles.handleWrapper}>
                    <View
                        style={[styles.handle, { backgroundColor: palette.outlineVariant }]}
                    />
                </View>
            ) : null}
            <View
                style={[
                    styles.row,
                    { borderBottomColor: palette.dividerSoft },
                ]}
            >
                <Pressable
                    onPress={onLeftPress}
                    hitSlop={12}
                    style={({ pressed }) => [
                        styles.sideWrap,
                        { opacity: pressed ? 0.6 : 1 },
                    ]}
                >
                    <Text
                        style={{
                            fontFamily: 'Manrope_500Medium',
                            fontSize: 15,
                            color: palette.textSecondary,
                        }}
                    >
                        {leftLabel}
                    </Text>
                </Pressable>

                <View style={styles.centerWrap} pointerEvents="none">
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 18,
                            color: palette.text,
                        }}
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                </View>

                {rightLabel ? (
                    <Pressable
                        onPress={onRightPress}
                        disabled={rightDisabled || rightPending}
                        hitSlop={12}
                        style={({ pressed }) => [
                            styles.sideWrap,
                            styles.rightWrap,
                            {
                                opacity:
                                    rightDisabled || rightPending
                                        ? 0.5
                                        : pressed
                                          ? 0.6
                                          : 1,
                            },
                        ]}
                    >
                        {rightPending ? (
                            <ActivityIndicator size="small" color={palette.primary} />
                        ) : (
                            <Text
                                style={{
                                    fontFamily: 'Manrope_600SemiBold',
                                    fontSize: 15,
                                    color: rightColor,
                                }}
                            >
                                {rightLabel}
                            </Text>
                        )}
                    </Pressable>
                ) : (
                    // Empty right slot — preserves layout balance vs the left Cancel link.
                    <View style={[styles.sideWrap, styles.rightWrap]} />
                )}
            </View>
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
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sideWrap: {
        minWidth: 60,
        paddingVertical: Spacing.xs,
    },
    rightWrap: {
        alignItems: 'flex-end',
    },
    centerWrap: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
