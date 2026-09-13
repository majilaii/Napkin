import { Type } from '@/constants/theme';

export const CREATE_TABLE_COPY = {
    title: 'Start a Table',
    namePlaceholder: 'Table name',
    inviteLabel: 'Invite people',
    emptyMutuals: 'No matching mutual friends.',
} as const;

export const CREATE_TABLE_NAME_TYPE = Type.listNameInput;

/** iOS page sheets begin below the window's top; keyboard frames use window coordinates. */
export function getCreateTableKeyboardOffset(windowHeight: number, rootHeight: number | null): number {
    return rootHeight === null ? 0 : Math.max(0, windowHeight - rootHeight);
}
