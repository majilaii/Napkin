/**
 * CollectionsSection — the curated self and the capture loop under ONE roof
 * (TICKET-191). Owns the single "Collections" SectionHeader and the readiness
 * gate; ListsShelf and ImportsStrip render headerless beneath it with
 * subordinate RailSubLabels — never a second section header.
 *
 * Self: hold the whole section (header included) until useMyLists resolves —
 * the same anti-flash rule ListsShelf applies internally. Once resolved, lists
 * always yield content (ghost "new list" card minimum) and the strip yields
 * content once its history resolves (ghost minimum), so the header never sits
 * over an empty section. Cold start = the header over two quiet ghost cards.
 *
 * Stranger: public lists only — the whole section hides when there are none,
 * and the Imports strip (a private workbench) never renders.
 */
import React from 'react';
import { View } from 'react-native';

import { useMyLists } from '@/hooks/lists/useMyLists';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';
import { SectionHeader } from './SectionHeader';
import { ListsShelf } from './ListsShelf';
import { ImportsStrip } from './ImportsStrip';
import { publicListsToShelf } from './listsShelfUtils';

interface Props {
    isSelf: boolean;
    /** The profile owner's id. */
    userId: string;
    /** Stranger data: the profile payload's public lists (empty for self). */
    publicLists: ProfileListSummary[];
}

export function CollectionsSection({ isSelf, userId, publicLists }: Props) {
    // Same cache entry ListsShelf reads — this dedupes to one request.
    const { data: myLists } = useMyLists(isSelf ? userId : null);

    if (isSelf) {
        // Hold the header until lists resolve — no header-over-nothing flash.
        if (myLists === undefined) return null;
        return (
            <View>
                <SectionHeader title="Collections" />
                <ListsShelf isSelf userId={userId} publicLists={[]} />
                <ImportsStrip userId={userId} />
            </View>
        );
    }

    if (publicListsToShelf(publicLists).length === 0) return null;
    return (
        <View>
            <SectionHeader title="Collections" />
            <ListsShelf isSelf={false} userId={userId} publicLists={publicLists} />
        </View>
    );
}
