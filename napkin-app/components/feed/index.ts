/**
 * Barrel export for feed components.
 */
export { Avatar } from './Avatar';
export { PulseDot } from './PulseDot';
export { TableNightCard } from './TableNightCard';
export { SoloShareCard } from './SoloShareCard';
export { JournalNoteCard } from './JournalNoteCard';
export { FilterChipRow, type FilterChip } from './FilterChipRow';
export { DateSectionHeader } from './DateSectionHeader';
export { CompactEntryRow } from './CompactEntryRow';
export { ActiveRoundsShelf } from './ActiveRoundsShelf';
export { FeedActionRow } from './FeedActionRow';

// TICKET-060: multimodal import feed cards
export { SharedSaveCard, type SharedSaveCardProps, type SharedSaveCardRestaurant } from './SharedSaveCard';
export { ShareDigestCard, type ShareDigestCardProps } from './ShareDigestCard';
export { RestaurantFloatCard, type RestaurantFloatCardProps, type FloatMember } from './RestaurantFloatCard';

// Feed tab (TICKET-098: friends-only reviews)
export { FriendFeedCard } from './FriendFeedCard';
export { InlineStars } from './InlineStars';

// Feed re-dress — sparse tail (TICKET-103; DiscoveryLedger + TrendingRail
// reaped in TICKET-189 §7)
export { FeedSparseTail } from './FeedSparseTail';

// Feed modes — For You / Following (TICKET-125)
export { FeedModeTabs, type FeedMode } from './FeedModeTabs';
export { FeedHeader } from './FeedHeader';
export { FollowingFeed } from './FollowingFeed';
export { ForYouFeed } from './ForYouFeed';
export { FollowingEmptyState } from './FollowingEmptyState';
export { PublicListsBrowseBlock } from './PublicListsBrowseBlock';
export { PeopleToFollowBlock } from './PeopleToFollowBlock';

// TICKET-189 — "on socials" module (flag FOR_YOU_SOCIALS)
export { OnSocialsBlock } from './OnSocialsBlock';

// TICKET-115 Table lists — quiet ledger line for table-list adds
export { ListAddLedgerLine } from './ListAddLedgerLine';

// TICKET-130 Gazette mix — shared big kicker + engraved cuisine chip
export { SectionKicker } from './SectionKicker';
export { GlyphChip, chipTint } from './GlyphChip';
