import React from 'react';
import {
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CitySuggestField } from '@/components/onboarding/CitySuggestField';
import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SearchLocality } from '@/hooks/search/searchLocalityStore';

interface SearchLocalityBarProps {
    label: string;
    locality: SearchLocality;
    onSelectCurrentLocation: () => void;
    onSelectCity: (city: string) => void;
    /** Places header variant: compact pill beside the saved/been/filter chips. */
    compact?: boolean;
}

export function SearchLocalityBar({
    label,
    locality,
    onSelectCurrentLocation,
    onSelectCity,
    compact = false,
}: SearchLocalityBarProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const [sheetOpen, setSheetOpen] = React.useState(false);
    const [city, setCity] = React.useState('');

    const openSheet = () => {
        Keyboard.dismiss();
        setCity(locality === 'auto' ? '' : locality.city);
        setSheetOpen(true);
    };

    const chooseCurrentLocation = () => {
        setSheetOpen(false);
        setTimeout(onSelectCurrentLocation, 0);
    };

    const chooseCity = (value: string) => {
        const next = value.trim();
        if (!next) return;
        onSelectCity(next);
        setSheetOpen(false);
    };

    return (
        <>
            <Pressable
                onPress={openSheet}
                style={({ pressed }) => [
                    styles.bar,
                    compact && [
                        styles.compactBar,
                        Shadow.ambient,
                        { backgroundColor: palette.scrimFrost },
                    ],
                    { opacity: pressed ? 0.65 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`search location, ${label}`}
                accessibilityHint="opens location choices"
            >
                <Ionicons
                    name="location-outline"
                    size={compact ? IconSize.sm + Spacing.xs / 2 : IconSize.lg}
                    color={palette.textMuted}
                />
                <Text
                    numberOfLines={1}
                    style={[
                        Type.metadata,
                        styles.barLabel,
                        compact && styles.compactLabel,
                        { color: palette.textMuted },
                    ]}
                >
                    {label}
                </Text>
                <Ionicons
                    name="chevron-down-outline"
                    size={compact ? 14 : IconSize.lg}
                    color={palette.textFaint}
                />
            </Pressable>

            <Modal
                visible={sheetOpen}
                transparent
                animationType="slide"
                onRequestClose={() => setSheetOpen(false)}
            >
                <KeyboardAvoidingView
                    style={styles.modalRoot}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <Pressable
                        style={[styles.backdrop, { backgroundColor: palette.overlay }]}
                        onPress={() => setSheetOpen(false)}
                        accessibilityRole="button"
                        accessibilityLabel="close location choices"
                    />
                    <View
                        style={[
                            styles.sheet,
                            Shadow.ambient,
                            {
                                backgroundColor: palette.surfaceNote,
                                paddingBottom: Math.max(insets.bottom, Spacing.lg),
                            },
                        ]}
                    >
                            <View
                                style={[
                                    styles.handle,
                                    { backgroundColor: palette.outlineVariant },
                                ]}
                            />
                            <Text
                                style={[
                                    Type.titleMedium,
                                    styles.title,
                                    { color: palette.text },
                                ]}
                            >
                                where
                            </Text>

                            <Pressable
                                onPress={chooseCurrentLocation}
                                style={({ pressed }) => [
                                    styles.choiceRow,
                                    {
                                        backgroundColor:
                                            locality === 'auto'
                                                ? palette.primaryMuted
                                                : palette.surfaceJournalLow,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ selected: locality === 'auto' }}
                            >
                                <Ionicons
                                    name="location-outline"
                                    size={IconSize.lg}
                                    color={palette.textSecondary}
                                />
                                <Text
                                    style={[
                                        Type.body,
                                        styles.choiceLabel,
                                        { color: palette.text },
                                    ]}
                                >
                                    current location
                                </Text>
                                {locality === 'auto' ? (
                                    <Ionicons
                                        name="checkmark-circle-outline"
                                        size={IconSize.lg}
                                        color={palette.primary}
                                    />
                                ) : null}
                            </Pressable>

                            <View
                                style={[
                                    styles.cityField,
                                    { backgroundColor: palette.background },
                                ]}
                            >
                                <CitySuggestField
                                    value={city}
                                    onChangeText={(value) => setCity(value.slice(0, 120))}
                                    onSelectSuggestion={chooseCity}
                                    maxLength={120}
                                    placeholder="city"
                                    placeholderTextColor={palette.textMuted}
                                    autoCapitalize="words"
                                    autoCorrect={false}
                                    returnKeyType="done"
                                    onSubmitEditing={() => chooseCity(city)}
                                    style={[Type.body, styles.cityInput, { color: palette.text }]}
                                    accessibilityLabel="city"
                                />
                            </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    bar: {
        minHeight: IconSize.lg + Spacing.md + Spacing.xs,
        marginHorizontal: Spacing.lg,
        paddingHorizontal: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    barLabel: {
        flex: 1,
    },
    compactBar: {
        minHeight: Spacing.hitTarget - Spacing.xs,
        marginHorizontal: 0,
        paddingHorizontal: Spacing.sm + Spacing.xs + Spacing.xs / 2,
        borderRadius: Radius.full,
        gap: Spacing.sm - Spacing.xs / 2,
        flex: 0,
        maxWidth: 160,
    },
    compactLabel: {
        flex: 0,
        maxWidth: 102,
        ...Type.feedLedger,
        fontFamily: 'Manrope_600SemiBold',
    },
    modalRoot: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        gap: Spacing.md,
    },
    handle: {
        width: Spacing.xxl - Spacing.md,
        height: Spacing.xs,
        borderRadius: Radius.full,
        alignSelf: 'center',
    },
    title: {
        marginTop: Spacing.xs,
    },
    choiceRow: {
        minHeight: Spacing.xxl,
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    choiceLabel: {
        flex: 1,
    },
    cityField: {
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
    },
    cityInput: {
        minHeight: Spacing.xxl,
        paddingVertical: Spacing.sm,
    },
});
