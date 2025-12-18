import React from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StarRating } from '@/components/StarRating';

interface ValueProfile {
    flavor: number;
    ambience: number;
    value: number;
    service: number;
}

interface RestaurantReviewProps {
    theme: {
        text: string;
        tint: string;
    };
    rating: number;
    setRating: (rating: number) => void;
    valueProfile: ValueProfile;
    reviewText: string;
    setReviewText: (text: string) => void;
    onBack: () => void;
    onSubmit: () => void;
}

export function RestaurantReview({
    theme,
    rating,
    setRating,
    valueProfile,
    reviewText,
    setReviewText,
    onBack,
    onSubmit,
}: RestaurantReviewProps) {
    return (
        <ScrollView contentContainerStyle={styles.scrollContent}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color={theme.tint} />
                <Text style={[styles.backText, { color: theme.tint }]}>Back to Details</Text>
            </TouchableOpacity>

            <Text style={[styles.header, { color: theme.text }]}>Write a Review</Text>

            <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <StarRating
                    rating={rating}
                    onRatingChange={setRating}
                    size={40}
                />
            </View>

            <View style={styles.section}>
                <Text style={[styles.label, { color: theme.text }]}>Value Profile Snapshot</Text>
                <Text style={styles.helperText}>Your current profile will be attached to this review.</Text>
                <View style={{ padding: 10, backgroundColor: theme.tint + '20', borderRadius: 8 }}>
                    <Text style={{ color: theme.text }}>
                        Flavor: {valueProfile.flavor}, Ambience: {valueProfile.ambience}, Value: {valueProfile.value}, Service: {valueProfile.service}
                    </Text>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={[styles.label, { color: theme.text }]}>Notes</Text>
                <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="How was it?"
                    multiline
                    numberOfLines={4}
                    value={reviewText}
                    onChangeText={setReviewText}
                />
            </View>

            <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: 'red' }]}
                onPress={onSubmit}
            >
                <Text style={styles.submitButtonText}>Submit Log</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scrollContent: {
        padding: 20,
        paddingBottom: 100,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    backText: {
        fontSize: 16,
        marginLeft: 4,
        fontWeight: '500',
    },
    header: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 24,
    },
    section: {
        marginBottom: 24,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
        color: '#333',
    },
    helperText: {
        fontSize: 14,
        color: '#666',
        marginBottom: 16,
    },
    input: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#f9f9f9',
    },
    textArea: {
        height: 100,
        textAlignVertical: 'top',
    },
    submitButton: {
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 12,
    },
    submitButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
});
