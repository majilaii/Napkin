import {
    CREATE_TABLE_COPY,
    CREATE_TABLE_NAME_TYPE,
} from '../createTablePresentation';

describe('create-table presentation contract', () => {
    it('uses the shortened labels and upright authored-name type', () => {
        expect(CREATE_TABLE_COPY).toEqual({
            inviteLabel: 'Invite',
            emptyMutuals: 'no mutual follows yet',
        });
        expect(CREATE_TABLE_NAME_TYPE).toMatchObject({
            fontFamily: 'Newsreader_500Medium',
            fontSize: 28,
            lineHeight: 34,
        });
    });
});
