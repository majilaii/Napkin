import React, { useState, useEffect } from 'react';
import { StyleSheet, SafeAreaView, View, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useProfile } from '@/hooks/user/useProfile';
import { useCreateEntry } from '@/hooks/entries/useCreateEntry';
import { useUpdateEntry } from '@/hooks/entries/useUpdateEntry';
import { useDeleteEntry } from '@/hooks/entries/useDeleteEntry';
import { useEntryHistory, useLatestEntry, Entry } from '@/hooks/entries/useEntryHistory';
import { useRestaurantStatus, useUpdateRestaurantStatus } from '@/hooks/places/useRestaurantStatus';
import { RestaurantDetails, RestaurantReview } from '@/components/restaurant';
import { LogModal } from '@/components/restaurant/LogModal';
import { EntriesModal } from '@/components/EntriesModal';
import { EditEntryModal } from '@/components/EditEntryModal';
import { SearchResult } from '@/hooks/places/useRestaurantSearch';

export default function RestaurantDetailScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const router = useRouter();
    const params = useLocalSearchParams<{
        id: string;
        name: string;
        address: string;
        latitude: string;
        longitude: string;
    }>();

    // Reconstruct restaurant object from params
    const restaurant: SearchResult = {
        id: params.id || '',
        name: params.name || '',
        formattedAddress: params.address || '',
        latitude: params.latitude ? parseFloat(params.latitude) : undefined,
        longitude: params.longitude ? parseFloat(params.longitude) : undefined,
    };

    // Auth
    const { user } = useAuth();
    const userId = user?.id ?? '';

    // Profile from React Query
    const { data: profile } = useProfile(userId || undefined);

    // Modal states
    const [modalVisible, setModalVisible] = useState(false);
    const [entriesModalVisible, setEntriesModalVisible] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
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

    // Mutations
    const createEntryMutation = useCreateEntry();
    const updateEntryMutation = useUpdateEntry();
    const deleteEntryMutation = useDeleteEntry();
    const updateStatusMutation = useUpdateRestaurantStatus();

    // Get latest entry for the selected restaurant
    const { data: latestEntry } = useLatestEntry(userId, restaurant.id, 'restaurant');
    const { data: entryHistory = [] } = useEntryHistory(userId, restaurant.id, 'restaurant');
    const { data: restaurantStatus } = useRestaurantStatus(userId, restaurant.id);

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

    const handleBack = () => {
        router.back();
    };

    const handleStatusChange = (updates: { been?: boolean; liked?: boolean; want_to_try?: boolean }) => {
        if (!restaurant || !userId) return;
        updateStatusMutation.mutate({
            userId,
            placeId: restaurant.id,
            updates,
        });
    };

    const handleModalAction = (action: string) => {
        if (action === 'addEntry' || action === 'review') {
            setModalVisible(false);
            setIsReviewing(true);
        } else if (action === 'viewEntries') {
            setModalVisible(false);
            setEntriesModalVisible(true);
        }
    };

    const handleRate = async (num: number) => {
        setRating(num);
        if (!restaurant || !userId) return;

        try {
            // Update if there's a quick rating (no content)
            // Create new if no entry exists OR latest has content (detailed review)
            if (latestEntry && !latestEntry.content) {
                await updateEntryMutation.mutateAsync({
                    entryId: latestEntry.id,
                    userId,
                    locationId: restaurant.id,
                    updates: { rating: num },
                });
            } else {
                await createEntryMutation.mutateAsync({
                    restaurant: {
                        external_id: restaurant.id,
                        name: restaurant.name,
                        location: { address: restaurant.formattedAddress || undefined },
                        latitude: restaurant.latitude,
                        longitude: restaurant.longitude,
                    },
                    rating: num,
                    userId,
                    locationId: restaurant.id,
                });
            }
        } catch (e) {
            console.error('Error saving rating:', e);
        }
    };

    const handleSubmitReview = async () => {
        if (!restaurant || !userId) return;

        try {
            await createEntryMutation.mutateAsync({
                restaurant: {
                    external_id: restaurant.id,
                    name: restaurant.name,
                    location: { address: restaurant.formattedAddress || undefined },
                    latitude: restaurant.latitude,
                    longitude: restaurant.longitude,
                },
                rating: rating,
                content: reviewText,
                value_profile: valueProfile,
                userId,
                locationId: restaurant.id,
            });

            Alert.alert('Success', 'Entry logged successfully!');
            setIsReviewing(false);
            setRating(0);
            setReviewText('');
        } catch (e) {
            console.error('Error submitting entry:', e);
            Alert.alert('Error', 'Failed to submit entry');
        }
    };

    const handleDeleteEntry = () => {
        if (latestEntry && userId && restaurant) {
            deleteEntryMutation.mutate({
                entryId: latestEntry.id,
                userId,
                locationId: restaurant.id,
            });
        }
    };

    if (!restaurant.id) {
        return null;
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {isReviewing ? (
                <RestaurantReview
                    theme={theme}
                    rating={rating}
                    setRating={setRating}
                    valueProfile={valueProfile}
                    reviewText={reviewText}
                    setReviewText={setReviewText}
                    onBack={() => setIsReviewing(false)}
                    onSubmit={handleSubmitReview}
                />
            ) : (
                <RestaurantDetails
                    theme={theme}
                    restaurant={restaurant}
                    onBack={handleBack}
                    onOpenModal={() => setModalVisible(true)}
                />
            )}

            {!isReviewing && (
                <LogModal
                    visible={modalVisible}
                    onClose={() => setModalVisible(false)}
                    restaurantName={restaurant.name}
                    onRate={handleRate}
                    onAction={handleModalAction}
                    onDeleteReview={handleDeleteEntry}
                    onStatusChange={handleStatusChange}
                    initialRating={latestEntry?.rating ?? 0}
                    initialToggles={{
                        been: restaurantStatus?.been ?? latestEntry != null,
                        like: restaurantStatus?.liked ?? false,
                        try: restaurantStatus?.want_to_try ?? false,
                    }}
                    hasReviewed={latestEntry?.content != null && latestEntry.content.length > 0}
                    visitCount={entryHistory.length}
                    lastVisitDate={entryHistory[0]?.visited_at}
                />
            )}

            <EntriesModal
                visible={entriesModalVisible}
                onClose={() => setEntriesModalVisible(false)}
                restaurantName={restaurant.name}
                entries={entryHistory}
                isLoading={false}
                onEditEntry={(entry) => {
                    setEntriesModalVisible(false);
                    setSelectedEntry(entry);
                    setTimeout(() => setEditModalVisible(true), 100);
                }}
            />

            {selectedEntry && (
                <EditEntryModal
                    visible={editModalVisible}
                    onClose={() => {
                        setEditModalVisible(false);
                        setSelectedEntry(null);
                        setTimeout(() => setEntriesModalVisible(true), 100);
                    }}
                    entry={selectedEntry}
                    restaurantName={restaurant.name}
                    onSave={async (entryId, updates) => {
                        try {
                            await updateEntryMutation.mutateAsync({
                                entryId,
                                userId,
                                locationId: restaurant.id,
                                updates,
                            });
                            setEditModalVisible(false);
                            setSelectedEntry(null);
                            Alert.alert('Success', 'Entry updated!');
                        } catch (e) {
                            Alert.alert('Error', 'Failed to update entry');
                        }
                    }}
                    onDelete={async (entryId) => {
                        try {
                            await deleteEntryMutation.mutateAsync({
                                entryId,
                                userId,
                                locationId: restaurant.id,
                            });
                            setEditModalVisible(false);
                            setSelectedEntry(null);
                            Alert.alert('Success', 'Entry deleted');
                        } catch (e) {
                            Alert.alert('Error', 'Failed to delete entry');
                        }
                    }}
                    isLoading={updateEntryMutation.isPending || deleteEntryMutation.isPending}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});
