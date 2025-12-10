import React, { useState, useEffect } from 'react';
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
    onDeleteReview?: () => void; // Called when user undoes a review (turns off Been after having reviewed)
    onStatusChange?: (updates: { been?: boolean; liked?: boolean; want_to_try?: boolean }) => void; // Update status in backend
    // Initial state from existing review
    initialRating?: number;
    initialToggles?: {
        been?: boolean;
        like?: boolean;
        try?: boolean;
    };
    hasReviewed?: boolean; // If user has already written a detailed review
}

export function LogModal({
    visible,
    onClose,
    restaurantName,
    onRate,
    onAction,
    onDeleteReview,
    onStatusChange,
    initialRating = 0,
    initialToggles = {},
    hasReviewed = false,
}: LogModalProps) {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const [rating, setRating] = useState(initialRating);
    const [toggles, setToggles] = useState({
        been: initialToggles.been ?? false,
        like: initialToggles.like ?? false,
        try: initialToggles.try ?? false,
    });

    // Sync state when modal OPENS (not on every prop change to avoid flicker)
    const wasVisible = React.useRef(false);
    useEffect(() => {
        // Only sync when modal transitions from closed to open
        if (visible && wasVisible.current === false) {
            setRating(initialRating);
            setToggles({
                been: initialToggles.been ?? false,
                like: initialToggles.like ?? false,
                try: initialToggles.try ?? false,
            });
        }
        wasVisible.current = visible;
    }, [visible, initialRating, initialToggles.been, initialToggles.like, initialToggles.try]);

    const handleRating = (r: number) => {
        setRating(r);
        // Auto-toggle "Been" when user rates non-zero (they've been there!)
        if (r > 0 && !toggles.been) {
            setToggles((prev) => ({ ...prev, been: true }));
        }
    };

    const handleDismiss = () => {
        // Submit if user has rating OR has Been toggled on
        if (rating > 0 || toggles.been) {
            onRate(rating); // rating can be 0 (no rating / just visited)
            if (toggles.been) {
                onAction('been');
            }
        }
        // Reset state for next open
        setRating(0);
        setToggles({ been: false, like: false, try: false });
        onClose();
    };

    // Cancel: X button - close without submitting
    const handleCancel = () => {
        setRating(0);
        setToggles({ been: false, like: false, try: false });
        onClose();
    };

    const toggleOption = (key: keyof typeof toggles) => {
        const newValue = !toggles[key];

        // Special handling for "Been" toggle when turning OFF
        if (key === 'been' && toggles.been) {
            // Trying to turn OFF "Been"
            // Only allow if current rating is 0 (user cleared their stars)
            if (rating > 0) {
                // Can't toggle off Been if there's a current rating
                return;
            }

            // If "Been" was initially true (from backend), user is "undoing" their visit/review
            // Delete in backend but DON'T close modal - user may want to do more
            if (initialToggles.been && onDeleteReview) {
                onDeleteReview();
            }
        }

        // Update local state
        setToggles((prev) => ({ ...prev, [key]: newValue }));

        // Map toggle keys to backend field names and update backend status
        if (onStatusChange) {
            const fieldMap: Record<string, string> = {
                been: 'been',
                like: 'liked',
                try: 'want_to_try',
            };
            onStatusChange({ [fieldMap[key]]: newValue });
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={handleDismiss}
        >
            <TouchableWithoutFeedback onPress={handleDismiss}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.content}>
                            <View style={styles.header}>
                                <Text style={styles.title}>I tried...</Text>
                                <Text style={styles.restaurantName} numberOfLines={1}>
                                    {restaurantName}
                                </Text>
                                <TouchableOpacity onPress={handleCancel} style={styles.closeButton}>
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
                                    style={[
                                        styles.toggleBtn,
                                        toggles.been && { backgroundColor: '#00897b' },
                                    ]}
                                    onPress={() => toggleOption('been')}
                                    activeOpacity={toggles.been && rating > 0 ? 1 : 0.2}
                                >
                                    <Ionicons
                                        name={toggles.been ? (rating > 0 ? 'checkmark-circle' : 'eye') : 'eye-outline'}
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
                                    onPress={() => {
                                        onRate(rating);
                                        onAction('review');
                                    }}
                                >
                                    <Ionicons name="create-outline" size={24} color="#333" />
                                    <Text style={styles.actionText}>
                                        {hasReviewed ? 'Review Again' : 'Review or Log'}
                                    </Text>
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


                            <TouchableOpacity
                                style={[styles.doneButton, { backgroundColor: 'black' }]}
                                onPress={handleDismiss}
                            >
                                <Text style={styles.doneButtonText}>Done</Text>
                            </TouchableOpacity>

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
    doneButton: {
        marginTop: 24,
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    doneButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
});
