import React from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
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

export function NotesSection({
    notes,
    onNotesChange,
    placeholder = "What did you have? How was it? Share your thoughts...",
    label = "Your Review",
    theme,
}: NotesSectionProps) {
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
                    },
                ]}
                placeholder={placeholder}
                placeholderTextColor={theme.textSecondary}
                value={notes}
                onChangeText={onNotesChange}
                multiline
                textAlignVertical="top"
                scrollEnabled={true}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    notesSection: {
        flex: 1,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
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
        minHeight: 200,
        paddingHorizontal: 0,
        paddingVertical: 0,
    },
});
