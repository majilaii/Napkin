import { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { useProfile } from '@/hooks/user/useProfile';
import { useCreateEntry } from '@/hooks/entries/useCreateEntry';
import { useUpdateEntry } from '@/hooks/entries/useUpdateEntry';
import { useDeleteEntry } from '@/hooks/entries/useDeleteEntry';
import { useEntryHistory, useLatestEntry, Entry } from '@/hooks/entries/useEntryHistory';
import { useRestaurantStatus, useUpdateRestaurantStatus } from '@/hooks/places/useRestaurantStatus';
import { SearchResult } from '@/hooks/places/useRestaurantSearch';

interface ValueProfile {
    flavor: number;
    ambience: number;
    value: number;
    service: number;
}

/**
 * Custom hook that orchestrates all restaurant detail screen logic.
 * Bundles state, queries, mutations, and handlers into a single interface.
 */
export function useRestaurantDetail(restaurant: SearchResult, userId: string) {
    // ========== STATE ==========
    const [modalVisible, setModalVisible] = useState(false);
    const [entriesModalVisible, setEntriesModalVisible] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
    const [isReviewing, setIsReviewing] = useState(false);

    // Review state
    const [reviewText, setReviewText] = useState('');
    const [rating, setRating] = useState(0);
    const [valueProfile, setValueProfile] = useState<ValueProfile>({
        flavor: 20,
        ambience: 20,
        value: 20,
        service: 20,
    });

    // ========== QUERIES ==========
    const { data: profile } = useProfile(userId || undefined);
    const { data: latestEntry } = useLatestEntry(userId, restaurant.id, 'restaurant');
    const { data: entryHistory = [] } = useEntryHistory(userId, restaurant.id, 'restaurant');
    const { data: restaurantStatus } = useRestaurantStatus(userId, restaurant.id);

    // ========== MUTATIONS ==========
    const createEntryMutation = useCreateEntry();
    const updateEntryMutation = useUpdateEntry();
    const deleteEntryMutation = useDeleteEntry();
    const updateStatusMutation = useUpdateRestaurantStatus();

    // ========== EFFECTS ==========
    // Sync value profile from user profile
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

    // ========== HANDLERS ==========
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

    const handleEditEntry = (entry: Entry) => {
        setEntriesModalVisible(false);
        setSelectedEntry(entry);
        setTimeout(() => setEditModalVisible(true), 100);
    };

    const handleSaveEntry = async (entryId: string, updates: Partial<Entry>) => {
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
    };

    const handleDeleteEntryById = async (entryId: string) => {
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
    };

    const handleCloseEditModal = () => {
        setEditModalVisible(false);
        setSelectedEntry(null);
        setTimeout(() => setEntriesModalVisible(true), 100);
    };

    // ========== RETURN ==========
    return {
        // Modal state
        modalVisible,
        setModalVisible,
        entriesModalVisible,
        setEntriesModalVisible,
        editModalVisible,
        selectedEntry,
        isReviewing,
        setIsReviewing,

        // Review state
        rating,
        setRating,
        reviewText,
        setReviewText,
        valueProfile,

        // Data
        latestEntry,
        entryHistory,
        restaurantStatus,

        // Computed
        initialRating: latestEntry?.rating ?? 0,
        initialToggles: {
            been: restaurantStatus?.been ?? latestEntry != null,
            like: restaurantStatus?.liked ?? false,
            try: restaurantStatus?.want_to_try ?? false,
        },
        hasReviewed: latestEntry?.content != null && latestEntry.content.length > 0,
        visitCount: entryHistory.length,
        lastVisitDate: entryHistory[0]?.visited_at,

        // Loading states
        isSubmitting: createEntryMutation.isPending || updateEntryMutation.isPending,
        isDeleting: deleteEntryMutation.isPending,

        // Handlers
        handleStatusChange,
        handleModalAction,
        handleRate,
        handleSubmitReview,
        handleDeleteEntry,
        handleEditEntry,
        handleSaveEntry,
        handleDeleteEntryById,
        handleCloseEditModal,
    };
}
