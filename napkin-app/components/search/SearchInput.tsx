/**
 * SearchInput — sticky header input with clear button and debounced emission.
 *
 * Keeps the displayed value immediate (responsive typing) and emits a debounced
 * value upward via onChangeDebounced (250ms trailing). Uses a useRef-backed
 * timer so the debounce never resets on render — see Technical Design risk note.
 */
import React, { useRef, useCallback, forwardRef } from 'react';
import {
    View,
    TextInput,
    StyleSheet,
    Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const DEBOUNCE_MS = 250;

interface SearchInputProps {
    value: string;
    onChangeImmediate: (text: string) => void;
    onChangeDebounced: (text: string) => void;
    onClear: () => void;
    autoFocus?: boolean;
    placeholder?: string;
}

export const SearchInput = forwardRef<TextInput, SearchInputProps>(
    function SearchInput(
        {
            value,
            onChangeImmediate,
            onChangeDebounced,
            onClear,
            autoFocus,
            placeholder = 'Search restaurants…',
        }: SearchInputProps,
        ref,
    ) {
        const scheme = useColorScheme() ?? 'light';
        const palette = Colors[scheme];
        const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

        const handleChange = useCallback(
            (text: string) => {
                onChangeImmediate(text);

                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                    onChangeDebounced(text);
                }, DEBOUNCE_MS);
            },
            [onChangeImmediate, onChangeDebounced],
        );

        const handleClear = useCallback(() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            onClear();
        }, [onClear]);

        return (
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: palette.surfaceContainerHigh,
                        borderColor: palette.outlineVariant,
                    },
                ]}
            >
                <Ionicons
                    name="search-outline"
                    size={18}
                    color={palette.textMuted}
                    style={styles.icon}
                />
                <TextInput
                    ref={ref}
                    style={[Type.body, styles.input, { color: palette.text }]}
                    value={value}
                    onChangeText={handleChange}
                    placeholder={placeholder}
                    placeholderTextColor={palette.textMuted}
                    autoFocus={autoFocus}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                    clearButtonMode="never"
                />
                {value.length > 0 && (
                    <Pressable onPress={handleClear} style={styles.clearButton} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={palette.textMuted} />
                    </Pressable>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: Spacing.md,
        marginVertical: Spacing.sm,
        borderRadius: Radius.full,
        borderWidth: 1,
        paddingHorizontal: Spacing.sm,
        height: 44,
    },
    icon: {
        marginRight: Spacing.xs,
    },
    input: {
        flex: 1,
        paddingVertical: 0,
    },
    clearButton: {
        marginLeft: Spacing.xs,
    },
});
