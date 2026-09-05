-- Actual merge RPC: neither an unknown candidate date nor an unknown request
-- date may pass the commit-time shared-meal window. Fixtures always roll back.
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
('98500000-0000-0000-0000-000000000001', 'merge-author@visits.invalid', '{"display_name":"Merge author"}'),
('98500000-0000-0000-0000-000000000002', 'merge-actor@visits.invalid', '{"display_name":"Merge actor"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (user_id, display_name) VALUES
('98500000-0000-0000-0000-000000000001', 'Merge author'),
('98500000-0000-0000-0000-000000000002', 'Merge actor')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.restaurants (id, name) VALUES
('98500000-0000-0000-0000-000000000010', 'Unknown date fixture');
INSERT INTO public.tables (id, owner_id, name) VALUES
('98500000-0000-0000-0000-000000000020', '98500000-0000-0000-0000-000000000001', 'Merge fixture');
INSERT INTO public.table_members (table_id, member_id, role) VALUES
('98500000-0000-0000-0000-000000000020', '98500000-0000-0000-0000-000000000001', 'admin'),
('98500000-0000-0000-0000-000000000020', '98500000-0000-0000-0000-000000000002', 'member');
INSERT INTO public.entries (id, user_id, restaurant_id, visited_at, visibility) VALUES
('98500000-0000-0000-0000-000000000030', '98500000-0000-0000-0000-000000000001', '98500000-0000-0000-0000-000000000010', NULL, 'friends');

DO $test$
DECLARE
    requested_date timestamptz;
    test_case integer;
BEGIN
    FOR test_case IN 1..2 LOOP
        requested_date := CASE WHEN test_case = 1 THEN '2026-09-05T12:00:00Z'::timestamptz ELSE NULL END;
        IF test_case = 2 THEN
            UPDATE public.entries SET visited_at = '2026-09-05T12:00:00Z'
            WHERE id = '98500000-0000-0000-0000-000000000030';
        END IF;
        BEGIN
            PERFORM public.fn_create_entry_and_merge_round(
                '98500000-0000-0000-0000-000000000002',
                '98500000-0000-0000-0000-000000000020',
                '98500000-0000-0000-0000-000000000010',
                requested_date,
                '98500000-0000-0000-0000-000000000030',
                '{}'::jsonb,
                NULL
            );
            RAISE EXCEPTION 'unknown date unexpectedly passed merge guard';
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
            ASSERT SQLERRM = 'round_conflict: visited_at outside 18h window',
                'must refuse at the date window, not a later unrelated guard';
        END;
    END LOOP;
END;
$test$;

ROLLBACK;
