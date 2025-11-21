import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StarRating } from './StarRating';

interface LogModalProps {
    visible: boolean;
    onClose: () => void;
    restaurantName: string;
    onRate: (rating: number) => void;
    onAction: (action: 'been' | 'like' | 'try' | 'list' | 'review' | 'share') => void;
}

export function LogModal({
    visible,
    onClose,
    restaurantName,
    onRate,
    onAction,
}: LogModalProps) {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const [rating, setRating] = useState(0);
    const [toggles, setToggles] = useState({
        been: false,
        like: false,
        try: false,
    });

    const handleRating = (r: number) => {
        setRating(r);
        onRate(r);
    };

    const toggleOption = (key: keyof typeof toggles) => {
        setToggles((prev) => {
            const newState = { ...prev, [key]: !prev[key] };
            if (newState[key]) {
                onAction(key);
            }
            return newState;
        });
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.content}>
                            <View style={styles.header}>
                                <Text style={styles.title}>I tried...</Text>
                                <Text style={styles.restaurantName} numberOfLines={1}>
                                    {restaurantName}
                                </Text>
                                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                                    <Ionicons name="close" size={24} color="#666" />
                                </TouchableOpacity>
                            </View>

                            <View style={styles.ratingSection}>
                                <StarRating
                                    rating={rating}
                                    onRatingChange={handleRating}
                                    size={48}
                                />
                            </View>

                            <View style={styles.togglesRow}>
                                <TouchableOpacity
                                    style={[styles.toggleBtn, toggles.been && { backgroundColor: theme.tint }]}
                                    onPress={() => toggleOption('been')}
                                >
                                    <Ionicons
                                        name={toggles.been ? 'eye' : 'eye-outline'}
                                        size={24}
                                        color={toggles.been ? 'white' : '#666'}
                                    />
                                    <Text style={[styles.toggleLabel, toggles.been && { color: 'white' }]}>
                                        Been
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.toggleBtn, toggles.like && { backgroundColor: '#ff4081' }]}
                                    onPress={() => toggleOption('like')}
                                >
                                    <Ionicons
                                        name={toggles.like ? 'heart' : 'heart-outline'}
                                        size={24}
                                        color={toggles.like ? 'white' : '#666'}
                                    />
                                    <Text style={[styles.toggleLabel, toggles.like && { color: 'white' }]}>
                                        Like
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.toggleBtn, toggles.try && { backgroundColor: '#4caf50' }]}
                                    onPress={() => toggleOption('try')}
                                >
                                    <Ionicons
                                        name={toggles.try ? 'bookmark' : 'bookmark-outline'}
                                        size={24}
                                        color={toggles.try ? 'white' : '#666'}
                                    />
                                    <Text style={[styles.toggleLabel, toggles.try && { color: 'white' }]}>
                                        TryList+
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            <View style={styles.divider} />

                            <View style={styles.actionsList}>
                                <TouchableOpacity
                                    style={styles.actionRow}
                                    onPress={() => onAction('list')}
                                >
                                    <Ionicons name="list" size={24} color="#333" />
                                    <Text style={styles.actionText}>Add to lists...</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.actionRow}
                                    onPress={() => onAction('review')}
                                >
                                    <Ionicons name="create-outline" size={24} color="#333" />
                                    <Text style={styles.actionText}>Review or Log</Text>
                                    <Ionicons name="chevron-forward" size={20} color="#ccc" style={{ marginLeft: 'auto' }} />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.actionRow}
                                    onPress={() => onAction('share')}
                                >
                                    <Ionicons name="share-social-outline" size={24} color="#333" />
                                    <Text style={styles.actionText}>Share</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    content: {
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        paddingBottom: 40,
    },
    header: {
        alignItems: 'center',
        marginBottom: 20,
        position: 'relative',
    },
    title: {
        fontSize: 14,
        color: '#666',
        marginBottom: 4,
    },
    restaurantName: {
        fontSize: 20,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    closeButton: {
        position: 'absolute',
        right: 0,
        top: 0,
        padding: 4,
    },
    ratingSection: {
        alignItems: 'center',
        marginBottom: 24,
    },
    togglesRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 16,
        marginBottom: 24,
    },
    toggleBtn: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 70,
        height: 70,
        borderRadius: 35,
        backgroundColor: '#f0f0f0',
        gap: 4,
    },
    toggleLabel: {
        fontSize: 12,
        color: '#666',
        fontWeight: '500',
    },
    divider: {
        height: 1,
        backgroundColor: '#eee',
        marginBottom: 16,
    },
    actionsList: {
        gap: 8,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        gap: 12,
    },
    actionText: {
        fontSize: 16,
        color: '#333',
    },
});
