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
export { ReactionPicker } from './ReactionPicker';

// TICKET-060: multimodal import feed cards
export { SharedSaveCard, type SharedSaveCardProps, type SharedSaveCardRestaurant } from './SharedSaveCard';
export { ShareDigestCard, type ShareDigestCardProps } from './ShareDigestCard';
export { RestaurantFloatCard, type RestaurantFloatCardProps, type FloatMember } from './RestaurantFloatCard';

// Feed tab (TICKET-098: friends-only reviews + trending rail)
export { FriendFeedCard } from './FriendFeedCard';
export { InlineStars } from './InlineStars';
