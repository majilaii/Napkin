import React, { useState, useEffect } from 'react';
import { StyleSheet, SafeAreaView, Alert } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { LogModal } from '@/components/LogModal';
import { EntriesModal } from '@/components/EntriesModal';
import { EditEntryModal } from '@/components/EditEntryModal';
import { LogTypeActionSheet } from '@/components/LogTypeActionSheet';
import { MealLogModal, MealLogData } from '@/components/MealLogModal';
import { useAuth } from '@/providers/AuthProvider';
import { useProfile } from '@/hooks/useProfile';
import { useRestaurantSearch, SearchResult } from '@/hooks/useRestaurantSearch';
import { useCreateEntry } from '@/hooks/useCreateEntry';
import { useUpdateEntry } from '@/hooks/useUpdateEntry';
import { useDeleteEntry } from '@/hooks/useDeleteEntry';
import { useEntryHistory, useLatestEntry, Entry } from '@/hooks/useEntryHistory';
import { useRestaurantStatus, useUpdateRestaurantStatus } from '@/hooks/useRestaurantStatus';
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
    const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
    const [isReviewing, setIsReviewing] = useState(false);

    // Action sheet and meal modal state
    const [actionSheetVisible, setActionSheetVisible] = useState(false);
    const [mealModalVisible, setMealModalVisible] = useState(false);

    // Review State
    const [reviewText, setReviewText] = useState('');
    const [rating, setRating] = useState(0);
    const [valueProfile, setValueProfile] = useState({
        flavor: 20,
        ambience: 20,
        value: 20,
        service: 20,
    });

    // Create entry mutation (for all entries)
    const createEntryMutation = useCreateEntry();

    // Update entry mutation
    const updateEntryMutation = useUpdateEntry();

    // Delete entry mutation
    const deleteEntryMutation = useDeleteEntry();

    // Get latest entry for the selected restaurant
    const { data: latestEntry } = useLatestEntry(
        userId,
        selectedRestaurant?.id,
        'restaurant'
    );

    // Get entry history for the selected restaurant
    const { data: entryHistory = [] } = useEntryHistory(
        userId,
        selectedRestaurant?.id,
        'restaurant'
    );

    // Get restaurant status (been, liked, want_to_try)
    const { data: restaurantStatus } = useRestaurantStatus(
        userId,
        selectedRestaurant?.id
    );

    // Update restaurant status mutation (for been/like/try toggles)
    const updateStatusMutation = useUpdateRestaurantStatus();

    // Handler to update status when toggled in modal
    const handleStatusChange = (updates: { been?: boolean; liked?: boolean; want_to_try?: boolean }) => {
        if (!selectedRestaurant || !userId) return;
        updateStatusMutation.mutate({
            userId,
            placeId: selectedRestaurant.id,
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

    // Handle log type selection from action sheet
    const handleLogTypeSelect = (type: 'meal' | 'restaurant' | 'table') => {
        if (type === 'meal') {
            setMealModalVisible(true);
        } else if (type === 'restaurant') {
            // Just close action sheet - user continues with search flow
            setActionSheetVisible(false);
        }
        // Table coming soon
    };

    // Handle meal submission
    const handleMealSubmit = async (data: MealLogData) => {
        if (!userId) return;

        try {
            await createEntryMutation.mutateAsync({
                user_place_id: data.user_place_id || undefined,
                rating: data.rating,
                content: data.content,
                dish_description: data.dish_description,
                cooked_by: data.cooked_by,
                visited_at: data.date.toISOString(),
                userId,
            });

            setMealModalVisible(false);
            Alert.alert('Success', 'Meal logged successfully!');
        } catch (e) {
            console.error('Error logging meal:', e);
            Alert.alert('Error', 'Failed to log meal');
        }
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

        try {
            // Quick rating: update existing entry if one exists, otherwise create new
            if (latestEntry) {
                // Update the existing entry's rating
                await updateEntryMutation.mutateAsync({
                    entryId: latestEntry.id,
                    userId,
                    locationId: selectedRestaurant.id,
                    updates: { rating: num },
                });
                console.log('Rating updated:', num);
            } else {
                // No existing entry, create a new quick rating entry
                await createEntryMutation.mutateAsync({
                    restaurant: {
                        external_id: selectedRestaurant.id,
                        name: selectedRestaurant.name,
                        location: {
                            address: selectedRestaurant.formattedAddress || undefined,
                        },
                        latitude: selectedRestaurant.latitude || undefined,
                        longitude: selectedRestaurant.longitude || undefined,
                    },
                    rating: num,
                    userId,
                    locationId: selectedRestaurant.id,
                });
                console.log('Rating saved (new entry):', num);
            }
        } catch (e) {
            console.error('Error saving rating:', e);
        }
    };

    const handleSubmitReview = async () => {
        if (!selectedRestaurant || !userId) return;

        try {
            await createEntryMutation.mutateAsync({
                restaurant: {
                    external_id: selectedRestaurant.id,
                    name: selectedRestaurant.name,
                    location: {
                        address: selectedRestaurant.formattedAddress || undefined,
                    },
                    latitude: selectedRestaurant.latitude || undefined,
                    longitude: selectedRestaurant.longitude || undefined,
                },
                rating: rating,
                content: reviewText,
                value_profile: valueProfile,
                userId,
                locationId: selectedRestaurant.id,
            });

            Alert.alert('Success', 'Entry logged successfully!');
            setIsReviewing(false);
            setSelectedRestaurant(null);
            setSearchQuery('');
            setRating(0);
            setReviewText('');
        } catch (e) {
            console.error('Error submitting entry:', e);
            Alert.alert('Error', 'Failed to submit entry');
        }
    };

    const handleDeleteEntry = () => {
        if (latestEntry && userId && selectedRestaurant) {
            deleteEntryMutation.mutate({
                entryId: latestEntry.id,
                userId,
                locationId: selectedRestaurant.id,
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
                    onDeleteReview={handleDeleteEntry}
                    onStatusChange={handleStatusChange}
                    // Pass existing entry state (latest entry)
                    initialRating={latestEntry?.rating ?? 0}
                    initialToggles={{
                        been: restaurantStatus?.been ?? latestEntry != null,
                        like: restaurantStatus?.liked ?? false,
                        try: restaurantStatus?.want_to_try ?? false,
                    }}
                    hasReviewed={latestEntry?.content != null && latestEntry.content.length > 0}
                    // Repeat dining info
                    visitCount={entryHistory.length}
                    lastVisitDate={entryHistory[0]?.visited_at}
                />
            )}

            {/* Entries Modal */}
            {selectedRestaurant && (
                <EntriesModal
                    visible={entriesModalVisible}
                    onClose={() => setEntriesModalVisible(false)}
                    restaurantName={selectedRestaurant.name}
                    entries={entryHistory}
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
                            await updateEntryMutation.mutateAsync({
                                entryId,
                                userId,
                                locationId: selectedRestaurant.id,
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
                            await deleteEntryMutation.mutateAsync({
                                entryId,
                                userId,
                                locationId: selectedRestaurant.id,
                            });
                            setEditModalVisible(false);
                            setSelectedEntry(null);
                            Alert.alert('Success', 'Entry deleted');
                        } catch (e) {
                            console.error('Error deleting entry:', e);
                            Alert.alert('Error', 'Failed to delete entry');
                        }
                    }}
                    isLoading={updateEntryMutation.isPending || deleteEntryMutation.isPending}
                />
            )}

            {/* Log Type Action Sheet */}
            <LogTypeActionSheet
                visible={actionSheetVisible}
                onClose={() => setActionSheetVisible(false)}
                onSelect={handleLogTypeSelect}
            />

            {/* Meal Log Modal */}
            <MealLogModal
                visible={mealModalVisible}
                onClose={() => setMealModalVisible(false)}
                onSubmit={handleMealSubmit}
                isSubmitting={createEntryMutation.isPending}
                userId={userId}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
});
