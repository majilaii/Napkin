-- Backfill restaurants.city from restaurants.address.
--
-- Older rows lack city because places-search/index.ts only started extracting
-- locality from addressComponents on 2026-04-25. Re-running Places lookups for
-- every legacy row would burn Google credits; the canonical address string
-- already carries the city in nearly every case.
--
-- Heuristic:
--   US addresses (last part = "USA"/"US"/"United States"): city = part N-2.
--     Shape: "<street>, <city>, <region> <zip>, USA"
--   Everything else (UK/EU): city = part N-1, with any trailing UK postcode
--     stripped. Shape: "<street>, ..., <city> <postcode>, <country>".
--
-- Edge cases (UK addresses missing the trailing "UK" segment) stay null and
-- can be cleaned manually. Address-less rows need a Places refetch.

with parts as (
    select id,
        string_to_array(address, ',') as p,
        array_length(string_to_array(address, ','), 1) as n
    from public.restaurants
    where city is null and address is not null
),
guesses as (
    select id,
        case
            when n is null or n < 2 then null
            when trim(p[n]) ilike 'usa'
              or trim(p[n]) ilike 'us'
              or trim(p[n]) ilike 'united states'
              then trim(p[greatest(n - 2, 1)])
            else regexp_replace(
                trim(p[n - 1]),
                '\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$',
                '',
                'i'
            )
        end as guess
    from parts
)
update public.restaurants r
set city = g.guess
from guesses g
where r.id = g.id
  and g.guess is not null
  and g.guess <> '';
