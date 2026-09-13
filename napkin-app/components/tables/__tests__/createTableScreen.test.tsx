/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import CreateTableScreen from '@/app/create-table';

const mockCreate = jest.fn();
const mockAddMember = jest.fn();
const mockCreateInvite = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockAlert = jest.fn();
const mockShare = jest.fn();
const mockToast = jest.fn();
const mockFocus = jest.fn();
const mockClara = { user_id: 'clara-id', display_name: 'Clara', avatar_url: null, is_mutual: true };

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) => ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'), Text: host('Text'), Pressable: host('Pressable'),
        ScrollView: host('ScrollView'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
        ActivityIndicator: host('ActivityIndicator'),
        TextInput: ReactModule.forwardRef((props: Record<string, unknown>, ref: unknown) => {
            ReactModule.useImperativeHandle(ref, () => ({ focus: mockFocus }));
            return ReactModule.createElement('TextInput', props);
        }),
        Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
        Share: { share: (...args: unknown[]) => mockShare(...args) },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        useWindowDimensions: () => ({ width: 375, height: 667, scale: 2, fontScale: 1 }),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style ?? {},
        },
    };
});
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, back: mockBack }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'owner-id' } }) }));
jest.mock('@/providers/ToastProvider', () => ({ useToast: () => ({ show: mockToast }) }));
jest.mock('@/hooks/tables/useCreateTable', () => ({ useCreateTable: () => ({ mutateAsync: mockCreate }) }));
jest.mock('@/hooks/tables/useAddMember', () => ({ useAddMember: () => ({ mutateAsync: mockAddMember }) }));
jest.mock('@/hooks/tables/useCreateInvite', () => ({ useCreateInvite: () => ({ mutateAsync: mockCreateInvite }) }));
jest.mock('@/hooks/users/useUserSearch', () => ({ useUserSearch: () => ({ data: [mockClara], isFetching: false }) }));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/constants/links', () => ({ TESTFLIGHT_INVITE_URL: '' }));

async function selectClara(screen: ReturnType<typeof render>) {
    fireEvent.changeText(screen.getByLabelText('Search mutual friends'), 'Clara');
    await act(async () => { jest.advanceTimersByTime(250); });
    fireEvent.press(screen.getByLabelText('Select Clara'));
}

describe('Create Table form and invitation contract', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockCreate.mockResolvedValue({ id: 'created-table-id' });
        mockAddMember.mockResolvedValue({ status: 'pending' });
        mockCreateInvite.mockResolvedValue({ join_url: 'https://example.invalid/join' });
        mockShare.mockResolvedValue({ action: 'sharedAction' });
    });
    afterEach(() => {
        act(() => { jest.runOnlyPendingTimers(); });
        jest.useRealTimers();
    });

    it('shows a clearly empty name and blocks both creation paths for whitespace', () => {
        const screen = render(<CreateTableScreen />);
        expect(screen.getByPlaceholderText('Table name').props.value).toBe('');
        expect(screen.queryByPlaceholderText('Sunday Roast Club')).toBeNull();
        fireEvent.changeText(screen.getByLabelText('Table name'), '   ');
        expect(screen.getByLabelText('Create table').props.accessibilityState.disabled).toBe(true);
        fireEvent.press(screen.getByLabelText('Create table'));
        fireEvent.press(screen.getByLabelText('Create table and share invite link'));
        expect(mockFocus).toHaveBeenCalledTimes(1);
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockAddMember).not.toHaveBeenCalled();
        expect(mockCreateInvite).not.toHaveBeenCalled();
    });

    it('selects locally, waits for table creation, then sends pending invitations', async () => {
        let resolveCreate!: (table: { id: string }) => void;
        mockCreate.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
        const screen = render(<CreateTableScreen />);
        await selectClara(screen);
        expect(screen.getByText('Selected')).toBeTruthy();
        expect(screen.queryByText('invited')).toBeNull();
        expect(mockAddMember).not.toHaveBeenCalled();
        fireEvent.changeText(screen.getByLabelText('Table name'), '  Sunday Club  ');
        fireEvent.press(screen.getByLabelText('Create table'));
        expect(mockCreate).toHaveBeenCalledWith({ name: 'Sunday Club' });
        expect(mockAddMember).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Create table').props.accessibilityState.busy).toBe(true);
        expect(screen.getByLabelText('Table name').props.editable).toBe(false);
        expect(screen.getByLabelText('Back').props.accessibilityState.disabled).toBe(true);
        await act(async () => { resolveCreate({ id: 'created-table-id' }); });
        expect(mockAddMember).toHaveBeenCalledWith({ tableId: 'created-table-id', targetUserId: 'clara-id' });
        expect(mockToast).toHaveBeenCalledWith('1 invited');
        expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(tabs)/tables', params: { selected: 'created-table-id' } });
    });

    it('keeps the name and permits a retry after creation fails', async () => {
        mockCreate.mockRejectedValueOnce(new Error('offline'));
        const screen = render(<CreateTableScreen />);
        fireEvent.changeText(screen.getByLabelText('Table name'), 'Sunday Club');
        fireEvent.press(screen.getByLabelText('Create table'));
        await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Could not create table', 'Please try again in a moment.'));
        expect(screen.getByLabelText('Table name').props.value).toBe('Sunday Club');
        expect(screen.getByLabelText('Create table').props.accessibilityState.disabled).toBe(false);
        fireEvent.press(screen.getByLabelText('Create table'));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('reports a failed invitation without recreating or losing the created Table', async () => {
        mockAddMember.mockRejectedValueOnce(new Error('mutual relationship changed'));
        const screen = render(<CreateTableScreen />);
        await selectClara(screen);
        fireEvent.changeText(screen.getByLabelText('Table name'), 'Sunday Club');
        fireEvent.press(screen.getByLabelText('Create table'));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        expect(mockAlert).toHaveBeenCalledWith('Table created', "One person couldn't be invited — you can try again from the table.");
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockToast).not.toHaveBeenCalled();
    });

    it('shares only the real invite link after creation succeeds', async () => {
        const screen = render(<CreateTableScreen />);
        fireEvent.changeText(screen.getByLabelText('Table name'), 'Sunday Club');
        fireEvent.press(screen.getByLabelText('Create table and share invite link'));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        expect(mockCreateInvite).toHaveBeenCalledWith('created-table-id');
        expect(mockShare).toHaveBeenCalledWith({ message: 'join "Sunday Club" on Napkin — https://example.invalid/join' });
        expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(mockCreateInvite.mock.invocationCallOrder[0]);
        expect(mockCreateInvite.mock.invocationCallOrder[0]).toBeLessThan(mockShare.mock.invocationCallOrder[0]);
    });

    it('creates before sharing and keeps the created destination if invite minting fails', async () => {
        mockCreateInvite.mockRejectedValueOnce(new Error('link unavailable'));
        const screen = render(<CreateTableScreen />);
        fireEvent.changeText(screen.getByLabelText('Table name'), 'Sunday Club');
        fireEvent.press(screen.getByLabelText('Create table and share invite link'));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreateInvite).toHaveBeenCalledWith('created-table-id');
        expect(mockShare).not.toHaveBeenCalled();
    });
});
