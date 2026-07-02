/**
 * BottomActionBar — the restaurant page's action dock.
 *
 * One home for everything you can DO to a restaurant:
 *   LOG THIS MEAL (sole terracotta primary — the app's one write path)
 *   · save (bookmark → AddToListSheet)
 *   · directions
 *   · set a table (when the viewer has a Table and the restaurant is persisted)
 *
 * The bar pins to the bottom and fades upward into the page background —
 * structure by background shift, not a hard border (Heirloom rule).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    onLogPress: () => void;
    saved: boolean;
    onSavePress: () => void;
    saveDisabled?: boolean;
    showSetTable?: boolean;
    onSetTablePress?: () => void;
}

function withAlpha(hex: string, alpha: number): string {
    // Not a true alpha blender — expects a 6-digit hex and returns `${hex}${alphaHex}`.
    // We use it to derive the gradient fade color from the page background.
    const aa = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${hex}${aa}`;
}

interface DockIconProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress?: () => void;
    disabled?: boolean;
    palette: Palette;
    active?: boolean;
}

function DockIcon({ icon, label, onPress, disabled, palette, active }: DockIconProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [
                styles.iconBtn,
                {
                    backgroundColor: active ? palette.primaryMuted : palette.surfaceNote,
                    borderColor: 'rgba(28,28,25,0.10)',
                    opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
                },
            ]}
        >
            <Ionicons name={icon} size={17} color={palette.primary} />
        </Pressable>
    );
}

export function BottomActionBar({
    onLogPress,
    saved,
    onSavePress,
    saveDisabled,
    showSetTable,
    onSetTablePress,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const bg = palette.background;

    return (
        <View
            pointerEvents="box-none"
            style={[styles.container, { paddingBottom: Math.max(insets.bottom, 14) + 10 }]}
        >
            {/* Fade into page background */}
            <LinearGradient
                colors={[withAlpha(bg, 0), withAlpha(bg, 0.85), bg]}
                locations={[0, 0.4, 1]}
                style={styles.gradient}
                pointerEvents="none"
            />

            <View style={styles.row}>
                <Pressable
                    onPress={onLogPress}
                    accessibilityRole="button"
                    accessibilityLabel="Log this meal"
                    style={({ pressed }) => [
                        styles.primaryBtn,
                        {
                            backgroundColor: pressed
                                ? palette.primaryContainer
                                : palette.primary,
                        },
                    ]}
                >
                    <Text style={styles.primaryPlus}>+</Text>
                    <Text style={styles.primaryLabel}>LOG THIS MEAL</Text>
                </Pressable>

                <DockIcon
                    icon={saved ? 'bookmark' : 'bookmark-outline'}
                    label={saved ? 'Saved — change where this is saved' : 'Save restaurant'}
                    onPress={onSavePress}
                    disabled={saveDisabled}
                    active={saved}
                    palette={palette}
                />
                {showSetTable ? (
                    <DockIcon
                        icon="people-outline"
                        label="set a table here"
                        onPress={onSetTablePress}
                        palette={palette}
                    />
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 14,
        paddingHorizontal: 18,
    },
    gradient: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        top: -40,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    primaryBtn: {
        flex: 1,
        height: 44,
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
    },
    primaryPlus: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 15,
        lineHeight: 17,
        color: '#f6ecd9',
    },
    primaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.2,
        color: '#f6ecd9',
    },
    iconBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
