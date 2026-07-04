/**
 * Entry Detail — "Review · The Poster" (review-page-redesign handoff).
 *
 * Type-led review screen. NO flagship photo at the top — the review stands on
 * type and rhythm: who·when → place + rating → the note (hero) → your photos
 * "from the night" (a mosaic with the add tile built in) → who you were with →
 * engagement (loved-by + replies) over a persistent bottom composer.
 *
 * Reading surface by default; existing-content edits (note / rating / dish /
 * breakdown) are gated behind an explicit edit mode (⋯ → edit review). Adding a
 * missing photo or tagging companions stays inline as gentle completion
 * affordances, exactly as the mock depicts. All prior machinery is preserved:
 * Supper "at the table" accordion, Round banner, public-view eligibility gate,
 * companion picker, photo manage/lightbox, reactions + replies.
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
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Type, Shadow } from '@/constants/theme';
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
import { useAuth } from '@/providers/AuthProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { trackError } from '@/lib/track';
import { usePostInteractions, usePostInteractionsRealtime } from '@/hooks/posts';
import { useUpdateEntry } from '@/hooks/entries/useUpdateEntry';
import { useDeleteEntry } from '@/hooks/entries/useDeleteEntry';
import { useAddEntryPhoto, useRemoveEntryPhoto } from '@/hooks/entries/useEntryPhotoMutations';
import { useReportContent, useBlockUser } from '@/hooks/account';
import { CompanionPickerSheet } from '@/components/logging';
import { formatCompanions } from '@/lib/companions';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';
import {
    useAddComment,
    useDiscardFailedComment,
    useEditComment,
    useDeleteComment,
    useToggleReaction,
    useToggleCommentLike,
    effectiveCommentCount,
} from '@/hooks/posts/usePostInteractions';
import type { Comment, Scope, TargetType } from '@/hooks/posts/usePostInteractions';
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

/** Short relative time for reply bubbles ("just now", "2h", "3d"). */
function formatRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
    });
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

function EntryDetailScreen() {
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

    // TICKET-082: the viewer is a Supper member who hasn't logged their own take
    // yet → offer an "add your take" CTA. Host (and anyone who already took) is in
    // `takes`, so they never see it.
    const viewerIsPendingTaker = !!(
        supperEnabled &&
        entry?.supper_id &&
        supperDetail &&
        viewer?.id &&
        supperDetail.roster.some((r) => r.user_id === viewer.id) &&
        !supperDetail.takes.some((t) => t.user_id === viewer.id)
    );
    const { data: userHistory } = useUserRestaurantHistory(
        entry?.restaurant_id ?? null,
        viewer?.id ?? null,
        entry?.id,
    );

    // Reply composer — auto-focus when navigated to via FeedActionRow focus=reply.
    const [replyFocus, setReplyFocus] = useState(false);
    useEffect(() => {
        if (focus === 'reply') setReplyFocus(true);
    }, [focus]);
    // TICKET-085: when set, the composer is replying to a thread (parentCommentId =
    // the thread root id; name = the person being replied to, for the chip).
    const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
    // Photo lightbox — opens a full-screen pager when a mosaic tile is tapped.
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    // ── Own-entry edit hooks ───────────────────────────────────────────────────
    const isOwnEntry = !!(viewer && entry && viewer.id === entry.user_id);
    const updateEntry = useUpdateEntry(entry?.id ?? '');
    const deleteEntry = useDeleteEntry();

    // ── Viewer safety actions (TICKET-090, guideline 1.2) ─────────────────────
    const reportContent = useReportContent();
    const blockUser = useBlockUser();

    const handleViewerMenu = useCallback(() => {
        if (!entry) return;
        const authorId = entry.user_id;
        const authorName = entry.profiles?.display_name ?? 'this person';
        const fileReport = (reason: string) => {
            reportContent.mutate(
                { targetType: 'entry', targetId: entry.id, reason },
                {
                    onSuccess: () => Alert.alert('Reported', 'Thanks — we review reports within 24 hours.'),
                    onError: () => Alert.alert('Something went wrong', 'Try again in a moment.'),
                },
            );
        };
        Alert.alert(authorName, undefined, [
            {
                text: 'Report this review',
                style: 'destructive',
                onPress: () =>
                    Alert.alert('Report this review', undefined, [
                        { text: 'Spam or misleading', onPress: () => fileReport('spam') },
                        { text: 'Offensive or abusive', onPress: () => fileReport('offensive') },
                        { text: 'Something else', onPress: () => fileReport('other') },
                        { text: 'Cancel', style: 'cancel' },
                    ]),
            },
            {
                text: `Block ${authorName}`,
                style: 'destructive',
                onPress: () =>
                    Alert.alert(
                        `Block ${authorName}?`,
                        "You won't see each other's reviews, comments, or profiles.",
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Block',
                                style: 'destructive',
                                onPress: () =>
                                    blockUser.mutate(authorId, {
                                        onSuccess: () => router.back(),
                                        onError: () => Alert.alert('Something went wrong', 'Try again in a moment.'),
                                    }),
                            },
                        ],
                    ),
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [entry, reportContent, blockUser, router]);

    const handleDelete = useCallback(() => {
        if (!isOwnEntry || !entry?.id || !viewer?.id) return;
        Alert.alert(
            'Delete this review?',
            'This removes your rating, note, and photos. This can’t be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () =>
                        deleteEntry.mutate(
                            {
                                entryId: entry.id,
                                userId: viewer.id,
                                restaurantId: entry.restaurant_id ?? null,
                                supperId: entry.supper_id ?? null,
                            },
                            {
                                onSuccess: () => router.back(),
                                onError: (err: any) =>
                                    Alert.alert('Error', err?.message ?? 'Could not delete this review.'),
                            },
                        ),
                },
            ],
        );
    }, [isOwnEntry, entry?.id, entry?.restaurant_id, entry?.supper_id, viewer?.id, deleteEntry, router]);
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
    // Photo manage mode — toggled from the ⋯ menu; shows remove-grid
    const [photoManageMode, setPhotoManageMode] = useState(false);
    // Overflow (⋯) menu for owner post-actions — keeps destructive/edit actions out
    // of the reading surface.
    const [menuOpen, setMenuOpen] = useState(false);
    // Edit mode — a finished review is a READ surface; existing-content edits
    // (note / rating / dish / breakdown) are revealed only after ⋯ → edit review.
    const [editMode, setEditMode] = useState(false);
    const ownerEditing = isOwnEntry && editMode;

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
        (failed: { body: string; client_nonce?: string | null; parent_id?: string | null }) => {
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
                // Preserve threading on retry — else a failed reply re-posts top-level.
                parentCommentId: failed.parent_id ?? undefined,
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
    const { full: fullDate } = getRelativeDate(entry.visited_at ?? entry.created_at);

    const hasCategoryRatings =
        entry.vibe_rating != null ||
        entry.flavor_rating != null ||
        entry.service_rating != null ||
        entry.value_rating != null;

    const isRoundEntry = !!entry.table_night_id;

    // Past-tense verb per brand: "tried" when rated, "noted" when not.
    const ratingVerb = entry.rating != null && entry.rating > 0 ? 'tried' : 'noted';

    // Short date in field-notebook style ("18 jun"), always lowercase downstream.
    const shortDate = (() => {
        const d = new Date(entry.visited_at ?? entry.created_at);
        if (isNaN(d.getTime())) return fullDate;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    })();

    // Kicker suffix on the who·when row — round / supper provenance.
    const kickerSuffix = isRoundEntry
        ? ' · round'
        : supperEnabled && entry.supper_id
        ? ' · supper'
        : '';

    // Address line combines street + city with middle-dot separator.
    const addressLine = [entry.restaurants?.address, entry.restaurants?.city]
        .filter((p): p is string => !!p)
        .join(' · ');

    // Engagement surface — only on table-scoped or public-viewed entries (a pure
    // solo feed-only entry has no reactions/replies). Mirrors the old pill gate.
    const hasEngagement = !!entry.id && (isPublicView || !!entry.table_id);

    // Add-a-photo is an EDIT affordance — only in edit mode (⋯ → edit review), never
    // on the read surface. Capped at MAX_PHOTOS; never in public view.
    const canAddPhotos =
        ownerEditing && !isPublicView && allPhotos.length + newPhotoSlots.length < MAX_PHOTOS;

    // Unique reactors for the "Loved by …" row.
    const reactorList = (() => {
        const seen = new Set<string>();
        const out: { user_id: string; name: string }[] = [];
        for (const r of interactions?.reactions ?? []) {
            if (seen.has(r.user_id)) continue;
            seen.add(r.user_id);
            out.push({ user_id: r.user_id, name: r.profiles?.display_name ?? 'Someone' });
        }
        return out;
    })();
    const reactorExtra = Math.max(0, reactorList.length - 2);

    const comments = interactions?.comments ?? [];
    const replyCount = effectiveCommentCount(interactions);

    // TICKET-085: group into one level of nesting — roots + replies-by-root.
    // A reply whose root isn't present (shouldn't happen) renders as a root.
    const rootComments = comments.filter((c) => !c.parent_id);
    const rootIdSet = new Set(rootComments.map((c) => c.id));
    const repliesByRoot = new Map<string, Comment[]>();
    const orphanReplies: Comment[] = [];
    for (const c of comments) {
        if (!c.parent_id) continue;
        if (rootIdSet.has(c.parent_id)) {
            const arr = repliesByRoot.get(c.parent_id) ?? [];
            arr.push(c);
            repliesByRoot.set(c.parent_id, arr);
        } else {
            orphanReplies.push(c);
        }
    }
    const threadRoots = [...rootComments, ...orphanReplies];

    const startReply = (rootId: string, name: string) => {
        setReplyingTo({ id: rootId, name });
        setReplyFocus(true);
    };

    const myReactions = viewer
        ? (interactions?.reactions ?? [])
              .filter((r) => r.user_id === viewer.id)
              .map((r) => r.emoji)
        : [];

    const showEngagementBlock =
        hasEngagement &&
        (reactorList.length > 0 || comments.length > 0 || (isPublicView && repliesDisabled));

    const goToRestaurant = () => {
        if (!entry.restaurant_id) return;
        router.push({
            pathname: '/restaurant/[id]',
            params: {
                id: entry.restaurant_id,
                ...(entry.table_id ? { tableId: entry.table_id } : {}),
            },
        });
    };

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                {/* ── Top nav — back · "Review" · ⋯ / done ──────────────────── */}
                <View style={[styles.nav, { paddingTop: insets.top + Spacing.xs }]}>
                    <View style={styles.navSideL}>
                        <Pressable
                            onPress={() => router.back()}
                            style={styles.navBack}
                            hitSlop={12}
                            accessibilityRole="button"
                            accessibilityLabel="back"
                        >
                            <Ionicons name="chevron-back" size={18} color={palette.primary} />
                            <Text style={[styles.navBackLabel, { color: palette.primary }]}>back</Text>
                        </Pressable>
                    </View>
                    <Text style={[styles.navTitle, { color: palette.textMuted }]}>Review</Text>
                    <View style={styles.navSideR}>
                        {isOwnEntry ? (
                            photoManageMode ? (
                                <Pressable
                                    onPress={() => setPhotoManageMode(false)}
                                    hitSlop={12}
                                    accessibilityLabel="Done managing photos"
                                >
                                    <Text style={[styles.navDone, { color: palette.primary }]}>done</Text>
                                </Pressable>
                            ) : editMode ? (
                                <Pressable
                                    onPress={() => setEditMode(false)}
                                    hitSlop={12}
                                    accessibilityLabel="Done editing"
                                >
                                    <Text style={[styles.navDone, { color: palette.primary }]}>done</Text>
                                </Pressable>
                            ) : (
                                <Pressable
                                    onPress={() => setMenuOpen(true)}
                                    hitSlop={12}
                                    accessibilityLabel="More options"
                                >
                                    <Ionicons name="ellipsis-horizontal" size={20} color={palette.textMuted} />
                                </Pressable>
                            )
                        ) : viewer ? (
                            // Non-owner: report/block menu (TICKET-090, guideline 1.2)
                            <Pressable
                                onPress={handleViewerMenu}
                                hitSlop={12}
                                accessibilityLabel="Report or block"
                            >
                                <Ionicons name="ellipsis-horizontal" size={20} color={palette.textMuted} />
                            </Pressable>
                        ) : null}
                    </View>
                </View>

                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + (hasEngagement ? 110 : Spacing.xl),
                    }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.body}>
                        {/* ── who · when ─────────────────────────────────────── */}
                        <Pressable
                            style={styles.whoRow}
                            disabled={isOwnEntry || !(entry.user_id && entry.table_id)}
                            onPress={() => {
                                if (!isOwnEntry && entry.user_id && entry.table_id) {
                                    router.push({
                                        pathname: '/member/[userId]',
                                        params: { userId: entry.user_id, tableId: entry.table_id },
                                    });
                                }
                            }}
                        >
                            <InitialsAvatar name={displayName} size={34} palette={palette} />
                            <Text style={[styles.whoName, { color: palette.text }]}>
                                {isOwnEntry ? 'you' : displayName}
                            </Text>
                            <Text style={[styles.whoMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                {' · '}{ratingVerb}{' · '}{shortDate.toLowerCase()}{kickerSuffix}
                            </Text>
                        </Pressable>

                        {/* ── place + rating ─────────────────────────────────── */}
                        <View style={styles.placeRow}>
                            <Pressable
                                style={{ flex: 1, paddingRight: Spacing.md }}
                                disabled={!entry.restaurant_id}
                                onPress={goToRestaurant}
                            >
                                <Text style={[styles.placeName, { color: palette.text }]} numberOfLines={3}>
                                    {restaurantName}
                                </Text>
                                {addressLine ? (
                                    <Text style={[styles.placeMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                        {addressLine.toUpperCase()}
                                    </Text>
                                ) : null}
                            </Pressable>

                            {!isEditingRating ? (
                                entry.rating != null && entry.rating > 0 ? (
                                    <Pressable
                                        onPress={ownerEditing ? handleRatingTap : undefined}
                                        disabled={!ownerEditing}
                                        style={styles.ratingNumeralWrap}
                                        accessibilityLabel={`rated ${entry.rating} out of 5`}
                                    >
                                        <Text style={[styles.ratingNumeral, { color: palette.primary }]}>
                                            {entry.rating.toFixed(1)}
                                        </Text>
                                        <Text style={styles.ratingDenom}>/5</Text>
                                        {entry.liked ? (
                                            <Ionicons
                                                name="heart"
                                                size={15}
                                                color={palette.primary}
                                                style={styles.ratingHeart}
                                                accessibilityLabel="loved"
                                            />
                                        ) : null}
                                    </Pressable>
                                ) : entry.liked ? (
                                    <Pressable
                                        onPress={ownerEditing ? handleRatingTap : undefined}
                                        disabled={!ownerEditing}
                                        style={styles.ratingNumeralWrap}
                                        accessibilityLabel="liked"
                                    >
                                        <Ionicons name="heart" size={26} color={palette.primary} />
                                    </Pressable>
                                ) : ownerEditing ? (
                                    <Pressable
                                        onPress={handleRatingTap}
                                        style={[styles.ratePrompt, { backgroundColor: palette.surfaceContainerLow }]}
                                        accessibilityLabel="Add a rating"
                                    >
                                        <Text style={[styles.ratePromptText, { color: palette.textMuted }]}>rate</Text>
                                    </Pressable>
                                ) : null
                            ) : null}
                        </View>

                        {/* Rating editor (inline, edit mode) */}
                        {isEditingRating ? (
                            <View style={styles.ratingEditor}>
                                <StarRating
                                    value={localRating ?? 0}
                                    size={32}
                                    editable
                                    onChange={handleRatingChange}
                                />
                                <View style={styles.editButtonRow}>
                                    <Pressable onPress={handleRatingCancel} hitSlop={8}>
                                        <Text style={[styles.editAction, { color: palette.textSecondary }]}>cancel</Text>
                                    </Pressable>
                                    <Pressable onPress={handleRatingSave} disabled={updateEntry.isPending} hitSlop={8}>
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

                        {/* Previously-here banner — non-own or Round entries only */}
                        {!isPublicView && userHistory && userHistory.visit_count > 0 && !(isOwnEntry && !isRoundEntry) && (
                            <View style={{ marginTop: Spacing.lg }}>
                                <PreviouslyHereBanner
                                    voice="user"
                                    visitCount={userHistory.visit_count}
                                    lastRating={userHistory.last_visit?.rating ?? null}
                                    lastDate={userHistory.last_visit?.date ?? null}
                                    onPress={entry.restaurant_id ? goToRestaurant : undefined}
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
                                            ? ` · Group avg ${roundContext.groupAverage.toFixed(1)}`
                                            : ''}
                                    </Text>
                                </View>
                                <Text style={[Type.body, { color: palette.primary }]}>›</Text>
                            </Pressable>
                        )}

                        <View style={styles.divider} />

                        {/* ── the note — hero, em-dash lead, roman serif ─────── */}
                        {isEditingNote ? (
                            <View style={styles.noteEditor}>
                                <TextInput
                                    style={[styles.noteInput, { color: palette.text }]}
                                    value={localNote}
                                    onChangeText={setLocalNote}
                                    placeholder="Say something about it."
                                    placeholderTextColor={palette.textMuted}
                                    multiline
                                    textAlignVertical="top"
                                    autoFocus
                                />
                                <View style={styles.editButtonRow}>
                                    {noteSaving && <ActivityIndicator size="small" color={palette.textMuted} />}
                                    <Pressable onPress={handleNoteCancel} hitSlop={8}>
                                        <Text style={[styles.editAction, { color: palette.textSecondary }]}>cancel</Text>
                                    </Pressable>
                                    <Pressable onPress={handleNoteSave} disabled={updateEntry.isPending} hitSlop={8}>
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
                                onPress={ownerEditing ? handleNoteEditStart : undefined}
                                disabled={!ownerEditing}
                                style={styles.noteBlock}
                            >
                                <Text style={[styles.noteHero, { color: palette.text }]}>
                                    <Text style={[styles.noteDash, { color: palette.primary }]}>{'— '}</Text>
                                    {entry.content}
                                </Text>
                            </Pressable>
                        ) : ownerEditing ? (
                            <Pressable
                                onPress={handleNoteEditStart}
                                style={styles.noteBlock}
                                accessibilityRole="button"
                                accessibilityLabel="Add your writing"
                            >
                                <Text style={[styles.noteMurmur, { color: palette.textMuted }]}>
                                    {'— say something about the night'}
                                </Text>
                            </Pressable>
                        ) : null}

                        {/* Dish line */}
                        {isEditingDish ? (
                            <View style={styles.dishEditor}>
                                <TextInput
                                    style={[styles.inlineTextInput, { backgroundColor: palette.surfaceContainerLow, color: palette.text }]}
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
                                    <Pressable onPress={handleDishSave} disabled={updateEntry.isPending} hitSlop={8}>
                                        <Text style={[styles.editAction, { color: palette.primary }]}>save</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : entry.dish_description ? (
                            <Pressable
                                onPress={ownerEditing ? handleDishEditStart : undefined}
                                disabled={!ownerEditing}
                                style={styles.dishRow}
                            >
                                <Text style={[styles.dishText, { color: palette.textSecondary }]}>
                                    <Text style={[styles.dishLabel, { color: palette.textMuted }]}>dish{'  '}</Text>
                                    {'—  '}{entry.dish_description}
                                </Text>
                            </Pressable>
                        ) : null}

                        {/* Breakdown — chips (read) / editor (edit mode) */}
                        {isEditingBreakdown ? (
                            <View style={styles.breakdownEditor}>
                                <View style={styles.breakdownEditorHeader}>
                                    <Text style={[styles.sectionTinyLabel, { color: palette.textMuted }]}>break it down</Text>
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
                                onPress={ownerEditing ? handleBreakdownEditStart : undefined}
                                disabled={!ownerEditing}
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
                                                    style={[styles.breakdownChip, { backgroundColor: palette.tertiaryFixed }]}
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

                        {/* ── From the night — your photos, mosaic + add tile ── */}
                        {hasUserPhotos || canAddPhotos ? (
                            <View style={styles.photosBlock}>
                                <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>From the night</Text>
                                <FromTheNight
                                    photos={allPhotos}
                                    canAdd={canAddPhotos}
                                    onAdd={handlePhotoPress}
                                    onPressPhoto={(i) => {
                                        setActivePhotoIndex(i);
                                        setLightboxOpen(true);
                                    }}
                                    palette={palette}
                                />

                                {/* In-progress new photo uploads */}
                                {newPhotoSlots.length > 0 && (
                                    <View style={{ marginTop: Spacing.sm }}>
                                        <MultiPhotoRow
                                            photos={newPhotoSlots}
                                            maxPhotos={MAX_PHOTOS - allPhotos.length}
                                            onAdd={handlePhotoPress}
                                            onRemove={(slotId) =>
                                                setNewPhotoSlots((prev) => prev.filter((s) => s.id !== slotId))
                                            }
                                            onRetry={(slotId) => {
                                                const slot = newPhotoSlots.find((s) => s.id === slotId);
                                                if (slot) startUploadForSlot(slotId, slot.localUri);
                                            }}
                                            palette={palette}
                                        />
                                    </View>
                                )}

                                {/* Manage panel — ⋯ → manage photos */}
                                {isOwnEntry && photoManageMode && hasUserPhotos && entryPhotoRows && entryPhotoRows.length > 0 ? (
                                    <View style={{ marginTop: Spacing.md }}>
                                        <Text style={[Type.caption, { color: palette.textMuted }]}>Tap a photo to remove it</Text>
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs }}>
                                            {entryPhotoRows.map((row) => (
                                                <Pressable
                                                    key={row.id}
                                                    onPress={() => handleRemoveExistingPhoto(row.photo_url)}
                                                    style={styles.photoThumbContainer}
                                                >
                                                    <Image source={{ uri: row.photo_url }} style={styles.photoThumb} resizeMode="cover" />
                                                    <View style={[styles.photoRemoveOverlay, { backgroundColor: palette.overlay }]}>
                                                        <Ionicons name="trash-outline" size={16} color={palette.textInverse} />
                                                    </View>
                                                </Pressable>
                                            ))}
                                        </View>
                                    </View>
                                ) : null}
                            </View>
                        ) : null}

                        {/* ── who you were with ──────────────────────────────── */}
                        {(entry.companions ?? []).length > 0 ? (
                            <Pressable
                                onPress={ownerEditing ? handleCompanionEditStart : undefined}
                                disabled={!ownerEditing}
                                style={styles.companionsRow}
                            >
                                <View style={styles.facesStack}>
                                    {(entry.companions ?? []).slice(0, 4).map((c, i) => (
                                        <View
                                            key={c.user_id}
                                            style={[
                                                styles.faceWrap,
                                                { marginLeft: i === 0 ? 0 : -10, zIndex: 4 - i, borderColor: palette.background },
                                            ]}
                                        >
                                            <InitialsAvatar name={c.display_name} size={28} palette={palette} />
                                        </View>
                                    ))}
                                </View>
                                <Text style={[styles.companionsText, { color: palette.textSecondary }]} numberOfLines={1}>
                                    {'with '}{formatCompanions(entry.companions)}
                                </Text>
                                {ownerEditing ? (
                                    <Text style={[styles.companionsEdit, { color: palette.primary }]}>+ tag</Text>
                                ) : null}
                            </Pressable>
                        ) : ownerEditing ? (
                            <Pressable
                                onPress={handleCompanionEditStart}
                                style={styles.companionsEmpty}
                                accessibilityRole="button"
                                accessibilityLabel="Who were you with?"
                            >
                                <View style={styles.companionsEmptyIcon}>
                                    <Ionicons name="person-add-outline" size={16} color={palette.primary} />
                                </View>
                                <Text style={[styles.companionsEmptyText, { color: palette.primary }]}>Who were you with?</Text>
                                <Text style={[styles.companionsEmptyHint, { color: palette.textMuted }]}>Tag people</Text>
                            </Pressable>
                        ) : null}
                    </View>

                    {/* ── Supper "at the table" accordion (TICKET-082) ───────── */}
                    {supperEnabled && entry.supper_id && supperDetail ? (
                        <SupperTable
                            detail={supperDetail}
                            centerpieceUserId={entry.user_id}
                            palette={palette}
                        />
                    ) : null}

                    {/* ── "add your take" — pending Supper member only ───────── */}
                    {viewerIsPendingTaker && entry.restaurant_id ? (
                        <Pressable
                            onPress={() =>
                                router.push({
                                    pathname: '/log-meal',
                                    params: {
                                        supperTakeId: entry.supper_id!,
                                        restaurant: JSON.stringify({
                                            id: entry.restaurant_id,
                                            name: entry.restaurants?.name ?? 'Restaurant',
                                        }),
                                    },
                                })
                            }
                            style={({ pressed }) => [
                                styles.addTakeCta,
                                { backgroundColor: palette.primary, opacity: pressed ? 0.88 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="add your take to this supper"
                        >
                            <Ionicons name="add" size={18} color="#fffdf8" />
                            <Text style={styles.addTakeCtaLabel}>add your take</Text>
                        </Pressable>
                    ) : null}

                    {/* ── Engagement — loved-by + replies ────────────────────── */}
                    {showEngagementBlock ? (
                        <View style={styles.engagement}>
                            <View style={styles.divider} />

                            {reactorList.length > 0 ? (
                                <View style={styles.lovedByRow}>
                                    <View style={styles.facesStack}>
                                        {reactorList.slice(0, 3).map((r, i) => (
                                            <View
                                                key={r.user_id}
                                                style={[
                                                    styles.faceWrap,
                                                    { marginLeft: i === 0 ? 0 : -9, zIndex: 3 - i, borderColor: palette.background },
                                                ]}
                                            >
                                                <InitialsAvatar name={r.name} size={26} palette={palette} />
                                            </View>
                                        ))}
                                    </View>
                                    <Text style={[styles.lovedByText, { color: palette.textSecondary }]} numberOfLines={2}>
                                        {'Loved by '}
                                        <Text style={[styles.lovedByName, { color: palette.text }]}>
                                            {reactorList[0].name}
                                        </Text>
                                        {reactorList.length === 2 ? (
                                            <>
                                                {' & '}
                                                <Text style={[styles.lovedByName, { color: palette.text }]}>
                                                    {reactorList[1].name}
                                                </Text>
                                            </>
                                        ) : null}
                                        {reactorExtra > 0 ? (
                                            <>
                                                {', '}
                                                <Text style={[styles.lovedByName, { color: palette.text }]}>
                                                    {reactorList[1].name}
                                                </Text>
                                                {` & ${reactorExtra} other${reactorExtra === 1 ? '' : 's'}`}
                                            </>
                                        ) : null}
                                    </Text>
                                </View>
                            ) : null}

                            {comments.length > 0 ? (
                                <>
                                    <Text style={[styles.repliesHeader, { color: palette.textMuted }]}>
                                        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                                    </Text>
                                    {threadRoots.map((root) => (
                                        <React.Fragment key={root.id}>
                                            <ReplyBubble
                                                comment={root}
                                                targetType="entry"
                                                targetId={entry.id}
                                                scope={interactionScope}
                                                palette={palette}
                                                canReply={!repliesDisabled}
                                                onReply={() => startReply(root.id, root.profiles?.display_name ?? 'Someone')}
                                                onRetry={root.failed && root.client_nonce ? () => handleCommentRetry(root) : undefined}
                                                onDiscard={root.failed && root.client_nonce ? () => handleCommentDiscard(root) : undefined}
                                            />
                                            {(repliesByRoot.get(root.id) ?? []).map((reply) => (
                                                <ReplyBubble
                                                    key={reply.id}
                                                    comment={reply}
                                                    targetType="entry"
                                                    targetId={entry.id}
                                                    scope={interactionScope}
                                                    palette={palette}
                                                    isReply
                                                    canReply={!repliesDisabled}
                                                    onReply={() => startReply(root.id, reply.profiles?.display_name ?? 'Someone')}
                                                    onRetry={reply.failed && reply.client_nonce ? () => handleCommentRetry(reply) : undefined}
                                                    onDiscard={reply.failed && reply.client_nonce ? () => handleCommentDiscard(reply) : undefined}
                                                />
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </>
                            ) : null}

                            {isPublicView && repliesDisabled ? (
                                <Text style={[styles.repliesOffText, { color: palette.textMuted }]}>
                                    The author has replies turned off.
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </ScrollView>

                {/* ── Persistent bottom composer — heart + reply ─────────────── */}
                {hasEngagement ? (
                    <PosterComposer
                        entryId={entry.id}
                        palette={palette}
                        scope={interactionScope}
                        tableId={entry.table_id ?? undefined}
                        myReactions={myReactions}
                        allReactions={interactions?.reactions ?? []}
                        repliesDisabled={repliesDisabled}
                        bottomInset={insets.bottom}
                        autoFocusReply={replyFocus}
                        replyingTo={replyingTo}
                        onCancelReply={() => setReplyingTo(null)}
                        onReplySent={() => { setReplyFocus(false); setReplyingTo(null); }}
                    />
                ) : null}
            </View>

            {/* Companion picker sheet — owner edit */}
            {isOwnEntry ? (
                <CompanionPickerSheet
                    visible={companionEditMode}
                    onClose={handleCompanionSave}
                    selectedIds={new Set(localCompanions.map((c) => c.user_id))}
                    onToggle={toggleLocalCompanion}
                    currentUserId={viewer?.id}
                    palette={palette}
                />
            ) : null}

            {/* Full-screen photo lightbox */}
            <PhotoLightbox
                visible={lightboxOpen && hasUserPhotos}
                photos={allPhotos}
                initialIndex={activePhotoIndex}
                palette={palette}
                topInset={insets.top}
                onClose={() => setLightboxOpen(false)}
            />

            {/* ── ⋯ overflow menu — every owner action lives here ──────────── */}
            <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
                <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
                    <Pressable
                        style={[styles.menuSheet, { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + Spacing.md }]}
                        onPress={() => {}}
                    >
                        {isOwnEntry ? (
                            <Pressable
                                style={styles.menuRow}
                                onPress={() => { setMenuOpen(false); setEditMode(true); }}
                                accessibilityRole="button"
                            >
                                <Ionicons name="create-outline" size={20} color={palette.text} />
                                <Text style={[styles.menuLabel, { color: palette.text }]}>edit review</Text>
                            </Pressable>
                        ) : null}
                        {isOwnEntry && hasUserPhotos ? (
                            <Pressable
                                style={styles.menuRow}
                                onPress={() => { setMenuOpen(false); setPhotoManageMode(true); }}
                                accessibilityRole="button"
                            >
                                <Ionicons name="images-outline" size={20} color={palette.text} />
                                <Text style={[styles.menuLabel, { color: palette.text }]}>manage photos</Text>
                            </Pressable>
                        ) : null}
                        {isOwnEntry ? (
                            <Pressable
                                style={styles.menuRow}
                                onPress={() => { setMenuOpen(false); handleDelete(); }}
                                accessibilityRole="button"
                            >
                                <Ionicons name="trash-outline" size={20} color={palette.primary} />
                                <Text style={[styles.menuLabel, { color: palette.primary }]}>delete review</Text>
                            </Pressable>
                        ) : null}
                        <Pressable
                            style={[styles.menuRow, styles.menuCancel]}
                            onPress={() => setMenuOpen(false)}
                            accessibilityRole="button"
                        >
                            <Text style={[styles.menuLabel, { color: palette.textMuted }]}>cancel</Text>
                        </Pressable>
                    </Pressable>
                </Pressable>
            </Modal>
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

// ── FromTheNight ──────────────────────────────────────────────────────────────
//
// Adaptive "from the night" mosaic — the user's OWN photos, with the add tile
// built into the composition (never a floating button). A big lead photo on the
// left; a stacked right column carrying a second photo and, for the owner, the
// dashed Add tile. A "+N" overlay covers photos beyond what the grid shows.

function FromTheNight({
    photos,
    canAdd,
    onAdd,
    onPressPhoto,
    palette,
}: {
    photos: string[];
    canAdd: boolean;
    onAdd: () => void;
    onPressPhoto: (index: number) => void;
    palette: Palette;
}) {
    const n = photos.length;

    const addTile = (style: any) => (
        <Pressable
            onPress={onAdd}
            style={[styles.ftnAddTile, style]}
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
        >
            <Ionicons name="add" size={19} color={palette.primary} />
            <Text style={[styles.ftnAddLabel, { color: palette.primary }]}>Add</Text>
        </Pressable>
    );

    // 0 photos (owner only — caller hides the section otherwise) → wide add tile.
    if (n === 0) {
        return (
            <Pressable
                onPress={onAdd}
                style={styles.ftnWideAdd}
                accessibilityRole="button"
                accessibilityLabel="Add a photo"
            >
                <Ionicons name="add" size={20} color={palette.primary} />
                <Text style={[styles.ftnWideAddLabel, { color: palette.primary }]}>Add a photo</Text>
            </Pressable>
        );
    }

    // 1 photo → big photo + (owner) add tile beside it, else single wide photo.
    if (n === 1) {
        if (canAdd) {
            return (
                <View style={styles.ftnRow}>
                    <Pressable style={styles.ftnBig} onPress={() => onPressPhoto(0)}>
                        <Image source={{ uri: photos[0] }} style={styles.ftnImg} resizeMode="cover" />
                    </Pressable>
                    <View style={styles.ftnSide}>{addTile({ flex: 1 })}</View>
                </View>
            );
        }
        return (
            <Pressable style={styles.ftnSingle} onPress={() => onPressPhoto(0)}>
                <Image source={{ uri: photos[0] }} style={styles.ftnImg} resizeMode="cover" />
            </Pressable>
        );
    }

    // 2+ photos → big lead + right column.
    const remainingIfAdd = n - 2; // hidden behind the top thumb when Add owns the bottom
    const remainingIfNoAdd = n - 3; // hidden behind the bottom thumb (non-owner)
    return (
        <View style={styles.ftnRow}>
            <Pressable style={styles.ftnBig} onPress={() => onPressPhoto(0)}>
                <Image source={{ uri: photos[0] }} style={styles.ftnImg} resizeMode="cover" />
            </Pressable>
            <View style={styles.ftnSide}>
                <Pressable style={styles.ftnCell} onPress={() => onPressPhoto(1)}>
                    <Image source={{ uri: photos[1] }} style={styles.ftnImg} resizeMode="cover" />
                    {canAdd && remainingIfAdd > 0 ? (
                        <View style={[styles.ftnMoreOverlay, { backgroundColor: palette.overlay }]}>
                            <Text style={[styles.ftnMoreText, { color: palette.textOnImage }]}>+{remainingIfAdd}</Text>
                        </View>
                    ) : null}
                </Pressable>
                {canAdd ? (
                    addTile(styles.ftnCell)
                ) : n >= 3 ? (
                    <Pressable style={styles.ftnCell} onPress={() => onPressPhoto(2)}>
                        <Image source={{ uri: photos[2] }} style={styles.ftnImg} resizeMode="cover" />
                        {remainingIfNoAdd > 0 ? (
                            <View style={[styles.ftnMoreOverlay, { backgroundColor: palette.overlay }]}>
                                <Text style={[styles.ftnMoreText, { color: palette.textOnImage }]}>+{remainingIfNoAdd}</Text>
                            </View>
                        ) : null}
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

// ── PhotoLightbox ─────────────────────────────────────────────────────────────
//
// Full-screen black pager opened when a mosaic tile is tapped. Horizontal paging
// carousel with dot indicators; close affordance top-right.

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
                        <Image key={i} source={{ uri: url }} style={styles.lightboxImg} resizeMode="contain" />
                    ))}
                </ScrollView>
                {photos.length > 1 ? (
                    <View style={styles.pageDots}>
                        {photos.map((_, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.pageDot,
                                    { backgroundColor: i === index ? palette.tertiary : 'rgba(255,255,255,0.4)' },
                                ]}
                            />
                        ))}
                    </View>
                ) : null}
            </View>
        </Modal>
    );
}

// ── ReplyBubble ───────────────────────────────────────────────────────────────
//
// A single reply rendered as a warm bubble — avatar + name·time + roman-serif
// body. Flat (the data model carries no thread parent or per-reply reactions —
// threading/❤️ is a follow-up ticket). Author keeps edit/delete via the ••• menu;
// failed sends keep retry/discard.

function ReplyBubble({
    comment,
    targetType,
    targetId,
    scope = 'table',
    palette,
    isReply = false,
    canReply = true,
    onReply,
    onRetry,
    onDiscard,
}: {
    comment: Comment;
    targetType: TargetType;
    targetId: string;
    scope?: Scope;
    palette: Palette;
    isReply?: boolean;
    canReply?: boolean;
    onReply?: () => void;
    onRetry?: () => void;
    onDiscard?: () => void;
}) {
    const { user } = useAuth();
    const editComment = useEditComment();
    const deleteComment = useDeleteComment();
    const toggleLike = useToggleCommentLike();
    const [isEditing, setIsEditing] = useState(false);
    const [editBody, setEditBody] = useState(comment.body);

    const isAuthor = !!user && comment.user_id === user.id;
    const ageMs = Date.now() - new Date(comment.created_at).getTime();
    const canEdit = isAuthor && ageMs < 5 * 60 * 1000 && !comment.pending;
    const canDelete = isAuthor && !comment.pending;

    const name = comment.profiles?.display_name ?? 'Someone';
    const timeLabel = comment.failed
        ? "couldn't send"
        : comment.pending
        ? 'sending…'
        : formatRelativeTime(comment.created_at);
    const muted = comment.pending || comment.failed;
    const interactive = !comment.pending && !comment.failed;
    const liked = !!comment.viewer_liked;
    const likeCount = comment.like_count ?? 0;

    const handleToggleLike = () => {
        if (!interactive) return;
        toggleLike.mutate({ targetType, targetId, commentId: comment.id, scope });
    };

    const handleDelete = () => {
        deleteComment.mutate({ targetType, targetId, commentId: comment.id, scope });
    };

    const handleMenu = () => {
        const options = canEdit ? ['Cancel', 'Edit', 'Delete'] : ['Cancel', 'Delete'];
        const deleteIndex = options.length - 1;
        const editIndex = canEdit ? 1 : -1;
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                { options, cancelButtonIndex: 0, destructiveButtonIndex: deleteIndex },
                (idx) => {
                    if (canEdit && idx === editIndex) setIsEditing(true);
                    if (idx === deleteIndex) handleDelete();
                },
            );
        } else {
            const alertOptions: any[] = [];
            if (canEdit) alertOptions.push({ text: 'Edit', onPress: () => setIsEditing(true) });
            alertOptions.push({ text: 'Delete', style: 'destructive', onPress: handleDelete });
            alertOptions.push({ text: 'Cancel', style: 'cancel' });
            Alert.alert('Reply', undefined, alertOptions);
        }
    };

    const handleSaveEdit = () => {
        const trimmed = editBody.trim();
        if (!trimmed) return;
        editComment.mutate(
            { targetType, targetId, commentId: comment.id, body: trimmed, scope },
            { onSuccess: () => setIsEditing(false), onError: () => setIsEditing(false) },
        );
    };

    return (
        <View style={[styles.rbRow, isReply && styles.rbReplyRow, { opacity: muted ? 0.7 : 1 }]}>
            <InitialsAvatar name={name} size={isReply ? 28 : 32} palette={palette} />
            <View style={{ flex: 1, minWidth: 0 }}>
                <View style={[styles.rbBubble, Shadow.note, { backgroundColor: isReply ? palette.primaryMuted : palette.surfaceNote }]}>
                    <View style={styles.rbNameRow}>
                        <Text style={[styles.rbName, { color: palette.text }]}>{name}</Text>
                        <Text style={[styles.rbTime, { color: palette.textMuted }]}>
                            {' · '}{timeLabel}{comment.edited_at && !comment.pending ? ' · edited' : ''}
                        </Text>
                        {isAuthor && canDelete && !isEditing ? (
                            <Pressable onPress={handleMenu} hitSlop={8} style={styles.rbMenuBtn} accessibilityLabel="Reply options">
                                <Text style={[styles.rbMenuDots, { color: palette.textMuted }]}>•••</Text>
                            </Pressable>
                        ) : null}
                    </View>

                    {isEditing ? (
                        <View style={styles.rbEdit}>
                            <TextInput
                                value={editBody}
                                onChangeText={setEditBody}
                                style={[
                                    styles.rbEditInput,
                                    { color: palette.text, borderColor: palette.outlineVariant, backgroundColor: palette.surfaceContainerLow },
                                ]}
                                multiline
                                maxLength={2000}
                                autoFocus
                                placeholderTextColor={palette.textMuted}
                            />
                            <View style={styles.rbEditActions}>
                                <Pressable onPress={() => { setIsEditing(false); setEditBody(comment.body); }} hitSlop={8}>
                                    <Text style={[styles.rbActionLabel, { color: palette.textSecondary }]}>Cancel</Text>
                                </Pressable>
                                <Pressable onPress={handleSaveEdit} hitSlop={8}>
                                    <Text style={[styles.rbActionLabel, { color: palette.primary }]}>Save</Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : (
                        <Text style={[styles.rbBody, { color: palette.text }]}>{comment.body}</Text>
                    )}
                </View>

                {interactive ? (
                    <View style={styles.rbActions}>
                        <Pressable onPress={handleToggleLike} disabled={toggleLike.isPending} hitSlop={6} accessibilityLabel={liked ? 'Unlike reply' : 'Love reply'}>
                            <Text style={[styles.rbActionBtn, { color: liked ? palette.primary : palette.textMuted }]}>
                                {liked ? 'Loved' : 'Love'}
                            </Text>
                        </Pressable>
                        {canReply && onReply ? (
                            <Pressable onPress={onReply} hitSlop={6} accessibilityLabel="Reply">
                                <Text style={[styles.rbActionBtn, { color: palette.textMuted }]}>Reply</Text>
                            </Pressable>
                        ) : null}
                        {likeCount > 0 ? (
                            <View style={styles.rbLikeCount}>
                                <Ionicons name="heart" size={11} color={palette.primary} />
                                <Text style={[styles.rbActionBtn, { color: palette.textMuted }]}>{likeCount}</Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}

                {comment.failed ? (
                    <View style={styles.rbFailedActions}>
                        {onRetry ? (
                            <Pressable onPress={onRetry} hitSlop={8} accessibilityLabel="Retry sending reply">
                                <Text style={[styles.rbActionLabel, { color: palette.primary }]}>Retry</Text>
                            </Pressable>
                        ) : null}
                        {onDiscard ? (
                            <Pressable onPress={onDiscard} hitSlop={8} accessibilityLabel="Discard failed reply">
                                <Text style={[styles.rbActionLabel, { color: palette.textSecondary }]}>Discard</Text>
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}
            </View>
        </View>
    );
}

// ── PosterComposer ────────────────────────────────────────────────────────────
//
// Persistent bottom bar: a heart toggle (tap = ❤️ on/off, long-press = emoji
// picker in table scope / reactors sheet in public scope) and an inline reply
// composer. Replaces the old floating pill + slide-up composer. KeyboardAvoiding
// keeps it pinned above the keyboard.

interface PosterComposerProps {
    entryId: string;
    palette: Palette;
    scope?: Scope;
    tableId?: string;
    myReactions: string[];
    allReactions?: import('@/hooks/posts/usePostInteractions').Reaction[];
    repliesDisabled?: boolean;
    bottomInset: number;
    autoFocusReply?: boolean;
    /** TICKET-085: when set, the reply attaches to this thread root + shows a chip. */
    replyingTo?: { id: string; name: string } | null;
    onCancelReply?: () => void;
    onReplySent?: () => void;
}

function PosterComposer({
    entryId,
    palette,
    scope = 'table',
    tableId,
    myReactions,
    allReactions = [],
    repliesDisabled = false,
    bottomInset,
    autoFocusReply = false,
    replyingTo = null,
    onCancelReply,
    onReplySent,
}: PosterComposerProps) {
    const toggleReaction = useToggleReaction();
    const addComment = useAddComment();

    const anchorRef = useRef<View>(null);
    const inputRef = useRef<TextInput>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);
    const [reactorsEmoji, setReactorsEmoji] = useState<string | null>(null);
    const [body, setBody] = useState('');
    const [sendError, setSendError] = useState<string | null>(null);

    useEffect(() => {
        if ((autoFocusReply || replyingTo) && !repliesDisabled) {
            const t = setTimeout(() => inputRef.current?.focus(), 250);
            return () => clearTimeout(t);
        }
    }, [autoFocusReply, replyingTo, repliesDisabled]);

    const likedEmoji = myReactions.includes('❤️') ? '❤️' : myReactions[0] ?? null;
    const liked = !!likedEmoji;

    const applyToggle = (emoji: string) => {
        // If switching from one emoji to another, remove the old one first.
        if (!myReactions.includes(emoji) && likedEmoji && likedEmoji !== emoji) {
            toggleReaction.mutate({ targetType: 'entry', targetId: entryId, emoji: likedEmoji, scope, tableId });
        }
        toggleReaction.mutate({ targetType: 'entry', targetId: entryId, emoji, scope, tableId });
    };

    const handleTapLike = () => applyToggle(liked ? likedEmoji! : '❤️');

    const handleLongPress = () => {
        if (scope === 'public') {
            setReactorsEmoji(likedEmoji ?? '❤️');
            return;
        }
        if (!anchorRef.current) return;
        const handle = findNodeHandle(anchorRef.current);
        if (handle == null) return;
        UIManager.measureInWindow(handle, (x, y) => setPickerAnchor({ x, y }));
    };

    const handlePick = (emoji: string) => {
        setPickerAnchor(null);
        applyToggle(emoji);
    };

    const trimmed = body.trim();
    const canSend = trimmed.length >= 1 && !addComment.isPending;

    const handleSend = () => {
        if (!canSend) return;
        setSendError(null);
        const pendingBody = trimmed;
        const nonce = `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        addComment.mutate(
            { targetType: 'entry', targetId: entryId, body: pendingBody, clientNonce: nonce, scope, tableId, parentCommentId: replyingTo?.id },
            {
                onSuccess: () => {
                    setBody('');
                    setSendError(null);
                    onReplySent?.();
                },
                onError: (err: any) => {
                    setBody(pendingBody);
                    setSendError(err?.message ?? err?.error ?? 'Send failed. Tap retry.');
                },
            },
        );
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.composerWrap}
            pointerEvents="box-none"
        >
            <View
                style={[
                    styles.composer,
                    {
                        backgroundColor: palette.surfaceNote,
                        borderTopColor: palette.divider,
                        paddingBottom: Math.max(bottomInset, 12) + 6,
                    },
                ]}
            >
                {replyingTo && !repliesDisabled ? (
                    <View style={styles.composerReplyChip}>
                        <Text style={[styles.composerReplyChipText, { color: palette.textSecondary }]} numberOfLines={1}>
                            {'Replying to '}
                            <Text style={{ fontFamily: 'Manrope_700Bold', color: palette.text }}>{replyingTo.name}</Text>
                        </Text>
                        <Pressable onPress={onCancelReply} hitSlop={8} accessibilityLabel="Cancel reply">
                            <Ionicons name="close" size={14} color={palette.textMuted} />
                        </Pressable>
                    </View>
                ) : null}
                {sendError ? (
                    <Text style={[styles.composerErr, { color: palette.error }]}>{sendError}</Text>
                ) : null}
                <View style={styles.composerRow}>
                    <Pressable
                        ref={anchorRef}
                        onPress={handleTapLike}
                        onLongPress={handleLongPress}
                        delayLongPress={220}
                        hitSlop={6}
                        style={[
                            styles.composerHeart,
                            {
                                borderColor: liked ? 'rgba(160,63,40,0.35)' : 'rgba(138,114,108,0.3)',
                                backgroundColor: liked ? 'rgba(160,63,40,0.07)' : 'transparent',
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={liked ? 'Unlike' : 'Like (long-press to pick an emoji)'}
                    >
                        {liked && likedEmoji !== '❤️' ? (
                            <Text style={styles.composerHeartEmoji} allowFontScaling={false}>{likedEmoji}</Text>
                        ) : (
                            <Ionicons
                                name={liked ? 'heart' : 'heart-outline'}
                                size={22}
                                color={liked ? palette.primary : palette.textSecondary}
                            />
                        )}
                    </Pressable>

                    {!repliesDisabled ? (
                        <View
                            style={[
                                styles.composerInputPill,
                                { backgroundColor: palette.background, borderColor: palette.dividerSoft },
                            ]}
                        >
                            <TextInput
                                ref={inputRef}
                                value={body}
                                onChangeText={(t) => {
                                    setBody(t);
                                    if (sendError) setSendError(null);
                                }}
                                placeholder="Add a reply…"
                                placeholderTextColor={palette.textMuted}
                                style={[styles.composerInput, { color: palette.text }]}
                                multiline
                                blurOnSubmit={false}
                            />
                            <Pressable
                                onPress={handleSend}
                                disabled={!canSend}
                                style={[
                                    styles.composerSend,
                                    { backgroundColor: canSend ? palette.primary : palette.outlineVariant },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel="Send reply"
                            >
                                {addComment.isPending ? (
                                    <ActivityIndicator size="small" color="#fffdf8" />
                                ) : (
                                    <Ionicons name="send" size={15} color="#fffdf8" />
                                )}
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.composerDisabled}>
                            <Text style={[styles.composerDisabledText, { color: palette.textMuted }]}>
                                Replies are off for this review.
                            </Text>
                        </View>
                    )}
                </View>
            </View>

            <ReactionPicker
                visible={!!pickerAnchor}
                anchor={pickerAnchor}
                onPick={handlePick}
                onClose={() => setPickerAnchor(null)}
            />

            {reactorsEmoji !== null && (
                <ReactorsSheet
                    emoji={reactorsEmoji}
                    reactors={allReactions.filter((r) => r.emoji === reactorsEmoji)}
                    onClose={() => setReactorsEmoji(null)}
                    scope={scope}
                />
            )}
        </KeyboardAvoidingView>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const PAGE_H = 22;
const DIVIDER = 'rgba(221, 192, 186, 0.5)';

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // ── Top nav ──
    nav: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: Spacing.sm,
    },
    navSideL: { flex: 1, alignItems: 'flex-start' },
    navSideR: { flex: 1, alignItems: 'flex-end' },
    navBack: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    navBackLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    navTitle: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 2,
        textTransform: 'uppercase',
        textAlign: 'center',
    },
    navDone: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },

    // ── Body ──
    body: { paddingHorizontal: PAGE_H, paddingTop: Spacing.sm },

    // who · when
    whoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Spacing.lg },
    whoName: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
    whoMeta: { fontFamily: 'Manrope_400Regular', fontSize: 13, flexShrink: 1 },

    // place + rating
    placeRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    placeName: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 36,
        lineHeight: 39,
        letterSpacing: -0.7,
    },
    placeMeta: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1.2,
        marginTop: 9,
    },
    ratingNumeralWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 3, paddingTop: 4 },
    ratingNumeral: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 34, lineHeight: 36 },
    ratingDenom: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 16, color: '#cdb8a8' },
    ratePrompt: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
    ratePromptText: { fontFamily: 'Manrope_500Medium', fontSize: 11, letterSpacing: 0.4 },

    ratingHeart: { marginLeft: 3, alignSelf: 'center' },


    // rating editor
    ratingEditor: { marginTop: Spacing.md, alignItems: 'flex-start', gap: Spacing.sm },
    editButtonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, marginTop: Spacing.sm },
    editAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.3 },

    // round banner
    roundBanner: {
        marginTop: Spacing.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    roundBannerTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },

    divider: { height: 1, backgroundColor: DIVIDER, marginVertical: Spacing.lg },

    // the note — hero
    noteBlock: {},
    noteHero: { fontFamily: 'Newsreader_400Regular', fontSize: 20, lineHeight: 30 },
    noteDash: { fontFamily: 'Newsreader_600SemiBold' },
    noteMurmur: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 19, lineHeight: 29 },
    noteEditor: {},
    noteInput: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 20,
        lineHeight: 30,
        minHeight: 120,
        padding: 0,
        textAlignVertical: 'top',
    },

    // dish
    dishRow: { marginTop: Spacing.md },
    dishText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 15, lineHeight: 22 },
    dishLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
    dishEditor: { marginTop: Spacing.md },
    inlineTextInput: {
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        fontSize: 15,
        fontFamily: 'Manrope_400Regular',
        minHeight: 44,
    },

    // breakdown
    breakdownStripWrap: { marginTop: Spacing.md },
    breakdownChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    breakdownChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
    breakdownChipLabel: { fontFamily: 'Manrope_500Medium', fontSize: 10, letterSpacing: 0.3, textTransform: 'lowercase' },
    breakdownChipNum: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 13 },
    breakdownEditor: { marginTop: Spacing.md, gap: Spacing.xs },
    breakdownEditorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
    breakdownEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
    breakdownEditLabel: { fontFamily: 'Manrope_500Medium', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', width: 60 },
    sectionTinyLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },

    // ── From the night ──
    photosBlock: { marginTop: Spacing.lg },
    sectionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: 11,
    },
    ftnRow: { flexDirection: 'row', gap: 8, height: 176 },
    ftnBig: { flex: 2, borderRadius: 14, overflow: 'hidden' },
    ftnSide: { flex: 1, gap: 8 },
    ftnCell: { flex: 1, borderRadius: 14, overflow: 'hidden' },
    ftnImg: { width: '100%', height: '100%' },
    ftnSingle: { width: '100%', height: 200, borderRadius: 14, overflow: 'hidden' },
    ftnAddTile: {
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: 'rgba(160,63,40,0.4)',
        backgroundColor: 'rgba(160,63,40,0.04)',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    ftnAddLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 9, letterSpacing: 0.5 },
    ftnWideAdd: {
        height: 96,
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: 'rgba(160,63,40,0.4)',
        backgroundColor: 'rgba(160,63,40,0.04)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    ftnWideAddLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    ftnMoreOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ftnMoreText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 22 },

    // companions
    facesStack: { flexDirection: 'row', alignItems: 'center' },
    faceWrap: { borderRadius: 999, borderWidth: 1.5 },
    companionsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: Spacing.lg },
    companionsText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 14, flexShrink: 1 },
    companionsEdit: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginLeft: 'auto' },
    companionsEmpty: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: Spacing.lg,
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: 'rgba(160,63,40,0.35)',
        borderRadius: 14,
        backgroundColor: 'rgba(160,63,40,0.03)',
    },
    companionsEmptyIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: 'rgba(160,63,40,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    companionsEmptyText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    companionsEmptyHint: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginLeft: 'auto' },

    // add-your-take CTA (supper)
    addTakeCta: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginHorizontal: PAGE_H,
        marginTop: Spacing.md,
        paddingVertical: 14,
        borderRadius: Radius.lg,
    },
    addTakeCtaLabel: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17, color: '#fffdf8' },

    // ── Engagement ──
    engagement: { paddingHorizontal: PAGE_H, marginTop: Spacing.sm },
    lovedByRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: Spacing.xs },
    lovedByText: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 18, flex: 1 },
    lovedByName: { fontFamily: 'Manrope_700Bold' },
    repliesHeader: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginTop: Spacing.lg,
        marginBottom: 4,
    },
    repliesOffText: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: Spacing.sm },

    // ── ReplyBubble ──
    rbRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', marginTop: 14 },
    rbBubble: { borderRadius: 16, borderBottomLeftRadius: 5, paddingVertical: 11, paddingHorizontal: 14 },
    rbNameRow: { flexDirection: 'row', alignItems: 'center' },
    rbName: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
    rbTime: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
    rbMenuBtn: { marginLeft: 'auto', paddingHorizontal: 4 },
    rbMenuDots: { fontFamily: 'Manrope_500Medium', fontSize: 12, lineHeight: 12 },
    rbBody: { fontFamily: 'Newsreader_400Regular', fontSize: 15, lineHeight: 22, marginTop: 3 },
    rbEdit: { marginTop: 6, gap: 6 },
    rbEditInput: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: Radius.sm,
        padding: Spacing.sm,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 20,
        minHeight: 48,
    },
    rbEditActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.md },
    rbActionLabel: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
    rbFailedActions: { flexDirection: 'row', gap: Spacing.md, marginTop: 6, marginLeft: 4 },
    rbReplyRow: { marginLeft: 30, marginTop: 10 },
    rbActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 7, marginLeft: 4 },
    rbActionBtn: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
    rbLikeCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },

    // ── Persistent composer ──
    composerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    composer: {
        paddingHorizontal: 20,
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 8,
    },
    composerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    composerHeart: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    composerHeartEmoji: { fontSize: 20, lineHeight: 24 },
    composerInputPill: {
        flex: 1,
        minHeight: 48,
        borderRadius: 24,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 18,
        paddingRight: 6,
    },
    composerInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, maxHeight: 100, paddingVertical: 12 },
    composerSend: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
    composerDisabled: { flex: 1, justifyContent: 'center', paddingLeft: 4 },
    composerDisabledText: { fontFamily: 'Manrope_400Regular', fontSize: 13 },
    composerErr: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginBottom: 8, marginLeft: 60 },
    composerReplyChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6, paddingHorizontal: 4, marginBottom: 2 },
    composerReplyChipText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },

    // ── ⋯ overflow menu ──
    menuBackdrop: { flex: 1, backgroundColor: 'rgba(28,28,25,0.32)', justifyContent: 'flex-end' },
    menuSheet: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, paddingTop: Spacing.sm, paddingHorizontal: Spacing.lg },
    menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: Spacing.md },
    menuCancel: { justifyContent: 'center', marginTop: Spacing.xs },
    menuLabel: { fontFamily: 'Manrope_500Medium', fontSize: 16 },

    // ── Photo manage thumbs ──
    photoThumbContainer: { position: 'relative', width: 80, height: 80 },
    photoThumb: { width: 80, height: 80, borderRadius: Radius.md },
    photoRemoveOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },

    // ── Photo lightbox ──
    lightboxBackdrop: { flex: 1, backgroundColor: '#000' },
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
    lightboxImg: { width: SCREEN_WIDTH, flex: 1 },
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
    pageDot: { width: 6, height: 6, borderRadius: 3 },
});

// Wrap the screen so a bad entry's render error shows a graceful fallback
// instead of crashing the whole app (TICKET-083 polish). This boundary catches
// before the root one, so it must report too (TICKET-088 crash visibility).
export default function EntryDetailScreenWithBoundary() {
    return (
        <ErrorBoundary screen="entry-detail" onError={(e) => trackError(e, 'entry-detail')}>
            <EntryDetailScreen />
        </ErrorBoundary>
    );
}
