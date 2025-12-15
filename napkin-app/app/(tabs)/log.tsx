import React, { useState, useEffect } from 'react';
import { StyleSheet, SafeAreaView, Alert } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { LogModal } from '@/components/LogModal';
import { EntriesModal } from '@/components/EntriesModal';
import { EditEntryModal } from '@/components/EditEntryModal';
import { useAuth } from '@/providers/AuthProvider';
import { useProfile } from '@/hooks/useProfile';
import { useRestaurantSearch, SearchResult } from '@/hooks/useRestaurantSearch';
import { useSubmitReview } from '@/hooks/useSubmitReview';
import { useExistingReview } from '@/hooks/useExistingReview';
import { useVisitHistory, VisitEntry } from '@/hooks/useVisitHistory';
import { useRestaurantStatus, useUpdateRestaurantStatus } from '@/hooks/useRestaurantStatus';
import { useDeleteReview } from '@/hooks/useDeleteReview';
import { useUpdateReview } from '@/hooks/useUpdateReview';
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
    const [entriesModalVisible, setEntriesModalVisible] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<VisitEntry | null>(null);
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

    // Update review mutation for editing entries
    const updateReviewMutation = useUpdateReview();

    // Update restaurant status mutation (for been/like/try toggles)
    const updateStatusMutation = useUpdateRestaurantStatus();

    // Get visit history for repeat dining
    const { data: visitHistory = [] } = useVisitHistory(
        userId,
        selectedRestaurant?.id
    );

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
        if (action === 'addEntry' || action === 'review') {
            // Close modal and go to detailed review entry
            setModalVisible(false);
            setIsReviewing(true);
        } else if (action === 'viewEntries') {
            // Open entries modal
            setModalVisible(false);
            setEntriesModalVisible(true);
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
                    // Pass existing review state (latest entry)
                    initialRating={existingReview?.rating ?? 0}
                    initialToggles={{
                        been: restaurantStatus?.been ?? existingReview != null,
                        like: restaurantStatus?.liked ?? false,
                        try: restaurantStatus?.want_to_try ?? false,
                    }}
                    hasReviewed={existingReview?.content != null && existingReview.content.length > 0}
                    // Repeat dining info
                    visitCount={visitHistory.length}
                    lastVisitDate={visitHistory[0]?.visited_at}
                />
            )}

            {/* Entries Modal */}
            {selectedRestaurant && (
                <EntriesModal
                    visible={entriesModalVisible}
                    onClose={() => setEntriesModalVisible(false)}
                    restaurantName={selectedRestaurant.name}
                    entries={visitHistory}
                    isLoading={false}
                    onEditEntry={(entry) => {
                        // Close EntriesModal first, then open EditEntryModal
                        setEntriesModalVisible(false);
                        setSelectedEntry(entry);
                        // Small delay to allow modal transition
                        setTimeout(() => setEditModalVisible(true), 100);
                    }}
                />
            )}

            {/* Edit Entry Modal */}
            {selectedRestaurant && selectedEntry && (
                <EditEntryModal
                    visible={editModalVisible}
                    onClose={() => {
                        setEditModalVisible(false);
                        setSelectedEntry(null);
                        // Go back to entries list
                        setTimeout(() => setEntriesModalVisible(true), 100);
                    }}
                    entry={selectedEntry}
                    restaurantName={selectedRestaurant.name}
                    onSave={async (entryId, updates) => {
                        try {
                            await updateReviewMutation.mutateAsync({
                                reviewId: entryId,
                                userId,
                                restaurantId: selectedRestaurant.id,
                                updates,
                            });
                            setEditModalVisible(false);
                            setSelectedEntry(null);
                            Alert.alert('Success', 'Entry updated!');
                        } catch (e) {
                            console.error('Error updating entry:', e);
                            Alert.alert('Error', 'Failed to update entry');
                        }
                    }}
                    onDelete={async (entryId) => {
                        try {
                            await deleteReviewMutation.mutateAsync({
                                reviewId: entryId,
                                userId,
                                restaurantId: selectedRestaurant.id,
                            });
                            setEditModalVisible(false);
                            setSelectedEntry(null);
                            Alert.alert('Success', 'Entry deleted');
                        } catch (e) {
                            console.error('Error deleting entry:', e);
                            Alert.alert('Error', 'Failed to delete entry');
                        }
                    }}
                    isLoading={updateReviewMutation.isPending || deleteReviewMutation.isPending}
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
