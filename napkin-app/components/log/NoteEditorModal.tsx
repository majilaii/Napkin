/**
 * NoteEditorModal — Letterboxd-style full-screen note editor (TICKET-071).
 *
 * Opens from the log-meal route when the user taps the note preview block.
 *
 * Behaviour:
 *   - Near-full-screen slide-up (RN Modal, presentationStyle pageSheet on iOS)
 *   - Autofocused multiline TextInput, italic serif 16/24, 24px padding
 *   - Placeholder "— what will you remember?"
 *   - No underline chrome — the screen IS the field
 *   - Header: quiet "close" left · uppercase kicker "THE NOTE" center
 *             · terracotta "done" right
 *   - BOTH done and close COMMIT the draft (never lose text — Letterboxd rule)
 *   - onRequestClose also commits (native swipe-to-dismiss on iOS pageSheet)
 */
import React, { useRef, useEffect, useState } from 'react';
import {
    Modal,
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    Platform,
    KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    visible: boolean;
    value: string;
    /** Called with the committed draft when the modal closes (never discards). */
    onClose: (committed: string) => void;
}

export function NoteEditorModal({ visible, value, onClose }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const inputRef = useRef<TextInput>(null);
    const [draft, setDraft] = useState(value);

    // Sync draft from outside when opening
    useEffect(() => {
        if (visible) setDraft(value);
    }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

    // Autofocus after slide-up animation settles
    useEffect(() => {
        if (visible) {
            const t = setTimeout(() => inputRef.current?.focus(), 150);
            return () => clearTimeout(t);
        }
    }, [visible]);

    const commit = () => onClose(draft);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={false}
            presentationStyle="pageSheet"
            onRequestClose={commit}
        >
            <KeyboardAvoidingView
                style={[styles.root, { backgroundColor: palette.surfaceNote }]}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
                    <Pressable onPress={commit} hitSlop={14} accessibilityLabel="close">
                        <Text style={[styles.closeBtn, { color: palette.textMuted }]}>
                            close
                        </Text>
                    </Pressable>

                    <Text style={[styles.kicker, { color: palette.textMuted }]}>
                        THE NOTE
                    </Text>

                    <Pressable onPress={commit} hitSlop={14} accessibilityLabel="done">
                        <Text style={[styles.doneBtn, { color: palette.primary }]}>
                            done
                        </Text>
                    </Pressable>
                </View>

                {/* Full-screen text area */}
                <TextInput
                    ref={inputRef}
                    value={draft}
                    onChangeText={setDraft}
                    multiline
                    placeholder="— what will you remember?"
                    placeholderTextColor={palette.textMuted}
                    style={[styles.input, { color: palette.text }]}
                    scrollEnabled
                    textAlignVertical="top"
                    returnKeyType="default"
                    blurOnSubmit={false}
                />
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingBottom: 16,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    closeBtn: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    doneBtn: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    input: {
        flex: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 32,
        backgroundColor: 'transparent',
    },
});
