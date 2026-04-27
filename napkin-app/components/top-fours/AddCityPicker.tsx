/**
 * AddCityPicker — bottom sheet for claiming a new city.
 *
 * Lists available cities (from useAvailableCities).
 * Tapping a city closes the picker and opens EditTopFourSheet for that city.
 */

import React from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    ScrollView,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAvailableCities } from '@/hooks/top-fours/useAvailableCities';
import { AvailableCityRow } from './AvailableCityRow';
import type { AvailableCity } from '@/hooks/top-fours/useAvailableCities';

interface Props {
    visible: boolean;
    userId: string;
    onClose: () => void;
    onSelectCity: (city: AvailableCity) => void;
}

export function AddCityPicker({ visible, userId, onClose, onSelectCity }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const { data: cities, isLoading } = useAvailableCities(visible ? userId : null);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: palette.background,
                        paddingTop: insets.top + Spacing.sm,
                        paddingBottom: insets.bottom,
                    },
                ]}
            >
                {/* Header */}
                <View style={styles.header}>
                    <Text
                        style={[
                            Type.headlineItalic,
                            {
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontStyle: 'italic',
                                fontSize: 20,
                                color: palette.text,
                            },
                        ]}
                    >
                        Add a city
                    </Text>
                    <Pressable onPress={onClose} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.textMuted }]}>Cancel</Text>
                    </Pressable>
                </View>

                <Text style={[Type.bodySmall, { color: palette.textMuted, marginHorizontal: Spacing.lg, marginBottom: Spacing.md }]}>
                    Cities where you have logged restaurants.
                </Text>

                {/* City list */}
                {isLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xl }} />
                ) : (
                    <ScrollView showsVerticalScrollIndicator={false}>
                        {(cities ?? []).map(city => (
                            <AvailableCityRow
                                key={city.city}
                                city={city}
                                onPress={onSelectCity}
                            />
                        ))}
                        {!isLoading && (cities ?? []).length === 0 && (
                            <Text
                                style={[
                                    Type.bodySmall,
                                    {
                                        color: palette.textMuted,
                                        textAlign: 'center',
                                        paddingHorizontal: Spacing.xl,
                                        paddingTop: Spacing.xl,
                                    },
                                ]}
                            >
                                No unclaimed cities found. Log more restaurants to unlock new cities.
                            </Text>
                        )}
                    </ScrollView>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
    },
});
