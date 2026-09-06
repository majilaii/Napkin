/* eslint-disable import/first -- Native hosts are replaced before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (v: any) => v.ios ?? v.default },
        StyleSheet: { create: (v: any) => v, flatten: (v: any) => Array.isArray(v) ? Object.assign({}, ...v.filter(Boolean)) : v, absoluteFill: {}, hairlineWidth: 1 },
        Text: host('Text'), TextInput: host('TextInput'), View: host('View'), Pressable: host('Pressable'), Image: host('Image'),
        Modal: host('Modal'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/imageUpload', () => ({ compressAndUpload: jest.fn() }));
jest.mock('@/components/photos/PhotoLightbox', () => ({ PhotoLightbox: () => null }));
jest.mock('@/hooks/restaurants/useRestaurantVisitMutations', () => ({ useRestaurantVisitMutations: jest.fn() }));

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Colors } from '@/constants/theme';
import { useRestaurantVisitMutations } from '@/hooks/restaurants/useRestaurantVisitMutations';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import { RestaurantVisitActions, orderVisits } from './RestaurantVisitActions';
import { VisitReviewSheet, stageVisitPhotos } from './VisitReviewSheet';

const row = (id: string, created_at: string, visited_at: string | null = null): SelfLogRow => ({ id, entry_id: id, created_at, visited_at, source: 'solo', supper_id: null, table_night_id: null, is_bare: true, rating: null, note: null, photos: [], companions: [] });
const props = { userId: 'u', pageId: 'r', restaurantId: 'r', restaurantName: 'Brawn', palette: Colors.light, onLog: jest.fn(), onOpenVisit: jest.fn() };

it('blocks double taps and retries the same nonce before allowing a distinct repeat visit', async () => {
    let reject!: (e: Error) => void;
    const record = jest.fn().mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    (useRestaurantVisitMutations as jest.Mock).mockReturnValue({ record: { mutateAsync: record }, save: {}, undo: {} });
    const screen = render(<RestaurantVisitActions {...props} visits={[]} />);
    act(() => { fireEvent.press(screen.getByText('Check in')); fireEvent.press(screen.getByText('Check in')); });
    expect(record).toHaveBeenCalledTimes(1);
    const nonce = record.mock.calls[0][0].client_nonce;
    await act(async () => { reject(new Error('Offline')); });
    record.mockResolvedValueOnce({ entry: { id: 'v1', is_bare: true } });
    fireEvent.press(screen.getByText('Retry check-in'));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1][0].client_nonce).toBe(nonce);
    screen.rerender(<RestaurantVisitActions {...props} visits={[row('v1', '2026-09-01')]} />);
    record.mockResolvedValueOnce({ entry: { id: 'v2', is_bare: true } });
    fireEvent.press(screen.getByText('Check in again'));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(3));
    expect(record.mock.calls[2][0].client_nonce).not.toBe(nonce);
});

it('numbers repeated visits by recording order, even after an earlier visit is backdated', () => {
    const a = row('a', '2026-09-01', '2026-08-30');
    const b = row('b', '2026-09-02', '2026-01-01');
    expect(orderVisits([a, b]).map((v) => v.id)).toEqual(['b', 'a']);
});

it('cancel discards note edits without saving; Save includes words and optional rating together', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const screen = render(<VisitReviewSheet visit={row('v', '2026-09-01')} number={1} restaurantName="Brawn" userId="u" palette={Colors.light} onSave={onSave} onClose={onClose} />);
    fireEvent.changeText(screen.getByLabelText('Your review, optional'), 'Still thinking about the pasta');
    fireEvent.press(screen.getByText('Cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText('Save review'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ rating: null, content: 'Still thinking about the pasta' }));
});

it('reuses staged photos after a later photo fails, with no binding or scalar save on failure', async () => {
    const photos = [{ uri: 'file:a' }, { uri: 'file:b' }];
    const upload = jest.fn().mockResolvedValueOnce('https://approved/a').mockRejectedValueOnce(new Error('Moderation unavailable')).mockResolvedValueOnce('https://approved/b');
    await expect(stageVisitPhotos(photos, 'u', upload)).rejects.toThrow('Moderation unavailable');
    await expect(stageVisitPhotos(photos, 'u', upload)).resolves.toEqual(['https://approved/a', 'https://approved/b']);
    expect(upload.mock.calls.map(([uri]) => uri)).toEqual(['file:a', 'file:b', 'file:b']);
});
