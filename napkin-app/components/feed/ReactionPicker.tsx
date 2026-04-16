/**
 * ReactionPicker — floating emoji picker shown on long-press of a like button.
 *
 * Renders as a Modal so it floats above the feed without disturbing layout.
 * Emojis animate in with a quick scale+translate spring.
 */
import React, { useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    withDelay,
} from 'react-native-reanimated';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const REACTION_EMOJIS = ['🔥', '😋', '❤️', '💯', '👀'] as const;

interface ReactionPickerProps {
    visible: boolean;
    anchor: { x: number; y: number } | null; // screen coords of the anchor button
    onPick: (emoji: string) => void;
    onClose: () => void;
}

export function ReactionPicker({ visible, anchor, onPick, onClose }: ReactionPickerProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (!anchor) return null;

    // Popover sits above the anchor; left-aligned to it but clamped to screen edges.
    const POPOVER_WIDTH = 260;
    const left = Math.max(12, Math.min(anchor.x - 20, 9999));
    const top = Math.max(60, anchor.y - 58);

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <View
                    pointerEvents="box-none"
                    style={[
                        styles.popover,
                        {
                            top,
                            left,
                            width: POPOVER_WIDTH,
                            backgroundColor: palette.card,
                            shadowColor: palette.text,
                        },
                    ]}
                >
                    {REACTION_EMOJIS.map((emoji, i) => (
                        <EmojiButton
                            key={emoji}
                            emoji={emoji}
                            index={i}
                            onPick={onPick}
                        />
                    ))}
                </View>
            </Pressable>
        </Modal>
    );
}

function EmojiButton({
    emoji,
    index,
    onPick,
}: {
    emoji: string;
    index: number;
    onPick: (emoji: string) => void;
}) {
    const scale = useSharedValue(0);
    const translateY = useSharedValue(12);

    useEffect(() => {
        scale.value = withDelay(index * 25, withSpring(1, { damping: 12, stiffness: 260 }));
        translateY.value = withDelay(index * 25, withTiming(0, { duration: 200 }));
    }, [index, scale, translateY]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }, { translateY: translateY.value }],
    }));

    return (
        <Animated.View style={animatedStyle}>
            <Pressable
                onPress={() => onPick(emoji)}
                hitSlop={6}
                style={({ pressed }) => [
                    styles.emojiBtn,
                    pressed && { transform: [{ scale: 1.15 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
            >
                <Text style={styles.emoji} allowFontScaling={false}>
                    {emoji}
                </Text>
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    popover: {
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: Radius.full,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 20,
        elevation: 8,
    },
    emojiBtn: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emoji: {
        fontSize: 28,
        lineHeight: 34,
    },
});
