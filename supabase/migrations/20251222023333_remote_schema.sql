
  create table "public"."table_activity_comments" (
    "id" uuid not null default gen_random_uuid(),
    "entry_id" uuid,
    "user_id" uuid,
    "content" text not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."table_activity_comments" enable row level security;


  create table "public"."table_activity_likes" (
    "entry_id" uuid not null,
    "user_id" uuid not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."table_activity_likes" enable row level security;


  create table "public"."table_night_dish_ratings" (
    "dish_id" uuid not null,
    "user_id" uuid not null,
    "rating" numeric(2,1)
      );


alter table "public"."table_night_dish_ratings" enable row level security;


  create table "public"."table_night_dishes" (
    "id" uuid not null default gen_random_uuid(),
    "table_night_id" uuid,
    "dish_name" text not null,
    "created_by" uuid,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."table_night_dishes" enable row level security;


  create table "public"."table_night_participants" (
    "table_night_id" uuid not null,
    "user_id" uuid not null,
    "rating" numeric(2,1),
    "ready" boolean default false,
    "notes" text
      );


alter table "public"."table_night_participants" enable row level security;


  create table "public"."table_night_photo_likes" (
    "photo_id" uuid not null,
    "user_id" uuid not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."table_night_photo_likes" enable row level security;


  create table "public"."table_night_photos" (
    "id" uuid not null default gen_random_uuid(),
    "table_night_id" uuid,
    "user_id" uuid,
    "photo_url" text not null,
    "uploaded_at" timestamp with time zone default now()
      );


alter table "public"."table_night_photos" enable row level security;


  create table "public"."table_night_predictions" (
    "table_night_id" uuid not null,
    "predictor_user_id" uuid not null,
    "target_user_id" uuid not null,
    "predicted_rating" numeric(2,1)
      );


alter table "public"."table_night_predictions" enable row level security;


  create table "public"."table_nights" (
    "id" uuid not null default gen_random_uuid(),
    "table_id" uuid,
    "restaurant_id" uuid,
    "host_user_id" uuid,
    "status" text default 'rating'::text,
    "predictions_enabled" boolean default false,
    "is_async" boolean default false,
    "created_at" timestamp with time zone default now(),
    "revealed_at" timestamp with time zone
      );


alter table "public"."table_nights" enable row level security;


  create table "public"."table_top_4" (
    "table_id" uuid not null,
    "position" integer not null,
    "restaurant_id" uuid,
    "custom_photo_url" text,
    "updated_by" uuid,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."table_top_4" enable row level security;

alter table "public"."entries" add column "table_id" uuid;

alter table "public"."entries" add column "table_night_id" uuid;

alter table "public"."entries" add column "visibility" text default 'private'::text;

alter table "public"."tables" add column "avatar_url" text;

alter table "public"."tables" add column "updated_at" timestamp with time zone default now();

CREATE INDEX idx_entries_table_id ON public.entries USING btree (table_id);

CREATE INDEX idx_entries_table_night_id ON public.entries USING btree (table_night_id);

CREATE INDEX idx_entries_visibility ON public.entries USING btree (visibility);

CREATE UNIQUE INDEX table_activity_comments_pkey ON public.table_activity_comments USING btree (id);

CREATE UNIQUE INDEX table_activity_likes_pkey ON public.table_activity_likes USING btree (entry_id, user_id);

CREATE UNIQUE INDEX table_night_dish_ratings_pkey ON public.table_night_dish_ratings USING btree (dish_id, user_id);

CREATE UNIQUE INDEX table_night_dishes_pkey ON public.table_night_dishes USING btree (id);

CREATE UNIQUE INDEX table_night_participants_pkey ON public.table_night_participants USING btree (table_night_id, user_id);

CREATE UNIQUE INDEX table_night_photo_likes_pkey ON public.table_night_photo_likes USING btree (photo_id, user_id);

CREATE UNIQUE INDEX table_night_photos_pkey ON public.table_night_photos USING btree (id);

CREATE UNIQUE INDEX table_night_predictions_pkey ON public.table_night_predictions USING btree (table_night_id, predictor_user_id, target_user_id);

CREATE UNIQUE INDEX table_nights_pkey ON public.table_nights USING btree (id);

CREATE UNIQUE INDEX table_top_4_pkey ON public.table_top_4 USING btree (table_id, "position");

alter table "public"."table_activity_comments" add constraint "table_activity_comments_pkey" PRIMARY KEY using index "table_activity_comments_pkey";

alter table "public"."table_activity_likes" add constraint "table_activity_likes_pkey" PRIMARY KEY using index "table_activity_likes_pkey";

alter table "public"."table_night_dish_ratings" add constraint "table_night_dish_ratings_pkey" PRIMARY KEY using index "table_night_dish_ratings_pkey";

alter table "public"."table_night_dishes" add constraint "table_night_dishes_pkey" PRIMARY KEY using index "table_night_dishes_pkey";

alter table "public"."table_night_participants" add constraint "table_night_participants_pkey" PRIMARY KEY using index "table_night_participants_pkey";

alter table "public"."table_night_photo_likes" add constraint "table_night_photo_likes_pkey" PRIMARY KEY using index "table_night_photo_likes_pkey";

alter table "public"."table_night_photos" add constraint "table_night_photos_pkey" PRIMARY KEY using index "table_night_photos_pkey";

alter table "public"."table_night_predictions" add constraint "table_night_predictions_pkey" PRIMARY KEY using index "table_night_predictions_pkey";

alter table "public"."table_nights" add constraint "table_nights_pkey" PRIMARY KEY using index "table_nights_pkey";

alter table "public"."table_top_4" add constraint "table_top_4_pkey" PRIMARY KEY using index "table_top_4_pkey";

alter table "public"."entries" add constraint "entries_table_id_fkey" FOREIGN KEY (table_id) REFERENCES public.tables(id) not valid;

alter table "public"."entries" validate constraint "entries_table_id_fkey";

alter table "public"."entries" add constraint "entries_table_night_id_fkey" FOREIGN KEY (table_night_id) REFERENCES public.table_nights(id) not valid;

alter table "public"."entries" validate constraint "entries_table_night_id_fkey";

alter table "public"."entries" add constraint "entries_visibility_check" CHECK ((visibility = ANY (ARRAY['private'::text, 'friends'::text, 'table'::text, 'both'::text]))) not valid;

alter table "public"."entries" validate constraint "entries_visibility_check";

alter table "public"."table_activity_comments" add constraint "table_activity_comments_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE CASCADE not valid;

alter table "public"."table_activity_comments" validate constraint "table_activity_comments_entry_id_fkey";

alter table "public"."table_activity_comments" add constraint "table_activity_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_activity_comments" validate constraint "table_activity_comments_user_id_fkey";

alter table "public"."table_activity_likes" add constraint "table_activity_likes_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE CASCADE not valid;

alter table "public"."table_activity_likes" validate constraint "table_activity_likes_entry_id_fkey";

alter table "public"."table_activity_likes" add constraint "table_activity_likes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_activity_likes" validate constraint "table_activity_likes_user_id_fkey";

alter table "public"."table_night_dish_ratings" add constraint "table_night_dish_ratings_dish_id_fkey" FOREIGN KEY (dish_id) REFERENCES public.table_night_dishes(id) ON DELETE CASCADE not valid;

alter table "public"."table_night_dish_ratings" validate constraint "table_night_dish_ratings_dish_id_fkey";

alter table "public"."table_night_dish_ratings" add constraint "table_night_dish_ratings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_night_dish_ratings" validate constraint "table_night_dish_ratings_user_id_fkey";

alter table "public"."table_night_dishes" add constraint "table_night_dishes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_night_dishes" validate constraint "table_night_dishes_created_by_fkey";

alter table "public"."table_night_dishes" add constraint "table_night_dishes_table_night_id_fkey" FOREIGN KEY (table_night_id) REFERENCES public.table_nights(id) ON DELETE CASCADE not valid;

alter table "public"."table_night_dishes" validate constraint "table_night_dishes_table_night_id_fkey";

alter table "public"."table_night_participants" add constraint "table_night_participants_table_night_id_fkey" FOREIGN KEY (table_night_id) REFERENCES public.table_nights(id) ON DELETE CASCADE not valid;

alter table "public"."table_night_participants" validate constraint "table_night_participants_table_night_id_fkey";

alter table "public"."table_night_participants" add constraint "table_night_participants_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_night_participants" validate constraint "table_night_participants_user_id_fkey";

alter table "public"."table_night_photo_likes" add constraint "table_night_photo_likes_photo_id_fkey" FOREIGN KEY (photo_id) REFERENCES public.table_night_photos(id) ON DELETE CASCADE not valid;

alter table "public"."table_night_photo_likes" validate constraint "table_night_photo_likes_photo_id_fkey";

alter table "public"."table_night_photo_likes" add constraint "table_night_photo_likes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_night_photo_likes" validate constraint "table_night_photo_likes_user_id_fkey";

alter table "public"."table_night_photos" add constraint "table_night_photos_table_night_id_fkey" FOREIGN KEY (table_night_id) REFERENCES public.table_nights(id) ON DELETE CASCADE not valid;

alter table "public"."table_night_photos" validate constraint "table_night_photos_table_night_id_fkey";

alter table "public"."table_night_photos" add constraint "table_night_photos_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_night_photos" validate constraint "table_night_photos_user_id_fkey";

alter table "public"."table_night_predictions" add constraint "table_night_predictions_predictor_user_id_fkey" FOREIGN KEY (predictor_user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_night_predictions" validate constraint "table_night_predictions_predictor_user_id_fkey";

alter table "public"."table_night_predictions" add constraint "table_night_predictions_table_night_id_fkey" FOREIGN KEY (table_night_id) REFERENCES public.table_nights(id) ON DELETE CASCADE not valid;

alter table "public"."table_night_predictions" validate constraint "table_night_predictions_table_night_id_fkey";

alter table "public"."table_night_predictions" add constraint "table_night_predictions_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_night_predictions" validate constraint "table_night_predictions_target_user_id_fkey";

alter table "public"."table_nights" add constraint "table_nights_host_user_id_fkey" FOREIGN KEY (host_user_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_nights" validate constraint "table_nights_host_user_id_fkey";

alter table "public"."table_nights" add constraint "table_nights_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) not valid;

alter table "public"."table_nights" validate constraint "table_nights_restaurant_id_fkey";

alter table "public"."table_nights" add constraint "table_nights_status_check" CHECK ((status = ANY (ARRAY['rating'::text, 'pre_reveal'::text, 'revealed'::text, 'closed'::text]))) not valid;

alter table "public"."table_nights" validate constraint "table_nights_status_check";

alter table "public"."table_nights" add constraint "table_nights_table_id_fkey" FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE CASCADE not valid;

alter table "public"."table_nights" validate constraint "table_nights_table_id_fkey";

alter table "public"."table_top_4" add constraint "table_top_4_position_check" CHECK ((("position" >= 1) AND ("position" <= 4))) not valid;

alter table "public"."table_top_4" validate constraint "table_top_4_position_check";

alter table "public"."table_top_4" add constraint "table_top_4_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) not valid;

alter table "public"."table_top_4" validate constraint "table_top_4_restaurant_id_fkey";

alter table "public"."table_top_4" add constraint "table_top_4_table_id_fkey" FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE CASCADE not valid;

alter table "public"."table_top_4" validate constraint "table_top_4_table_id_fkey";

alter table "public"."table_top_4" add constraint "table_top_4_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(user_id) not valid;

alter table "public"."table_top_4" validate constraint "table_top_4_updated_by_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_default_home_place()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.user_places (user_id, name, icon, is_home)
    VALUES (NEW.user_id, 'Home', '🏠', TRUE)
    ON CONFLICT (user_id, name) DO NOTHING;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', 'New User'));

  insert into public.value_profiles (user_id, flavor, ambience, value, service)
  values (new.id, 10, 10, 10, 10);
  return new;
end;
$function$
;

grant delete on table "public"."table_activity_comments" to "anon";

grant insert on table "public"."table_activity_comments" to "anon";

grant references on table "public"."table_activity_comments" to "anon";

grant select on table "public"."table_activity_comments" to "anon";

grant trigger on table "public"."table_activity_comments" to "anon";

grant truncate on table "public"."table_activity_comments" to "anon";

grant update on table "public"."table_activity_comments" to "anon";

grant delete on table "public"."table_activity_comments" to "authenticated";

grant insert on table "public"."table_activity_comments" to "authenticated";

grant references on table "public"."table_activity_comments" to "authenticated";

grant select on table "public"."table_activity_comments" to "authenticated";

grant trigger on table "public"."table_activity_comments" to "authenticated";

grant truncate on table "public"."table_activity_comments" to "authenticated";

grant update on table "public"."table_activity_comments" to "authenticated";

grant delete on table "public"."table_activity_comments" to "service_role";

grant insert on table "public"."table_activity_comments" to "service_role";

grant references on table "public"."table_activity_comments" to "service_role";

grant select on table "public"."table_activity_comments" to "service_role";

grant trigger on table "public"."table_activity_comments" to "service_role";

grant truncate on table "public"."table_activity_comments" to "service_role";

grant update on table "public"."table_activity_comments" to "service_role";

grant delete on table "public"."table_activity_likes" to "anon";

grant insert on table "public"."table_activity_likes" to "anon";

grant references on table "public"."table_activity_likes" to "anon";

grant select on table "public"."table_activity_likes" to "anon";

grant trigger on table "public"."table_activity_likes" to "anon";

grant truncate on table "public"."table_activity_likes" to "anon";

grant update on table "public"."table_activity_likes" to "anon";

grant delete on table "public"."table_activity_likes" to "authenticated";

grant insert on table "public"."table_activity_likes" to "authenticated";

grant references on table "public"."table_activity_likes" to "authenticated";

grant select on table "public"."table_activity_likes" to "authenticated";

grant trigger on table "public"."table_activity_likes" to "authenticated";

grant truncate on table "public"."table_activity_likes" to "authenticated";

grant update on table "public"."table_activity_likes" to "authenticated";

grant delete on table "public"."table_activity_likes" to "service_role";

grant insert on table "public"."table_activity_likes" to "service_role";

grant references on table "public"."table_activity_likes" to "service_role";

grant select on table "public"."table_activity_likes" to "service_role";

grant trigger on table "public"."table_activity_likes" to "service_role";

grant truncate on table "public"."table_activity_likes" to "service_role";

grant update on table "public"."table_activity_likes" to "service_role";

grant delete on table "public"."table_night_dish_ratings" to "anon";

grant insert on table "public"."table_night_dish_ratings" to "anon";

grant references on table "public"."table_night_dish_ratings" to "anon";

grant select on table "public"."table_night_dish_ratings" to "anon";

grant trigger on table "public"."table_night_dish_ratings" to "anon";

grant truncate on table "public"."table_night_dish_ratings" to "anon";

grant update on table "public"."table_night_dish_ratings" to "anon";

grant delete on table "public"."table_night_dish_ratings" to "authenticated";

grant insert on table "public"."table_night_dish_ratings" to "authenticated";

grant references on table "public"."table_night_dish_ratings" to "authenticated";

grant select on table "public"."table_night_dish_ratings" to "authenticated";

grant trigger on table "public"."table_night_dish_ratings" to "authenticated";

grant truncate on table "public"."table_night_dish_ratings" to "authenticated";

grant update on table "public"."table_night_dish_ratings" to "authenticated";

grant delete on table "public"."table_night_dish_ratings" to "service_role";

grant insert on table "public"."table_night_dish_ratings" to "service_role";

grant references on table "public"."table_night_dish_ratings" to "service_role";

grant select on table "public"."table_night_dish_ratings" to "service_role";

grant trigger on table "public"."table_night_dish_ratings" to "service_role";

grant truncate on table "public"."table_night_dish_ratings" to "service_role";

grant update on table "public"."table_night_dish_ratings" to "service_role";

grant delete on table "public"."table_night_dishes" to "anon";

grant insert on table "public"."table_night_dishes" to "anon";

grant references on table "public"."table_night_dishes" to "anon";

grant select on table "public"."table_night_dishes" to "anon";

grant trigger on table "public"."table_night_dishes" to "anon";

grant truncate on table "public"."table_night_dishes" to "anon";

grant update on table "public"."table_night_dishes" to "anon";

grant delete on table "public"."table_night_dishes" to "authenticated";

grant insert on table "public"."table_night_dishes" to "authenticated";

grant references on table "public"."table_night_dishes" to "authenticated";

grant select on table "public"."table_night_dishes" to "authenticated";

grant trigger on table "public"."table_night_dishes" to "authenticated";

grant truncate on table "public"."table_night_dishes" to "authenticated";

grant update on table "public"."table_night_dishes" to "authenticated";

grant delete on table "public"."table_night_dishes" to "service_role";

grant insert on table "public"."table_night_dishes" to "service_role";

grant references on table "public"."table_night_dishes" to "service_role";

grant select on table "public"."table_night_dishes" to "service_role";

grant trigger on table "public"."table_night_dishes" to "service_role";

grant truncate on table "public"."table_night_dishes" to "service_role";

grant update on table "public"."table_night_dishes" to "service_role";

grant delete on table "public"."table_night_participants" to "anon";

grant insert on table "public"."table_night_participants" to "anon";

grant references on table "public"."table_night_participants" to "anon";

grant select on table "public"."table_night_participants" to "anon";

grant trigger on table "public"."table_night_participants" to "anon";

grant truncate on table "public"."table_night_participants" to "anon";

grant update on table "public"."table_night_participants" to "anon";

grant delete on table "public"."table_night_participants" to "authenticated";

grant insert on table "public"."table_night_participants" to "authenticated";

grant references on table "public"."table_night_participants" to "authenticated";

grant select on table "public"."table_night_participants" to "authenticated";

grant trigger on table "public"."table_night_participants" to "authenticated";

grant truncate on table "public"."table_night_participants" to "authenticated";

grant update on table "public"."table_night_participants" to "authenticated";

grant delete on table "public"."table_night_participants" to "service_role";

grant insert on table "public"."table_night_participants" to "service_role";

grant references on table "public"."table_night_participants" to "service_role";

grant select on table "public"."table_night_participants" to "service_role";

grant trigger on table "public"."table_night_participants" to "service_role";

grant truncate on table "public"."table_night_participants" to "service_role";

grant update on table "public"."table_night_participants" to "service_role";

grant delete on table "public"."table_night_photo_likes" to "anon";

grant insert on table "public"."table_night_photo_likes" to "anon";

grant references on table "public"."table_night_photo_likes" to "anon";

grant select on table "public"."table_night_photo_likes" to "anon";

grant trigger on table "public"."table_night_photo_likes" to "anon";

grant truncate on table "public"."table_night_photo_likes" to "anon";

grant update on table "public"."table_night_photo_likes" to "anon";

grant delete on table "public"."table_night_photo_likes" to "authenticated";

grant insert on table "public"."table_night_photo_likes" to "authenticated";

grant references on table "public"."table_night_photo_likes" to "authenticated";

grant select on table "public"."table_night_photo_likes" to "authenticated";

grant trigger on table "public"."table_night_photo_likes" to "authenticated";

grant truncate on table "public"."table_night_photo_likes" to "authenticated";

grant update on table "public"."table_night_photo_likes" to "authenticated";

grant delete on table "public"."table_night_photo_likes" to "service_role";

grant insert on table "public"."table_night_photo_likes" to "service_role";

grant references on table "public"."table_night_photo_likes" to "service_role";

grant select on table "public"."table_night_photo_likes" to "service_role";

grant trigger on table "public"."table_night_photo_likes" to "service_role";

grant truncate on table "public"."table_night_photo_likes" to "service_role";

grant update on table "public"."table_night_photo_likes" to "service_role";

grant delete on table "public"."table_night_photos" to "anon";

grant insert on table "public"."table_night_photos" to "anon";

grant references on table "public"."table_night_photos" to "anon";

grant select on table "public"."table_night_photos" to "anon";

grant trigger on table "public"."table_night_photos" to "anon";

grant truncate on table "public"."table_night_photos" to "anon";

grant update on table "public"."table_night_photos" to "anon";

grant delete on table "public"."table_night_photos" to "authenticated";

grant insert on table "public"."table_night_photos" to "authenticated";

grant references on table "public"."table_night_photos" to "authenticated";

grant select on table "public"."table_night_photos" to "authenticated";

grant trigger on table "public"."table_night_photos" to "authenticated";

grant truncate on table "public"."table_night_photos" to "authenticated";

grant update on table "public"."table_night_photos" to "authenticated";

grant delete on table "public"."table_night_photos" to "service_role";

grant insert on table "public"."table_night_photos" to "service_role";

grant references on table "public"."table_night_photos" to "service_role";

grant select on table "public"."table_night_photos" to "service_role";

grant trigger on table "public"."table_night_photos" to "service_role";

grant truncate on table "public"."table_night_photos" to "service_role";

grant update on table "public"."table_night_photos" to "service_role";

grant delete on table "public"."table_night_predictions" to "anon";

grant insert on table "public"."table_night_predictions" to "anon";

grant references on table "public"."table_night_predictions" to "anon";

grant select on table "public"."table_night_predictions" to "anon";

grant trigger on table "public"."table_night_predictions" to "anon";

grant truncate on table "public"."table_night_predictions" to "anon";

grant update on table "public"."table_night_predictions" to "anon";

grant delete on table "public"."table_night_predictions" to "authenticated";

grant insert on table "public"."table_night_predictions" to "authenticated";

grant references on table "public"."table_night_predictions" to "authenticated";

grant select on table "public"."table_night_predictions" to "authenticated";

grant trigger on table "public"."table_night_predictions" to "authenticated";

grant truncate on table "public"."table_night_predictions" to "authenticated";

grant update on table "public"."table_night_predictions" to "authenticated";

grant delete on table "public"."table_night_predictions" to "service_role";

grant insert on table "public"."table_night_predictions" to "service_role";

grant references on table "public"."table_night_predictions" to "service_role";

grant select on table "public"."table_night_predictions" to "service_role";

grant trigger on table "public"."table_night_predictions" to "service_role";

grant truncate on table "public"."table_night_predictions" to "service_role";

grant update on table "public"."table_night_predictions" to "service_role";

grant delete on table "public"."table_nights" to "anon";

grant insert on table "public"."table_nights" to "anon";

grant references on table "public"."table_nights" to "anon";

grant select on table "public"."table_nights" to "anon";

grant trigger on table "public"."table_nights" to "anon";

grant truncate on table "public"."table_nights" to "anon";

grant update on table "public"."table_nights" to "anon";

grant delete on table "public"."table_nights" to "authenticated";

grant insert on table "public"."table_nights" to "authenticated";

grant references on table "public"."table_nights" to "authenticated";

grant select on table "public"."table_nights" to "authenticated";

grant trigger on table "public"."table_nights" to "authenticated";

grant truncate on table "public"."table_nights" to "authenticated";

grant update on table "public"."table_nights" to "authenticated";

grant delete on table "public"."table_nights" to "service_role";

grant insert on table "public"."table_nights" to "service_role";

grant references on table "public"."table_nights" to "service_role";

grant select on table "public"."table_nights" to "service_role";

grant trigger on table "public"."table_nights" to "service_role";

grant truncate on table "public"."table_nights" to "service_role";

grant update on table "public"."table_nights" to "service_role";

grant delete on table "public"."table_top_4" to "anon";

grant insert on table "public"."table_top_4" to "anon";

grant references on table "public"."table_top_4" to "anon";

grant select on table "public"."table_top_4" to "anon";

grant trigger on table "public"."table_top_4" to "anon";

grant truncate on table "public"."table_top_4" to "anon";

grant update on table "public"."table_top_4" to "anon";

grant delete on table "public"."table_top_4" to "authenticated";

grant insert on table "public"."table_top_4" to "authenticated";

grant references on table "public"."table_top_4" to "authenticated";

grant select on table "public"."table_top_4" to "authenticated";

grant trigger on table "public"."table_top_4" to "authenticated";

grant truncate on table "public"."table_top_4" to "authenticated";

grant update on table "public"."table_top_4" to "authenticated";

grant delete on table "public"."table_top_4" to "service_role";

grant insert on table "public"."table_top_4" to "service_role";

grant references on table "public"."table_top_4" to "service_role";

grant select on table "public"."table_top_4" to "service_role";

grant trigger on table "public"."table_top_4" to "service_role";

grant truncate on table "public"."table_top_4" to "service_role";

grant update on table "public"."table_top_4" to "service_role";


  create policy "Members can view comments"
  on "public"."table_activity_comments"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.entries e
     JOIN public.table_members tm ON ((tm.table_id = e.table_id)))
  WHERE ((e.id = table_activity_comments.entry_id) AND (tm.member_id = auth.uid())))));



  create policy "Users can comment"
  on "public"."table_activity_comments"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can delete own comments"
  on "public"."table_activity_comments"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "Members can view activity likes"
  on "public"."table_activity_likes"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.entries e
     JOIN public.table_members tm ON ((tm.table_id = e.table_id)))
  WHERE ((e.id = table_activity_likes.entry_id) AND (tm.member_id = auth.uid())))));



  create policy "Users can like entries"
  on "public"."table_activity_likes"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can unlike entries"
  on "public"."table_activity_likes"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "Members can view dish ratings"
  on "public"."table_night_dish_ratings"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM ((public.table_night_dishes d
     JOIN public.table_nights tn ON ((tn.id = d.table_night_id)))
     JOIN public.table_members tm ON ((tm.table_id = tn.table_id)))
  WHERE ((d.id = table_night_dish_ratings.dish_id) AND (tm.member_id = auth.uid())))));



  create policy "Users can rate dishes"
  on "public"."table_night_dish_ratings"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can update own dish ratings"
  on "public"."table_night_dish_ratings"
  as permissive
  for update
  to public
using ((user_id = auth.uid()));



  create policy "Members can view dishes"
  on "public"."table_night_dishes"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.table_nights tn
     JOIN public.table_members tm ON ((tm.table_id = tn.table_id)))
  WHERE ((tn.id = table_night_dishes.table_night_id) AND (tm.member_id = auth.uid())))));



  create policy "Users can add dishes"
  on "public"."table_night_dishes"
  as permissive
  for insert
  to public
with check ((created_by = auth.uid()));



  create policy "Members can view participants"
  on "public"."table_night_participants"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.table_nights tn
     JOIN public.table_members tm ON ((tm.table_id = tn.table_id)))
  WHERE ((tn.id = table_night_participants.table_night_id) AND (tm.member_id = auth.uid())))));



  create policy "Users can participate"
  on "public"."table_night_participants"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can update own participation"
  on "public"."table_night_participants"
  as permissive
  for update
  to public
using ((user_id = auth.uid()));



  create policy "Members can view photo likes"
  on "public"."table_night_photo_likes"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM ((public.table_night_photos p
     JOIN public.table_nights tn ON ((tn.id = p.table_night_id)))
     JOIN public.table_members tm ON ((tm.table_id = tn.table_id)))
  WHERE ((p.id = table_night_photo_likes.photo_id) AND (tm.member_id = auth.uid())))));



  create policy "Users can like photos"
  on "public"."table_night_photo_likes"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can unlike photos"
  on "public"."table_night_photo_likes"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "Members can view photos"
  on "public"."table_night_photos"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.table_nights tn
     JOIN public.table_members tm ON ((tm.table_id = tn.table_id)))
  WHERE ((tn.id = table_night_photos.table_night_id) AND (tm.member_id = auth.uid())))));



  create policy "Users can delete own photos"
  on "public"."table_night_photos"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "Users can upload photos"
  on "public"."table_night_photos"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Members can view predictions after reveal"
  on "public"."table_night_predictions"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.table_nights tn
     JOIN public.table_members tm ON ((tm.table_id = tn.table_id)))
  WHERE ((tn.id = table_night_predictions.table_night_id) AND (tm.member_id = auth.uid()) AND (tn.status = ANY (ARRAY['revealed'::text, 'closed'::text]))))));



  create policy "Users can make predictions"
  on "public"."table_night_predictions"
  as permissive
  for insert
  to public
with check ((predictor_user_id = auth.uid()));



  create policy "Host can update table night"
  on "public"."table_nights"
  as permissive
  for update
  to public
using ((host_user_id = auth.uid()));



  create policy "Members can create table nights"
  on "public"."table_nights"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.table_members
  WHERE ((table_members.table_id = table_nights.table_id) AND (table_members.member_id = auth.uid())))));



  create policy "Members can view table nights"
  on "public"."table_nights"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.table_members
  WHERE ((table_members.table_id = table_nights.table_id) AND (table_members.member_id = auth.uid())))));



  create policy "Admins can manage top 4"
  on "public"."table_top_4"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.table_members
  WHERE ((table_members.table_id = table_top_4.table_id) AND (table_members.member_id = auth.uid()) AND (table_members.role = 'admin'::text)))));



  create policy "Members can view top 4"
  on "public"."table_top_4"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.table_members
  WHERE ((table_members.table_id = table_top_4.table_id) AND (table_members.member_id = auth.uid())))));



