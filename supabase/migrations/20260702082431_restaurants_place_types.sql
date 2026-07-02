-- Restaurant page 2a: persist Google place types for tag chips
-- ("fine dining", "small plates", "wine bar").
--
-- Blast radius (additive, nullable — no RLS/FK/embed impact):
--   writers: _shared/restaurant.ts upsertFromPlace (sparse write from input.types)
--   readers: restaurant-history?action=page select list
--   client:  RestaurantPageRestaurant.place_types (optional field, old caches fine)
--   optimistic patches: none synthesize restaurant rows with this field
alter table public.restaurants
    add column if not exists place_types text[];
