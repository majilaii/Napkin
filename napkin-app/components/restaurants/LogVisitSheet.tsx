/**
 * LogVisitSheet — 3-option menu sheet that appears after tapping the
 * floating "Log" pill on a restaurant page.
 *
 * Canvas: napkin-design-system/project/ui_kits/napkin-app/logging-entry-canvas.html
 * Section 2, variant ③ "Menu sheet — discrete choices" — expanded to three
 * rows for our Round primitive.
 *
 * Options:
 *   ① Quick log          — ~10s: stars, optional line, done (FastLogSheet)
 *   ② Write a review     — prose, photos, companions (/create-entry solo)
 *   ③ Start a Round      — group rating event (shown only for social Tables)
 */
import React from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    visible: boolean;
    onClose: () => void;
    onDismiss?: () => void;
    onQuickLog: () => void;
    onWriteReview: () => void;
    onStartRound: () => void;
    showRoundOption: boolean;
    restaurantName?: string;
}

export function LogVisitSheet({
    visible,
    onClose,
    onDismiss,
    onQuickLog,
    onWriteReview,
    onStartRound,
    showRoundOption,
    restaurantName,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const insets = useSafeAreaInsets();

    const title = restaurantName
        ? `Add ${restaurantName} to your ledger`
        : 'Add to your ledger';

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            onDismiss={onDismiss}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.card,
                        paddingBottom: insets.bottom + Spacing.lg,
                    },
                    Shadow.ambient,
                ]}
            >
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                <Text
                    style={[
                        styles.caption,
                        { color: palette.textMuted },
                    ]}
                    numberOfLines={1}
                >
                    {title}
                </Text>

                {/* Quick log — primary (terracotta fill) */}
                <PrimaryOption
                    palette={palette}
                    onPress={onQuickLog}
                    glyph="star"
                    title="Quick log"
                    subtitle="Stars, a line, done. ~10 seconds."
                />

                {/* Write a review — secondary (journal-low fill) */}
                <SecondaryOption
                    palette={palette}
                    onPress={onWriteReview}
                    iconName="create-outline"
                    title="Write a review"
                    subtitle="Prose, photos, the full entry."
                />

                {/* Start a Round — tertiary (journal-low fill) */}
                {showRoundOption ? (
                    <SecondaryOption
                        palette={palette}
                        onPress={onStartRound}
                        iconName="people-outline"
                        title="Start a Round"
                        subtitle="Rate together with your Table."
                    />
                ) : null}
            </View>
        </Modal>
    );
}

function PrimaryOption({
    palette,
    onPress,
    glyph,
    title,
    subtitle,
}: {
    palette: Palette;
    onPress: () => void;
    glyph: 'star';
    title: string;
    subtitle: string;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                optionStyles.row,
                {
                    backgroundColor: pressed ? palette.primaryContainer : palette.primary,
                },
            ]}
        >
            <Text
                style={{
                    fontSize: 22,
                    color: palette.cream,
                    fontFamily: 'Manrope_400Regular',
                }}
            >
                {glyph === 'star' ? '★' : ''}
            </Text>
            <View style={optionStyles.text}>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 17,
                        color: palette.cream,
                        lineHeight: 20,
                    }}
                >
                    {title}
                </Text>
                <Text
                    style={{
                        fontFamily: 'Manrope_500Medium',
                        fontSize: 11,
                        color: 'rgba(246, 236, 217, 0.82)',
                        marginTop: 2,
                    }}
                >
                    {subtitle}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(246, 236, 217, 0.75)" />
        </Pressable>
    );
}

function SecondaryOption({
    palette,
    onPress,
    iconName,
    title,
    subtitle,
}: {
    palette: Palette;
    onPress: () => void;
    iconName: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle: string;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                optionStyles.row,
                {
                    backgroundColor: pressed
                        ? palette.surfaceContainer
                        : palette.surfaceContainerLow,
                    marginTop: 10,
                },
            ]}
        >
            <Ionicons name={iconName} size={20} color={palette.primary} />
            <View style={optionStyles.text}>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 17,
                        color: palette.text,
                        lineHeight: 20,
                    }}
                >
                    {title}
                </Text>
                <Text
                    style={{
                        fontFamily: 'Manrope_500Medium',
                        fontSize: 11,
                        color: palette.textMuted,
                        marginTop: 2,
                    }}
                >
                    {subtitle}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>
    );
}

const optionStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        marginHorizontal: Spacing.lg,
        borderRadius: Radius.md,
    },
    text: {
        flex: 1,
    },
});

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xxl,
        borderTopRightRadius: Radius.xxl,
        paddingTop: Spacing.sm,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    caption: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginHorizontal: Spacing.lg,
        marginBottom: Spacing.md,
    },
});
