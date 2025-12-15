import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VisitEntry } from '@/hooks/useVisitHistory';

interface EntriesModalProps {
    visible: boolean;
    onClose: () => void;
    restaurantName: string;
    entries: VisitEntry[];
    isLoading?: boolean;
    onEditEntry?: (entry: VisitEntry) => void;
}

export function EntriesModal({
    visible,
    onClose,
    restaurantName,
    entries,
    isLoading = false,
    onEditEntry,
}: EntriesModalProps) {

    const renderEntry = ({ item, index }: { item: VisitEntry; index: number }) => {
        const isFastReview = !item.content;
        const date = new Date(item.visited_at || item.created_at);

        return (
            <TouchableOpacity
                style={styles.entryCard}
                onPress={() => onEditEntry?.(item)}
                activeOpacity={0.7}
            >
                <View style={styles.entryHeader}>
                    <View style={styles.entryMeta}>
                        <Text style={styles.entryDate}>
                            {date.toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric'
                            })}
                        </Text>
                        {isFastReview && (
                            <View style={styles.fastBadge}>
                                <Text style={styles.fastBadgeText}>Quick Rating</Text>
                            </View>
                        )}
                    </View>
                    {item.rating !== null && (
                        <View style={styles.ratingBadge}>
                            <Ionicons name="star" size={14} color="#FFD700" />
                            <Text style={styles.ratingText}>{item.rating}</Text>
                        </View>
                    )}
                </View>

                {item.content && (
                    <Text style={styles.entryContent} numberOfLines={3}>
                        {item.content}
                    </Text>
                )}

                <View style={styles.entryFooter}>
                    <Text style={styles.entryNumber}>Entry #{entries.length - index}</Text>
                    <Ionicons name="chevron-forward" size={16} color="#ccc" />
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Ionicons name="close" size={24} color="#333" />
                    </TouchableOpacity>
                    <View style={styles.headerTitleContainer}>
                        <Text style={styles.headerTitle}>Your Entries</Text>
                        <Text style={styles.headerSubtitle} numberOfLines={1}>
                            {restaurantName}
                        </Text>
                    </View>
                    <View style={styles.placeholder} />
                </View>

                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color="#00897b" />
                    </View>
                ) : entries.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="document-text-outline" size={48} color="#ccc" />
                        <Text style={styles.emptyText}>No entries yet</Text>
                        <Text style={styles.emptySubtext}>
                            Rate this restaurant to create your first entry
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={entries}
                        keyExtractor={(item) => item.id}
                        renderItem={renderEntry}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                    />
                )}
            </View>
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
    placeholder: {
        width: 40,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#666',
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#999',
        marginTop: 8,
        textAlign: 'center',
    },
    listContent: {
        padding: 16,
    },
    entryCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    entryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    entryMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    entryDate: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    fastBadge: {
        backgroundColor: '#e3f2fd',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    fastBadgeText: {
        fontSize: 10,
        color: '#1976d2',
        fontWeight: '500',
    },
    ratingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#fff8e1',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    ratingText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    entryContent: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
        marginBottom: 8,
    },
    entryFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
    },
    entryNumber: {
        fontSize: 12,
        color: '#999',
    },
});
