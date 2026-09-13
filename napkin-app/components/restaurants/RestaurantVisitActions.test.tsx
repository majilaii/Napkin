/* eslint-disable import/first -- Native hosts are replaced before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (v: any) => v.ios ?? v.default },
        StyleSheet: { create: (v: any) => v, flatten: (v: any) => Array.isArray(v) ? Object.assign({}, ...v.filter(Boolean)) : v, absoluteFill: {}, hairlineWidth: 1 },
        Text: host('Text'), TextInput: host('TextInput'), View: host('View'), Pressable: (props: any) => ReactModule.createElement('Pressable', { accessible: true, ...props }, props.children), Image: host('Image'),
        Modal: host('Modal'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('@/hooks/restaurants/useRestaurantVisitMutations', () => ({ useRestaurantVisitMutations: jest.fn() }));

import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Image, Text } from 'react-native';
import { Colors } from '@/constants/theme';
import { useRestaurantVisitMutations } from '@/hooks/restaurants/useRestaurantVisitMutations';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import { RestaurantVisitActions, orderVisits } from './RestaurantVisitActions';

const row = (id: string, created_at: string, visited_at: string | null = null): SelfLogRow => ({ id, entry_id: id, created_at, visited_at, source: 'solo', supper_id: null, table_night_id: null, is_bare: true, rating: null, note: null, photos: [], companions: [] });
const props = { userId: 'u', pageId: 'r', restaurantId: 'r', restaurantName: 'Brawn', palette: Colors.light, onLog: jest.fn(), onOpenVisit: jest.fn(), onReview: jest.fn() };
const record = jest.fn();
const save = jest.fn();
const undo = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
    record.mockReset();
    save.mockReset();
    undo.mockReset();
    (useRestaurantVisitMutations as jest.Mock).mockReturnValue({
        record: { mutateAsync: record, isPending: false },
        save: { mutateAsync: save, isPending: false },
        undo: { mutateAsync: undo, isPending: false },
    });
});

function expectStableActions(screen: ReturnType<typeof render>) {
    const buttons = screen.getAllByRole('button');
    expect(within(buttons[0]).getByText('Check in')).toBeTruthy();
    expect(within(buttons[1]).getByText('Log a meal')).toBeTruthy();
    expect(screen.getAllByText('Check in')).toHaveLength(1);
    expect(screen.getAllByText('Log a meal')).toHaveLength(1);
    expect(screen.queryByText('View your review')).toBeNull();
    expect(screen.queryByText('New visit')).toBeNull();
}

it.each([
    ['no visits', []],
    ['one bare check-in', [row('bare', '2026-09-01')]],
    ['a reviewed meal', [{ ...row('reviewed', '2026-09-01'), rating: 4.5, note: 'The roast chicken.', is_bare: false }]],
    ['several visits on the same day', [row('lunch', '2026-09-01T12:00:00Z'), row('dinner', '2026-09-01T19:00:00Z')]],
] as const)('keeps the same two actions in the same order with %s', (_state, visits) => {
    const screen = render(<RestaurantVisitActions {...props} visits={[...visits]} />);
    expectStableActions(screen);
    fireEvent.press(screen.getByText('Log a meal'));
    expect(props.onLog).toHaveBeenCalledTimes(1);
    expect(props.onReview).not.toHaveBeenCalled();
    expect(props.onOpenVisit).not.toHaveBeenCalled();
});

it('offers check-in and direct meal logging before the first visit', () => {
    const screen = render(<RestaurantVisitActions {...props} visits={[]} />);
    expectStableActions(screen);
    fireEvent.press(screen.getByText('Log a meal'));
    expect(props.onLog).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
    expect(props.onReview).not.toHaveBeenCalled();
});

it.each([{ visits: [] }, { visits: [row('visit', '2026-09-01')] }])('shows regular status independently of personal visits (%o)', ({ visits }) => {
    const screen = render(<RestaurantVisitActions {...props} visits={visits}
        regularStatus={<Text>Clara · The regular</Text>} />);
    expect(screen.getByText('Clara · The regular')).toBeTruthy();
    expectStableActions(screen);
    expect(record).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
});

it('blocks double taps and retries the same nonce before allowing a distinct repeat visit', async () => {
    let reject!: (e: Error) => void;
    record.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const screen = render(<RestaurantVisitActions {...props} visits={[]} />);
    act(() => { fireEvent.press(screen.getByText('Check in')); fireEvent.press(screen.getByText('Check in')); });
    expect(record).toHaveBeenCalledTimes(1);
    const nonce = record.mock.calls[0][0].client_nonce;
    await act(async () => { reject(new Error('Offline')); });
    fireEvent.press(screen.getByText('Log a meal'));
    expect(props.onLog).not.toHaveBeenCalled();
    record.mockResolvedValueOnce({ entry: { id: 'v1', is_bare: true } });
    fireEvent.press(screen.getByText('Retry check-in'));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1][0].client_nonce).toBe(nonce);
    screen.rerender(<RestaurantVisitActions {...props} visits={[row('v1', '2026-09-01')]} />);
    record.mockResolvedValueOnce({ entry: { id: 'v2', is_bare: true } });
    expectStableActions(screen);
    fireEvent.press(screen.getByText('Add review'));
    expect(props.onReview).toHaveBeenLastCalledWith(expect.objectContaining({ entry_id: 'v1' }));
    act(() => { fireEvent.press(screen.getByText('Check in')); fireEvent.press(screen.getByText('Check in')); });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(3));
    expect(record.mock.calls[2][0].client_nonce).not.toBe(nonce);
    screen.rerender(<RestaurantVisitActions {...props} visits={[row('v1', '2026-09-01'), row('v2', '2026-09-01T00:01:00Z')]} />);
    expect(screen.getByText('2 visits')).toBeTruthy();
    fireEvent.press(screen.getByText('Add review'));
    expect(props.onReview).toHaveBeenLastCalledWith(expect.objectContaining({ entry_id: 'v2' }));
    expect(save).not.toHaveBeenCalled();
});

it('numbers repeated visits by recording order, even after an earlier visit is backdated', () => {
    const a = row('a', '2026-09-01', '2026-08-30');
    const b = row('b', '2026-09-02', '2026-01-01');
    expect(orderVisits([a, b]).map((v) => v.id)).toEqual(['b', 'a']);
});

it('adds a review to the exact older check-in selected from history and retains selection on refresh', () => {
    const older = row('older', '2026-09-01');
    const newer = { ...row('newer', '2026-09-02'), rating: 4.5, is_bare: false };
    const screen = render(<RestaurantVisitActions {...props} visits={[older, newer]} />);
    expectStableActions(screen);
    fireEvent.press(screen.getByLabelText('Visit history, 2 visits'));
    fireEvent.press(screen.getByLabelText(/^Visit 1, no review,/));
    expect(screen.queryByLabelText('Close visit sheet')).toBeNull();
    expectStableActions(screen);
    screen.rerender(<RestaurantVisitActions {...props} visits={[{ ...older }, { ...newer }]} />);
    fireEvent.press(screen.getByText('Add review'));
    expect(props.onReview).toHaveBeenCalledWith(older);
    expect(props.onLog).not.toHaveBeenCalled();
    expect(props.onOpenVisit).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
});

it('selects the saved ID when it arrives, even if it is backdated and an older visit was selected', () => {
    const older = row('older', '2026-09-01');
    const newer = row('newer', '2026-09-02');
    const screen = render(<RestaurantVisitActions {...props} visits={[older, newer]} />);
    fireEvent.press(screen.getByLabelText('Visit history, 2 visits'));
    fireEvent.press(screen.getByLabelText(/^Visit 1, no review,/));
    screen.rerender(<RestaurantVisitActions {...props} visits={[older, newer]} selectedVisitId="saved" />);
    expect(screen.getByText('Loading your visit…')).toBeTruthy();
    expectStableActions(screen);
    expect(screen.queryByText('Add review')).toBeNull();
    const saved = { ...row('saved', '2026-09-03', '2026-01-01T12:00:00Z'), rating: 4, is_bare: false };
    screen.rerender(<RestaurantVisitActions {...props} visits={[older, newer, saved]} selectedVisitId="saved" />);
    expectStableActions(screen);
    fireEvent.press(screen.getByLabelText(/^Open visit /));
    expect(props.onOpenVisit).toHaveBeenCalledWith(saved);
    expect(props.onReview).not.toHaveBeenCalled();
});

it('restores the empty-state actions after the selected review is deleted and history refreshes', () => {
    const onMissingVisit = jest.fn();
    const reviewed = { ...row('saved', '2026-09-03'), rating: 4, is_bare: false };
    const screen = render(<RestaurantVisitActions {...props} visits={[reviewed]} selectedVisitId="saved" visitsUpdatedAt={100} onMissingVisit={onMissingVisit} />);
    fireEvent.press(screen.getByLabelText(/^Open visit /));
    expect(props.onOpenVisit).toHaveBeenCalledWith(reviewed);
    screen.rerender(<RestaurantVisitActions {...props} visits={[]} selectedVisitId="saved" visitsUpdatedAt={200} visitsRefreshing onMissingVisit={onMissingVisit} />);
    expect(screen.getByText('Loading your visit…')).toBeTruthy();
    expectStableActions(screen);
    expect(onMissingVisit).not.toHaveBeenCalled();
    screen.rerender(<RestaurantVisitActions {...props} visits={[]} selectedVisitId="saved" visitsUpdatedAt={200} onMissingVisit={onMissingVisit} />);
    expect(screen.queryByText('Loading your visit…')).toBeNull();
    expectStableActions(screen);
    fireEvent.press(screen.getByText('Log a meal'));
    expect(props.onLog).toHaveBeenCalledTimes(1);
    expect(onMissingVisit).toHaveBeenCalledTimes(1);
});

it('falls back to the latest remaining visit after a chosen historical visit disappears', () => {
    const onMissingVisit = jest.fn();
    const older = row('older', '2026-09-01');
    const newer = row('newer', '2026-09-02');
    const screen = render(<RestaurantVisitActions {...props} visits={[older, newer]} visitsUpdatedAt={100} onMissingVisit={onMissingVisit} />);
    fireEvent.press(screen.getByLabelText('Visit history, 2 visits'));
    fireEvent.press(screen.getByLabelText(/^Visit 1, no review,/));
    screen.rerender(<RestaurantVisitActions {...props} visits={[newer]} visitsUpdatedAt={100} visitsRefreshing onMissingVisit={onMissingVisit} />);
    expect(screen.queryByText('Add review')).toBeNull();
    expect(onMissingVisit).not.toHaveBeenCalled();
    screen.rerender(<RestaurantVisitActions {...props} visits={[newer]} visitsUpdatedAt={200} onMissingVisit={onMissingVisit} />);
    expect(screen.getByText('1 visit')).toBeTruthy();
    fireEvent.press(screen.getByText('Add review'));
    expect(props.onReview).toHaveBeenCalledWith(newer);
    expect(onMissingVisit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Log a meal')).toBeTruthy();
});

it('waits for an authoritative refresh before clearing a saved ID that never arrives', () => {
    const onMissingVisit = jest.fn();
    const existing = row('existing', '2026-09-01');
    const screen = render(<RestaurantVisitActions {...props} visits={[existing]} visitsUpdatedAt={100} onMissingVisit={onMissingVisit} />);
    screen.rerender(<RestaurantVisitActions {...props} visits={[existing]} selectedVisitId="missing" visitsUpdatedAt={100} onMissingVisit={onMissingVisit} />);
    expect(screen.getByText('Loading your visit…')).toBeTruthy();
    expectStableActions(screen);
    screen.rerender(<RestaurantVisitActions {...props} visits={[{ ...existing }]} selectedVisitId="missing" visitsUpdatedAt={100} onMissingVisit={onMissingVisit} />);
    expect(onMissingVisit).not.toHaveBeenCalled();
    expect(screen.queryByText('Add review')).toBeNull();
    screen.rerender(<RestaurantVisitActions {...props} visits={[existing]} selectedVisitId="missing" visitsUpdatedAt={200} visitsRefreshing onMissingVisit={onMissingVisit} />);
    expect(onMissingVisit).not.toHaveBeenCalled();
    expect(screen.queryByText('Add review')).toBeNull();
    screen.rerender(<RestaurantVisitActions {...props} visits={[existing]} selectedVisitId="missing" visitsUpdatedAt={200} onMissingVisit={onMissingVisit} />);
    expect(onMissingVisit).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Add review'));
    expect(props.onReview).toHaveBeenCalledWith(existing);
});

it.each([
    { rating: 4.5 },
    { note: 'A lovely lunch.' },
    { photos: [{ id: 'p', url: 'https://image.example/lunch' }] },
])('opens a finished review for reading when the visit contains %o', (content) => {
    const visit = { ...row('v1', '2026-09-01'), ...content, is_bare: false };
    const screen = render(<RestaurantVisitActions {...props} visits={[visit]} />);
    expectStableActions(screen);
    fireEvent.press(screen.getByLabelText(/^Open visit /));
    expect(props.onOpenVisit).toHaveBeenCalledWith(visit);
    expect(props.onReview).not.toHaveBeenCalled();
    expect(props.onLog).not.toHaveBeenCalled();
    expect(screen.queryByText('edit')).toBeNull();
});

it('logs a separate new meal directly without changing the selected existing visit', () => {
    const visit = { ...row('v1', '2026-09-01'), rating: 4, is_bare: false };
    const screen = render(<RestaurantVisitActions {...props} visits={[visit]} />);
    expectStableActions(screen);
    fireEvent.press(screen.getByText('Log a meal'));
    expect(props.onLog).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
    expect(screen.getByText('Check in')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Open visit /));
    expect(props.onOpenVisit).toHaveBeenCalledWith(visit);
});

it.each([
    { source: 'supper' as const, supper_id: 's1' },
    { table_night_id: 'n1' },
    { entry_id: null, source: 'supper' as const },
])('opens shared or non-entry visits through their read route: %o', (context) => {
    const visit = { ...row('v1', '2026-09-01'), ...context };
    const screen = render(<RestaurantVisitActions {...props} visits={[visit]} />);
    expect(screen.queryByText('Add review')).toBeNull();
    fireEvent.press(screen.getByLabelText(/^Open visit /));
    expect(props.onOpenVisit).toHaveBeenCalledWith(visit);
    expect(props.onReview).not.toHaveBeenCalled();
});

it('changes the date only on the selected older visit', async () => {
    save.mockResolvedValue({});
    const screen = render(<RestaurantVisitActions {...props} visits={[row('older', '2026-09-01'), row('newer', '2026-09-02')]} />);
    fireEvent.press(screen.getByLabelText('Visit history, 2 visits'));
    fireEvent.press(screen.getByLabelText(/^Visit 1, no review,/));
    fireEvent.press(screen.getByLabelText('Change date for visit 1'));
    fireEvent.press(screen.getByText('Today'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ entry_id: 'older', patch: { visited_at: expect.any(String) } }));
    expect(record).not.toHaveBeenCalled();
});

it('undoes only the check-in just recorded, preserving the older visit', async () => {
    const older = row('older', '2026-09-01');
    const newer = row('newer', '2026-09-02');
    let finishCheckIn!: (result: unknown) => void;
    record.mockImplementationOnce(() => new Promise((resolve) => { finishCheckIn = resolve; }));
    undo.mockResolvedValue({});
    const screen = render(<RestaurantVisitActions {...props} visits={[older]} />);
    fireEvent.press(screen.getByText('Check in'));
    expect(record).toHaveBeenCalledTimes(1);
    await act(async () => { finishCheckIn({ entry: { id: 'newer', is_bare: true } }); });
    expect(screen.getByText('Check in')).toBeTruthy();
    expect(screen.getByText('Loading your visit…')).toBeTruthy();
    expectStableActions(screen);
    screen.rerender(<RestaurantVisitActions {...props} visits={[older, newer]} />);
    await act(async () => { fireEvent.press(screen.getByLabelText('Undo check-in')); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledWith('newer');
    screen.rerender(<RestaurantVisitActions {...props} visits={[older]} />);
    expect(screen.getByText('1 visit')).toBeTruthy();
    expect(screen.queryByText('Undo')).toBeNull();
});

it('does not offer another path while a repeat check-in needs retry', async () => {
    record.mockRejectedValueOnce(new Error('Offline'));
    const screen = render(<RestaurantVisitActions {...props} visits={[row('v1', '2026-09-01')]} />);
    fireEvent.press(screen.getByText('Check in'));
    await waitFor(() => expect(screen.getByText('Offline')).toBeTruthy());
    expectStableActions(screen);
    expect(screen.getByRole('button', { name: 'Check in' }).props.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Log a meal' }).props.disabled).toBe(true);
    const nonce = record.mock.calls[0][0].client_nonce;
    fireEvent.press(screen.getByText('Log a meal'));
    expect(props.onLog).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Add review'));
    expect(props.onReview).not.toHaveBeenCalled();
    record.mockResolvedValueOnce({ entry: { id: 'v2', is_bare: true } });
    fireEvent.press(screen.getByText('Retry check-in'));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1][0].client_nonce).toBe(nonce);
});

it('shows the saved rating, note and photo in the visit itself and opens that exact entry for reading', () => {
    const visit = {
        ...row('reviewed', '2026-09-01T12:00:00Z', '2026-09-01T12:30:00Z'),
        rating: 4.5, note: 'The roast chicken was worth returning for.', is_bare: false,
        photos: [{ id: 'photo', url: 'https://photos.example/lunch.jpg' }],
    };
    const screen = render(<RestaurantVisitActions {...props} visits={[visit]} />);
    expectStableActions(screen);
    const receipt = screen.getByLabelText('Open visit 1');
    expect(within(receipt).getByText(visit.note)).toBeTruthy();
    expect(within(receipt).getByLabelText('Your rating 4.5 out of 5')).toBeTruthy();
    const preview = screen.UNSAFE_getAllByType(Image).find((element) => element.props.source?.uri === visit.photos[0].url);
    expect(preview).toBeTruthy();
    fireEvent.press(receipt);
    expect(props.onOpenVisit).toHaveBeenCalledWith(visit);
    expect(props.onReview).not.toHaveBeenCalled();
    expect(props.onLog).not.toHaveBeenCalled();
});

it('moves from a bare check-in to saved review content while keeping both main actions unchanged', () => {
    const bare = row('same-visit', '2026-09-01T12:00:00Z');
    const screen = render(<RestaurantVisitActions {...props} visits={[bare]} />);
    fireEvent.press(screen.getByText('Add review'));
    expect(props.onReview).toHaveBeenCalledWith(bare);
    const saved = { ...bare, rating: 4, note: 'Lunch was lovely.', is_bare: false };
    screen.rerender(<RestaurantVisitActions {...props} visits={[saved]} selectedVisitId={saved.entry_id} />);
    expectStableActions(screen);
    expect(screen.queryByText('Add review')).toBeNull();
    expect(screen.getByText('Lunch was lovely.')).toBeTruthy();
    expect(screen.getByText('1 visit')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open visit 1'));
    expect(props.onOpenVisit).toHaveBeenCalledWith(saved);
    fireEvent.press(screen.getByText('Log a meal'));
    expect(props.onLog).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
});

it('never offers undo for an older check-in or for a newly recorded visit after review content arrives', async () => {
    const older = row('older', '2026-09-01');
    const fresh = row('fresh', '2026-09-02');
    const screen = render(<RestaurantVisitActions {...props} visits={[older]} />);
    expect(screen.queryByLabelText('Undo check-in')).toBeNull();
    record.mockResolvedValueOnce({ entry: { id: fresh.id, is_bare: true } });
    fireEvent.press(screen.getByText('Check in'));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    screen.rerender(<RestaurantVisitActions {...props} visits={[older, fresh]} />);
    expect(screen.getByLabelText('Undo check-in')).toBeTruthy();
    screen.rerender(<RestaurantVisitActions {...props} visits={[older, { ...fresh, rating: 4, is_bare: false }]} />);
    expect(screen.queryByLabelText('Undo check-in')).toBeNull();
    expectStableActions(screen);
});
