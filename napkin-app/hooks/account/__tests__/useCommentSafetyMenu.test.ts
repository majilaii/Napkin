/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
type AlertButton = { text: string; style?: string; onPress?: () => void };
const mockAlert = jest.fn();
const mockReport = jest.fn();
const mockBlock = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('react-native', () => ({
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));
jest.mock('react', () => ({
    ...jest.requireActual('react'),
    useCallback: (fn: unknown) => fn,
}));
jest.mock('../useReportContent', () => ({
    useReportContent: () => ({ mutate: (...args: unknown[]) => mockReport(...args) }),
}));
jest.mock('../useBlocking', () => ({
    useBlockUser: () => ({ mutate: (...args: unknown[]) => mockBlock(...args) }),
}));
jest.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: (...args: unknown[]) => mockInvalidate(...args) }),
}));

import { useCommentSafetyMenu } from '../useCommentSafetyMenu';

function buttons(callIndex: number): AlertButton[] {
    return mockAlert.mock.calls[callIndex][2] as AlertButton[];
}

function press(callIndex: number, text: string): void {
    const button = buttons(callIndex).find((b) => b.text === text);
    if (!button?.onPress) throw new Error(`no button "${text}"`);
    button.onPress();
}

const comment = { id: 'comment-1', user_id: 'billie', profiles: { display_name: 'Billie' } };

describe('useCommentSafetyMenu', () => {
    beforeEach(() => {
        mockAlert.mockReset();
        mockReport.mockReset();
        mockBlock.mockReset();
        mockInvalidate.mockReset();
    });

    it('reports the exact comment with the chosen reason', () => {
        const open = useCommentSafetyMenu();
        open(comment);
        expect(mockAlert.mock.calls[0][0]).toBe('Billie');
        press(0, 'Report this comment');
        press(1, 'Offensive or abusive');
        expect(mockReport).toHaveBeenCalledWith(
            { targetType: 'comment', targetId: 'comment-1', reason: 'offensive' },
            expect.any(Object),
        );
    });

    it('blocks the author only after a confirm', () => {
        const open = useCommentSafetyMenu();
        open(comment);
        press(0, 'Block Billie');
        expect(mockBlock).not.toHaveBeenCalled();
        expect(mockAlert.mock.calls[1][0]).toBe('Block Billie?');
        press(1, 'Block');
        expect(mockBlock).toHaveBeenCalledWith('billie', expect.any(Object));
    });

    it('refetches the thread after a block so the comment leaves at once', () => {
        const open = useCommentSafetyMenu({ targetType: 'entry', targetId: 'entry-9', scope: 'public' });
        open(comment);
        press(0, 'Block Billie');
        press(1, 'Block');
        const [, options] = mockBlock.mock.calls[0];
        (options as { onSuccess: () => void }).onSuccess();
        expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['postInteractions', 'entry', 'entry-9', 'public'] });
    });

    it('never titles the menu with the "New User" placeholder', () => {
        const open = useCommentSafetyMenu();
        open({ id: 'comment-3', user_id: 'someone', profiles: { display_name: 'New User' } });
        expect(mockAlert.mock.calls[0][0]).toBe('this person');
    });

    it('names an author with no display name neutrally', () => {
        const open = useCommentSafetyMenu();
        open({ id: 'comment-2', user_id: 'someone', profiles: null });
        expect(mockAlert.mock.calls[0][0]).toBe('this person');
        expect(buttons(0).map((b) => b.text)).toContain('Block this person');
    });
});
