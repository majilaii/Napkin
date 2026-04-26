-- Backfill restaurants.city from restaurants.address when city is null.
--
-- Most Google-formatted addresses look like:
--   "123 Main St, New York, NY 10001, USA"     (4 commas → city is part [-3])
--   "12 Rue de Rivoli, 75001 Paris, France"    (3 commas → city is part [-2])
--
-- Strategy: count comma-separated parts, then index from the right of the
-- country to find the city slot.
--
-- Run in the Supabase SQL editor. PREVIEW first (select), apply second (update).
--
-- ── Preview ──────────────────────────────────────────────────────────────────
-- Inspect what the script would set before mutating anything.
--
-- select
--     id,
--     name,
--     city  as city_before,
--     address,
--     case array_length(string_to_array(address, ','), 1)
--         when 4 then trim(split_part(address, ',', 2))
--         when 5 then trim(split_part(address, ',', 3))
--         when 3 then trim(split_part(address, ',', 2))
--         else null
--     end as city_guess
-- from public.restaurants
-- where city is null
--   and address is not null
-- order by created_at desc
-- limit 100;

-- ── Apply ────────────────────────────────────────────────────────────────────
-- Updates only rows where the heuristic produces a non-empty value.
update public.restaurants
set city = case array_length(string_to_array(address, ','), 1)
    when 4 then trim(split_part(address, ',', 2))
    when 5 then trim(split_part(address, ',', 3))
    when 3 then trim(split_part(address, ',', 2))
    else null
end
where city is null
  and address is not null
  and case array_length(string_to_array(address, ','), 1)
        when 4 then trim(split_part(address, ',', 2))
        when 5 then trim(split_part(address, ',', 3))
        when 3 then trim(split_part(address, ',', 2))
        else null
      end is not null
  and case array_length(string_to_array(address, ','), 1)
        when 4 then trim(split_part(address, ',', 2))
        when 5 then trim(split_part(address, ',', 3))
        when 3 then trim(split_part(address, ',', 2))
        else null
      end <> '';

-- ── Verify ───────────────────────────────────────────────────────────────────
-- select count(*) filter (where city is null) as still_null,
--        count(*) filter (where city is not null) as has_city
-- from public.restaurants;
