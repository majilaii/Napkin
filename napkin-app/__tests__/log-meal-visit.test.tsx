/* eslint-disable import/first -- Replace native hosts before loading the route. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (v: any) => v.ios ?? v.default },
        StyleSheet: { create: (v: any) => v, flatten: (v: any) => Array.isArray(v) ? Object.assign({}, ...v.filter(Boolean)) : v, absoluteFill: {}, hairlineWidth: 1 },
        View: host('View'), Modal: (props: any) => props.visible === false ? null : ReactModule.createElement('Modal', props, props.children), Text: host('Text'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
        ActivityIndicator: host('ActivityIndicator'), Alert: { alert: jest.fn() },
    };
});
jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn(), useRouter: jest.fn(), Stack: { Screen: () => null } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), MediaTypeOptions: { Images: 'Images' } }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'owner' }, signOut: jest.fn() }) }));
jest.mock('@/providers/ToastProvider', () => ({ useToast: jest.fn() }));
jest.mock('@/hooks/tables/useTables', () => ({ useTables: () => ({ data: [{ tables: { id: 'old-table', name: 'Friends' } }, { tables: { id: 'new-table', name: 'Lunch club' } }] }) }));
jest.mock('@/hooks/tables/useCreateEntry', () => ({ useCreateEntry: jest.fn() }));
jest.mock('@/hooks/users/useUserProfile', () => ({ useUserProfile: () => ({ data: { data: { profile: { account_privacy: 'public' } } } }) }));
jest.mock('@/hooks/restaurants/useAvailableVisitCheckIns', () => ({ useAvailableVisitCheckIns: jest.fn() }));
jest.mock('@/hooks/restaurants/useVisitReviewDraft', () => ({ useVisitReviewDraft: jest.fn() }));
jest.mock('@/hooks/suppers', () => ({ useAddSupperTake: () => ({ isPending: false }), useAttachTakeToSupper: () => ({ isPending: false }), isAttachConflict: () => false }));
jest.mock('@/components/suppers', () => ({ StitchConfirmSheet: () => null }));
jest.mock('@/components/logging/CompanionPickerSheet', () => ({ CompanionPickerSheet: () => null }));
jest.mock('@/components/log/PhotoMosaic', () => ({ PhotoMosaic: () => null }));
jest.mock('@/components/log/PhotoViewer', () => ({ PhotoViewer: () => null }));
jest.mock('@/components/log/NoteEditorModal', () => ({ NoteEditorModal: () => null }));
jest.mock('@/components/log/CalendarModal', () => ({ CalendarModal: () => null }));
jest.mock('@/lib/imageUpload', () => ({ compressAndUpload: jest.fn(), PhotoUploadError: class PhotoUploadError extends Error {} }));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useToast } from '@/providers/ToastProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useAvailableVisitCheckIns } from '@/hooks/restaurants/useAvailableVisitCheckIns';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import { useVisitReviewDraft, type VisitReviewDraft } from '@/hooks/restaurants/useVisitReviewDraft';
import { PhotoMosaic } from '@/components/log/PhotoMosaic';
import { NoteEditorModal } from '@/components/log/NoteEditorModal';
import { CalendarModal } from '@/components/log/CalendarModal';
import { CompanionPickerSheet } from '@/components/logging/CompanionPickerSheet';
import { compressAndUpload } from '@/lib/imageUpload';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { makeTestClient } from './utils/queryWrapper';
import LogMealScreen from '@/app/log-meal';

const back = jest.fn();
const create = jest.fn();
const toast = jest.fn();
const refetch = jest.fn();
const photoUrls = Array.from({ length: 8 }, (_, i) => `https://photos.example/${i}.jpg`);
const original: VisitReviewDraft = {
    id: 'older-visit', user_id: 'owner', restaurant_id: 'brawn',
    created_at: '2026-08-10T18:00:00.000Z', visited_at: '2026-08-10T18:15:00.000Z',
    rating: 4.5, content: 'A birthday dinner', liked: true, visibility: 'private',
    vibe_rating: 3, flavor_rating: 4.5, service_rating: 4, value_rating: 3.5,
    photos: photoUrls.map((url, i) => ({ id: `p${i}`, url })),
    companions: [{ user_id: 'carmen', display_name: 'Carmen', avatar_url: null }],
    table_ids: ['old-table'],
};
const pageKey = queryKeys.restaurants.page('brawn');
const selectionKey = queryKeys.restaurants.visitSelection('owner', 'brawn');

const checkInDraft: VisitReviewDraft = {
    ...original, rating: null, content: null, photos: [],
    liked: false, vibe_rating: null, flavor_rating: null, service_rating: null, value_rating: null,
};

const checkInRow = (draft: VisitReviewDraft): SelfLogRow => ({
    id: `entry:${draft.id}`, entry_id: draft.id, source: 'solo', supper_id: null, table_night_id: null,
    created_at: draft.created_at, visited_at: draft.visited_at, rating: null, note: null,
    photos: [], companions: draft.companions.map((companion) => companion.user_id), is_bare: true,
});

function suggestCheckIns(...drafts: VisitReviewDraft[]) {
    (useAvailableVisitCheckIns as jest.Mock).mockReturnValue({
        data: drafts.map(checkInRow), isPending: false, isError: false, refetch: jest.fn(),
    });
}

function discardPrompt() {
    const calls = (Alert.alert as jest.Mock).mock.calls;
    const latest = calls[calls.length - 1];
    expect(latest[0]).toBe('Discard this draft?');
    return latest[2] as { text: string; style?: string; onPress?: () => void }[];
}

function resultFor(draft = original) {
    return { entry: { ...draft, is_bare: false } };
}

function mount(draft: VisitReviewDraft | undefined = original, options: { newMeal?: boolean; loading?: boolean; error?: boolean; draftsById?: Record<string, VisitReviewDraft> } = {}) {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ restaurant: JSON.stringify({ id: 'brawn', name: 'Brawn' }), pageId: 'brawn', ...(options.newMeal ? {} : { entryId: original.id }) });
    (useVisitReviewDraft as jest.Mock).mockImplementation((_ownerId, entryId) => ({ data: options.loading || options.error ? undefined : options.draftsById ? options.draftsById[entryId] : draft, isError: !!options.error, isPending: !!options.loading, refetch }));
    const client = makeTestClient();
    client.setQueryData(pageKey, {
        restaurant: { id: 'brawn' }, personal: { visit_count: 2 }, self_log: [
            { id: 'entry:older-visit', entry_id: original.id, rating: null, note: null, photos: [] },
            { id: 'entry:newer-visit', entry_id: 'newer-visit', rating: 3, note: 'A later lunch', photos: [] },
        ],
    });
    client.setQueryData(selectionKey, 'newer-visit');
    const screen = render(<QueryClientProvider client={client}><LogMealScreen /></QueryClientProvider>);
    return { ...screen, client };
}

beforeEach(() => {
    jest.clearAllMocks();
    create.mockReset();
    (compressAndUpload as jest.Mock).mockReset();
    (callEdgeFn as jest.Mock).mockReset();
    (useRouter as jest.Mock).mockReturnValue({ back, replace: jest.fn() });
    (useToast as jest.Mock).mockReturnValue({ show: toast });
    (useCreateEntry as jest.Mock).mockReturnValue({ mutate: create, isPending: false });
    (callEdgeFn as jest.Mock).mockResolvedValue(resultFor());
    (useAvailableVisitCheckIns as jest.Mock).mockReturnValue({ data: [], isPending: false, isError: false, refetch: jest.fn() });
});

it('hydrates the full composer and saves the exact older visit without incrementing its restaurant count', async () => {
    const screen = mount();
    expect(useVisitReviewDraft).toHaveBeenCalledWith('owner', 'older-visit');
    expect(screen.getByText('REVIEW YOUR VISIT')).toBeTruthy();
    expect(screen.getByText(original.content!)).toBeTruthy();
    expect(screen.getByText('4.5')).toBeTruthy();
    expect(screen.getByLabelText('liked').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(true);
    expect(screen.UNSAFE_getByType(CalendarModal).props.value.toISOString()).toBe(original.visited_at);
    expect(screen.UNSAFE_getByType(CompanionPickerSheet).props.selectedIds).toEqual(new Set(['carmen']));
    const mosaic = screen.UNSAFE_getByType(PhotoMosaic).props;
    expect(mosaic.maxPhotos).toBe(10);
    expect(mosaic.photos.map((p: any) => p.publicUrl)).toEqual(photoUrls);
    expect(screen.queryByText('also appears on your public profile')).toBeNull();
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(callEdgeFn).toHaveBeenCalledTimes(1);
    expect(callEdgeFn).toHaveBeenCalledWith('entry', {
        action: 'save_visit', body: { entry_id: original.id, patch: {
            rating: 4.5, content: original.content, visited_at: original.visited_at,
            liked: true, vibe_rating: 3, flavor_rating: 4.5, service_rating: 4, value_rating: 3.5,
        } },
    });
    expect(create).not.toHaveBeenCalled();
    expect(screen.client.getQueryData(selectionKey)).toBe(original.id);
    const page = screen.client.getQueryData<any>(pageKey);
    expect(page.personal.visit_count).toBe(2);
    expect(page.self_log).toHaveLength(2);
    expect(page.self_log.find((v: any) => v.entry_id === original.id)).toMatchObject({ rating: 4.5, note: original.content, photos: original.photos });
    expect(page.self_log.find((v: any) => v.entry_id === 'newer-visit').note).toBe('A later lunch');
    expect(toast).toHaveBeenCalledWith('Review saved');
});

it('sends changed companions and tables together with the review on the existing entry', async () => {
    const screen = mount();
    fireEvent.press(screen.getByLabelText('Friends'));
    fireEvent.press(screen.getByLabelText('Lunch club'));
    act(() => {
        screen.UNSAFE_getByType(CompanionPickerSheet).props.onToggle(original.companions[0]);
        screen.UNSAFE_getByType(CompanionPickerSheet).props.onToggle({ user_id: 'new-friend', display_name: 'New friend', avatar_url: null });
    });
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(callEdgeFn).toHaveBeenCalled());
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body).toMatchObject({ entry_id: original.id, patch: { table_ids: ['new-table'], companion_ids: ['new-friend'] } });
    expect(create).not.toHaveBeenCalled();
});

it.each(['note', 'photos'])('saves a %s-only review and leaves an originally undated visit undated', async (kind) => {
    const draft = { ...original, rating: null, visited_at: null, content: kind === 'note' ? 'Only a note' : null, photos: kind === 'photos' ? original.photos : [] };
    (callEdgeFn as jest.Mock).mockResolvedValue(resultFor(draft));
    const screen = mount(draft);
    expect(screen.getByText('Add a date')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(back).toHaveBeenCalled());
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.patch).toMatchObject({ rating: null, visited_at: null, content: draft.content });
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.patch).not.toHaveProperty('photo_urls');
    expect(toast).toHaveBeenCalledWith('Review saved');
    expect(create).not.toHaveBeenCalled();
});

it('clears a review on the same visit and reports Visit saved rather than a finished review', async () => {
    const draft = { ...original, photos: [], content: null };
    (callEdgeFn as jest.Mock).mockResolvedValue(resultFor({ ...draft, rating: null }));
    const screen = mount(draft);
    fireEvent.press(screen.getByLabelText('Rate 4.5'));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(back).toHaveBeenCalled());
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.patch.rating).toBeNull();
    expect(toast).toHaveBeenCalledWith('Visit saved');
    expect(screen.client.getQueryData<any>(pageKey).personal.visit_count).toBe(2);
});

it('blocks synchronous duplicate saves and keeps the edited draft after a failed existing-visit save', async () => {
    let reject!: (error: Error) => void;
    (callEdgeFn as jest.Mock).mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const screen = mount();
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('Keep this edited note'));
    const save = screen.getByLabelText('Save review').props.onPress;
    act(() => { save(); save(); });
    await waitFor(() => expect(callEdgeFn).toHaveBeenCalledTimes(1));
    await act(async () => reject(new Error('Connection lost')));
    expect(back).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Couldn’t save your review', 'Connection lost');
    expect(screen.getByText('Keep this edited note')).toBeTruthy();
    expect(screen.UNSAFE_getByType(PhotoMosaic).props.photos).toHaveLength(8);
    expect(screen.client.getQueryData(selectionKey)).toBe('newer-visit');
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(back).toHaveBeenCalled());
    expect((callEdgeFn as jest.Mock).mock.calls[1][1].body).toMatchObject({ entry_id: original.id, patch: { content: 'Keep this edited note' } });
    expect(create).not.toHaveBeenCalled();
});

it('cancel closes the composer without mutating the existing visit', () => {
    const screen = mount();
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('Unsaved draft'));
    fireEvent.press(screen.getByLabelText('close'));
    expect(back).toHaveBeenCalledTimes(1);
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
});

it.each(['loading', 'error'])('does not expose a saveable empty form while the original visit is %s', (state) => {
    const screen = mount(original, { loading: state === 'loading', error: state === 'error' });
    expect(screen.queryByText('YOUR APPRAISAL')).toBeNull();
    expect(screen.queryByLabelText('Save review')).toBeNull();
    expect(screen.queryByLabelText('Save')).toBeNull();
    if (state === 'error') {
        expect(screen.getByText('Couldn’t load this visit.')).toBeTruthy();
        fireEvent.press(screen.getByText('Try again'));
        expect(refetch).toHaveBeenCalledTimes(1);
    }
    fireEvent.press(screen.getByText('Close'));
    expect(back).toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
});

it('blocks saving while a new photo upload fails, retains the slot, and saves after retry succeeds', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///lunch.jpg' }] });
    (compressAndUpload as jest.Mock).mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValueOnce('https://photos.example/new.jpg');
    const screen = mount({ ...original, photos: [] });
    await act(async () => screen.UNSAFE_getByType(PhotoMosaic).props.onAdd());
    await waitFor(() => expect(screen.UNSAFE_getByType(PhotoMosaic).props.photos[0]?.error).toBeTruthy());
    expect(screen.getByLabelText('Save review').props.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText('Save review'));
    expect(callEdgeFn).not.toHaveBeenCalled();
    const slot = screen.UNSAFE_getByType(PhotoMosaic).props.photos[0];
    await act(async () => screen.UNSAFE_getByType(PhotoMosaic).props.onRetry(slot.id));
    await waitFor(() => expect(screen.getByLabelText('Save review').props.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(callEdgeFn).toHaveBeenCalled());
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.patch.photo_urls).toEqual(['https://photos.example/new.jpg']);
});

it('creates a new visit when entryId is absent and selects the confirmed response once', async () => {
    const screen = mount(undefined, { newMeal: true });
    expect(screen.getByText('LOG A MEAL')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Rate 4'));
    const save = screen.getByLabelText('Save').props.onPress;
    act(() => { save(); save(); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ restaurant_id: 'brawn', rating: 4, client_nonce: expect.any(String) });
    await act(async () => create.mock.calls[0][1].onSuccess({ ...original, id: 'new-visit', rating: 4, content: 'Confirmed server note' }));
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(screen.client.getQueryData(selectionKey)).toBe('new-visit');
    const page = screen.client.getQueryData<any>(pageKey);
    expect(page.personal.visit_count).toBe(3);
    expect(page.self_log.find((v: any) => v.entry_id === 'new-visit').note).toBe('Confirmed server note');
    expect(toast).toHaveBeenCalledWith('Meal logged');
    expect(back).toHaveBeenCalledTimes(1);
});

it.each(['network failure', 'HTTP 504'])('keeps the exact payload and nonce after %s and shows only the confirmed row on retry', async (failure) => {
    const screen = mount(undefined, { newMeal: true });
    fireEvent.press(screen.getByLabelText('Rate 4'));
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('Original attempted note'));
    fireEvent.press(screen.getByLabelText('Save'));
    const attempt = create.mock.calls[0][0];
    const error = failure === 'HTTP 504' ? Object.assign(new Error('Gateway timeout'), { context: { status: 504 } }) : new Error('Response lost');
    await act(async () => create.mock.calls[0][1].onError(error));
    expect(screen.getByText('Original attempted note')).toBeTruthy();
    expect(screen.getByText('Your draft is kept. Retry to confirm this meal was saved.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
    expect(screen.client.getQueryData(selectionKey)).toBe('newer-visit');
    fireEvent.press(screen.getByLabelText('Retry save'));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toBe(attempt);
    expect(create.mock.calls[1][0].client_nonce).toBe(attempt.client_nonce);
    await act(async () => create.mock.calls[1][1].onSuccess({ ...original, id: 'dedup-visit', content: 'Server confirmed content' }));
    expect(screen.client.getQueryData<any>(pageKey).self_log.find((v: any) => v.entry_id === 'dedup-visit').note).toBe('Server confirmed content');
    expect(screen.client.getQueryData<any>(pageKey).personal.visit_count).toBe(3);
    expect(back).toHaveBeenCalledTimes(1);
});

it('unlocks a definitively rejected new meal and removes unauthorized tables before a corrected save', async () => {
    const screen = mount(undefined, { newMeal: true });
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Friends'));
    fireEvent.press(screen.getByLabelText('Lunch club'));
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('Keep my meal draft'));
    fireEvent.press(screen.getByLabelText('Save'));
    const rejectedAttempt = create.mock.calls[0][0];
    expect(rejectedAttempt.table_ids).toEqual(['old-table', 'new-table']);
    await act(async () => create.mock.calls[0][1].onError(Object.assign(new Error('table_not_authorized'), {
        code: 'table_not_authorized', offendingIds: ['old-table'],
        cause: { context: { status: 403 } },
    })));
    expect(screen.queryByLabelText('Retry save')).toBeNull();
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('Lunch club').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText('Keep my meal draft')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Rate 3.5'));
    fireEvent.press(screen.getByLabelText('Save'));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toMatchObject({ rating: 3.5, content: 'Keep my meal draft', table_ids: ['new-table'] });
    expect(create.mock.calls[1][0].client_nonce).not.toBe(rejectedAttempt.client_nonce);
});

it('retains the original nonce after an uncertain save and a later table rejection while allowing the rejected payload to be corrected', async () => {
    const screen = mount(undefined, { newMeal: true });
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Friends'));
    fireEvent.press(screen.getByLabelText('Lunch club'));
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('The note that may already be saved'));
    fireEvent.press(screen.getByLabelText('Save'));
    const uncertainAttempt = create.mock.calls[0][0];

    // The server may have committed this entry before its response was lost.
    await act(async () => create.mock.calls[0][1].onError(new Error('Response lost')));
    fireEvent.press(screen.getByLabelText('Retry save'));
    expect(create.mock.calls[1][0]).toBe(uncertainAttempt);
    // Membership validation can now fail before the server reaches nonce dedup.
    await act(async () => create.mock.calls[1][1].onError(Object.assign(new Error('table_not_authorized'), {
        code: 'table_not_authorized', offendingIds: ['old-table'],
        cause: { context: { status: 403 } },
    })));
    expect(screen.queryByLabelText('Retry save')).toBeNull();
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('Lunch club').props.accessibilityState.checked).toBe(true);
    expect(screen.client.getQueryData(selectionKey)).toBe('newer-visit');
    expect(toast).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();

    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('A corrected draft after the rejection'));
    fireEvent.press(screen.getByLabelText('Rate 3.5'));
    fireEvent.press(screen.getByLabelText('Save'));
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0]).toMatchObject({
        client_nonce: uncertainAttempt.client_nonce,
        rating: 3.5, content: 'A corrected draft after the rejection', table_ids: ['new-table'],
    });

    // Dedup returns the earlier committed entry, which remains authoritative.
    await act(async () => create.mock.calls[2][1].onSuccess({
        ...original, id: 'previously-committed-visit', rating: 4,
        content: 'The note that may already be saved',
    }));
    const page = screen.client.getQueryData<any>(pageKey);
    expect(page.personal.visit_count).toBe(3);
    expect(page.self_log.filter((v: any) => v.entry_id === 'previously-committed-visit')).toHaveLength(1);
    expect(page.self_log.find((v: any) => v.entry_id === 'previously-committed-visit')).toMatchObject({
        rating: 4, note: 'The note that may already be saved',
    });
    expect(screen.client.getQueryData(selectionKey)).toBe('previously-committed-visit');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    expect(callEdgeFn).not.toHaveBeenCalled();
});

it.each([400, 403, 422])('allows a corrected draft after a definitive HTTP %s rejection', async (status) => {
    const screen = mount(undefined, { newMeal: true });
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Save'));
    const rejectedAttempt = create.mock.calls[0][0];
    await act(async () => create.mock.calls[0][1].onError(Object.assign(new Error('Please correct this meal'), { context: { status } })));
    expect(screen.queryByLabelText('Retry save')).toBeNull();
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('A corrected note'));
    fireEvent.press(screen.getByLabelText('Rate 3'));
    fireEvent.press(screen.getByLabelText('Save'));
    expect(create.mock.calls[1][0]).toMatchObject({ rating: 3, content: 'A corrected note' });
    expect(create.mock.calls[1][0].client_nonce).not.toBe(rejectedAttempt.client_nonce);
    expect(back).not.toHaveBeenCalled();
});

it('never changes an existing-visit route into creation if its loaded draft disappears', async () => {
    const screen = mount();
    (useVisitReviewDraft as jest.Mock).mockReturnValue({ data: undefined, isError: true, isPending: false, refetch });
    screen.rerender(<QueryClientProvider client={screen.client}><LogMealScreen /></QueryClientProvider>);
    const save = screen.queryByLabelText('Save review');
    if (save) fireEvent.press(save);
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
});

it('leaves untouched legacy duplicate photos above the picker limit out of the patch', async () => {
    const legacy = {
        ...original,
        photos: Array.from({ length: 12 }, (_, i) => ({ id: `legacy-${i}`, url: `https://photos.example/${i % 7}.jpg` })),
    };
    (callEdgeFn as jest.Mock).mockResolvedValue(resultFor({ ...legacy, content: 'Updated note only' }));
    const screen = mount(legacy);
    expect(screen.UNSAFE_getByType(PhotoMosaic).props.photos).toHaveLength(12);
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('Updated note only'));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(back).toHaveBeenCalled());
    const patch = (callEdgeFn as jest.Mock).mock.calls[0][1].body.patch;
    expect(patch.content).toBe('Updated note only');
    expect(patch).not.toHaveProperty('photo_urls');
    expect(screen.client.getQueryData<any>(pageKey).self_log.find((v: any) => v.entry_id === original.id).photos).toEqual(legacy.photos);
});

it('sends an explicit empty photo collection only when the user removes the last existing photo', async () => {
    const screen = mount({ ...original, photos: [original.photos[0]] });
    act(() => screen.UNSAFE_getByType(PhotoMosaic).props.onRemove(original.photos[0].id));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(callEdgeFn).toHaveBeenCalled());
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.patch.photo_urls).toEqual([]);
});

it('starts a new meal even when an unreviewed check-in is available and never silently attaches on save', async () => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    expect(screen.getByText('New visit')).toBeTruthy();
    expect(screen.getByLabelText(/^Use check-in from /)).toBeTruthy();
    expect(screen.queryByLabelText('Save review')).toBeNull();
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(false);
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Save'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ restaurant_id: 'brawn', rating: 4 });
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(useVisitReviewDraft).not.toHaveBeenCalledWith('owner', checkInDraft.id);
});

it('enriches the explicitly chosen check-in with its original date and audience without creating another visit', async () => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    expect(useVisitReviewDraft).toHaveBeenLastCalledWith('owner', checkInDraft.id);
    expect(screen.getByLabelText('Save review')).toBeTruthy();
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(true);
    expect(screen.UNSAFE_getByType(CalendarModal).props.value.toISOString()).toBe(checkInDraft.visited_at);
    expect(screen.UNSAFE_getByType(CompanionPickerSheet).props.selectedIds).toEqual(new Set(['carmen']));
    expect(Alert.alert).not.toHaveBeenCalled();
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('A note for that exact check-in'));
    (callEdgeFn as jest.Mock).mockResolvedValue(resultFor({ ...checkInDraft, content: 'A note for that exact check-in' }));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body).toMatchObject({
        entry_id: checkInDraft.id,
        patch: { content: 'A note for that exact check-in', visited_at: checkInDraft.visited_at },
    });
    expect(create).not.toHaveBeenCalled();
    expect(screen.client.getQueryData<any>(pageKey).personal.visit_count).toBe(2);
    expect(screen.client.getQueryData(selectionKey)).toBe(checkInDraft.id);
});

it('keeps two same-day check-ins separate and saves the exact older one chosen from the list', async () => {
    const lunch = { ...checkInDraft, id: 'lunch', visited_at: '2026-08-10T12:00:00.000Z' };
    const dinner = { ...checkInDraft, id: 'dinner', visited_at: '2026-08-10T19:00:00.000Z' };
    suggestCheckIns(dinner, lunch);
    const screen = mount(undefined, { newMeal: true, draftsById: { lunch, dinner } });
    expect(screen.getByText('New visit')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Choose check-in'));
    const options = screen.getAllByLabelText(/^Use check-in from /);
    expect(options).toHaveLength(2);
    expect(options[0].props.accessibilityLabel).not.toBe(options[1].props.accessibilityLabel);
    fireEvent.press(options[1]);
    expect(useVisitReviewDraft).toHaveBeenLastCalledWith('owner', 'lunch');
    expect(screen.UNSAFE_getByType(CalendarModal).props.value.toISOString()).toBe(lunch.visited_at);
    fireEvent.press(screen.getByLabelText('Rate 4'));
    (callEdgeFn as jest.Mock).mockResolvedValue(resultFor({ ...lunch, rating: 4 }));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(callEdgeFn).toHaveBeenCalledTimes(1));
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.entry_id).toBe('lunch');
    expect(create).not.toHaveBeenCalled();
});

it('retains a dirty new draft when retargeting is cancelled and discards it only on explicit confirmation', () => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    fireEvent.press(screen.getByLabelText('Rate 4'));
    act(() => screen.UNSAFE_getByType(NoteEditorModal).props.onClose('Keep this new-meal draft'));
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    const buttons = discardPrompt();
    expect(buttons.find((button) => button.text === 'Cancel')?.style).toBe('cancel');
    expect(screen.getByText('Keep this new-meal draft')).toBeTruthy();
    expect(screen.getByText('New visit')).toBeTruthy();
    expect(screen.getByLabelText('Save')).toBeTruthy();
    expect(useVisitReviewDraft).not.toHaveBeenCalledWith('owner', checkInDraft.id);
    act(() => buttons.find((button) => button.text === 'Discard draft')!.onPress!());
    expect(screen.queryByText('Keep this new-meal draft')).toBeNull();
    expect(screen.getByLabelText('Save review')).toBeTruthy();
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
});

it('switches an untouched chosen check-in back to a clean new meal without inheriting its date or audience', () => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    fireEvent.press(screen.getByLabelText('Change visit'));
    fireEvent.press(screen.getByLabelText('New visit'));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(screen.getByText('New visit')).toBeTruthy();
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(false);
    expect(screen.UNSAFE_getByType(CompanionPickerSheet).props.selectedIds).toEqual(new Set());
    expect(screen.UNSAFE_getByType(CalendarModal).props.value.toISOString()).not.toBe(checkInDraft.visited_at);
    expect(screen.getByLabelText('Save').props.disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
});

it.each(['loading', 'error'])('never creates or edits a fallback entry when the chosen check-in is %s', (state) => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true, loading: state === 'loading', error: state === 'error' });
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    expect(screen.queryByLabelText('Save review')).toBeNull();
    expect(screen.queryByLabelText('Save')).toBeNull();
    if (state === 'error') {
        fireEvent.press(screen.getByText('Try again'));
        expect(refetch).toHaveBeenCalledTimes(1);
    }
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Start a new visit'));
    expect(screen.getByText('New visit')).toBeTruthy();
    expect(screen.getByLabelText('Save').props.disabled).toBe(true);
});

it.each([
    { rating: 4 }, { content: 'Written from another session' }, { photos: original.photos },
])('refuses a suggested check-in that already acquired review content: %o', (content) => {
    suggestCheckIns(checkInDraft);
    const screen = mount({ ...checkInDraft, ...content }, { newMeal: true });
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    expect(screen.getByText('This check-in already has a review.')).toBeTruthy();
    expect(screen.queryByLabelText('Save review')).toBeNull();
    expect(screen.queryByLabelText('Save')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
});

it('keeps a direct Add review route fixed to its exact entry even if other check-ins are available', () => {
    suggestCheckIns(checkInDraft, { ...checkInDraft, id: 'another-check-in' });
    const screen = mount();
    expect(useAvailableVisitCheckIns).toHaveBeenCalledWith('owner', 'brawn', false);
    expect(screen.queryByLabelText('Change visit')).toBeNull();
    expect(screen.queryByLabelText('Choose check-in')).toBeNull();
    expect(screen.queryByLabelText(/^Use check-in from /)).toBeNull();
    expect(screen.getByLabelText('Save review')).toBeTruthy();
});

it('locks the visit target during a new-meal save and retains that lock after an uncertain retry followed by a definite rejection', async () => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Friends'));
    fireEvent.press(screen.getByLabelText('Save'));
    expect(screen.getByLabelText(/^Use check-in from /).props.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    expect(screen.getByText('New visit')).toBeTruthy();
    await act(async () => create.mock.calls[0][1].onError(new Error('Response lost')));
    expect(screen.getByLabelText(/^Use check-in from /).props.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText('Retry save'));
    await act(async () => create.mock.calls[1][1].onError(Object.assign(new Error('table_not_authorized'), {
        code: 'table_not_authorized', offendingIds: ['old-table'], cause: { context: { status: 403 } },
    })));
    expect(screen.queryByLabelText('Retry save')).toBeNull();
    expect(screen.getByLabelText(/^Use check-in from /).props.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    expect(screen.getByText('New visit')).toBeTruthy();
    expect(useVisitReviewDraft).not.toHaveBeenCalledWith('owner', checkInDraft.id);
    expect(callEdgeFn).not.toHaveBeenCalled();
});

it('keeps meal logging available when loading optional check-in suggestions fails and offers a scoped retry', () => {
    const retrySuggestions = jest.fn();
    (useAvailableVisitCheckIns as jest.Mock).mockReturnValue({ data: undefined, isError: true, refetch: retrySuggestions });
    const screen = mount(undefined, { newMeal: true });
    expect(screen.getByText('New visit')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry loading check-ins'));
    expect(retrySuggestions).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Save'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(callEdgeFn).not.toHaveBeenCalled();
});

it.each(['fetching', 'error'])('does not hydrate an optional check-in from stale cached data while its authoritative read is %s', (state) => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    (useVisitReviewDraft as jest.Mock).mockReturnValue({
        data: checkInDraft, isFetching: state === 'fetching', isError: state === 'error', isPending: false, refetch,
    });
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    expect(screen.queryByLabelText('Save review')).toBeNull();
    expect(screen.queryByLabelText('Save')).toBeNull();
    expect(screen.queryByText('YOUR APPRAISAL')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
    const fresh = { ...checkInDraft, table_ids: ['new-table'], companions: [] };
    (useVisitReviewDraft as jest.Mock).mockReturnValue({ data: fresh, isFetching: false, isError: false, isPending: false, refetch });
    screen.rerender(<QueryClientProvider client={screen.client}><LogMealScreen /></QueryClientProvider>);
    expect(screen.getByLabelText('Save review')).toBeTruthy();
    expect(screen.getByLabelText('Friends').props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('Lunch club').props.accessibilityState.checked).toBe(true);
    expect(screen.UNSAFE_getByType(CompanionPickerSheet).props.selectedIds).toEqual(new Set());
});

it('fences a late photo upload after the user explicitly discards that draft to choose a check-in', async () => {
    suggestCheckIns(checkInDraft);
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///discarded.jpg' }] });
    let completeUpload!: (url: string) => void;
    (compressAndUpload as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { completeUpload = resolve; }));
    const screen = mount(checkInDraft, { newMeal: true });
    await act(async () => screen.UNSAFE_getByType(PhotoMosaic).props.onAdd());
    expect(screen.UNSAFE_getByType(PhotoMosaic).props.photos).toHaveLength(1);
    await waitFor(() => expect(typeof completeUpload).toBe('function'));
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    const buttons = discardPrompt();
    act(() => buttons.find((button) => button.text === 'Discard draft')!.onPress!());
    expect(screen.UNSAFE_getByType(PhotoMosaic).props.photos).toHaveLength(0);
    await act(async () => completeUpload('https://photos.example/discarded.jpg'));
    expect(screen.UNSAFE_getByType(PhotoMosaic).props.photos).toHaveLength(0);
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(callEdgeFn).toHaveBeenCalledTimes(1));
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.entry_id).toBe(checkInDraft.id);
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body.patch).not.toHaveProperty('photo_urls');
    expect(create).not.toHaveBeenCalled();
});

it('accepts only the first synchronous check-in choice while that target is being loaded', () => {
    const lunch = { ...checkInDraft, id: 'lunch', visited_at: '2026-08-10T12:00:00.000Z' };
    const dinner = { ...checkInDraft, id: 'dinner', visited_at: '2026-08-10T19:00:00.000Z' };
    suggestCheckIns(dinner, lunch);
    const screen = mount(undefined, { newMeal: true, draftsById: { lunch, dinner } });
    fireEvent.press(screen.getByLabelText('Choose check-in'));
    const options = screen.getAllByLabelText(/^Use check-in from /);
    const firstChoice = options[0].props.onPress;
    const secondChoice = options[1].props.onPress;
    act(() => { firstChoice(); secondChoice(); });
    expect(useVisitReviewDraft).toHaveBeenLastCalledWith('owner', 'dinner');
    expect(useVisitReviewDraft).not.toHaveBeenCalledWith('owner', 'lunch');
    expect(screen.UNSAFE_getByType(CalendarModal).props.value.toISOString()).toBe(dinner.visited_at);
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
});

it('refuses a stale new-meal save callback in the same tick as a confirmed switch to an existing check-in', async () => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    fireEvent.press(screen.getByLabelText('Rate 4'));
    const staleSaveNewMeal = screen.getByLabelText('Save').props.onPress;
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    const discard = discardPrompt().find((button) => button.text === 'Discard draft')!.onPress!;
    act(() => { discard(); staleSaveNewMeal(); });
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Save review')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Rate 4.5'));
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(callEdgeFn).toHaveBeenCalledTimes(1));
    expect((callEdgeFn as jest.Mock).mock.calls[0][1].body).toMatchObject({ entry_id: checkInDraft.id, patch: { rating: 4.5 } });
    expect(create).not.toHaveBeenCalled();
});

it('refuses a stale existing-visit save callback in the same tick as a switch to a new meal', () => {
    suggestCheckIns(checkInDraft);
    const screen = mount(checkInDraft, { newMeal: true });
    fireEvent.press(screen.getByLabelText(/^Use check-in from /));
    const staleSaveExistingVisit = screen.getByLabelText('Save review').props.onPress;
    fireEvent.press(screen.getByLabelText('Change visit'));
    const chooseNew = screen.getByLabelText('New visit').props.onPress;
    act(() => { chooseNew(); staleSaveExistingVisit(); });
    expect(create).not.toHaveBeenCalled();
    expect(callEdgeFn).not.toHaveBeenCalled();
    expect(screen.getByText('New visit')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Rate 4'));
    fireEvent.press(screen.getByLabelText('Save'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ restaurant_id: 'brawn', rating: 4 });
    expect(callEdgeFn).not.toHaveBeenCalled();
});
