import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';

type Props = {
    count: number;
    onPress: () => void;
    palette: typeof Colors.light;
};

export function ProfileNapkinsLine({ count, onPress, palette }: Props) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${count} napkins this month, open the ledger`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
            <Text style={[Type.metadata, styles.copy, { color: palette.textMuted }]}>
                {`${count} napkins this month`}
            </Text>
            <Ionicons name="chevron-forward" size={IconSize.sm} color={palette.textFaint} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: Spacing.hitTarget,
        marginHorizontal: Spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    copy: {
        flex: 1,
        fontVariant: ['tabular-nums'],
    },
    pressed: { opacity: 0.8 },
});
