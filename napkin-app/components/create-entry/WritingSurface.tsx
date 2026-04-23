/**
 * WritingSurface — the Newsreader 20/32 prose TextInput.
 * Ghost copy: "Say something about this one."
 *
 * Sized so 3-block layout (masthead + writing + chips) hits ≥55% of viewport
 * before keyboard opens on a 390×844 device (iPhone 14 equiv).
 * minHeight = 460 × 0.55 ≈ 260, but we target the viewport directly via
 * the Dimensions API at render time.
 */
import React, { useRef } from 'react';
import { TextInput, StyleSheet, Dimensions } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
// ≥55% of usable viewport (accounting for safe area top ~44 + sheet header ~56 = ~100)
const MIN_WRITING_HEIGHT = Math.max(200, Math.floor((SCREEN_HEIGHT - 100) * 0.55));

interface Props {
    value: string;
    onChangeText: (text: string) => void;
    autoFocus?: boolean;
}

export function WritingSurface({ value, onChangeText, autoFocus }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const inputRef = useRef<TextInput>(null);

    return (
        <TextInput
            ref={inputRef}
            style={[
                styles.input,
                {
                    color: palette.text,
                    minHeight: MIN_WRITING_HEIGHT,
                },
            ]}
            placeholder="Say something about this one."
            placeholderTextColor={palette.textMuted}
            value={value}
            onChangeText={onChangeText}
            multiline
            textAlignVertical="top"
            autoFocus={autoFocus}
            scrollEnabled={false}
        />
    );
}

const styles = StyleSheet.create({
    input: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 20,
        lineHeight: 32,
        letterSpacing: -0.1,
        fontWeight: '400',
        padding: 0,
        paddingTop: 20,
        paddingBottom: 16,
    },
});
