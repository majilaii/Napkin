type ListEntryRow = Record<string, unknown> & {
  restaurant?: Record<string, unknown> | null;
};

/** Project a service-role list embed into its viewer-safe wire shape. */
export function projectListEntryForViewer(
  entry: ListEntryRow,
  viewerId: string,
): ListEntryRow | null {
  const restaurant = entry.restaurant;
  if (!restaurant) return null;
  const isCreator = restaurant.created_by === viewerId;
  const isLiveVerified = restaurant.verification === "verified" &&
    restaurant.merged_into == null;
  if (!isCreator && !isLiveVerified) return null;

  const { merged_into: _mergedInto, ...withoutAlias } = restaurant;
  if (isCreator) {
    return { ...entry, restaurant: withoutAlias };
  }
  const {
    created_by: _createdBy,
    completeness_version: _completenessVersion,
    ...publicRestaurant
  } = withoutAlias;
  return { ...entry, restaurant: publicRestaurant };
}
