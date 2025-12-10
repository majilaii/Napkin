import React, { useState, useEffect } from 'react';
import { StyleSheet, SafeAreaView, Alert } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { LogModal } from '@/components/LogModal';
import { useAuth } from '@/providers/AuthProvider';
import { useProfile } from '@/hooks/useProfile';
import { useRestaurantSearch, SearchResult } from '@/hooks/useRestaurantSearch';
import { useSubmitReview } from '@/hooks/useSubmitReview';
import { useExistingReview } from '@/hooks/useExistingReview';
import { useRestaurantStatus, useUpdateRestaurantStatus } from '@/hooks/useRestaurantStatus';
import { useDeleteReview } from '@/hooks/useDeleteReview';
import { SearchView, DetailsView, ReviewView } from '@/components/log';

type Restaurant = SearchResult;

export default function LogScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    // Auth
    const { user } = useAuth();
    const userId = user?.id ?? '';

    // Profile from React Query
    const { data: profile } = useProfile(userId || undefined);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const { data: searchResults = [], isLoading: isSearching } = useRestaurantSearch(searchQuery);

    // Selected restaurant / review flow
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
        service: 20,
    });

    // Submit review mutation
    const submitReviewMutation = useSubmitReview();

    // Get existing review for the selected restaurant (to show initial state in modal)
    const { data: existingReview } = useExistingReview(
        userId,
        selectedRestaurant?.id // foursquare_id
    );

    // Get restaurant status (been, liked, want_to_try)
    const { data: restaurantStatus } = useRestaurantStatus(
        userId,
        selectedRestaurant?.id // foursquare_id
    );

    // Delete review mutation
    const deleteReviewMutation = useDeleteReview();

    // Update restaurant status mutation (for been/like/try toggles)
    const updateStatusMutation = useUpdateRestaurantStatus();

    // Handler to update status when toggled in modal
    const handleStatusChange = (updates: { been?: boolean; liked?: boolean; want_to_try?: boolean }) => {
        if (!selectedRestaurant || !userId) return;
        updateStatusMutation.mutate({
            userId,
            foursquareId: selectedRestaurant.id,
            updates,
        });
    };

    // Update value profile when profile loads
    useEffect(() => {
        if (profile) {
            setValueProfile({
                flavor: profile.flavor ?? 20,
                ambience: profile.ambience ?? 20,
                value: profile.value ?? 20,
                service: profile.service ?? 20,
            });
        }
    }, [profile]);

    const handleSelectRestaurant = (restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
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
            console.log('Action', `Selected: ${action}`);
        }
    };

    const handleRate = async (num: number) => {
        setRating(num);
        if (!selectedRestaurant || !userId) return;

        // Fast review (rating only) using mutation
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
            rating: num,
        };

        try {
            await submitReviewMutation.mutateAsync({
                payload,
                userId,
                restaurantId: selectedRestaurant.id,
            });
            console.log('Rating saved:', num);
        } catch (e) {
            console.error('Error saving rating:', e);
        }
    };

    const handleSubmitReview = async () => {
        if (!selectedRestaurant || !userId) return;

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

        try {
            await submitReviewMutation.mutateAsync({
                payload,
                userId,
                restaurantId: selectedRestaurant.id,
            });

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

    const handleDeleteReview = () => {
        if (existingReview && userId && selectedRestaurant) {
            deleteReviewMutation.mutate({
                reviewId: existingReview.id,
                userId,
                restaurantId: selectedRestaurant.id,
            });
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {!selectedRestaurant ? (
                <SearchView
                    theme={theme}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isSearching={isSearching}
                    searchResults={searchResults}
                    onSelectRestaurant={handleSelectRestaurant}
                />
            ) : isReviewing ? (
                <ReviewView
                    theme={theme}
                    rating={rating}
                    setRating={setRating}
                    valueProfile={valueProfile}
                    reviewText={reviewText}
                    setReviewText={setReviewText}
                    onBack={handleBackToDetails}
                    onSubmit={handleSubmitReview}
                />
            ) : (
                <DetailsView
                    theme={theme}
                    restaurant={selectedRestaurant}
                    onBack={handleBackToSearch}
                    onOpenModal={() => setModalVisible(true)}
                />
            )}

            {selectedRestaurant && !isReviewing && (
                <LogModal
                    visible={modalVisible}
                    onClose={() => setModalVisible(false)}
                    restaurantName={selectedRestaurant.name}
                    onRate={handleRate}
                    onAction={handleModalAction}
                    onDeleteReview={handleDeleteReview}
                    onStatusChange={handleStatusChange}
                    // Pass existing review state
                    initialRating={existingReview?.rating ?? 0}
                    initialToggles={{
                        been: restaurantStatus?.been ?? existingReview != null,
                        like: restaurantStatus?.liked ?? false,
                        try: restaurantStatus?.want_to_try ?? false,
                    }}
                    hasReviewed={existingReview?.content != null && existingReview.content.length > 0}
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
});
