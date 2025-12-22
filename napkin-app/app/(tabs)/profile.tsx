import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    ActivityIndicator,
    SafeAreaView,
    TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserEntries } from '@/hooks/entries/useUserEntries';
import { useProfile } from '@/hooks/user/useProfile';
import { Entry } from '@/lib/api';
import { StarRating } from '@/components/StarRating';
import { Top4Grid, Top4Restaurant } from '@/components/profile/Top4Grid';

export default function ProfileScreen() {
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];

    // Auth from context
    const { user } = useAuth();
    const userId = user?.id ?? null;

    // Server state from React Query
    const {
        data: entries = [],
        isLoading: entriesLoading,
        error: entriesError,
        refetch: refetchEntries
    } = useUserEntries(userId);

    const {
        data: profile,
        isLoading: profileLoading
    } = useProfile(userId);

    const displayName = profile?.display_name ?? 'User';
    const loading = entriesLoading || profileLoading;
    const error = entriesError?.message ?? null;

    // Top 4 state (local for now)
    const [top4Restaurants] = useState<(Top4Restaurant | null)[]>([]);
    const [isEditingTop4, setIsEditingTop4] = useState(false);

    // Pull to refresh
    const [refreshing, setRefreshing] = useState(false);
    const onRefresh = async () => {
        setRefreshing(true);
        await refetchEntries();
        setRefreshing(false);
    };

    // Format date
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    };

    // Top 4 handlers
    const handleTop4Press = (restaurant: Top4Restaurant) => {
        console.log('Navigate to restaurant:', restaurant.restaurant.name);
        // TODO: Navigate to restaurant profile
    };

    const handleTop4Add = (position: number) => {
        console.log('Add restaurant at position:', position);
        // TODO: Open search modal
    };

    const handleTop4Remove = (position: number) => {
        console.log('Remove restaurant at position:', position);
        // TODO: Remove from database
    };

    // Render a single entry card
    const renderEntryCard = (entry: Entry) => {
        const locationName = entry.restaurant?.name || entry.user_place?.name || 'Unknown Location';
        const locationCity = entry.restaurant?.city;
        const locationCountry = entry.restaurant?.country;

        return (
            <View key={entry.id} style={[styles.reviewCard, { backgroundColor: colors.background }]}>
                {/* Location name */}
                <Text style={[styles.restaurantName, { color: colors.text }]}>
                    {locationName}
                </Text>

                {/* Location */}
                {locationCity && (
                    <Text style={[styles.location, { color: colors.icon }]}>
                        {locationCity}{locationCountry ? `, ${locationCountry}` : ''}
                    </Text>
                )}

                {/* Dish description if present */}
                {entry.dish_description && (
                    <Text style={[styles.dishDescription, { color: colors.text }]}>
                        {entry.dish_description}
                    </Text>
                )}

                {/* Rating */}
                {entry.rating !== null && (
                    <View style={styles.ratingRow}>
                        <StarRating rating={entry.rating} size={20} onRatingChange={() => { }} />
                        <Text style={[styles.ratingText, { color: colors.text }]}>
                            {entry.rating.toFixed(1)}
                        </Text>
                    </View>
                )}

                {/* Entry content */}
                {entry.content && (
                    <Text style={[styles.reviewContent, { color: colors.text }]}>
                        {entry.content}
                    </Text>
                )}

                {/* Value profile breakdown */}
                {entry.value_profile && Object.keys(entry.value_profile).length > 0 && (
                    <View style={styles.valueProfileContainer}>
                        <Text style={[styles.sectionLabel, { color: colors.icon }]}>Value Profile</Text>
                        <View style={styles.valueProfileGrid}>
                            {Object.entries(entry.value_profile).map(([key, value]) => (
                                value !== undefined && (
                                    <View key={key} style={styles.valueItem}>
                                        <Text style={[styles.valueLabel, { color: colors.icon }]}>
                                            {key.charAt(0).toUpperCase() + key.slice(1)}
                                        </Text>
                                        <View style={styles.valueBarContainer}>
                                            <View
                                                style={[
                                                    styles.valueBar,
                                                    { width: `${((value as number) / 40) * 100}%`, backgroundColor: colors.tint },
                                                ]}
                                            />
                                        </View>
                                        <Text style={[styles.valueNumber, { color: colors.text }]}>{value}</Text>
                                    </View>
                                )
                            ))}
                        </View>
                    </View>
                )}

                {/* Date */}
                <Text style={[styles.dateText, { color: colors.icon }]}>
                    {formatDate(entry.visited_at)}
                </Text>
            </View>
        );
    };

    // Loading state
    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.centerContent}>
                    <ActivityIndicator size="large" color={colors.tint} />
                    <Text style={[styles.loadingText, { color: colors.icon }]}>Loading profile...</Text>
                </View>
            </SafeAreaView>
        );
    }

    // Error state (not logged in)
    if (error && !userId) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.centerContent}>
                    <Text style={[styles.errorText, { color: 'red' }]}>{error}</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.icon }]}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Profile</Text>
                <Text style={[styles.displayName, { color: colors.text }]}>{displayName}</Text>
                <Text style={[styles.reviewCount, { color: colors.icon }]}>
                    {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </Text>
            </View>

            {/* Reviews list */}
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
                }
            >
                {/* Top 4 Section */}
                <View style={styles.top4Section}>
                    <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>Top 4</Text>
                        <TouchableOpacity
                            onPress={() => setIsEditingTop4(!isEditingTop4)}
                            style={styles.editButton}
                        >
                            <Ionicons
                                name={isEditingTop4 ? 'checkmark' : 'pencil'}
                                size={20}
                                color={colors.tint}
                            />
                        </TouchableOpacity>
                    </View>
                    <Top4Grid
                        restaurants={top4Restaurants}
                        isEditing={isEditingTop4}
                        onPress={handleTop4Press}
                        onAdd={handleTop4Add}
                        onRemove={handleTop4Remove}
                    />
                </View>

                {/* Diary Section */}
                <View style={styles.diarySection}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Diary</Text>
                </View>

                {error && (
                    <Text style={[styles.errorText, { color: 'red' }]}>{error}</Text>
                )}

                {entries.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>No entries yet</Text>
                        <Text style={[styles.emptySubtitle, { color: colors.icon }]}>
                            Start logging your meals to see them here!
                        </Text>
                    </View>
                ) : (
                    entries.map(renderEntryCard)
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
    },
    errorText: {
        fontSize: 16,
        textAlign: 'center',
        padding: 20,
    },
    header: {
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    displayName: {
        fontSize: 20,
        fontWeight: '600',
    },
    reviewCount: {
        fontSize: 14,
        marginTop: 4,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    reviewCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    restaurantName: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 4,
    },
    location: {
        fontSize: 14,
        marginBottom: 8,
    },
    dishDescription: {
        fontSize: 15,
        fontStyle: 'italic',
        marginBottom: 8,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    ratingText: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    reviewContent: {
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 12,
    },
    valueProfileContainer: {
        marginTop: 8,
        marginBottom: 12,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    valueProfileGrid: {
        gap: 8,
    },
    valueItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    valueLabel: {
        width: 70,
        fontSize: 13,
    },
    valueBarContainer: {
        flex: 1,
        height: 8,
        backgroundColor: '#e0e0e0',
        borderRadius: 4,
        marginHorizontal: 8,
        overflow: 'hidden',
    },
    valueBar: {
        height: '100%',
        borderRadius: 4,
    },
    valueNumber: {
        width: 24,
        fontSize: 13,
        fontWeight: '500',
        textAlign: 'right',
    },
    dateText: {
        fontSize: 12,
        marginTop: 4,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: 40,
    },
    // Top 4 section styles
    top4Section: {
        marginBottom: 24,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '700',
    },
    editButton: {
        padding: 8,
    },
    diarySection: {
        marginBottom: 16,
    },
});
