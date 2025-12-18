import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    NativeSyntheticEvent,
    TextInputContentSizeChangeEventData,
} from 'react-native';

interface NotesSectionProps {
    notes: string;
    onNotesChange: (notes: string) => void;
    placeholder?: string;
    label?: string;
    theme: {
        text: string;
        textSecondary: string;
        background: string;
    };
}

const MIN_HEIGHT = 300;

export function NotesSection({
    notes,
    onNotesChange,
    placeholder = "What did you have? How was it? Share your thoughts...",
    label = "Your Review",
    theme,
}: NotesSectionProps) {
    const [inputHeight, setInputHeight] = useState(MIN_HEIGHT);

    const handleContentSizeChange = (
        e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>
    ) => {
        const newHeight = e.nativeEvent.contentSize.height;
        setInputHeight(Math.max(MIN_HEIGHT, newHeight));
    };

    return (
        <View style={styles.notesSection}>
            <Text style={[styles.notesSectionLabel, { color: theme.textSecondary }]}>
                {label}
            </Text>
            <TextInput
                style={[
                    styles.notesInput,
                    {
                        color: theme.text,
                        backgroundColor: theme.background,
                        minHeight: inputHeight,
                    },
                ]}
                placeholder={placeholder}
                placeholderTextColor={theme.textSecondary}
                value={notes}
                onChangeText={onNotesChange}
                multiline
                textAlignVertical="top"
                onContentSizeChange={handleContentSizeChange}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    notesSection: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8
    },
    notesSectionLabel: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    notesInput: {
        fontSize: 16,
        lineHeight: 24,
        paddingHorizontal: 0,
        paddingVertical: 0,
    },
});
