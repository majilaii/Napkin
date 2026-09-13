import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { CITIES } from '@/lib/cities';

type Props = {
    value: string;
    onChange: (city: string) => void;
    palette: typeof Colors.light;
    disabled?: boolean;
};

/** Give search results the full space above the keyboard, independent of setup chrome. */
export function HomeCityPicker({ value, onChange, palette, disabled }: Props) {
    const insets = useSafeAreaInsets();
    const input = useRef<TextInput>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState(value);
    const term = query.trim().toLowerCase();
    const matches = term ? [
        ...CITIES.filter((city) => city.toLowerCase().startsWith(term)),
        ...CITIES.filter((city) => !city.toLowerCase().startsWith(term) && city.toLowerCase().includes(term)),
    ].slice(0, 5) : [];
    const choose = (city: string) => {
        onChange(city.trim());
        setOpen(false);
    };

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={value ? `Home city: ${value}` : 'Choose your home city'}
                accessibilityHint="Opens city search"
                accessibilityState={{ disabled: !!disabled }}
                disabled={disabled}
                onPress={() => { setQuery(value); setOpen(true); }}
                style={({ pressed }) => [s.field, { opacity: pressed ? 0.7 : 1 }]}
            >
                <Text style={[Type.body, s.flex, { color: value ? palette.text : palette.textMuted }]}>
                    {value || 'Search for your city'}
                </Text>
                <Ionicons name="search-outline" size={24} color={palette.textMuted} />
            </Pressable>
            <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)} onShow={() => input.current?.focus()}>
                <KeyboardAvoidingView style={[s.flex, { backgroundColor: palette.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <View style={[s.header, { paddingTop: insets.top + Spacing.xs }]}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Cancel city search" onPress={() => setOpen(false)} style={s.headerButton}>
                            <Ionicons name="arrow-back-outline" size={24} color={palette.text} />
                        </Pressable>
                        <Text accessibilityRole="header" style={[Type.body, { color: palette.text }]}>Home city</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel="Use entered city" onPress={() => choose(query)} style={s.headerButton}>
                            <Text style={[Type.metadata, { color: palette.primary }]}>Done</Text>
                        </Pressable>
                    </View>
                    <View style={[s.search, { backgroundColor: palette.surfaceNote }]}>
                        <Ionicons name="search-outline" size={24} color={palette.textMuted} />
                        <TextInput ref={input} value={query} onChangeText={setQuery} maxLength={120} placeholder="Search cities" placeholderTextColor={palette.textMuted}
                            accessibilityLabel="Search cities" autoCapitalize="words" autoCorrect={false} returnKeyType="done"
                            onSubmitEditing={() => choose(query)} style={[Type.body, s.input, { color: palette.text }]} />
                        {query ? <Pressable onPress={() => { setQuery(''); input.current?.focus(); }} accessibilityRole="button" accessibilityLabel="Clear city search" style={s.clear}>
                            <Ionicons name="close-outline" size={20} color={palette.textMuted} />
                        </Pressable> : null}
                    </View>
                    <ScrollView style={s.flex} contentContainerStyle={[s.results, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator>
                        {matches.length ? <>
                            <Text style={[Type.sectionKicker, s.resultLabel, { color: palette.textMuted }]}>{matches.length} {matches.length === 1 ? 'suggestion' : 'suggestions'}</Text>
                            {matches.map((city) => <Pressable key={city} onPress={() => choose(city)} accessibilityRole="button" accessibilityLabel={city}
                                style={({ pressed }) => [s.result, { backgroundColor: pressed ? palette.surfaceContainerLow : undefined }]}>
                                <Ionicons name="location-outline" size={20} color={palette.primary} />
                                <Text style={[Type.body, s.flex, { color: palette.text }]}>{city}</Text>
                                <Ionicons name="arrow-forward-outline" size={16} color={palette.textMuted} />
                            </Pressable>)}
                        </> : <Text style={[Type.body, s.empty, { color: palette.textSecondary }]}>
                            {term ? 'No suggestions. Tap Done to use this city.' : 'Start typing to find your city.'}
                        </Text>}
                    </ScrollView>
                </KeyboardAvoidingView>
            </Modal>
        </>
    );
}

const s = StyleSheet.create({
    flex: { flex: 1 },
    field: { minHeight: Spacing.xxl, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    header: { paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerButton: { minWidth: Spacing.hitTarget, minHeight: Spacing.hitTarget, justifyContent: 'center', alignItems: 'center' },
    search: { marginHorizontal: Spacing.lg, marginVertical: Spacing.sm, paddingLeft: Spacing.md, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    input: { flex: 1, minHeight: Spacing.xxl, paddingVertical: Spacing.sm },
    clear: { width: Spacing.hitTarget, minHeight: Spacing.hitTarget, alignItems: 'center', justifyContent: 'center' },
    results: { paddingHorizontal: Spacing.lg },
    resultLabel: { marginTop: Spacing.xs, marginBottom: Spacing.sm },
    result: { minHeight: Spacing.xxl, paddingVertical: Spacing.sm, flexDirection: 'row', gap: Spacing.md, alignItems: 'center', borderRadius: Radius.sm },
    empty: { marginTop: Spacing.md },
});
