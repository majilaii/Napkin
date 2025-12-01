


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."visit_privacy" AS ENUM (
    'public',
    'private'
);


ALTER TYPE "public"."visit_privacy" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', 'New User'));

  insert into public.value_profiles (user_id, flavor, ambience, value, service)
  values (new.id, 10, 10, 10, 10);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."list_items" (
    "list_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "note" "text",
    "position" integer
);


ALTER TABLE "public"."list_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_public" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "bio" "text",
    "home_city" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "city" "text",
    "country" "text",
    "google_place_id" "text",
    "lat" double precision,
    "lng" double precision,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "foursquare_id" "text"
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "rating" double precision NOT NULL,
    "value_profile" "jsonb" NOT NULL,
    "content" "text",
    "visited_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= (0.5)::double precision) AND ("rating" <= (5.0)::double precision)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_members" (
    "table_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."table_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."value_profiles" (
    "user_id" "uuid" NOT NULL,
    "flavor" integer NOT NULL,
    "ambience" integer NOT NULL,
    "value" integer NOT NULL,
    "service" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."value_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visit_companions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visit_id" "uuid" NOT NULL,
    "companion_user" "uuid",
    "companion_name" "text"
);


ALTER TABLE "public"."visit_companions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visit_dishes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visit_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "note" "text",
    "rating" integer,
    CONSTRAINT "visit_dishes_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."visit_dishes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visit_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visit_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "caption" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."visit_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visit_tables" (
    "visit_id" "uuid" NOT NULL,
    "table_id" "uuid" NOT NULL
);


ALTER TABLE "public"."visit_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "visited_on" "date" NOT NULL,
    "rating" integer,
    "journal_entry" "text",
    "privacy" "public"."visit_privacy" DEFAULT 'private'::"public"."visit_privacy",
    "vibe_tags" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "visits_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."visits" OWNER TO "postgres";


ALTER TABLE ONLY "public"."list_items"
    ADD CONSTRAINT "list_items_pkey" PRIMARY KEY ("list_id", "restaurant_id");



ALTER TABLE ONLY "public"."lists"
    ADD CONSTRAINT "lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_foursquare_id_key" UNIQUE ("foursquare_id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_google_place_id_key" UNIQUE ("google_place_id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_members"
    ADD CONSTRAINT "table_members_pkey" PRIMARY KEY ("table_id", "member_id");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."value_profiles"
    ADD CONSTRAINT "value_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."visit_companions"
    ADD CONSTRAINT "visit_companions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visit_dishes"
    ADD CONSTRAINT "visit_dishes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visit_photos"
    ADD CONSTRAINT "visit_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visit_tables"
    ADD CONSTRAINT "visit_tables_pkey" PRIMARY KEY ("visit_id", "table_id");



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."list_items"
    ADD CONSTRAINT "list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_items"
    ADD CONSTRAINT "list_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."lists"
    ADD CONSTRAINT "lists_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_members"
    ADD CONSTRAINT "table_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_members"
    ADD CONSTRAINT "table_members_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("user_id");



ALTER TABLE ONLY "public"."value_profiles"
    ADD CONSTRAINT "value_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visit_companions"
    ADD CONSTRAINT "visit_companions_companion_user_fkey" FOREIGN KEY ("companion_user") REFERENCES "public"."profiles"("user_id");



ALTER TABLE ONLY "public"."visit_companions"
    ADD CONSTRAINT "visit_companions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visit_dishes"
    ADD CONSTRAINT "visit_dishes_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visit_photos"
    ADD CONSTRAINT "visit_photos_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visit_tables"
    ADD CONSTRAINT "visit_tables_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visit_tables"
    ADD CONSTRAINT "visit_tables_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



CREATE POLICY "Allow authenticated insert restaurants" ON "public"."restaurants" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated insert reviews" ON "public"."reviews" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow public read restaurants" ON "public"."restaurants" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow public read reviews" ON "public"."reviews" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow users to update own reviews" ON "public"."reviews" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can insert restaurants" ON "public"."restaurants" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can update restaurants" ON "public"."restaurants" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Restaurants are publicly readable" ON "public"."restaurants" FOR SELECT USING (true);



CREATE POLICY "Reviews are public" ON "public"."reviews" FOR SELECT USING (true);



CREATE POLICY "Reviews are publicly readable" ON "public"."reviews" FOR SELECT USING (true);



CREATE POLICY "Users can create their own reviews" ON "public"."reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own reviews" ON "public"."reviews" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own reviews" ON "public"."reviews" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own reviews" ON "public"."reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own reviews" ON "public"."reviews" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own reviews" ON "public"."reviews" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."list_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles self access" ON "public"."profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "restaurants insert/update by owners" ON "public"."restaurants" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "restaurants readable" ON "public"."restaurants" FOR SELECT USING (true);



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "value profile self access" ON "public"."value_profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."value_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visit_companions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visit_dishes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visit_dishes follow visit policy" ON "public"."visit_dishes" USING ((EXISTS ( SELECT 1
   FROM "public"."visits" "v"
  WHERE (("v"."id" = "visit_dishes"."visit_id") AND ("v"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."visits" "v"
  WHERE (("v"."id" = "visit_dishes"."visit_id") AND ("v"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."visit_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visit_tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visits modify own" ON "public"."visits" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "visits read own or public" ON "public"."visits" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("privacy" = 'public'::"public"."visit_privacy")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


















GRANT ALL ON TABLE "public"."list_items" TO "anon";
GRANT ALL ON TABLE "public"."list_items" TO "authenticated";
GRANT ALL ON TABLE "public"."list_items" TO "service_role";



GRANT ALL ON TABLE "public"."lists" TO "anon";
GRANT ALL ON TABLE "public"."lists" TO "authenticated";
GRANT ALL ON TABLE "public"."lists" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."restaurants" TO "anon";
GRANT ALL ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."table_members" TO "anon";
GRANT ALL ON TABLE "public"."table_members" TO "authenticated";
GRANT ALL ON TABLE "public"."table_members" TO "service_role";



GRANT ALL ON TABLE "public"."tables" TO "anon";
GRANT ALL ON TABLE "public"."tables" TO "authenticated";
GRANT ALL ON TABLE "public"."tables" TO "service_role";



GRANT ALL ON TABLE "public"."value_profiles" TO "anon";
GRANT ALL ON TABLE "public"."value_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."value_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."visit_companions" TO "anon";
GRANT ALL ON TABLE "public"."visit_companions" TO "authenticated";
GRANT ALL ON TABLE "public"."visit_companions" TO "service_role";



GRANT ALL ON TABLE "public"."visit_dishes" TO "anon";
GRANT ALL ON TABLE "public"."visit_dishes" TO "authenticated";
GRANT ALL ON TABLE "public"."visit_dishes" TO "service_role";



GRANT ALL ON TABLE "public"."visit_photos" TO "anon";
GRANT ALL ON TABLE "public"."visit_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."visit_photos" TO "service_role";



GRANT ALL ON TABLE "public"."visit_tables" TO "anon";
GRANT ALL ON TABLE "public"."visit_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."visit_tables" TO "service_role";



GRANT ALL ON TABLE "public"."visits" TO "anon";
GRANT ALL ON TABLE "public"."visits" TO "authenticated";
GRANT ALL ON TABLE "public"."visits" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


