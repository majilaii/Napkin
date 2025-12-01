import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    SafeAreaView,
    Alert,
    useColorScheme as useRNColorScheme
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { LogModal } from '@/components/LogModal';
import { StarRating } from '@/components/StarRating';

type Restaurant = {
    id: string;
    name: string;
    formattedAddress: string;
    latitude: number;
    longitude: number;
};

export default function LogScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    // State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Restaurant[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [modalVisible, setModalVisible] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);

    // Review State
    const [reviewText, setReviewText] = useState('');
    const [rating, setRating] = useState(0);
    const [valueProfile, setValueProfile] = useState({
        flavor: 20,
        ambience: 20,
        value: 20,
        location: 20,
        service: 20,
    });

    useEffect(() => {
        fetchUserProfile();
    }, []);

    const fetchUserProfile = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('user-profile', {
                method: 'GET',
            });
            if (error) throw error;
            if (data.data) {
                setValueProfile({
                    flavor: data.data.flavor ?? 20,
                    ambience: data.data.ambience ?? 20,
                    value: data.data.value ?? 20,
                    location: data.data.location ?? 20,
                    service: data.data.service ?? 20,
                });
            }
        } catch (e) {
            console.error('Error fetching profile:', e);
        }
    };

    const handleSearch = async (text: string) => {
        setSearchQuery(text);
        if (text.length < 3) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const { data, error } = await supabase.functions.invoke('foursquare-search', {
                body: { query: text, limit: 5 },
            });

            if (error) throw error;
            setSearchResults(data.data || []);
        } catch (error) {
            console.error('Search error:', error);
            // Fallback mock data for testing if API fails or is not set up
            if (text.toLowerCase().includes('sushi')) {
                setSearchResults([
                    {
                        id: '1',
                        name: 'Sushi Nakazawa',
                        formattedAddress: '23 Commerce St, New York, NY 10014',
                        latitude: 40.731,
                        longitude: -74.005,
                    },
                    {
                        id: '2',
                        name: 'Sugarfish',
                        formattedAddress: '33 E 20th St, New York, NY 10003',
                        latitude: 40.738,
                        longitude: -73.989,
                    }
                ]);
            }
        } finally {
            setIsSearching(false);
        }
    };

    const handleSelectRestaurant = (restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
        setSearchResults([]);
        setSearchQuery('');
    };

    const handleBackToSearch = () => {
        setSelectedRestaurant(null);
        setSearchQuery('');
        setIsReviewing(false);
    };

    const handleBackToDetails = () => {
        setIsReviewing(false);
    };

    const handleModalAction = (action: string) => {
        console.log('Action:', action);
        if (action === 'review') {
            setModalVisible(false);
            setIsReviewing(true);
        } else {
            Alert.alert('Action', `Selected: ${action}`);
        }
    };

    const handleRate = async (r: number) => {
        setRating(r);
        if (!selectedRestaurant) return;

        // Fast review (rating only)
        try {
            const payload = {
                restaurant: {
                    foursquare_id: selectedRestaurant.id,
                    name: selectedRestaurant.name,
                    location: {
                        address: selectedRestaurant.formattedAddress,
                    },
                    latitude: selectedRestaurant.latitude,
                    longitude: selectedRestaurant.longitude,
                },
                rating: r,
            };
            console.log('Sending fast review payload:', JSON.stringify(payload));
            const { error } = await supabase.functions.invoke('review', {
                body: payload
            });
            if (error) throw error;
            console.log('Rating saved:', r);
        } catch (e) {
            console.error('Error saving rating:', e);
        }
    };

    const handleSubmitReview = async () => {
        if (!selectedRestaurant) return;

        if (rating === 0) {
            Alert.alert('Rating Required', 'Please provide a rating of at least 0.5 stars.');
            return;
        }

        try {
            const payload = {
                restaurant: {
                    foursquare_id: selectedRestaurant.id,
                    name: selectedRestaurant.name,
                    location: {
                        address: selectedRestaurant.formattedAddress,
                    },
                    latitude: selectedRestaurant.latitude,
                    longitude: selectedRestaurant.longitude,
                },
                rating: rating,
                content: reviewText,
                value_profile: valueProfile,
            };
            console.log('Submitting full review payload:', JSON.stringify(payload));

            const { error } = await supabase.functions.invoke('review', {
                body: payload
            });

            if (error) throw error;

            // Also update user's value profile preferences if they changed?
            // For now, we just save the review. 
            // Optionally we could auto-update the user's default profile based on this review, 
            // but usually the profile is "what I care about" (global) vs "how this place was" (specific).
            // The schema has `value_profile` in `reviews` table, so it's specific to the review.
            // But we also have `user-profile` endpoint to save global preferences.
            // Let's save the global preferences too if the user adjusted them here?
            // Or maybe we should have a separate "Save Profile" button?
            // For now, let's just save the review.

            Alert.alert('Success', 'Review logged successfully!');
            setIsReviewing(false);
            setSelectedRestaurant(null);
            setSearchQuery('');
            setRating(0);
            setReviewText('');
        } catch (e) {
            console.error('Error submitting review:', e);
            Alert.alert('Error', 'Failed to submit review');
        }
    };

    // Render Search View
    const renderSearchView = () => (
        <View style={styles.searchContent}>
            <Text style={[styles.header, { color: theme.text }]}>Find a place</Text>
            <View style={styles.searchContainer}>
                <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search restaurants..."
                    value={searchQuery}
                    onChangeText={handleSearch}
                    autoFocus
                />
                {isSearching && <ActivityIndicator size="small" color={theme.tint} />}
            </View>

            <ScrollView style={styles.resultsList}>
                {searchResults.map((item) => (
                    <TouchableOpacity
                        key={item.id}
                        style={styles.resultItem}
                        onPress={() => handleSelectRestaurant(item)}
                    >
                        <View style={styles.resultIcon}>
                            <Ionicons name="restaurant" size={24} color="#666" />
                        </View>
                        <View style={styles.resultInfo}>
                            <Text style={[styles.resultName, { color: theme.text }]}>{item.name}</Text>
                            <Text style={styles.resultAddress}>{item.formattedAddress}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color="#ccc" />
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );

    // Render Details View
    const renderDetailsView = () => {
        if (!selectedRestaurant) return null;

        return (
            <ScrollView contentContainerStyle={styles.detailsContent}>
                <TouchableOpacity onPress={handleBackToSearch} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.tint} />
                    <Text style={[styles.backText, { color: theme.tint }]}>Search</Text>
                </TouchableOpacity>

                <View style={styles.placeholderImage}>
                    <Ionicons name="image-outline" size={64} color="black" />
                </View>

                <View style={styles.restaurantHeader}>
                    <Text style={[styles.detailsName, { color: theme.text }]}>{selectedRestaurant.name}</Text>
                    <Text style={styles.detailsAddress}>{selectedRestaurant.formattedAddress}</Text>
                </View>

                <View style={styles.actionsContainer}>
                    <TouchableOpacity
                        style={[styles.logButton, { backgroundColor: "grey" }]}
                        onPress={() => setModalVisible(true)}
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
    };

    // Render Review View
    const renderReviewView = () => (
        <ScrollView contentContainerStyle={styles.scrollContent}>
            <TouchableOpacity onPress={handleBackToDetails} style={styles.backButton}>
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
                onPress={handleSubmitReview}
            >
                <Text style={styles.submitButtonText}>Submit Log</Text>
            </TouchableOpacity>
        </ScrollView >
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {!selectedRestaurant
                ? renderSearchView()
                : isReviewing
                    ? renderReviewView()
                    : renderDetailsView()
            }

            {selectedRestaurant && !isReviewing && (
                <LogModal
                    visible={modalVisible}
                    onClose={() => setModalVisible(false)}
                    restaurantName={selectedRestaurant.name}
                    onRate={handleRate}
                    onAction={handleModalAction}
                />
            )}
        </SafeAreaView>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 100,
    },
    searchContent: {
        flex: 1,
        padding: 20,
    },
    header: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 24,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 50,
        backgroundColor: '#f9f9f9',
        marginBottom: 20,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        height: '100%',
        fontSize: 16,
    },
    resultsList: {
        flex: 1,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    resultIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f0f0f0',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    resultInfo: {
        flex: 1,
    },
    resultName: {
        fontWeight: '600',
        fontSize: 16,
        marginBottom: 4,
    },
    resultAddress: {
        color: '#666',
        fontSize: 14,
    },
    // Details Styles
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
    // Review Styles
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
