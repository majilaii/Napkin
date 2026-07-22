import React from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    type TextInputProps,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CITIES } from '@/lib/cities';

type CitySuggestFieldProps = Omit<TextInputProps, 'onChangeText' | 'value'> & {
    value: string;
    onChangeText: (value: string) => void;
};

export const CitySuggestField = React.forwardRef<TextInput, CitySuggestFieldProps>(
    function CitySuggestField({ value, onChangeText, ...inputProps }, ref) {
        const scheme = useColorScheme() ?? 'light';
        const palette = Colors[scheme];
        const [expanded, setExpanded] = React.useState(false);

        const suggestions = React.useMemo(() => {
            const query = value.trim().toLowerCase();
            if (!expanded || !query) return [];

            const prefix: string[] = [];
            const substring: string[] = [];
            for (const city of CITIES) {
                const candidate = city.toLowerCase();
                if (candidate.startsWith(query)) prefix.push(city);
                else if (candidate.includes(query)) substring.push(city);
            }
            return [...prefix, ...substring].slice(0, 5);
        }, [expanded, value]);

        return (
            <View>
                <TextInput
                    {...inputProps}
                    ref={ref}
                    value={value}
                    onChangeText={(text) => {
                        onChangeText(text);
                        setExpanded(text.trim().length > 0);
                    }}
                />

                {suggestions.length > 0 ? (
                    <View style={styles.suggestions}>
                        {suggestions.map((city) => (
                            <Pressable
                                key={city}
                                onPress={() => {
                                    onChangeText(city);
                                    setExpanded(false);
                                }}
                                style={({ pressed }) => [
                                    styles.suggestion,
                                    {
                                        backgroundColor: palette.surfaceContainerLow,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={city}
                            >
                                <Text style={[styles.suggestionText, { color: palette.text }]}>
                                    {city}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
            </View>
        );
    },
);

const styles = StyleSheet.create({
    suggestions: {
        gap: Spacing.xs,
        marginTop: Spacing.sm,
    },
    suggestion: {
        minHeight: 44,
        borderRadius: Radius.md,
        justifyContent: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
    },
    suggestionText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 16,
    },
});
