import {
    CREATE_TABLE_COPY,
    CREATE_TABLE_NAME_TYPE,
    getCreateTableKeyboardOffset,
} from '../createTablePresentation';

describe('create-table presentation contract', () => {
    it('uses the shortened labels and upright authored-name type', () => {
        expect(CREATE_TABLE_COPY).toEqual({
            title: 'Start a Table',
            namePlaceholder: 'Table name',
            inviteLabel: 'Invite people',
            emptyMutuals: 'No matching mutual friends.',
        });
        expect(CREATE_TABLE_NAME_TYPE).toMatchObject({
            fontFamily: 'Newsreader_500Medium',
            fontSize: 22,
            lineHeight: 28,
        });
    });

    it('aligns keyboard avoidance with the modal origin without adding a full-screen offset', () => {
        expect(getCreateTableKeyboardOffset(667, null)).toBe(0);
        expect(getCreateTableKeyboardOffset(667, 667)).toBe(0);
        expect(getCreateTableKeyboardOffset(667, 637)).toBe(30);
        expect(getCreateTableKeyboardOffset(852, 790)).toBe(62);
        expect(getCreateTableKeyboardOffset(667, 700)).toBe(0);
    });
});
