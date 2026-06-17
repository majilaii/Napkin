-- Wave 2: make a table_share (the "shared_save" feed card) a first-class post and
-- make it retractable by its author.
--
-- (1) comment_count — table_shares already denormalizes reaction_count + top_emojis
--     via sync_post_counts_and_top_emojis(); add comment_count and extend the
--     trigger so the feed card + detail can render a reply count like an entry.
-- (2) deleted_at — a soft-delete tombstone so the author can retract a share (the
--     orphaned-feed-card fix) without dangling its reaction/comment FKs. The
--     table-activity read filters `deleted_at IS NULL`.
--
-- post_comments on a table_share already insert fine (post-interactions accepts
-- target_type='table_share'); this just gives the feed a denormalized count and a
-- retract path. No RLS change: the existing member-select / author-update policies
-- already cover reading + soft-deleting one's own share.

alter table public.table_shares
    add column if not exists comment_count int not null default 0;

alter table public.table_shares
    add column if not exists deleted_at timestamptz;

-- Backfill comment_count from any existing comments (none expected pre-feature).
update public.table_shares ts
set comment_count = (
    select count(*)
    from public.post_comments pc
    where pc.target_type = 'table_share'
      and pc.target_id = ts.id
      and pc.scope = 'table'
)
where ts.comment_count = 0;

-- Recreate the AFTER-trigger count function. Verbatim from 20260615000100 except
-- the table_share branch now ALSO maintains comment_count. CREATE OR REPLACE keeps
-- the existing trigger bindings.
create or replace function public.sync_post_counts_and_top_emojis()
returns trigger language plpgsql as $$
declare
    v_target_type text;
    v_target_id   uuid;
    v_scope       text;
    v_reaction_count int;
    v_comment_count  int;
    v_top_emojis jsonb;
begin
    if tg_op = 'DELETE' then
        v_target_type := old.target_type;
        v_target_id   := old.target_id;
        v_scope       := old.scope;
    else
        v_target_type := new.target_type;
        v_target_id   := new.target_id;
        v_scope       := new.scope;
    end if;

    select count(*) into v_reaction_count
    from post_reactions
    where target_type = v_target_type and target_id = v_target_id and scope = v_scope;

    select count(*) into v_comment_count
    from post_comments
    where target_type = v_target_type and target_id = v_target_id and scope = v_scope;

    select coalesce(
        jsonb_agg(jsonb_build_object('emoji', emoji, 'count', cnt, 'last_reacted_at', last_at)
                  order by cnt desc, last_at desc),
        '[]'::jsonb
    ) into v_top_emojis
    from (
        select emoji, count(*) as cnt, max(created_at) as last_at
        from post_reactions
        where target_type = v_target_type and target_id = v_target_id and scope = v_scope
        group by emoji
    ) sub;

    if v_target_type = 'table_night' then
        update public.table_nights
        set reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis     = v_top_emojis
        where id = v_target_id;

    elsif v_target_type = 'entry' then
        if v_scope = 'table' then
            update public.entries
            set reaction_count = v_reaction_count,
                comment_count  = v_comment_count,
                top_emojis     = v_top_emojis
            where id = v_target_id;
        else
            update public.entries
            set public_reaction_count = v_reaction_count,
                public_reply_count    = v_comment_count,
                public_top_emojis     = v_top_emojis
            where id = v_target_id;
        end if;

    elsif v_target_type = 'table_share' then
        -- table_shares.top_emojis is text[] (not jsonb), so extract emoji strings only.
        update public.table_shares
        set reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis = (
                select coalesce(array_agg(emoji order by cnt desc), '{}')
                from (
                    select emoji, count(*) as cnt
                    from public.post_reactions pr
                    where pr.target_id   = v_target_id
                      and pr.target_type = 'table_share'
                      and pr.scope       = 'table'
                    group by emoji
                    order by cnt desc
                    limit 3
                ) sub2
            )
        where id = v_target_id;
    end if;

    return null;
end;
$$;

comment on column public.table_shares.comment_count is
  'Denorm reply count, maintained by sync_post_counts_and_top_emojis (Wave 2).';
comment on column public.table_shares.deleted_at is
  'Soft-delete tombstone — author retracted the share. table-activity reads filter deleted_at IS NULL.';
