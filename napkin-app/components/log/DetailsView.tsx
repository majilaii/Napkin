import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SearchResult } from '@/hooks/useRestaurantSearch';

interface DetailsViewProps {
    theme: {
        text: string;
        tint: string;
    };
    restaurant: SearchResult;
    onBack: () => void;
    onOpenModal: () => void;
}

export function DetailsView({
    theme,
    restaurant,
    onBack,
    onOpenModal,
}: DetailsViewProps) {
    return (
        <ScrollView contentContainerStyle={styles.detailsContent}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color={theme.tint} />
                <Text style={[styles.backText, { color: theme.tint }]}>Search</Text>
            </TouchableOpacity>

            <View style={styles.placeholderImage}>
                <Ionicons name="image-outline" size={64} color="black" />
            </View>

            <View style={styles.restaurantHeader}>
                <Text style={[styles.detailsName, { color: theme.text }]}>{restaurant.name}</Text>
                <Text style={styles.detailsAddress}>{restaurant.formattedAddress}</Text>
            </View>

            <View style={styles.actionsContainer}>
                <TouchableOpacity
                    style={[styles.logButton, { backgroundColor: "grey" }]}
                    onPress={onOpenModal}
                >
                    <Text style={styles.logButtonText}>Log or Rate</Text>
                    <Ionicons name="add-circle-outline" size={24} color="white" />
                </TouchableOpacity>
            </View>

            <View style={styles.infoSection}>
                <Text style={styles.sectionTitle}>Information</Text>
                <View style={styles.infoRow}>
                    <Ionicons name="time-outline" size={20} color="#666" />
                    <Text style={styles.infoText}>Open today: 5:00 PM - 10:00 PM</Text>
                </View>
                <View style={styles.infoRow}>
                    <Ionicons name="call-outline" size={20} color="#666" />
                    <Text style={styles.infoText}>+1 (212) 555-0123</Text>
                </View>
                <View style={styles.infoRow}>
                    <Ionicons name="globe-outline" size={20} color="#666" />
                    <Text style={styles.infoText}>Website</Text>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    detailsContent: {
        paddingBottom: 40,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginBottom: 8,
    },
    backText: {
        fontSize: 16,
        marginLeft: 4,
        fontWeight: '500',
    },
    placeholderImage: {
        height: 200,
        backgroundColor: '#f0f0f0',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    restaurantHeader: {
        paddingHorizontal: 20,
        marginBottom: 24,
    },
    detailsName: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    detailsAddress: {
        fontSize: 16,
        color: '#666',
    },
    actionsContainer: {
        paddingHorizontal: 20,
        marginBottom: 32,
    },
    logButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        borderRadius: 30,
        gap: 8,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    logButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    infoSection: {
        paddingHorizontal: 20,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 16,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        gap: 12,
    },
    infoText: {
        fontSize: 16,
        color: '#333',
    },
});
