/**
 * CreateTableModal - Modal to create a new table
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TextInput,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CreateTableModalProps {
    visible: boolean;
    onClose: () => void;
    onSubmit: (name: string) => Promise<void>;
    isSubmitting: boolean;
    theme: {
        text: string;
        textSecondary: string;
        background: string;
        card: string;
        primary: string;
        border: string;
    };
}

export function CreateTableModal({
    visible,
    onClose,
    onSubmit,
    isSubmitting,
    theme,
}: CreateTableModalProps) {
    const [tableName, setTableName] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        const name = tableName.trim();
        if (!name) {
            setError('Table name is required');
            return;
        }
        if (name.length < 2) {
            setError('Name must be at least 2 characters');
            return;
        }

        setError(null);
        try {
            await onSubmit(name);
            setTableName('');
            onClose();
        } catch (error) {
            console.error(error);
            setError('Failed to create table. Please try again.');
        }
    };

    const handleClose = () => {
        setTableName('');
        setError(null);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={handleClose}
        >
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: theme.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <SafeAreaView style={styles.safeArea}>
                    {/* Header */}
                    <View style={[styles.header, { borderBottomColor: theme.border }]}>
                        <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
                            <Text style={[styles.cancelText, { color: theme.primary }]}>Cancel</Text>
                        </TouchableOpacity>
                        <Text style={[styles.title, { color: theme.text }]}>Create Table</Text>
                        <TouchableOpacity
                            onPress={handleSubmit}
                            style={styles.headerButton}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <ActivityIndicator size="small" color={theme.primary} />
                            ) : (
                                <Text style={[styles.doneText, { color: theme.primary }]}>Create</Text>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Content */}
                    <View style={styles.content}>
                        <View style={[styles.inputContainer, { backgroundColor: theme.card }]}>
                            <Ionicons name="people" size={20} color={theme.textSecondary} />
                            <TextInput
                                style={[styles.input, { color: theme.text }]}
                                placeholder="Table name (e.g., Sunday Roast Club)"
                                placeholderTextColor={theme.textSecondary}
                                value={tableName}
                                onChangeText={(text) => {
                                    setTableName(text);
                                    if (error) setError(null);
                                }}
                                autoFocus
                                maxLength={50}
                                returnKeyType="done"
                                onSubmitEditing={handleSubmit}
                            />
                        </View>

                        {error && <Text style={styles.errorText}>{error}</Text>}

                        <Text style={[styles.hint, { color: theme.textSecondary }]}>
                            Give your table a fun name. You&apos;ll be able to invite friends after creating it.
                        </Text>
                    </View>
                </SafeAreaView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    headerButton: {
        minWidth: 60,
    },
    cancelText: {
        fontSize: 16,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
    },
    doneText: {
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'right',
    },
    content: {
        padding: 20,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 12,
        gap: 12,
    },
    input: {
        flex: 1,
        fontSize: 16,
    },
    errorText: {
        color: '#FF3B30',
        fontSize: 13,
        marginTop: 8,
        marginLeft: 4,
    },
    hint: {
        fontSize: 13,
        marginTop: 16,
        lineHeight: 18,
    },
});
