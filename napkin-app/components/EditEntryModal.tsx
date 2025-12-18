import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StarRating } from './StarRating';
import { Entry } from '@/hooks/entries/useEntryHistory';

interface EditEntryModalProps {
    visible: boolean;
    onClose: () => void;
    entry: Entry | null;
    restaurantName: string;
    onSave: (entryId: string, updates: { rating?: number | null; content?: string | null }) => void;
    onDelete: (entryId: string) => void;
    isLoading?: boolean;
}

export function EditEntryModal({
    visible,
    onClose,
    entry,
    restaurantName,
    onSave,
    onDelete,
    isLoading = false,
}: EditEntryModalProps) {
    const [rating, setRating] = useState<number>(0);
    const [content, setContent] = useState('');
    const [hasChanges, setHasChanges] = useState(false);

    // Sync state when entry changes
    useEffect(() => {
        if (entry) {
            setRating(entry.rating ?? 0);
            setContent(entry.content ?? '');
            setHasChanges(false);
        }
    }, [entry]);

    const isFastReview = entry && !entry.content;

    const handleRatingChange = (r: number) => {
        setRating(r);
        setHasChanges(true);
    };

    const handleContentChange = (text: string) => {
        setContent(text);
        setHasChanges(true);
    };

    const handleSave = () => {
        if (!entry) return;
        onSave(entry.id, {
            rating: rating > 0 ? rating : null,
            content: content.trim() || null,
        });
    };

    const handleDelete = () => {
        if (!entry) return;

        Alert.alert(
            'Delete Entry',
            'Are you sure you want to delete this entry? This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => onDelete(entry.id),
                },
            ]
        );
    };

    const handleClose = () => {
        if (hasChanges) {
            Alert.alert(
                'Unsaved Changes',
                'You have unsaved changes. Discard them?',
                [
                    { text: 'Keep Editing', style: 'cancel' },
                    {
                        text: 'Discard',
                        style: 'destructive',
                        onPress: onClose,
                    },
                ]
            );
        } else {
            onClose();
        }
    };

    if (!entry) return null;

    const entryDate = new Date(entry.visited_at || entry.created_at);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={handleClose}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
            >
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                        <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <View style={styles.headerTitleContainer}>
                        <Text style={styles.headerTitle}>Edit Entry</Text>
                        <Text style={styles.headerSubtitle} numberOfLines={1}>
                            {restaurantName}
                        </Text>
                    </View>
                    <TouchableOpacity
                        onPress={handleSave}
                        style={styles.saveButton}
                        disabled={!hasChanges || isLoading}
                    >
                        <Text style={[
                            styles.saveText,
                            (!hasChanges || isLoading) && styles.saveTextDisabled
                        ]}>
                            Save
                        </Text>
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
                    {/* Entry Meta */}
                    <View style={styles.metaSection}>
                        <View style={styles.metaRow}>
                            <Ionicons name="calendar-outline" size={16} color="#666" />
                            <Text style={styles.metaText}>
                                {entryDate.toLocaleDateString('en-GB', {
                                    weekday: 'long',
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                })}
                            </Text>
                        </View>
                        {isFastReview && (
                            <View style={styles.fastBadge}>
                                <Text style={styles.fastBadgeText}>Quick Rating</Text>
                            </View>
                        )}
                    </View>

                    {/* Rating Section */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Rating</Text>
                        <View style={styles.ratingContainer}>
                            <StarRating
                                rating={rating}
                                onRatingChange={handleRatingChange}
                                size={40}
                            />
                        </View>
                    </View>

                    {/* Content Section */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Notes</Text>
                        <TextInput
                            style={styles.textInput}
                            multiline
                            placeholder="Add notes about your experience..."
                            placeholderTextColor="#999"
                            value={content}
                            onChangeText={handleContentChange}
                            textAlignVertical="top"
                        />
                    </View>

                    {/* Delete Button */}
                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={handleDelete}
                    >
                        <Ionicons name="trash-outline" size={20} color="#ff4444" />
                        <Text style={styles.deleteButtonText}>Delete Entry</Text>
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f8f8',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    closeButton: {
        padding: 8,
    },
    cancelText: {
        fontSize: 16,
        color: '#666',
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#666',
        marginTop: 2,
    },
    saveButton: {
        padding: 8,
    },
    saveText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#00897b',
    },
    saveTextDisabled: {
        color: '#ccc',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    metaSection: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    metaText: {
        fontSize: 14,
        color: '#666',
    },
    fastBadge: {
        backgroundColor: '#e3f2fd',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 4,
    },
    fastBadgeText: {
        fontSize: 12,
        color: '#1976d2',
        fontWeight: '500',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    ratingContainer: {
        alignItems: 'center',
        backgroundColor: 'white',
        padding: 20,
        borderRadius: 12,
    },
    textInput: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 120,
        color: '#333',
    },
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 16,
        marginTop: 24,
        marginBottom: 40,
    },
    deleteButtonText: {
        fontSize: 16,
        color: '#ff4444',
        fontWeight: '500',
    },
});
