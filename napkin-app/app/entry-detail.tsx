/**
 * Entry Detail — full view of a single entry (solo share or round take).
 * Shows restaurant, overall rating, secondary ratings, notes, dish, date.
 *
 * TICKET-019 additions:
 *  - Own-entry inline edit affordances: tappable rating, "Add note/dish/photos/breakdown" rows
 *  - Edit gates on viewer?.id === entry.user_id (other members remain read-only)
 *  - Mutations via useUpdateEntry (direct supabase-js PATCH, no feed re-sort)
 *  - Photo add/remove via useAddEntryPhoto / useRemoveEntryPhoto
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Image,
    Dimensions,
    TextInput,
    Alert,
    ActionSheetIOS,
    Platform,
    KeyboardAvoidingView,
    Modal,
    findNodeHandle,
    UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { StarRating } from '@/components/StarRating';
import { MultiPhotoRow } from '@/components/MultiPhotoRow';
import { useRoundContext } from '@/hooks/tables/useTableNight';
import { useUserRestaurantHistory } from '@/hooks/restaurants/useRestaurantHistory';
import { useSupper } from '@/hooks/suppers';
import { SupperTable } from '@/components/suppers';
import { FRIEND_TEST } from '@/constants/flags';
import { PreviouslyHereBanner } from '@/components/restaurants';
// (PullQuote / GiantRatingNumeral retired here — the writing is now rendered
//  inline as the hero and the rating as a small amber chip.)
import { useAuth } from '@/providers/AuthProvider';
import { usePostInteractions, usePostInteractionsRealtime } from '@/hooks/posts';
import { CommentRow } from '@/components/posts/CommentRow';
import { useUpdateEntry } from '@/hooks/entries/useUpdateEntry';
import { useAddEntryPhoto, useRemoveEntryPhoto } from '@/hooks/entries/useEntryPhotoMutations';
import { useTables } from '@/hooks/tables/useTables';
import { CompanionPickerSheet } from '@/components/logging';
import { CompanionChipsRow } from '@/components/logging';
import { formatCompanions } from '@/lib/companions';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';
import {
    useAddComment,
    useDiscardFailedComment,
    useToggleReaction,
    effectiveCommentCount,
} from '@/hooks/posts/usePostInteractions';
import { ReactionPicker } from '@/components/feed/ReactionPicker';
import { ReactorsSheet } from '@/components/posts/ReactorsSheet';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Palette = typeof Colors.light;

const CATEGORY_LABELS = [
    { key: 'vibe_rating' as const, label: 'Vibe' },
    { key: 'flavor_rating' as const, label: 'Flavor' },
    { key: 'service_rating' as const, label: 'Service' },
    { key: 'value_rating' as const, label: 'Value' },
];

interface EntryDetail {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    /** TICKET-075: author's Letterboxd-style like (read-only here). */
    liked: boolean;
    visited_at: string;
    created_at: string;
    allow_public_replies: boolean;
    table_id: string | null;
    table_night_id: string | null;
    /** TICKET-082: group key — non-null when this entry is part of a Supper. */
    supper_id: string | null;
    visibility: string;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    photo_url: string | null;
    companions?: { user_id: string; display_name: string }[];
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    profiles: {
        display_name: string;
    };
}

// ── Photo types (for flesh-out editing) ─────────────────────────────────────

interface PhotoSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    error: string | null;
    uploadGen: number;
}

const MAX_PHOTOS = 6;

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchEntry(entryId?: string, nightId?: string, userId?: string): Promise<EntryDetail> {
    let entry: any;

    if (entryId) {
        // Direct entry lookup.
        // TICKET-043: table_id is revoked from authenticated role (column-level grant).
        // We omit it from the select and fetch the primary table_id separately via
        // entry_tables (which authenticated can read under RLS: author OR table member).
        const { data, error } = await supabase
            .from('entries')
            .select(`
                id,
                user_id,
                restaurant_id,
                rating,
                content,
                dish_description,
                liked,
                visited_at,
                created_at,
                table_night_id,
                supper_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
                photo_url,
                restaurants (
                    id,
                    name,
                    address,
                    city,
                    photo_url
                )
            `)
            .eq('id', entryId)
            .single();

        if (error) throw error;
        entry = data;
    } else if (nightId && userId) {
        // Lookup by table_night_id + user_id (for round participants).
        // TICKET-043: same table_id omission — fetched separately below.
        const { data, error } = await supabase
            .from('entries')
            .select(`
                id,
                user_id,
                restaurant_id,
                rating,
                content,
                dish_description,
                liked,
                visited_at,
                created_at,
                table_night_id,
                supper_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
                photo_url,
                restaurants (
                    id,
                    name,
                    address,
                    city,
                    photo_url
                )
            `)
            .eq('table_night_id', nightId)
            .eq('user_id', userId)
            .single();

        if (error) throw error;
        entry = data;
    } else {
        throw new Error('Either entryId or nightId+userId required');
    }

    // TICKET-043: fetch the primary table_id from entry_tables (column-level revoke
    // prevents reading entries.table_id directly as authenticated). The author sees all
    // their own entry_tables rows; a round-participant viewer sees rows for the Table
    // they share with the author. We take the first row ordered by posted_at DESC as
    // the "primary" table for UI routing (navigation to member profiles, comment scope).
    const { data: etRow } = await supabase
        .from('entry_tables')
        .select('table_id')
        .eq('entry_id', entry.id)
        .order('posted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    const resolvedTableId: string | null = etRow?.table_id ?? null;

    // Fetch profile (includes allow_public_replies for reply-gate in public view)
    const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, allow_public_replies')
        .eq('user_id', entry.user_id)
        .single();

    // Fetch companions (tagged users)
    const { data: companionRows } = await supabase
        .from('entry_companions')
        .select('user_id, profiles:user_id(display_name)')
        .eq('entry_id', entry.id);

    const companions = ((companionRows ?? []) as any[]).map((c: any) => {
        const profileNode = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
        return {
            user_id: c.user_id,
            display_name: profileNode?.display_name ?? 'User',
        };
    });

    // PostgREST returns FK-joined restaurants as object (with .single()),
    // but TS may infer it as array. Normalize:
    const restaurant = Array.isArray(entry.restaurants)
        ? entry.restaurants[0] ?? null
        : entry.restaurants ?? null;

    return {
        ...entry,
        // TICKET-043: table_id sourced from entry_tables (revoked on entries directly).
        table_id: resolvedTableId,
        restaurants: restaurant,
        companions,
        profiles: profile ?? { display_name: 'User', allow_public_replies: false },
        allow_public_replies: (profile as any)?.allow_public_replies ?? false,
    } as unknown as EntryDetail;
}

function getRelativeDate(dateString: string): { relative: string; full: string } {
    const date = new Date(dateString);
    const full = date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    if (isNaN(date.getTime())) return { relative: full, full };

    const nowMs = Date.now();
    const diffMs = nowMs - date.getTime();
    if (diffMs < 0) return { relative: full, full };
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHrs = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHrs / 24);

    let relative: string;
    if (diffSec < 60) {
        relative = 'Just now';
    } else if (diffMin < 60) {
        relative = `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    } else if (diffHrs < 24) {
        relative = `${diffHrs} hour${diffHrs === 1 ? '' : 's'} ago`;
    } else if (diffDays === 1) {
        relative = 'Yesterday';
    } else if (diffDays < 7) {
        relative = `${diffDays} days ago`;
    } else if (diffDays < 14) {
        relative = 'Last week';
    } else {
        relative = full;
    }

    return { relative, full };
}

/**
 * Resolves (nightId, userId) -> entryId so that useEntryDetail can always key
 * on the canonical queryKeys.entries.detail(entryId). Required for useUpdateEntry
 * optimistic patches and invalidations to land on this screen's query.
 */
async function resolveEntryIdByNight(nightId: string, userId: string): Promise<string> {
    const { data, error } = await supabase
        .from('entries')
        .select('id')
        .eq('table_night_id', nightId)
        .eq('user_id', userId)
        .single();
    if (error) throw error;
    return data.id;
}

function useEntryDetail(entryId?: string, nightId?: string, userId?: string) {
    const { data: resolvedId, isLoading: resolvingId, error: resolveError } = useQuery({
        queryKey: queryKeys.tableNight.resolveEntryByNight(nightId ?? '', userId ?? ''),
        queryFn: () => resolveEntryIdByNight(nightId!, userId!),
        enabled: !entryId && !!nightId && !!userId,
        staleTime: Infinity,
    });
    const effectiveId = entryId ?? resolvedId;

    const detail = useQuery({
        queryKey: queryKeys.entries.detail(effectiveId ?? ''),
        queryFn: () => fetchEntry(effectiveId, undefined, undefined),
        enabled: !!effectiveId,
    });

    return {
        ...detail,
        isLoading: detail.isLoading || resolvingId,
        error: detail.error ?? resolveError,
    };
}

async function fetchEntryPhotos(entryId: string): Promise<{ id: string; photo_url: string; sort_order: number }[]> {
    const { data, error } = await supabase
        .from('entry_photos')
        .select('id, photo_url, sort_order')
        .eq('entry_id', entryId)
        .order('sort_order', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

function useEntryPhotos(entryId?: string) {
    return useQuery({
        queryKey: queryKeys.entryDetail.photos(entryId ?? ''),
        queryFn: () => fetchEntryPhotos(entryId!),
        enabled: !!entryId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function EntryDetailScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { entryId, nightId, userId, focus, viewAs } = useLocalSearchParams<{
        entryId?: string;
        nightId?: string;
        userId?: string;
        focus?: string;
        viewAs?: 'public';
    }>();
    const isPublicView = viewAs === 'public';
    const { data: entry, isLoading, error } = useEntryDetail(entryId, nightId, userId);
    // In public view, replies are only allowed when the entry author has opted in.
    // False while entry is loading; safe default.
    const repliesDisabled = isPublicView && !(entry?.allow_public_replies ?? false);
    // Round context for banner — enabled only once we know the entry's table_night_id
    const { data: roundContext } = useRoundContext(entry?.table_night_id ?? null);

    // TICKET-082: Supper mode — when this entry is part of a Supper, fetch the
    // merged-review payload (roster + every member's take). Gated by the curtain
    // flag; the centerpiece entry stays the hero, SupperTable renders everyone else.
    const supperEnabled = !FRIEND_TEST.hideSuppers && !isPublicView;
    const { data: supperDetail } = useSupper(
        supperEnabled ? entry?.supper_id ?? null : null,
    );

    // Post interactions — scope determined by viewAs param
    // Table scope = default (existing behavior); public scope = restaurant-page review view
    const interactionScope = isPublicView ? 'public' : 'table' as const;
    const { data: interactions } = usePostInteractions(
        entry?.id ? 'entry' : null,
        entry?.id ?? null,
        interactionScope,
    );
    usePostInteractionsRealtime({
        targetType: entry?.id ? 'entry' : null,
        targetId: entry?.id ?? null,
        scope: interactionScope,
    });
    // entry_photos for carousel (resolved after entry loads) — now returns full rows with id
    const { data: entryPhotoRows } = useEntryPhotos(entry?.id);
    // Viewer's personal history at this restaurant (cross-Table, excludes this entry)
    const { user: viewer } = useAuth();
    const { data: userHistory } = useUserRestaurantHistory(
        entry?.restaurant_id ?? null,
        viewer?.id ?? null,
        entry?.id,
    );

    // Reply composer — opens when user taps reply in the floating pill, or
    // when the screen was navigated to via FeedActionRow with focus=reply.
    const [replyOpen, setReplyOpen] = useState(false);
    useEffect(() => {
        if (focus === 'reply') setReplyOpen(true);
    }, [focus]);
    // Photo lightbox — opens a full-screen pager when a mosaic tile is tapped.
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    // ── Own-entry edit hooks ───────────────────────────────────────────────────
    const isOwnEntry = !!(viewer && entry && viewer.id === entry.user_id);
    const updateEntry = useUpdateEntry(entry?.id ?? '');
    const addEntryPhoto = useAddEntryPhoto(entry?.id ?? '');
    const removeEntryPhoto = useRemoveEntryPhoto(entry?.id ?? '');

    // ── Inline edit states ────────────────────────────────────────────────────
    // Rating
    const [isEditingRating, setIsEditingRating] = useState(false);
    const [localRating, setLocalRating] = useState<number | null>(null);
    const [ratingError, setRatingError] = useState<string | null>(null);

    // Note
    const [isEditingNote, setIsEditingNote] = useState(false);
    const [localNote, setLocalNote] = useState('');
    const [noteError, setNoteError] = useState<string | null>(null);
    const noteSaving = updateEntry.isPending && !isEditingRating;

    // Dish
    const [isEditingDish, setIsEditingDish] = useState(false);
    const [localDish, setLocalDish] = useState('');
    const [dishError, setDishError] = useState<string | null>(null);

    // Breakdown
    const [isEditingBreakdown, setIsEditingBreakdown] = useState(false);
    const [localBreakdown, setLocalBreakdown] = useState<{
        vibe_rating: number;
        flavor_rating: number;
        service_rating: number;
        value_rating: number;
    }>({ vibe_rating: 0, flavor_rating: 0, service_rating: 0, value_rating: 0 });
    const [breakdownErrors, setBreakdownErrors] = useState<Record<string, string>>({});

    // Companion editing — owner-only
    const [companionEditMode, setCompanionEditMode] = useState(false);
    const [localCompanions, setLocalCompanions] = useState<UserSearchResult[]>([]);

    const toggleLocalCompanion = useCallback((u: UserSearchResult) => {
        if (!viewer || u.user_id === viewer.id) return;
        setLocalCompanions(prev => {
            const exists = prev.some(c => c.user_id === u.user_id);
            if (exists) return prev.filter(c => c.user_id !== u.user_id);
            return [...prev, u];
        });
    }, [viewer]);

    const handleCompanionEditStart = () => {
        if (!isOwnEntry || !entry) return;
        setLocalCompanions(
            (entry.companions ?? []).map(c => ({
                user_id: c.user_id,
                display_name: c.display_name,
                avatar_url: null,
            }))
        );
        setCompanionEditMode(true);
    };

    const handleCompanionSave = async () => {
        if (!entry) return;
        try {
            await updateEntry.mutateAsync({
                companion_ids: localCompanions.map(c => c.user_id),
            });
            setCompanionEditMode(false);
        } catch {
            Alert.alert('Error', "Couldn't update companions. Try again.");
        }
    };

    // Photo editing (for flesh-out)
    const [newPhotoSlots, setNewPhotoSlots] = useState<PhotoSlot[]>([]);
    const uploadGenRefs = useRef(new Map<string, number>());
    // Photo manage mode — toggled by the pencil icon; shows remove-grid + add button
    const [photoManageMode, setPhotoManageMode] = useState(false);

    // ── Derived photo state ───────────────────────────────────────────────────
    const entryPhotoUrls: string[] = entryPhotoRows
        ? entryPhotoRows.map(r => r.photo_url)
        : [];

    const allPhotos: string[] =
        entryPhotoUrls.length > 0
            ? entryPhotoUrls
            : entry?.photo_url
            ? [entry.photo_url]
            : [];

    const hasUserPhotos = allPhotos.length > 0;
    const heroDisplayUrl = hasUserPhotos ? allPhotos[0] : entry?.restaurants?.photo_url ?? null;
    const hasHeroDisplay = !!heroDisplayUrl;

    // ── Photo upload helpers ──────────────────────────────────────────────────
    const startUploadForSlot = useCallback(async (slotId: string, uri: string) => {
        if (!viewer?.id || !entry?.id) return;
        const gen = (uploadGenRefs.current.get(slotId) ?? 0) + 1;
        uploadGenRefs.current.set(slotId, gen);

        setNewPhotoSlots(prev => prev.map(s => s.id === slotId
            ? { ...s, uploading: true, error: null }
            : s
        ));

        try {
            await addEntryPhoto.mutateAsync({ localUri: uri, userId: viewer.id });

            if (uploadGenRefs.current.get(slotId) !== gen) return;
            setNewPhotoSlots(prev => prev.filter(s => s.id !== slotId));
        } catch {
            if (uploadGenRefs.current.get(slotId) !== gen) return;
            setNewPhotoSlots(prev => prev.map(s => s.id === slotId
                ? { ...s, uploading: false, error: 'Upload failed. Tap to retry.' }
                : s
            ));
        }
    }, [viewer?.id, entry?.id, addEntryPhoto]);

    const addNewPhotoSlot = useCallback((uri: string) => {
        setNewPhotoSlots(prev => {
            if (prev.length + allPhotos.length >= MAX_PHOTOS) return prev;
            const slotId = `photo-${Date.now()}-${Math.random()}`;
            const newSlot: PhotoSlot = {
                id: slotId,
                localUri: uri,
                publicUrl: null,
                uploading: true,
                error: null,
                uploadGen: 0,
            };
            setTimeout(() => startUploadForSlot(slotId, uri), 0);
            return [...prev, newSlot];
        });
    }, [startUploadForSlot, allPhotos.length]);

    const handlePhotoPress = () => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
                async (buttonIndex) => {
                    if (buttonIndex === 1) await pickFromCamera();
                    if (buttonIndex === 2) await pickFromLibrary();
                }
            );
        } else {
            Alert.alert('Add a Photo', undefined, [
                { text: 'Take Photo', onPress: pickFromCamera },
                { text: 'Choose from Library', onPress: pickFromLibrary },
                { text: 'Cancel', style: 'cancel' },
            ]);
        }
    };

    const pickFromCamera = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Camera Access Required', 'Please enable camera access in Settings.');
            return;
        }
        let result;
        try {
            result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
        } catch {
            Alert.alert('Camera Unavailable', 'Try choosing from your photo library instead.');
            return;
        }
        if (!result.canceled && result.assets[0]) {
            addNewPhotoSlot(result.assets[0].uri);
        }
    };

    const pickFromLibrary = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Photo Library Access Required', 'Please enable photo library access in Settings.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
        if (!result.canceled && result.assets[0]) {
            addNewPhotoSlot(result.assets[0].uri);
        }
    };

    const handleRemoveExistingPhoto = useCallback((photoUrl: string) => {
        if (!entryPhotoRows) return;
        const row = entryPhotoRows.find(r => r.photo_url === photoUrl);
        if (!row) return;
        const isHero = entry?.photo_url === photoUrl || (entryPhotoRows[0]?.photo_url === photoUrl);
        removeEntryPhoto.mutate({ photoId: row.id, photoUrl: row.photo_url, isHero });
    }, [entryPhotoRows, entry?.photo_url, removeEntryPhoto]);

    // ── Rating edit handlers ──────────────────────────────────────────────────
    const handleRatingTap = () => {
        if (!isOwnEntry || !entry) return;
        setLocalRating(entry.rating ?? 0);
        setRatingError(null);
        setIsEditingRating(true);
    };

    const handleRatingChange = (value: number) => {
        setLocalRating(value);
    };

    const handleRatingSave = async () => {
        if (localRating === null || !entry) return;
        setRatingError(null);
        const ratingValue = Math.round(localRating * 2) / 2;
        try {
            await updateEntry.mutateAsync({ rating: ratingValue });
            setIsEditingRating(false);
        } catch {
            setLocalRating(entry.rating ?? 0);
            setRatingError("Couldn't save. Try again.");
        }
    };

    const handleRatingCancel = () => {
        setIsEditingRating(false);
        setLocalRating(null);
        setRatingError(null);
    };

    // ── Note edit handlers ────────────────────────────────────────────────────
    const handleNoteEditStart = () => {
        if (!isOwnEntry || !entry) return;
        setLocalNote(entry.content ?? '');
        setNoteError(null);
        setIsEditingNote(true);
    };

    const handleNoteSave = async () => {
        if (!entry) return;
        setNoteError(null);
        try {
            await updateEntry.mutateAsync({ content: localNote.trim() || null });
            setIsEditingNote(false);
        } catch {
            setLocalNote(entry.content ?? '');
            setNoteError("Couldn't save. Try again.");
        }
    };

    const handleNoteCancel = () => {
        setIsEditingNote(false);
        setLocalNote('');
        setNoteError(null);
    };

    // ── Dish edit handlers ────────────────────────────────────────────────────
    const handleDishEditStart = () => {
        if (!isOwnEntry || !entry) return;
        setLocalDish(entry.dish_description ?? '');
        setDishError(null);
        setIsEditingDish(true);
    };

    const handleDishSave = async () => {
        if (!entry) return;
        setDishError(null);
        try {
            await updateEntry.mutateAsync({ dish_description: localDish.trim() || null });
            setIsEditingDish(false);
        } catch {
            setLocalDish(entry.dish_description ?? '');
            setDishError("Couldn't save. Try again.");
        }
    };

    const handleDishCancel = () => {
        setIsEditingDish(false);
        setLocalDish('');
        setDishError(null);
    };

    // ── Breakdown edit handlers ───────────────────────────────────────────────
    const handleBreakdownEditStart = () => {
        if (!isOwnEntry || !entry) return;
        setLocalBreakdown({
            vibe_rating: entry.vibe_rating ?? 0,
            flavor_rating: entry.flavor_rating ?? 0,
            service_rating: entry.service_rating ?? 0,
            value_rating: entry.value_rating ?? 0,
        });
        setBreakdownErrors({});
        setIsEditingBreakdown(true);
    };

    const handleBreakdownCategoryChange = async (key: string, value: number) => {
        const ratingValue = Math.round(value * 2) / 2;
        setLocalBreakdown(prev => ({ ...prev, [key]: ratingValue }));
        setBreakdownErrors(prev => ({ ...prev, [key]: '' }));
        try {
            await updateEntry.mutateAsync({ [key]: ratingValue > 0 ? ratingValue : null } as any);
        } catch {
            const entryVal = (entry as any)?.[key] as number | null | undefined;
            setLocalBreakdown(prev => ({ ...prev, [key]: entryVal ?? 0 }));
            setBreakdownErrors(prev => ({ ...prev, [key]: "Couldn't save. Try again." }));
        }
    };

    const handleBreakdownClose = () => {
        setIsEditingBreakdown(false);
    };

    // ── Comment retry / discard (failed-send edge case) ──────────────────────
    const addCommentForRetry = useAddComment();
    const discardFailedComment = useDiscardFailedComment();

    const handleCommentRetry = useCallback(
        (failed: { body: string; client_nonce?: string | null }) => {
            if (!entry?.id || !failed.client_nonce) return;
            discardFailedComment({
                targetType: 'entry',
                targetId: entry.id,
                clientNonce: failed.client_nonce,
                scope: interactionScope,
            });
            addCommentForRetry.mutate({
                targetType: 'entry',
                targetId: entry.id,
                body: failed.body,
                clientNonce: failed.client_nonce,
                scope: interactionScope,
            });
        },
        [entry?.id, addCommentForRetry, discardFailedComment, interactionScope],
    );

    const handleCommentDiscard = useCallback(
        (failed: { client_nonce?: string | null }) => {
            if (!entry?.id || !failed.client_nonce) return;
            discardFailedComment({
                targetType: 'entry',
                targetId: entry.id,
                clientNonce: failed.client_nonce,
                scope: interactionScope,
            });
        },
        [entry?.id, discardFailedComment, interactionScope],
    );

    // ── Public eligibility pre-check (viewAs=public, non-author viewer) ─────────
    // RPC gate per TICKET-021 AC: if the entry is not publicly eligible AND the
    // viewer is not the author, render "This review isn't available" instead of
    // the full screen. Authors always see their own entry regardless of eligibility
    // (owner preview after flipping private).
    const viewerId = viewer?.id;
    const isNonAuthorPublicView = isPublicView && !!entry && entry.user_id !== viewerId;
    const {
        data: isEligible,
        isLoading: eligibilityLoading,
    } = useQuery({
        queryKey: queryKeys.entryDetail.publicEligibility(entry?.id ?? ''),
        queryFn: async () => {
            const { data, error: rpcError } = await supabase.rpc('is_entry_publicly_eligible', {
                p_entry_id: entry!.id,
            });
            if (rpcError) throw rpcError;
            return data as boolean;
        },
        enabled: isNonAuthorPublicView,
        staleTime: 1000 * 60 * 5,
    });

    // ── Loading / error states ────────────────────────────────────────────────

    if (isLoading || !entry) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            </>
        );
    }

    if (error) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <Text style={[Type.body, { color: palette.error }]}>
                        Couldn&apos;t load this entry.
                    </Text>
                    <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Go back</Text>
                    </Pressable>
                </View>
            </>
        );
    }

    // Show loading while eligibility RPC is in-flight (non-author public view only)
    if (isNonAuthorPublicView && eligibilityLoading) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            </>
        );
    }

    // Entry is not publicly eligible and viewer is not the author
    if (isNonAuthorPublicView && isEligible === false) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                    <Text
                        style={[
                            Type.headlineMedium,
                            { color: palette.text, textAlign: 'center', paddingHorizontal: Spacing.xl },
                        ]}
                    >
                        {"This review isn’t available."}
                    </Text>
                    <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.lg }}>
                        <Text style={[Type.body, { color: palette.primary }]}>{'← Back'}</Text>
                    </Pressable>
                </View>
            </>
        );
    }

    const restaurantName = entry.restaurants?.name ?? 'Unknown spot';
    const displayName = entry.profiles?.display_name ?? 'Someone';
    const { relative: relativeDate, full: fullDate } = getRelativeDate(entry.visited_at ?? entry.created_at);

    const hasCategoryRatings =
        entry.vibe_rating != null ||
        entry.flavor_rating != null ||
        entry.service_rating != null ||
        entry.value_rating != null;

    const isRoundEntry = !!entry.table_night_id;

    // Past-tense verb per brand: "tried" when rated, "noted" when not.
    const ratingVerb = entry.rating != null && entry.rating > 0 ? 'tried' : 'noted';

    // Short date in field-notebook style ("18 apr"), always lowercase downstream.
    const shortDate = (() => {
        const d = new Date(entry.visited_at ?? entry.created_at);
        if (isNaN(d.getTime())) return fullDate;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    })();

    // Address line combines street + city with middle-dot separator.
    const addressLine = [entry.restaurants?.address, entry.restaurants?.city]
        .filter((p): p is string => !!p)
        .join(' \u00B7 ');

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 90,
                        paddingTop: hasHeroDisplay ? 0 : insets.top + Spacing.xs,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* ── Photos — prominent gallery centerpiece ("the night, gathered") ──
                        Multiple user photos → mosaic (one large + smaller tiles).
                        Single photo (user or restaurant fallback) → carousel/single image.
                        Photos are the first thing on the screen; tappable; the top-bar
                        back + pencil-manage affordances float over them. */}
                    {hasHeroDisplay ? (
                        <View>
                            {hasUserPhotos && allPhotos.length > 1 ? (
                                <PhotoMosaic
                                    photos={allPhotos}
                                    onPressPhoto={(i) => {
                                        setActivePhotoIndex(i);
                                        setLightboxOpen(true);
                                    }}
                                    palette={palette}
                                />
                            ) : (
                                // Single hero image — tappable to open the lightbox.
                                <Pressable
                                    onPress={() => {
                                        if (hasUserPhotos) {
                                            setActivePhotoIndex(0);
                                            setLightboxOpen(true);
                                        }
                                    }}
                                    disabled={!hasUserPhotos}
                                >
                                    <Image
                                        source={{ uri: heroDisplayUrl! }}
                                        style={{ width: '100%', aspectRatio: 4 / 3 }}
                                        resizeMode="cover"
                                    />
                                </Pressable>
                            )}
                            <View
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    height: insets.top + 56,
                                    backgroundColor: 'rgba(0,0,0,0.28)',
                                }}
                            />
                            <View
                                style={[
                                    styles.topBar,
                                    { position: 'absolute', top: insets.top, left: 0, right: 0 },
                                ]}
                            >
                                <Pressable onPress={() => router.back()}>
                                    <Text style={[Type.body, { color: palette.textInverse }]}>← Back</Text>
                                </Pressable>
                                {/* Pencil icon toggles unified photo manage mode (add + remove) */}
                                {isOwnEntry && (
                                    <Pressable
                                        onPress={() => setPhotoManageMode((v) => !v)}
                                        hitSlop={12}
                                    >
                                        <View style={[styles.editPhotoButton, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                                            <Ionicons
                                                name={photoManageMode ? 'checkmark' : 'pencil-outline'}
                                                size={14}
                                                color={palette.textInverse}
                                            />
                                        </View>
                                    </Pressable>
                                )}
                            </View>
                        </View>
                    ) : (
                        // ── Photoless: letterpress masthead (mirrors restaurant-page take-B) ──
                        <>
                            {/* Quiet back affordance — canvas idiom, not the primary "← Back" */}
                            <Pressable
                                onPress={() => router.back()}
                                style={styles.breadcrumb}
                                hitSlop={12}
                                accessibilityLabel="back"
                                accessibilityRole="button"
                            >
                                <Ionicons name="chevron-back" size={18} color={palette.textSecondary} />
                                <Text style={[styles.breadcrumbLabel, { color: palette.textSecondary }]}>
                                    back
                                </Text>
                            </Pressable>

                            {/* Centered masthead: hairline · italic serif name · meta · hairline */}
                            <View style={styles.masthead}>
                                <View style={[styles.mastheadHairline, { backgroundColor: 'rgba(160,63,40,0.25)' }]} />
                                <Text style={[styles.mastheadName, { color: palette.text }]} numberOfLines={2}>
                                    {restaurantName}
                                </Text>
                                {entry.restaurants?.city ? (
                                    <Text style={[styles.mastheadMeta, { color: palette.textMuted }]}>
                                        {entry.restaurants.city}
                                    </Text>
                                ) : null}
                                <View style={[styles.mastheadHairline, { backgroundColor: 'rgba(160,63,40,0.25)' }]} />
                            </View>

                            {/* Own-entry: quiet add-photo murmur (no big camera box) */}
                            {isOwnEntry && (
                                <Pressable
                                    onPress={handlePhotoPress}
                                    style={styles.addPhotoMurmurRow}
                                    hitSlop={8}
                                    accessibilityRole="button"
                                    accessibilityLabel="Add a photo"
                                >
                                    <Text style={[styles.addPhotoMurmur, { color: palette.primary }]}>
                                        + add a photo
                                    </Text>
                                </Pressable>
                            )}
                        </>
                    )}

                    {/* In-progress new photo uploads */}
                    {newPhotoSlots.length > 0 && (
                        <View style={[styles.section, { paddingTop: Spacing.md }]}>
                            <MultiPhotoRow
                                photos={newPhotoSlots}
                                maxPhotos={MAX_PHOTOS - allPhotos.length}
                                onAdd={handlePhotoPress}
                                onRemove={(slotId) => {
                                    setNewPhotoSlots(prev => prev.filter(s => s.id !== slotId));
                                }}
                                onRetry={(slotId) => {
                                    const slot = newPhotoSlots.find(s => s.id === slotId);
                                    if (slot) startUploadForSlot(slotId, slot.localUri);
                                }}
                                palette={palette}
                            />
                        </View>
                    )}

                    {/* Unified photo manage panel — pencil-gated, shows Add + existing Remove */}
                    {isOwnEntry && photoManageMode && hasHeroDisplay && (
                        <View style={[styles.section, { paddingTop: Spacing.sm }]}>
                            {hasUserPhotos && entryPhotoRows && entryPhotoRows.length > 0 && (
                                <>
                                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                                        Tap a photo to remove it
                                    </Text>
                                    <View
                                        style={{
                                            flexDirection: 'row',
                                            flexWrap: 'wrap',
                                            gap: Spacing.sm,
                                            marginTop: Spacing.xs,
                                        }}
                                    >
                                        {entryPhotoRows.map((row) => (
                                            <Pressable
                                                key={row.id}
                                                onPress={() => handleRemoveExistingPhoto(row.photo_url)}
                                                style={styles.photoThumbContainer}
                                            >
                                                <Image
                                                    source={{ uri: row.photo_url }}
                                                    style={styles.photoThumb}
                                                    resizeMode="cover"
                                                />
                                                <View style={[styles.photoRemoveOverlay]}>
                                                    <Ionicons name="trash-outline" size={16} color={palette.textInverse} />
                                                </View>
                                            </Pressable>
                                        ))}
                                    </View>
                                </>
                            )}
                            <Pressable
                                onPress={handlePhotoPress}
                                style={[
                                    styles.addPhotoButton,
                                    {
                                        backgroundColor: palette.surfaceContainerLow,
                                        marginTop: hasUserPhotos ? Spacing.md : 0,
                                    },
                                ]}
                            >
                                <Ionicons name="add" size={18} color={palette.primary} />
                                <Text style={[Type.body, { color: palette.primary, marginLeft: Spacing.xs }]}>
                                    Add a photo
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    {/* ── Body (encased note card) ───────────────────────── */}
                    <View
                        style={[
                            styles.bodyCard,
                            {
                                backgroundColor: palette.surfaceNote,
                                borderColor: palette.divider,
                                marginTop: hasHeroDisplay ? -18 : 8,
                            },
                        ]}
                    >
                        {/* Kicker: lowercase past-tense verb · relative date · full date */}
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>
                            {ratingVerb}
                            {' \u00B7 '}
                            {relativeDate.toLowerCase()}
                            {' \u00B7 '}
                            {shortDate.toLowerCase()}
                            {isRoundEntry ? ' \u00B7 round' : ''}
                            {/* TICKET-082: Supper entries get a "supper" kicker suffix. */}
                            {!isRoundEntry && supperEnabled && entry.supper_id ? ' \u00B7 supper' : ''}
                        </Text>

                        {/* Prior-visit metadata — own entries, hidden for first visit and public view */}
                        {!isPublicView && isOwnEntry && userHistory && userHistory.visit_count > 0 ? (() => {
                            const ordinals: Record<number, string> = { 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };
                            const visitNum = userHistory.visit_count + 1;
                            const ordinal = ordinals[visitNum] ?? `${visitNum}th`;
                            const lastRating = userHistory.last_visit?.rating;
                            const lastRatingStr = lastRating != null
                                ? (Number.isInteger(lastRating) ? String(lastRating) : String(lastRating))
                                : null;
                            return (
                                <Text style={[styles.priorVisitLine, { color: palette.textMuted }]}>
                                    {`your ${ordinal} visit${lastRatingStr ? ' \u00B7 last time ' + lastRatingStr : ''}`}
                                </Text>
                            );
                        })() : null}

                        {/* ── Who was there — overlapping faces + "with X & Y" line.
                            Sits just under the photos, above the name. Photos are the
                            night; this is who you shared it with. */}
                        {(entry.companions ?? []).length > 0 ? (
                            <View style={styles.facesRow}>
                                <View style={styles.facesStack}>
                                    {(entry.companions ?? []).slice(0, 4).map((c, i) => (
                                        <View
                                            key={c.user_id}
                                            style={[
                                                styles.faceWrap,
                                                {
                                                    marginLeft: i === 0 ? 0 : -10,
                                                    zIndex: 4 - i,
                                                    borderColor: palette.surfaceNote,
                                                },
                                            ]}
                                        >
                                            <InitialsAvatar name={c.display_name} size={26} palette={palette} />
                                        </View>
                                    ))}
                                </View>
                                <Text
                                    style={[styles.facesLine, { color: palette.textSecondary }]}
                                    numberOfLines={1}
                                >
                                    {formatCompanions(entry.companions)}
                                </Text>
                            </View>
                        ) : null}

                        {/* Title row: restaurant name (24px italic) + small amber rating chip.
                            The chip — not a giant numeral — keeps the writing as the hero. */}
                        <View style={styles.titleRow}>
                            <Pressable
                                onPress={() => {
                                    if (entry.restaurant_id) {
                                        router.push({
                                            pathname: '/restaurant/[id]',
                                            params: {
                                                id: entry.restaurant_id,
                                                ...(entry.table_id ? { tableId: entry.table_id } : {}),
                                            },
                                        });
                                    }
                                }}
                                disabled={!entry.restaurant_id}
                                style={{ flex: 1, paddingRight: Spacing.sm }}
                            >
                                <Text style={[styles.restaurantName, { color: palette.text }]} numberOfLines={2}>
                                    {restaurantName}
                                </Text>
                                {addressLine ? (
                                    <Text style={[styles.address, { color: palette.textMuted }]} numberOfLines={1}>
                                        {addressLine}
                                    </Text>
                                ) : null}
                            </Pressable>

                            {/* Small amber-cream rating chip — tappable to edit (own entries). */}
                            {!isEditingRating && entry.rating != null && entry.rating > 0 ? (
                                <Pressable
                                    onPress={isOwnEntry ? handleRatingTap : undefined}
                                    disabled={!isOwnEntry}
                                    hitSlop={8}
                                    style={[
                                        styles.ratingChip,
                                        { backgroundColor: palette.tertiaryFixed },
                                    ]}
                                    accessibilityLabel={`rated ${entry.rating} out of 5`}
                                >
                                    <Text style={[styles.ratingChipNum, { color: palette.tertiary }]}>
                                        {Number.isInteger(entry.rating) ? entry.rating : entry.rating.toFixed(1)}
                                    </Text>
                                    <Ionicons
                                        name="star"
                                        size={11}
                                        color={palette.tertiary}
                                        style={{ marginLeft: 3 }}
                                    />
                                    {/* TICKET-075: read-only like sits inside the chip when present. */}
                                    {entry.liked ? (
                                        <Ionicons
                                            name="heart"
                                            size={11}
                                            color={palette.primary}
                                            style={{ marginLeft: 4 }}
                                            accessibilityLabel="liked"
                                        />
                                    ) : null}
                                </Pressable>
                            ) : !isEditingRating && entry.liked ? (
                                // No rating but hearted — still surface the like as a small chip.
                                <Pressable
                                    onPress={isOwnEntry ? handleRatingTap : undefined}
                                    disabled={!isOwnEntry}
                                    hitSlop={8}
                                    style={[
                                        styles.ratingChip,
                                        { backgroundColor: palette.primaryMuted },
                                    ]}
                                >
                                    <Ionicons
                                        name="heart"
                                        size={13}
                                        color={palette.primary}
                                        accessibilityLabel="liked"
                                    />
                                </Pressable>
                            ) : !isEditingRating && isOwnEntry ? (
                                // Own entry, no rating yet — quiet tap target to add one.
                                <Pressable
                                    onPress={handleRatingTap}
                                    hitSlop={8}
                                    style={[
                                        styles.ratingChip,
                                        { backgroundColor: palette.surfaceContainerLow },
                                    ]}
                                    accessibilityLabel="Add a rating"
                                >
                                    <Text style={[styles.ratingChipAdd, { color: palette.textMuted }]}>rate</Text>
                                </Pressable>
                            ) : null}
                        </View>

                        {/* Rating editor (inline, below title row) */}
                        {isEditingRating ? (
                            <View style={styles.ratingEditor}>
                                <StarRating
                                    value={localRating ?? 0}
                                    size={32}
                                    editable
                                    onChange={handleRatingChange}
                                />
                                <View style={styles.editButtonRow}>
                                    <Pressable
                                        onPress={handleRatingCancel}
                                        hitSlop={8}
                                    >
                                        <Text style={[styles.editAction, { color: palette.textSecondary }]}>cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleRatingSave}
                                        disabled={updateEntry.isPending}
                                        hitSlop={8}
                                    >
                                        {updateEntry.isPending ? (
                                            <ActivityIndicator size="small" color={palette.primary} />
                                        ) : (
                                            <Text style={[styles.editAction, { color: palette.primary }]}>save</Text>
                                        )}
                                    </Pressable>
                                </View>
                                {ratingError ? (
                                    <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.xs }]}>
                                        {ratingError}
                                    </Text>
                                ) : null}
                            </View>
                        ) : null}

                        {/* Previously-here banner — hidden for own non-Round entries (replaced by
                            the inline "your Nth visit" kicker above). Still shown for Round entries
                            and for other users' entries viewed in this detail. */}
                        {!isPublicView && userHistory && userHistory.visit_count > 0 && !(isOwnEntry && !isRoundEntry) && (
                            <View style={{ marginTop: Spacing.lg }}>
                                <PreviouslyHereBanner
                                    voice="user"
                                    visitCount={userHistory.visit_count}
                                    lastRating={userHistory.last_visit?.rating ?? null}
                                    lastDate={userHistory.last_visit?.date ?? null}
                                    onPress={
                                        entry.restaurant_id
                                            ? () =>
                                                  router.push({
                                                      pathname: '/restaurant/[id]',
                                                      params: {
                                                          id: entry.restaurant_id!,
                                                          ...(entry.table_id ? { tableId: entry.table_id } : {}),
                                                      },
                                                  })
                                            : undefined
                                    }
                                />
                            </View>
                        )}

                        {/* Round context banner — hidden in public view */}
                        {!isPublicView && isRoundEntry && roundContext && (
                            <Pressable
                                onPress={() =>
                                    router.push({
                                        pathname: '/table-night-detail',
                                        params: { nightId: entry.table_night_id! },
                                    })
                                }
                                style={({ pressed }) => [
                                    styles.roundBanner,
                                    { backgroundColor: palette.primaryMuted, opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.roundBannerTitle, { color: palette.primary }]}>
                                        Part of a Round
                                    </Text>
                                    <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                                        {roundContext.participantCount} {roundContext.participantCount === 1 ? 'person' : 'people'}
                                        {roundContext.groupAverage != null
                                            ? ` \u00B7 Group avg ${roundContext.groupAverage.toFixed(1)}`
                                            : ''}
                                    </Text>
                                </View>
                                <Text style={[Type.body, { color: palette.primary }]}>›</Text>
                            </Pressable>
                        )}

                        {/* Prose / note — em-dash pull-quote, Newsreader 18/1.55 */}
                        {isEditingNote ? (
                            <View style={styles.proseEditor}>
                                <TextInput
                                    style={[
                                        styles.proseInput,
                                        { color: palette.text },
                                    ]}
                                    value={localNote}
                                    onChangeText={setLocalNote}
                                    placeholder="Say something about it."
                                    placeholderTextColor={palette.textMuted}
                                    multiline
                                    textAlignVertical="top"
                                    autoFocus
                                />
                                <View style={styles.editButtonRow}>
                                    {noteSaving && (
                                        <ActivityIndicator size="small" color={palette.textMuted} />
                                    )}
                                    <Pressable onPress={handleNoteCancel} hitSlop={8}>
                                        <Text style={[styles.editAction, { color: palette.textSecondary }]}>cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleNoteSave}
                                        disabled={updateEntry.isPending}
                                        hitSlop={8}
                                    >
                                        <Text style={[styles.editAction, { color: palette.primary }]}>save</Text>
                                    </Pressable>
                                </View>
                                {noteError ? (
                                    <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.xs }]}>
                                        {noteError}
                                    </Text>
                                ) : null}
                            </View>
                        ) : entry.content ? (
                            <Pressable
                                onPress={isOwnEntry ? handleNoteEditStart : undefined}
                                disabled={!isOwnEntry}
                                style={styles.proseBlock}
                            >
                                {/* The writing is the hero — largest text on the screen.
                                    Em-dash lead, terracotta left rule, Newsreader 22/1.5. */}
                                <View style={[styles.proseQuote, { borderLeftColor: palette.primary }]}>
                                    <Text style={[styles.proseHero, { color: palette.text }]}>
                                        {'— '}{entry.content}
                                    </Text>
                                </View>
                            </Pressable>
                        ) : isOwnEntry ? (
                            // Own entry, no writing yet — invite the hero.
                            <Pressable
                                onPress={handleNoteEditStart}
                                style={styles.proseBlock}
                                accessibilityRole="button"
                                accessibilityLabel="Add your writing"
                            >
                                <Text style={[styles.proseHeroMurmur, { color: palette.textMuted }]}>
                                    {'— say something about the night'}
                                </Text>
                            </Pressable>
                        ) : null}

                        {/* Dish line */}
                        {isEditingDish ? (
                            <View style={styles.dishEditor}>
                                <TextInput
                                    style={[
                                        styles.inlineTextInput,
                                        { backgroundColor: palette.surfaceContainerLow, color: palette.text },
                                    ]}
                                    value={localDish}
                                    onChangeText={setLocalDish}
                                    placeholder="e.g. spicy rigatoni, negroni"
                                    placeholderTextColor={palette.textMuted}
                                    autoFocus
                                    onBlur={handleDishSave}
                                />
                                {dishError ? (
                                    <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.xs }]}>
                                        {dishError}
                                    </Text>
                                ) : null}
                                <View style={styles.editButtonRow}>
                                    <Pressable onPress={handleDishCancel} hitSlop={8}>
                                        <Text style={[styles.editAction, { color: palette.textSecondary }]}>cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleDishSave}
                                        disabled={updateEntry.isPending}
                                        hitSlop={8}
                                    >
                                        <Text style={[styles.editAction, { color: palette.primary }]}>save</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : entry.dish_description ? (
                            <Pressable
                                onPress={isOwnEntry ? handleDishEditStart : undefined}
                                disabled={!isOwnEntry}
                                style={styles.dishRow}
                            >
                                <Text style={[styles.dishText, { color: palette.textSecondary }]}>
                                    <Text style={[styles.dishLabel, { color: palette.textMuted }]}>
                                        dish{'  '}
                                    </Text>
                                    {'\u2014  '}
                                    {entry.dish_description}
                                </Text>
                            </Pressable>
                        ) : null}

                        {/* Breakdown — inline strip; opens editor on tap */}
                        {isEditingBreakdown ? (
                            <View style={styles.breakdownEditor}>
                                <View style={styles.breakdownEditorHeader}>
                                    <Text style={[styles.sectionTinyLabel, { color: palette.textMuted }]}>
                                        break it down
                                    </Text>
                                    <Pressable onPress={handleBreakdownClose} hitSlop={8}>
                                        <Text style={[styles.editAction, { color: palette.primary }]}>done</Text>
                                    </Pressable>
                                </View>
                                {CATEGORY_LABELS.map(({ key, label }) => (
                                    <View key={key} style={styles.breakdownEditRow}>
                                        <Text style={[styles.breakdownEditLabel, { color: palette.textSecondary }]}>
                                            {label.toLowerCase()}
                                        </Text>
                                        <StarRating
                                            value={localBreakdown[key] ?? 0}
                                            size={20}
                                            editable
                                            onChange={(v) => handleBreakdownCategoryChange(key, v)}
                                        />
                                        {breakdownErrors[key] ? (
                                            <Text style={[Type.caption, { color: palette.error }]}>
                                                {breakdownErrors[key]}
                                            </Text>
                                        ) : null}
                                    </View>
                                ))}
                            </View>
                        ) : hasCategoryRatings ? (
                            <Pressable
                                onPress={isOwnEntry ? handleBreakdownEditStart : undefined}
                                disabled={!isOwnEntry}
                                style={styles.breakdownStripWrap}
                            >
                                <View style={styles.breakdownChips}>
                                    {CATEGORY_LABELS
                                        .filter(({ key }) => entry[key] != null)
                                        .map(({ key, label }) => {
                                            const val = entry[key] as number;
                                            return (
                                                <View
                                                    key={key}
                                                    style={[
                                                        styles.breakdownChip,
                                                        { backgroundColor: palette.tertiaryFixed },
                                                    ]}
                                                >
                                                    <Text style={[styles.breakdownChipLabel, { color: palette.tertiary }]}>
                                                        {label.toLowerCase()}
                                                    </Text>
                                                    <Text style={[styles.breakdownChipNum, { color: palette.tertiary }]}>
                                                        {val.toFixed(1)}
                                                    </Text>
                                                </View>
                                            );
                                        })}
                                </View>
                            </Pressable>
                        ) : null}

                        {/* ── Authorship (table entries only — your own shows no author) ── */}
                        {!isOwnEntry && entry.user_id && entry.table_id && (
                            <Pressable
                                onPress={() =>
                                    router.push({
                                        pathname: '/member/[userId]',
                                        params: { userId: entry.user_id, tableId: entry.table_id! },
                                    })
                                }
                                style={styles.authorRow}
                            >
                                <InitialsAvatar name={displayName} size={28} palette={palette} />
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.authorName, { color: palette.textSecondary }]}>
                                        logged by{' '}
                                        <Text style={{ color: palette.text, fontFamily: 'Manrope_600SemiBold' }}>
                                            {displayName}
                                        </Text>
                                    </Text>
                                </View>
                            </Pressable>
                        )}

                        {/* ── Companion edit affordance (owner only) ─────────────────
                            The read display ("who was there" faces + line) now lives at
                            the top of the card; here we keep only the owner's edit entry
                            point so the companion editor stays reachable. */}
                        {isOwnEntry ? (
                            <View style={styles.companionEditBlock}>
                                <Pressable
                                    onPress={handleCompanionEditStart}
                                    hitSlop={8}
                                    accessibilityRole="button"
                                    accessibilityLabel="Edit companions"
                                >
                                    <Text
                                        style={[styles.companionEditCta, { color: palette.textMuted }]}
                                    >
                                        {(entry.companions ?? []).length > 0
                                            ? 'Edit companions'
                                            : '+ Who were you with?'}
                                    </Text>
                                </Pressable>
                            </View>
                        ) : null}
                    </View>

                    {/* ── Supper "at the table" accordion (TICKET-082) ─────────────
                        Rendered below the body card when this entry is part of a
                        Supper. The centerpiece entry above stays the hero; this
                        block shows everyone ELSE at the table (roster minus author),
                        each expandable in place to their full take. */}
                    {supperEnabled && entry.supper_id && supperDetail ? (
                        <SupperTable
                            detail={supperDetail}
                            centerpieceUserId={entry.user_id}
                            palette={palette}
                        />
                    ) : null}

                    {/* Comments — plain rows on the warm cream page, outside the note card. */}
                    {/* Comments — shown for table scope (existing) and public scope (viewAs=public) */}
                    {entry.id && (isPublicView || entry.table_id) && (interactions?.comments ?? []).length > 0 && (
                        <View style={styles.commentsOutside}>
                            {(interactions?.comments ?? []).map((c) => (
                                <CommentRow
                                    key={c.id}
                                    comment={c}
                                    targetType="entry"
                                    targetId={entry.id}
                                    scope={interactionScope}
                                    onRetry={
                                        c.failed && c.client_nonce
                                            ? () => handleCommentRetry(c)
                                            : undefined
                                    }
                                    onDiscard={
                                        c.failed && c.client_nonce
                                            ? () => handleCommentDiscard(c)
                                            : undefined
                                    }
                                />
                            ))}
                        </View>
                    )}

                    {/* "Replies off" notice — shown below comments in public view when author
                        has allow_public_replies = false. Reactions still work; only replies hidden. */}
                    {isPublicView && repliesDisabled && (
                        <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
                            <Text
                                style={{
                                    fontFamily: 'Manrope_400Regular',
                                    fontSize: 12,
                                    color: palette.textMuted,
                                }}
                            >
                                The author has replies turned off.
                            </Text>
                        </View>
                    )}
                </ScrollView>

                {/* ── Floating action pill + docked composer ── */}
                {/* Public view: pill always shown (reactions allowed); reply button/composer
                    hidden when the entry author has allow_public_replies = false. */}
                {entry.id && (isPublicView || entry.table_id) && (
                    replyOpen && !repliesDisabled ? (
                        <DockedReplyComposer
                            entryId={entry.id}
                            palette={palette}
                            scope={interactionScope}
                            onClose={() => setReplyOpen(false)}
                        />
                    ) : (
                        <FloatingActionPill
                            entryId={entry.id}
                            reactionCount={interactions?.counts.reactions ?? 0}
                            commentCount={effectiveCommentCount(interactions)}
                            myReactions={
                                viewer
                                    ? (interactions?.reactions ?? [])
                                          .filter((r) => r.user_id === viewer.id)
                                          .map((r) => r.emoji)
                                    : []
                            }
                            allReactions={interactions?.reactions ?? []}
                            palette={palette}
                            scope={interactionScope}
                            tableId={entry.table_id ?? undefined}
                            repliesDisabled={repliesDisabled}
                            onReplyPress={() => setReplyOpen(true)}
                            bottomInset={insets.bottom}
                        />
                    )
                )}
            </View>

            {/* Companion picker sheet — owner edit mode */}
            {isOwnEntry ? (
                <CompanionPickerSheet
                    visible={companionEditMode}
                    onClose={handleCompanionSave}
                    selectedIds={new Set(localCompanions.map(c => c.user_id))}
                    onToggle={toggleLocalCompanion}
                    currentUserId={viewer?.id}
                    palette={palette}
                />
            ) : null}

            {/* Full-screen photo lightbox — opened from the mosaic / single hero. */}
            <PhotoLightbox
                visible={lightboxOpen && hasUserPhotos}
                photos={allPhotos}
                initialIndex={activePhotoIndex}
                palette={palette}
                topInset={insets.top}
                onClose={() => setLightboxOpen(false)}
            />
        </>
    );
}

// ── Components ─────────────────────────────────────────────────────────────────

function InitialsAvatar({
    name,
    size,
    palette,
}: {
    name: string;
    size: number;
    palette: Palette;
}) {
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const tints = [
        palette.tertiaryFixed,
        palette.secondaryContainer,
        palette.primaryMuted,
    ];
    const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];

    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Text
                style={{
                    fontFamily: 'Manrope_600SemiBold',
                    fontSize: size * 0.36,
                    color: palette.text,
                }}
            >
                {initials}
            </Text>
        </View>
    );
}

// ── PhotoMosaic ───────────────────────────────────────────────────────────────
//
// Prominent multi-photo gallery for the entry centerpiece ("the night, gathered").
// One large lead photo on the left + a stacked column of up to two smaller tiles
// on the right. A "+N" overlay covers any photos beyond the first three. Every
// tile is tappable and reports its index up so the parent can open the lightbox.

function PhotoMosaic({
    photos,
    onPressPhoto,
    palette,
}: {
    photos: string[];
    onPressPhoto: (index: number) => void;
    palette: Palette;
}) {
    const main = photos[0];
    const side = photos.slice(1, 3); // up to two side tiles
    const remaining = photos.length - 3; // photos hidden behind the +N overlay

    return (
        <View style={[styles.mosaic, { backgroundColor: palette.surfaceContainerLow }]}>
            <Pressable style={styles.mosaicMain} onPress={() => onPressPhoto(0)}>
                <Image source={{ uri: main }} style={styles.mosaicMainImg} resizeMode="cover" />
            </Pressable>
            {side.length > 0 ? (
                <View style={styles.mosaicSide}>
                    {side.map((url, i) => {
                        const photoIndex = i + 1;
                        const isLastTile = i === side.length - 1;
                        const showMore = isLastTile && remaining > 0;
                        return (
                            <Pressable
                                key={photoIndex}
                                style={styles.mosaicSideTile}
                                onPress={() => onPressPhoto(photoIndex)}
                            >
                                <Image
                                    source={{ uri: url }}
                                    style={styles.mosaicSideImg}
                                    resizeMode="cover"
                                />
                                {showMore ? (
                                    <View style={styles.mosaicMoreOverlay}>
                                        <Text style={styles.mosaicMoreText}>+{remaining}</Text>
                                    </View>
                                ) : null}
                            </Pressable>
                        );
                    })}
                </View>
            ) : null}
        </View>
    );
}

// ── PhotoLightbox ─────────────────────────────────────────────────────────────
//
// Full-screen black pager opened when a mosaic tile (or the single hero) is
// tapped. Horizontal paging carousel with dot indicators; close affordance
// top-right. Read-only — photo editing still lives in the pencil-gated manage
// panel on the main screen.

function PhotoLightbox({
    visible,
    photos,
    initialIndex,
    palette,
    topInset,
    onClose,
}: {
    visible: boolean;
    photos: string[];
    initialIndex: number;
    palette: Palette;
    topInset: number;
    onClose: () => void;
}) {
    const [index, setIndex] = useState(initialIndex);
    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        if (visible) setIndex(initialIndex);
    }, [visible, initialIndex]);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.lightboxBackdrop}>
                <Pressable
                    onPress={onClose}
                    style={[styles.lightboxClose, { top: topInset + 8 }]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Close photo"
                >
                    <Ionicons name="close" size={22} color="#fff" />
                </Pressable>
                <ScrollView
                    ref={scrollRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    contentOffset={{ x: initialIndex * SCREEN_WIDTH, y: 0 }}
                    onMomentumScrollEnd={(e) => {
                        setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));
                    }}
                    style={{ flex: 1 }}
                >
                    {photos.map((url, i) => (
                        <Image
                            key={i}
                            source={{ uri: url }}
                            style={styles.lightboxImg}
                            resizeMode="contain"
                        />
                    ))}
                </ScrollView>
                {photos.length > 1 ? (
                    <View style={styles.pageDots}>
                        {photos.map((_, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.pageDot,
                                    {
                                        backgroundColor:
                                            i === index ? palette.tertiary : 'rgba(255,255,255,0.4)',
                                    },
                                ]}
                            />
                        ))}
                    </View>
                ) : null}
            </View>
        </Modal>
    );
}

// ── FloatingActionPill ────────────────────────────────────────────────────────
//
// Instagram-story-style floating pill docked bottom-right. Holds the like
// toggle (tap = ❤️ on/off, long-press = emoji picker) and the reply trigger.
// Only rendered for table entries.

interface FloatingActionPillProps {
    entryId: string;
    reactionCount: number;
    commentCount: number;
    myReactions: string[];
    allReactions?: import('@/hooks/posts/usePostInteractions').Reaction[];
    palette: Palette;
    tableId?: string;
    scope?: 'table' | 'public';
    repliesDisabled?: boolean;
    onReplyPress: () => void;
    bottomInset: number;
}

function FloatingActionPill({
    entryId,
    reactionCount,
    commentCount,
    myReactions,
    allReactions = [],
    palette,
    tableId,
    scope = 'table',
    repliesDisabled = false,
    onReplyPress,
    bottomInset,
}: FloatingActionPillProps) {
    const toggleReaction = useToggleReaction();

    const anchorRef = useRef<View>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);
    // ReactorsSheet state — public scope long-press on reaction chip
    const [reactorsEmoji, setReactorsEmoji] = useState<string | null>(null);

    // Display state is driven entirely by props (postInteractions cache is
    // optimistically updated by useToggleReaction). No local deltas.
    const likedEmoji = myReactions.includes('❤️')
        ? '❤️'
        : myReactions[0] ?? null;
    const liked = !!likedEmoji;
    const effectiveCount = reactionCount;

    const applyToggle = (emoji: string) => {
        // TICKET-043: thread tableId so multi-Table entries route to the requesting Table.
        // If switching from one emoji to another, remove the old one first.
        if (!myReactions.includes(emoji) && likedEmoji && likedEmoji !== emoji) {
            toggleReaction.mutate({ targetType: 'entry', targetId: entryId, emoji: likedEmoji, scope, tableId });
        }

        toggleReaction.mutate({ targetType: 'entry', targetId: entryId, emoji, scope, tableId });
    };

    const handleTapLike = () => {
        applyToggle(liked ? likedEmoji! : '❤️');
    };

    const handleLongPress = () => {
        if (scope === 'public') {
            // Public scope: long-press shows ReactorsSheet (who reacted)
            setReactorsEmoji(likedEmoji ?? '❤️');
            return;
        }
        // Table scope: long-press opens emoji picker
        if (!anchorRef.current) return;
        const handle = findNodeHandle(anchorRef.current);
        if (handle == null) return;
        UIManager.measureInWindow(handle, (x, y) => {
            setPickerAnchor({ x, y });
        });
    };

    const handlePick = (emoji: string) => {
        setPickerAnchor(null);
        applyToggle(emoji);
    };

    return (
        <>
            <View
                style={[
                    styles.floatingPill,
                    { bottom: Math.max(bottomInset, 12) + 8 },
                ]}
                pointerEvents="box-none"
            >
                <View
                    style={[
                        styles.floatingPillInner,
                        { backgroundColor: 'rgba(252, 249, 244, 0.92)' },
                    ]}
                >
                    <Pressable
                        ref={anchorRef}
                        onPress={handleTapLike}
                        onLongPress={handleLongPress}
                        delayLongPress={220}
                        hitSlop={6}
                        style={styles.pillBtn}
                        accessibilityRole="button"
                        accessibilityLabel={
                            liked ? 'Unlike' : 'Like (long-press to pick an emoji)'
                        }
                    >
                        {liked ? (
                            <Text style={styles.pillEmoji} allowFontScaling={false}>
                                {likedEmoji}
                            </Text>
                        ) : (
                            <Ionicons
                                name="heart-outline"
                                size={18}
                                color={palette.textSecondary}
                            />
                        )}
                        {effectiveCount > 0 ? (
                            <Text
                                style={[
                                    styles.pillCount,
                                    { color: palette.textSecondary },
                                ]}
                            >
                                {effectiveCount}
                            </Text>
                        ) : null}
                    </Pressable>

                    {!repliesDisabled && (
                        <>
                            <View
                                style={[
                                    styles.pillSep,
                                    { backgroundColor: 'rgba(28, 28, 25, 0.12)' },
                                ]}
                            />

                            <Pressable
                                onPress={onReplyPress}
                                hitSlop={6}
                                style={styles.pillBtn}
                                accessibilityRole="button"
                                accessibilityLabel="Reply"
                            >
                                <Ionicons
                                    name="chatbubble-outline"
                                    size={16}
                                    color={palette.textSecondary}
                                />
                                <Text style={[styles.pillLabel, { color: palette.text }]}>
                                    reply
                                </Text>
                                {commentCount > 0 ? (
                                    <Text
                                        style={[
                                            styles.pillCount,
                                            { color: palette.textSecondary },
                                        ]}
                                    >
                                        {commentCount}
                                    </Text>
                                ) : null}
                            </Pressable>
                        </>
                    )}
                </View>
            </View>

            <ReactionPicker
                visible={!!pickerAnchor}
                anchor={pickerAnchor}
                onPick={handlePick}
                onClose={() => setPickerAnchor(null)}
            />

            {/* ReactorsSheet — public scope long-press on reaction chip */}
            {reactorsEmoji !== null && (
                <ReactorsSheet
                    emoji={reactorsEmoji}
                    reactors={allReactions.filter((r) => r.emoji === reactorsEmoji)}
                    onClose={() => setReactorsEmoji(null)}
                    scope={scope}
                />
            )}
        </>
    );
}

// ── DockedReplyComposer ───────────────────────────────────────────────────────
//
// Slides up from the bottom when the user taps "reply" on the floating pill.
// iMessage pattern — KeyboardAvoidingView keeps the input pinned above the
// keyboard. Closes on cancel or after a successful send.

interface DockedReplyComposerProps {
    entryId: string;
    palette: Palette;
    scope?: 'table' | 'public';
    onClose: () => void;
}

function DockedReplyComposer({ entryId, palette, scope = 'table', onClose }: DockedReplyComposerProps) {
    const [body, setBody] = useState('');
    const [sendError, setSendError] = useState<string | null>(null);
    const addComment = useAddComment();
    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        const t = setTimeout(() => inputRef.current?.focus(), 150);
        return () => clearTimeout(t);
    }, []);

    const trimmed = body.trim();
    const canSend = trimmed.length >= 1 && !addComment.isPending;

    const handleSend = () => {
        if (!canSend) return;
        setSendError(null);
        const pendingBody = trimmed;
        const nonce = `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        addComment.mutate(
            { targetType: 'entry', targetId: entryId, body: pendingBody, clientNonce: nonce, scope },
            {
                onSuccess: () => {
                    setBody('');
                    setSendError(null);
                    onClose();
                },
                onError: (err: any) => {
                    // Keep body + composer open so user can retry or edit.
                    setBody(pendingBody);
                    const msg =
                        err?.message ??
                        err?.error ??
                        'Send failed. Tap retry.';
                    setSendError(msg);
                },
            },
        );
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.dockedComposerWrap}
            pointerEvents="box-none"
        >
            <View
                style={[
                    styles.dockedComposer,
                    {
                        backgroundColor: palette.surfaceNote,
                        borderTopColor: palette.dividerSoft,
                    },
                ]}
            >
                <TextInput
                    ref={inputRef}
                    value={body}
                    onChangeText={(t) => {
                        setBody(t);
                        if (sendError) setSendError(null);
                    }}
                    placeholder="say something"
                    placeholderTextColor={palette.textMuted}
                    style={[styles.dockedInput, { color: palette.text }]}
                    multiline
                    returnKeyType="default"
                    blurOnSubmit={false}
                />
                {sendError ? (
                    <Text
                        style={{
                            fontFamily: 'Manrope_500Medium',
                            fontSize: 11,
                            color: palette.error,
                            marginTop: Spacing.xs,
                        }}
                    >
                        {sendError}
                    </Text>
                ) : null}
                <View style={styles.dockedActions}>
                    <Pressable
                        onPress={() => {
                            setBody('');
                            setSendError(null);
                            onClose();
                        }}
                        hitSlop={8}
                    >
                        <Text style={[styles.editAction, { color: palette.textSecondary }]}>
                            cancel
                        </Text>
                    </Pressable>
                    <Pressable onPress={handleSend} disabled={!canSend} hitSlop={8}>
                        {addComment.isPending ? (
                            <ActivityIndicator size="small" color={palette.primary} />
                        ) : (
                            <Text
                                style={[
                                    styles.editAction,
                                    { color: canSend ? palette.primary : palette.textMuted },
                                ]}
                            >
                                {sendError ? 'retry' : 'send'}
                            </Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const PAGE_H = 14;

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    topBar: {
        paddingHorizontal: PAGE_H,
        paddingBottom: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    section: { paddingHorizontal: PAGE_H, paddingTop: Spacing.md },

    // ── Body — encased note card ──
    // Brand: white `--surface-note`, radius-xl, near-invisible warm border,
    // `--shadow-note`. Floats just below the hero (slightly overlapping).
    bodyCard: {
        marginHorizontal: 0,
        paddingHorizontal: PAGE_H,
        paddingTop: 16,
        paddingBottom: 20,
        borderRadius: Radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 24,
        elevation: 3,
    },

    // Kicker — lowercase past-tense verb · relative date · short date
    kicker: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.4,
    },

    // Prior-visit metadata — "your 2nd visit · last time 3.5"
    priorVisitLine: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        marginTop: 6,
        marginBottom: 2,
    },

    // ── Who-was-there faces row ──
    facesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginTop: Spacing.sm,
    },
    facesStack: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    faceWrap: {
        borderRadius: 999,
        borderWidth: 1.5,
    },
    facesLine: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        flexShrink: 1,
    },

    // Title row — name (24px) + small amber rating chip
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: Spacing.sm + 2,
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 28,
        letterSpacing: -0.2,
    },
    address: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 4,
        letterSpacing: 0.2,
    },

    // Small amber-cream rating chip — replaces the giant numeral.
    ratingChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: Radius.full,
    },
    ratingChipNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 18,
    },
    ratingChipAdd: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.4,
    },

    // Rating editor (shown inline when isEditingRating)
    ratingEditor: {
        marginTop: Spacing.md,
        alignItems: 'flex-start',
        gap: Spacing.sm,
    },

    // Round banner
    roundBanner: {
        marginTop: Spacing.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    roundBannerTitle: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },

    // ── Prose — the HERO. Largest text on the screen. Newsreader 22/1.5,
    //    em-dash lead, 2px terracotta left rule. ──
    proseBlock: {
        marginTop: Spacing.lg,
    },
    proseQuote: {
        borderLeftWidth: 2,
        paddingLeft: 14,
        paddingVertical: 4,
    },
    proseHero: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 33,
        fontWeight: '400',
    },
    proseHeroMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        lineHeight: 30,
    },

    // Prose editor (tapped to edit) — matches the hero size for continuity.
    proseEditor: {
        marginTop: Spacing.lg,
    },
    proseInput: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 33,
        minHeight: 120,
        padding: 0,
        textAlignVertical: 'top',
    },

    // Dish line
    dishRow: {
        marginTop: Spacing.md,
    },
    dishText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 22,
    },
    dishLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    dishEditor: {
        marginTop: Spacing.md,
    },

    // Breakdown — small amber chips: "vibe 2.0  flavor 1.0  …"
    breakdownStripWrap: {
        marginTop: Spacing.md,
    },
    breakdownChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
    },
    breakdownChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: Radius.full,
    },
    breakdownChipLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.3,
        textTransform: 'lowercase',
    },
    breakdownChipNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },

    // Breakdown editor
    breakdownEditor: {
        marginTop: Spacing.md,
        gap: Spacing.xs,
    },
    breakdownEditorHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm,
    },
    breakdownEditRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingVertical: Spacing.xs,
    },
    breakdownEditLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        width: 60,
    },

    // Edit button row (cancel / save)
    editButtonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.lg,
        marginTop: Spacing.sm,
    },
    editAction: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.3,
    },
    sectionTinyLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },

    // Authorship row — only on table entries not-your-own
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: Spacing.md,
    },
    authorName: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
    },

    companionEditBlock: {
        marginTop: Spacing.sm,
        gap: Spacing.xs,
    },
    companionEditCta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        textDecorationLine: 'underline',
    },

    // Comments — plain rows on warm cream, sits below the note card.
    commentsOutside: {
        gap: Spacing.sm,
        paddingHorizontal: PAGE_H,
        paddingTop: Spacing.md,
    },

    // Floating bottom-right action pill — Instagram story-style.
    // Outer wrapper sets position absolute; inner renders the visible pill.
    floatingPill: {
        position: 'absolute',
        right: 16,
        left: 0,
        alignItems: 'flex-end',
    },
    floatingPillInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: Radius.full,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
        elevation: 6,
        // Inset 1px warm hairline per brand rule.
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(28, 28, 25, 0.06)',
    },
    pillBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    pillEmoji: {
        fontSize: 16,
        lineHeight: 20,
    },
    pillLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        letterSpacing: 0.1,
    },
    pillCount: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    pillSep: {
        width: 1,
        height: 14,
    },

    // Docked reply composer — iMessage pattern, slides up from bottom
    dockedComposerWrap: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
    },
    dockedComposer: {
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    dockedInput: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 15,
        lineHeight: 22,
        minHeight: 44,
        maxHeight: 140,
        padding: 0,
    },
    dockedActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: Spacing.lg,
        marginTop: Spacing.sm,
    },

    // Page dots — reused by the full-screen lightbox pager.
    pageDots: {
        position: 'absolute',
        bottom: Spacing.lg,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    pageDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },

    // ── Photo mosaic (multi-photo gallery centerpiece) ──
    mosaic: {
        width: '100%',
        aspectRatio: 4 / 3,
        flexDirection: 'row',
        gap: 2,
    },
    mosaicMain: {
        flex: 1.6,
        height: '100%',
    },
    mosaicMainImg: {
        width: '100%',
        height: '100%',
    },
    mosaicSide: {
        flex: 1,
        gap: 2,
    },
    mosaicSideTile: {
        flex: 1,
        width: '100%',
    },
    mosaicSideImg: {
        width: '100%',
        height: '100%',
    },
    mosaicMoreOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.42)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    mosaicMoreText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        color: '#fff',
    },

    // ── Photo lightbox (full-screen pager) ──
    lightboxBackdrop: {
        flex: 1,
        backgroundColor: '#000',
    },
    lightboxClose: {
        position: 'absolute',
        right: 16,
        zIndex: 10,
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.14)',
    },
    lightboxImg: {
        width: SCREEN_WIDTH,
        flex: 1,
    },

    // Photo manage mode
    editPhotoButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoThumbContainer: {
        position: 'relative',
        width: 80,
        height: 80,
    },
    photoThumb: {
        width: 80,
        height: 80,
        borderRadius: Radius.md,
    },
    photoRemoveOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: Radius.md,
        backgroundColor: 'rgba(0,0,0,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    // ── Photoless letterpress masthead (mirrors restaurant-page take-B) ──
    breadcrumb: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: PAGE_H,
        paddingVertical: 8,
    },
    breadcrumbLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    masthead: {
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 4,
    },
    mastheadHairline: {
        width: 56,
        height: 1,
    },
    mastheadName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 32,
        textAlign: 'center',
    },
    mastheadMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        textAlign: 'center',
    },
    addPhotoMurmurRow: {
        alignItems: 'center',
        paddingTop: Spacing.md,
    },
    addPhotoMurmur: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.2,
    },
    addPhotoButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },

    // Inline text input (dish)
    inlineTextInput: {
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        fontSize: 15,
        fontFamily: 'Manrope_400Regular',
        minHeight: 44,
    },
});
