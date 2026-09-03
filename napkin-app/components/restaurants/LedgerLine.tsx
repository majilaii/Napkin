import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import type { LedgerLineModel, LedgerLinePart } from './ledgerLineFormatter';

type Props = {
    line: LedgerLineModel | null;
    onPress?: () => void;
    flushTop?: boolean;
    palette: typeof Colors.light;
};

function partStyle(part: LedgerLinePart, palette: typeof Colors.light) {
    if (part.kind === 'label') return [Type.sectionKicker, { color: palette.textMuted }];
    if (part.kind === 'rating') {
        return [Type.restaurantLedgerRating, { color: palette.amberBright }];
    }
    return [Type.metadata, { color: palette.textMuted }];
}

export function LedgerLine({ line, onPress, flushTop = false, palette }: Props) {
    if (!line) return null;
    const canOpenHistory = line.visitCount > 0 && !!onPress;
    const content = (
        <>
            <View style={styles.parts}>
                {line.parts.map((part, index) => (
                    <Text
                        key={`${part.kind}:${part.text}:${index}`}
                        style={[
                            partStyle(part, palette),
                            part.kind === 'bridge' && styles.bridge,
                        ]}
                    >
                        {part.text}
                    </Text>
                ))}
            </View>
            {canOpenHistory ? (
                <Ionicons
                    name="chevron-forward"
                    size={IconSize.md}
                    color={palette.textFaint}
                />
            ) : null}
        </>
    );
    const rowStyle = [styles.row, !flushTop && styles.top];

    if (!canOpenHistory) {
        return (
            <View accessible accessibilityLabel={line.copy} style={rowStyle}>
                {content}
            </View>
        );
    }

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={line.copy}
            hitSlop={Spacing.sm}
            style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
        >
            {content}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: Spacing.restaurant.ledgerMinHeight,
        marginHorizontal: Spacing.restaurant.pageGutter,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.actionGap,
    },
    top: { marginTop: Spacing.restaurant.ledgerTop },
    parts: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: Spacing.restaurant.compactGap,
        rowGap: Spacing.xs,
    },
    bridge: { marginHorizontal: Spacing.xs },
    pressed: { opacity: 0.8 },
});
