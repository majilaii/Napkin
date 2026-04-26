/**
 * AddDetailsDrawer — collapsible container for breakdown ratings + dish field.
 * Collapsed by default; state is local (not persisted across sessions).
 *
 * Animated height transition using LayoutAnimation.
 * The four breakdown StarRatings live here, off the primary composer surface.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    LayoutAnimation,
    Platform,
    UIManager,
    TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StarRating } from '@/components/StarRating';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
    UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

interface BreakdownRatings {
    vibe: number;
    flavor: number;
    service: number;
    value: number;
}

interface Props {
    breakdown: BreakdownRatings;
    onBreakdownChange: (key: keyof BreakdownRatings, value: number) => void;
    dish: string;
    onDishChange: (text: string) => void;
}

const BREAKDOWN_ROWS: { key: keyof BreakdownRatings; label: string }[] = [
    { key: 'flavor', label: 'FLAVOR' },
    { key: 'vibe', label: 'VIBES' },
    { key: 'service', label: 'SERVICE' },
    { key: 'value', label: 'VALUE' },
];

export function AddDetailsDrawer({ breakdown, onBreakdownChange, dish, onDishChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [open, setOpen] = useState(false);

    const toggle = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setOpen(prev => !prev);
    };

    return (
        <View style={[styles.container, { borderTopColor: palette.dividerSoft }]}>
            <Pressable
                onPress={toggle}
                style={styles.trigger}
                accessibilityRole="button"
                accessibilityLabel={open ? 'Collapse details' : 'Add details'}
            >
                <Text style={[styles.triggerLabel, { color: palette.primary }]}>
                    add details
                </Text>
                <View
                    style={[
                        styles.chevronCircle,
                        { borderColor: 'rgba(160,63,40,0.3)' },
                    ]}
                >
                    <Ionicons
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={11}
                        color={palette.primary}
                    />
                </View>
            </Pressable>

            {open ? (
                <View style={styles.content}>
                    {/* Dish field */}
                    <View style={[styles.dishRow, { borderBottomColor: palette.ruleInkSoft }]}>
                        <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>
                            DISH
                        </Text>
                        <TextInput
                            style={[styles.dishInput, { color: palette.text }]}
                            placeholder="e.g. spicy rigatoni, negroni"
                            placeholderTextColor={palette.textMuted}
                            value={dish}
                            onChangeText={onDishChange}
                        />
                    </View>

                    {/* Breakdown star ratings */}
                    <View style={styles.breakdownList}>
                        {BREAKDOWN_ROWS.map(({ key, label }) => (
                            <View key={key} style={styles.breakdownRow}>
                                <Text style={[styles.breakdownLabel, { color: palette.textSecondary }]}>
                                    {label}
                                </Text>
                                <StarRating
                                    value={breakdown[key]}
                                    size={20}
                                    editable
                                    onChange={(v) => onBreakdownChange(key, v)}
                                />
                            </View>
                        ))}
                    </View>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: Spacing.lg,
    },
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: Spacing.md + 2,
        paddingBottom: Spacing.md + 2,
    },
    triggerLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    chevronCircle: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        paddingBottom: Spacing.md,
        gap: Spacing.md,
    },
    dishRow: {
        borderBottomWidth: 1,
        paddingBottom: Spacing.sm,
        marginBottom: Spacing.sm,
    },
    fieldLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: Spacing.xs,
    },
    dishInput: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 15,
        padding: 0,
    },
    breakdownList: {
        gap: Spacing.md,
    },
    breakdownRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    breakdownLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1,
        textTransform: 'uppercase',
        width: 68,
    },
});
