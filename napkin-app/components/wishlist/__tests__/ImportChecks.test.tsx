/* eslint-disable import/first */
import React from 'react';
// @ts-expect-error react-test-renderer has no types in this project.
import TestRenderer, { act } from 'react-test-renderer';
import { Colors } from '@/constants/theme';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockCorrect = jest.fn();
const mockDismiss = jest.fn();
const mockRetry = jest.fn();
const mockMint = jest.fn();
jest.mock('react-native', () => ({
    View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
    StyleSheet: { create: (styles: unknown) => styles },
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/imports/useCompletenessRetries', () => ({
    useCorrectCompletenessItem: () => ({ mutateAsync: mockCorrect }),
    useDismissCompletenessItem: () => ({ mutateAsync: mockDismiss }),
    useRetryCompletenessItem: () => ({ mutateAsync: mockRetry }),
}));
jest.mock('@/lib/importResolution', () => ({ mintImportMatchCorrection: (...args: any[]) => mockMint(...args) }));
jest.mock('../PlacePickerModal', () => ({ PlacePickerModal: 'PlacePickerModal' }));
import { ImportChecks, importCheckExplanation } from '../ImportChecks';
const ITEM = {
    id: 'check-1', job_id: 'job-1', item_nonce: 'item-nonce', import_nonce: 'import-nonce',
    restaurant_id: 'restaurant-1', restaurant_name: 'Posada Real Torre Berrueza',
    restaurant_city: 'Espinosa de los Monteros', resolution_id: 'prior-resolution',
    last_error: 'no_result', created_at: '2026-09-05T12:00:00Z',
};
function mount(overrides = {}) {
    const props = { userId: 'owner-1', items: [ITEM], savedRestaurantIds: new Set(['restaurant-1']),
        palette: Colors.light, loading: false, error: false, hasMore: false, loadingMore: false,
        onRetryLoad: jest.fn(), onLoadMore: jest.fn(), onRefreshPlaces: jest.fn(), refreshingPlaces: false, ...overrides };
    let renderer: any;
    act(() => { renderer = TestRenderer.create(<ImportChecks {...props} />); });
    return renderer;
}
function button(r: any, label: string) { return r.root.findByProps({ accessibilityLabel: label }); }
function contents(r: any) { return JSON.stringify(r.toJSON()); }
beforeEach(() => {
    mockCorrect.mockReset().mockResolvedValue({ state: 'pending' });
    mockDismiss.mockReset().mockResolvedValue({ dismissed: true });
    mockRetry.mockReset().mockResolvedValue({ state: 'pending' });
    mockMint.mockReset().mockResolvedValue('fresh-resolution');
});
it('explains the uncertainty and keeps saved-place dismissal separate from deletion', async () => {
    const r = mount();
    expect(contents(r)).toContain('No confident match was found');
    expect(contents(r)).toContain('Keeps your saved place and clears this check.');
    expect(contents(r)).not.toContain('try matching again');
    await act(async () => { await button(r, 'keep as saved').props.onPress(); });
    expect(mockDismiss).toHaveBeenCalledWith('check-1');
    expect(mockCorrect).not.toHaveBeenCalled();
    expect(mockRetry).not.toHaveBeenCalled();
    expect(contents(r)).toContain('Check cleared. Your saved place is unchanged.');
    act(() => r.unmount());
});
it('mints owner-bound fresh provenance before correcting, and passes imported locality', async () => {
    const r = mount();
    act(() => button(r, 'find correct place').props.onPress());
    const picker = r.root.findByType('PlacePickerModal');
    expect(picker.props.city).toBe('Espinosa de los Monteros');
    await act(async () => { await picker.props.onSelect({ id: 'ChIJ-picked', name: 'Chosen place' }); });
    expect(mockMint).toHaveBeenCalledWith({ import_nonce: 'import-nonce', prior_resolution_id: 'prior-resolution',
        chosen_external_id: 'ChIJ-picked', expected_owner_id: 'owner-1' });
    expect(mockCorrect).toHaveBeenCalledWith({ item_id: 'check-1', resolution_id: 'fresh-resolution' });
    expect(mockMint.mock.invocationCallOrder[0]).toBeLessThan(mockCorrect.mock.invocationCallOrder[0]);
    expect(r.root.findByType('PlacePickerModal').props.visible).toBe(false);
    expect(contents(r)).toContain('Refresh places to see the latest details after matching.');
    act(() => r.unmount());
});
it('blocks duplicate picks, retains an inline failure, and does not dismiss a failed match', async () => {
    let fail!: (error: Error) => void;
    mockMint.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const r = mount();
    act(() => button(r, 'find correct place').props.onPress());
    const pick = r.root.findByType('PlacePickerModal').props.onSelect;
    let pending!: Promise<void>;
    act(() => { pending = pick({ id: 'ChIJ-picked', name: 'Chosen' }); });
    await act(async () => { await pick({ id: 'ChIJ-other', name: 'Other' }); });
    expect(mockMint).toHaveBeenCalledTimes(1);
    await act(async () => { fail(new Error('network')); await pending; });
    expect(mockCorrect).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(r.root.findByType('PlacePickerModal').props.visible).toBe(true);
    expect(r.root.findByType('PlacePickerModal').props.errorText).toContain('Could not verify');
    act(() => r.unmount());
});
it('does not claim all checks are clear on a failed or incomplete read', () => {
    for (const extra of [{ error: true }, { loading: true }, { hasMore: true }]) {
        const r = mount({ items: [], ...extra });
        expect(contents(r)).not.toContain('No place checks waiting');
        act(() => r.unmount());
    }
});
it('retries legacy checks without inventing a match or a saved-place claim', async () => {
    const refresh = jest.fn();
    const r = mount({ items: [{ ...ITEM, import_nonce: null, restaurant_id: null }], onRefreshPlaces: refresh });
    expect(contents(r)).not.toContain('find correct place');
    expect(contents(r)).not.toContain('Choose a listing');
    expect(contents(r)).toContain('Automatic matching has paused.');
    expect(contents(r)).toContain('dismiss check');
    await act(async () => { await button(r, 'try matching again').props.onPress(); });
    expect(mockRetry).toHaveBeenCalledWith('check-1');
    expect(contents(r)).toContain('this check may return');
    act(() => button(r, 'refresh places').props.onPress());
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
});
it('does not expose internal provider errors or falsely assert a missing city', () => {
    expect(importCheckExplanation('locality_reject')).toBe('The location could not be confirmed.');
    expect(importCheckExplanation('secret-provider-payload')).toBe('Napkin could not finish checking this place’s details.');
});
