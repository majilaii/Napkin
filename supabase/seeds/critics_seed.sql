-- TICKET-026 — professional_critic_reviews seed fixtures.
--
-- Hand-curated rows for visual + edge-case verification of the Visits-tab
-- "Professional takes" band. Keyed by restaurant name lookups so the seed
-- works against whatever UUIDs exist in a dev DB. If a named restaurant is
-- absent, that row is silently skipped (the lookup returns NULL → nothing
-- inserted).
--
-- Coverage:
--   - kind=stars     (NYT / Pete Wells — Carbone)
--   - kind=score     (Infatuation — Carbone)
--   - kind=essential (Eater — Via Carota)
--   - kind=feature   (em-dash row)         — NYT feature on Via Carota
--   - suppressed=true                      — hidden row (takedown audit)
--   - scrape_confidence=40                 — low-confidence → excerpt suppressed client-side
--
-- Idempotent via the (restaurant_id, publication) unique index: re-running
-- upserts on that key. Replace restaurant names below with spots that exist
-- in your dev DB if different.

-- ── Carbone (NYC) ──────────────────────────────────────────────────────────
with r as (select id from public.restaurants where name ilike 'carbone%' order by created_at asc limit 1)
insert into public.professional_critic_reviews
    (restaurant_id, publication, kind, score, score_out_of, author, published_date, excerpt, source_url, scrape_confidence, suppressed)
select id, 'nyt', 'stars', '★★', null, 'Pete Wells', '2013-10-01',
       'The decor is studied, the waiters wear vintage dinner jackets, and the red sauce is taken more seriously than almost any place in town.',
       'https://www.nytimes.com/2013/10/02/dining/restaurant-review-carbone-in-greenwich-village.html',
       95, false
from r
on conflict (restaurant_id, publication) do update set
    kind = excluded.kind, score = excluded.score, score_out_of = excluded.score_out_of,
    author = excluded.author, published_date = excluded.published_date,
    excerpt = excluded.excerpt, source_url = excluded.source_url,
    scrape_confidence = excluded.scrape_confidence, suppressed = excluded.suppressed;

with r as (select id from public.restaurants where name ilike 'carbone%' order by created_at asc limit 1)
insert into public.professional_critic_reviews
    (restaurant_id, publication, kind, score, score_out_of, author, published_date, excerpt, source_url, scrape_confidence, suppressed)
select id, 'infatuation', 'score', '8.6', '10', 'The Infatuation Staff', '2022-06-15',
       'Carbone is a time-machine to an Italian-American fantasy. The spicy rigatoni vodka is worth the hype, and then some.',
       'https://www.theinfatuation.com/new-york/reviews/carbone',
       90, false
from r
on conflict (restaurant_id, publication) do update set
    kind = excluded.kind, score = excluded.score, score_out_of = excluded.score_out_of,
    author = excluded.author, published_date = excluded.published_date,
    excerpt = excluded.excerpt, source_url = excluded.source_url,
    scrape_confidence = excluded.scrape_confidence, suppressed = excluded.suppressed;

-- Low-confidence row — the excerpt is garbled; client should suppress it
-- but still render publication/score/author/year. Uses the `eater` slot so
-- it doesn't clash with the NYT or Infatuation rows above.
with r as (select id from public.restaurants where name ilike 'carbone%' order by created_at asc limit 1)
insert into public.professional_critic_reviews
    (restaurant_id, publication, kind, score, score_out_of, author, published_date, excerpt, source_url, scrape_confidence, suppressed)
select id, 'eater', 'essential', null, null, null, '2024-01-10',
       '  [garbled pull-quote — parsed incorrectly] ',
       'https://ny.eater.com/maps/best-restaurants-nyc-38-essentials',
       40, false
from r
on conflict (restaurant_id, publication) do update set
    kind = excluded.kind, score = excluded.score, score_out_of = excluded.score_out_of,
    author = excluded.author, published_date = excluded.published_date,
    excerpt = excluded.excerpt, source_url = excluded.source_url,
    scrape_confidence = excluded.scrape_confidence, suppressed = excluded.suppressed;

-- ── Via Carota (NYC) ───────────────────────────────────────────────────────
with r as (select id from public.restaurants where name ilike 'via carota%' order by created_at asc limit 1)
insert into public.professional_critic_reviews
    (restaurant_id, publication, kind, score, score_out_of, author, published_date, excerpt, source_url, scrape_confidence, suppressed)
select id, 'eater', 'essential', null, null, null, '2024-09-01',
       'A West Village gem where the insalata verde is a religion.',
       'https://ny.eater.com/maps/best-restaurants-nyc-38-essentials',
       100, false
from r
on conflict (restaurant_id, publication) do update set
    kind = excluded.kind, score = excluded.score, score_out_of = excluded.score_out_of,
    author = excluded.author, published_date = excluded.published_date,
    excerpt = excluded.excerpt, source_url = excluded.source_url,
    scrape_confidence = excluded.scrape_confidence, suppressed = excluded.suppressed;

with r as (select id from public.restaurants where name ilike 'via carota%' order by created_at asc limit 1)
insert into public.professional_critic_reviews
    (restaurant_id, publication, kind, score, score_out_of, author, published_date, excerpt, source_url, scrape_confidence, suppressed)
select id, 'nyt', 'feature', null, null, 'Tejal Rao', '2021-05-19',
       'Rita Sodi and Jody Williams have built a room that feels like the best dinner party in the West Village.',
       'https://www.nytimes.com/2021/05/19/dining/via-carota-rita-sodi-jody-williams.html',
       88, false
from r
on conflict (restaurant_id, publication) do update set
    kind = excluded.kind, score = excluded.score, score_out_of = excluded.score_out_of,
    author = excluded.author, published_date = excluded.published_date,
    excerpt = excluded.excerpt, source_url = excluded.source_url,
    scrape_confidence = excluded.scrape_confidence, suppressed = excluded.suppressed;

-- ── Suppressed row (takedown audit) — never rendered ───────────────────────
-- Seeded against Via Carota's Infatuation slot so the verification is
-- "the Visits tab shows NYT + Eater but NOT Infatuation for Via Carota."
with r as (select id from public.restaurants where name ilike 'via carota%' order by created_at asc limit 1)
insert into public.professional_critic_reviews
    (restaurant_id, publication, kind, score, score_out_of, author, published_date, excerpt, source_url, scrape_confidence, suppressed)
select id, 'infatuation', 'score', '8.9', '10', 'The Infatuation Staff', '2020-03-01',
       '[takedown — do not render]',
       'https://www.theinfatuation.com/new-york/reviews/via-carota',
       100, true
from r
on conflict (restaurant_id, publication) do update set
    kind = excluded.kind, score = excluded.score, score_out_of = excluded.score_out_of,
    author = excluded.author, published_date = excluded.published_date,
    excerpt = excluded.excerpt, source_url = excluded.source_url,
    scrape_confidence = excluded.scrape_confidence, suppressed = excluded.suppressed;
