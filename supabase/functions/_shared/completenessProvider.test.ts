import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DETAILS_PRO_SKU,
  FROZEN_ATTESTATION_FIELD_MASK,
  FROZEN_DEFERRED_TEXT_SEARCH_FIELD_MASK,
  parsePlaceAttestation,
  PHOTO_SKU,
  PLACE_DETAILS_ENDPOINT,
  PLACE_TEXT_SEARCH_ENDPOINT,
  type PlaceAttestationProjection,
  TEXT_SEARCH_SKU,
} from "./completeness.ts";
import {
  CompletenessPaidPathError,
  CompletenessProvider,
} from "./completenessProvider.ts";
import { projectionToPlace } from "../places-search/utils.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CLAIMANT = "00000000-0000-4000-8000-000000000002";
const RESTAURANT = "00000000-0000-4000-8000-000000000003";
const CANONICAL = "00000000-0000-4000-8000-000000000004";

const DETAILS_BODY = {
  displayName: { text: "Kartuli" },
  location: { latitude: 51.45, longitude: -0.07 },
  formattedAddress: "20 Lordship Lane, London, UK",
  addressComponents: [
    { longText: "London", types: ["locality"] },
    { longText: "United Kingdom", types: ["country"] },
  ],
  rating: 4.6,
  userRatingCount: 287,
  priceLevel: "PRICE_LEVEL_MODERATE",
  types: ["restaurant", "georgian_restaurant"],
  primaryType: "georgian_restaurant",
  websiteUri: "https://kartuli.example/menu",
  googleMapsUri: "https://maps.google.test/?cid=kartuli",
  nationalPhoneNumber: "+44 20 7946 0958",
  regularOpeningHours: {
    openNow: true,
    weekdayDescriptions: [
      "Monday: 12:00 PM – 10:00 PM",
      "Tuesday: 12:00 PM – 10:00 PM",
    ],
  },
  photos: [{
    name: "places/ChIJ-kartuli/photos/ref-1",
    authorAttributions: [{
      displayName: "A & B",
      uri: "https://maps.google.test/author?a=1&b=2",
    }],
  }],
};

Deno.test("attestation metadata is optional and never invalidates the base projection", () => {
  const projection = parsePlaceAttestation("ChIJ-skinny", {
    displayName: { text: "Skinny Place" },
    location: { latitude: 51.5, longitude: -0.1 },
  });
  assertEquals(projection, {
    place_id: "ChIJ-skinny",
    display_name: "Skinny Place",
    formatted_address: null,
    address_components: [],
    city: null,
    country: null,
    lat: 51.5,
    lng: -0.1,
    google_rating: null,
    google_rating_count: null,
    price_level: null,
    types: null,
    primary_type: null,
    website: null,
    phone: null,
    google_maps_uri: null,
    opening_hours: null,
    photo_reference: null,
    photo_attribution_html: null,
  });
});

Deno.test("attestation maps Google product metadata without retaining openNow", () => {
  const projection = parsePlaceAttestation("ChIJ-kartuli", DETAILS_BODY)!;
  assertEquals(projection.google_rating, 4.6);
  assertEquals(projection.google_rating_count, 287);
  assertEquals(projection.price_level, 2);
  assertEquals(projection.types, ["restaurant", "georgian_restaurant"]);
  assertEquals(projection.primary_type, "georgian_restaurant");
  assertEquals(projection.website, "https://kartuli.example/menu");
  assertEquals(projection.phone, "+44 20 7946 0958");
  assertEquals(
    projection.google_maps_uri,
    "https://maps.google.test/?cid=kartuli",
  );
  assertEquals(projection.opening_hours, {
    weekdayDescriptions: [
      "Monday: 12:00 PM – 10:00 PM",
      "Tuesday: 12:00 PM – 10:00 PM",
    ],
  });
});

Deno.test("attestation miss couples Enterprise Details mask to the legacy Details debit", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "fn_claim_place_attestation") {
        return {
          data: [{ outcome: "claimed", projection: null }],
          error: null,
        };
      }
      if (name === "fn_charge_sku_budget") return { data: true, error: null };
      if (name === "fn_commit_place_attestation") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
    fetchImpl: async (input, init) => {
      fetchCalls.push({ url: String(input), init });
      return Response.json(DETAILS_BODY);
    },
  });

  const projection = await provider.attest(OWNER, "ChIJ-kartuli", CLAIMANT);
  assertEquals(projection.display_name, "Kartuli");
  assertEquals(fetchCalls.length, 1);
  assertEquals(fetchCalls[0].url, `${PLACE_DETAILS_ENDPOINT}ChIJ-kartuli`);
  assertEquals(
    new Headers(fetchCalls[0].init?.headers).get("X-Goog-FieldMask"),
    FROZEN_ATTESTATION_FIELD_MASK,
  );
  assertEquals(
    rpcCalls.map((call) => [call.name, call.args.p_sku ?? null]),
    [
      ["fn_claim_place_attestation", null],
      ["fn_charge_sku_budget", DETAILS_PRO_SKU],
      ["fn_commit_place_attestation", null],
    ],
  );
});

Deno.test("metadata round-trips through attest, projectionToPlace, and persistence", async () => {
  let committedProjection: unknown = null;
  let insertedRow: Record<string, unknown> | null = null;
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "fn_claim_place_attestation") {
        return {
          data: [{ outcome: "claimed", projection: null }],
          error: null,
        };
      }
      if (name === "fn_charge_sku_budget") {
        return { data: true, error: null };
      }
      if (name === "fn_commit_place_attestation") {
        committedProjection = args.p_projection;
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.maybeSingle = async () => ({ data: null, error: null });
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          insertedRow = row;
          return {
            select: () => ({
              single: async () => ({ data: { id: RESTAURANT }, error: null }),
            }),
          };
        },
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
    fetchImpl: async () => Response.json(DETAILS_BODY),
  });

  const projection = await provider.attest(
    OWNER,
    "ChIJ-kartuli",
    CLAIMANT,
  );
  const place = projectionToPlace(projection);
  assertEquals(place.googleRating, 4.6);
  assertEquals(place.googleRatingCount, 287);
  assertEquals(place.priceLevel, 2);
  assertEquals(place.categories, ["restaurant", "georgian_restaurant"]);
  assertEquals(place.cuisine, "Georgian");
  assertEquals(place.website, "https://kartuli.example/menu");
  assertEquals(place.phone, "+44 20 7946 0958");
  assertEquals(place.link, "https://maps.google.test/?cid=kartuli");
  assertEquals(place.google_maps_uri, place.link);
  assertEquals(place.hours, projection.opening_hours);

  const persisted = await provider.persistAttestedRestaurant(
    OWNER,
    null,
    projection,
    CLAIMANT,
    false,
  );
  assertEquals(persisted.restaurant_id, RESTAURANT);
  assertEquals(committedProjection, projection);
  assertEquals(insertedRow?.google_rating, 4.6);
  assertEquals(insertedRow?.google_rating_count, 287);
  assertEquals(insertedRow?.price_level, 2);
  assertEquals(insertedRow?.place_types, [
    "restaurant",
    "georgian_restaurant",
  ]);
  assertEquals(insertedRow?.cuisine, "Georgian");
  assertEquals(insertedRow?.website, "https://kartuli.example/menu");
  assertEquals(insertedRow?.phone, "+44 20 7946 0958");
  assertEquals(
    insertedRow?.google_maps_uri,
    "https://maps.google.test/?cid=kartuli",
  );
  assertEquals(insertedRow?.hours, projection.opening_hours);
  assertEquals(
    Number.isNaN(Date.parse(String(insertedRow?.places_synced_at))),
    false,
  );
});

Deno.test("null attestation metadata is omitted from an existing-row CAS update", async () => {
  const sparseProjection = parsePlaceAttestation("ChIJ-kartuli", {
    displayName: { text: "Kartuli" },
    location: { latitude: 51.45, longitude: -0.07 },
  })!;
  const state = {
    id: RESTAURANT,
    external_id: "ChIJ-kartuli",
    verification: "verified",
    merged_into: null,
    completeness_version: 4,
    lat: 51.45,
    lng: -0.07,
    photo_url: null,
    photo_reference: null,
    photo_source: null,
    places_photo_attribution_html: null,
    created_by: OWNER,
  };
  const updateRows: Array<Record<string, unknown>> = [];
  const supabase = {
    rpc: async (name: string) => {
      if (name === "fn_resolve_canonical" || name === "fn_canonicalize_ghost") {
        return { data: RESTAURANT, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state, error: null }),
          }),
        }),
        update: (row: Record<string, unknown>) => {
          updateRows.push(row);
          const chain: Record<string, unknown> = { error: null };
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = async () => ({
            data: { id: RESTAURANT },
            error: null,
          });
          return chain;
        },
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
  });

  await provider.persistAttestedRestaurant(
    OWNER,
    RESTAURANT,
    sparseProjection,
    CLAIMANT,
    false,
  );

  const projectionUpdate = updateRows[0];
  for (
    const key of [
      "google_rating",
      "google_rating_count",
      "price_level",
      "place_types",
      "cuisine",
      "website",
      "phone",
      "google_maps_uri",
      "hours",
    ]
  ) {
    assertEquals(key in projectionUpdate, false, `${key} must be sparse`);
  }
  assertEquals(typeof projectionUpdate.places_synced_at, "string");
});

Deno.test("fresh attestation cache hit performs no debit and no fetch", async () => {
  let fetches = 0;
  const projection = parsePlaceAttestation("ChIJ-kartuli", DETAILS_BODY)!;
  const supabase = {
    rpc: async (name: string) => {
      if (name === "fn_claim_place_attestation") {
        return { data: [{ outcome: "hit", projection }], error: null };
      }
      throw new Error(`Unexpected paid RPC on cache hit: ${name}`);
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
    fetchImpl: async () => {
      fetches += 1;
      return Response.json(DETAILS_BODY);
    },
  });
  const result = await provider.attest(OWNER, "ChIJ-kartuli", CLAIMANT);
  assertEquals(result, projection);
  assertEquals(fetches, 0);
});

Deno.test("deferred Text Search couples exact endpoint/mask to Text Search debit", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let outbound: { url: string; init?: RequestInit } | null = null;
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: true, error: null };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
    fetchImpl: async (input, init) => {
      outbound = { url: String(input), init };
      return Response.json({
        places: [{
          id: "ChIJ-kartuli",
          displayName: { text: "Kartuli" },
          formattedAddress: "London, UK",
          addressComponents: [{ longText: "London", types: ["locality"] }],
        }],
      });
    },
  });
  const result = await provider.searchText(OWNER, {
    name: "Kartuli",
    city: "London",
  });
  assertEquals(result[0].externalId, "ChIJ-kartuli");
  assertEquals(outbound?.url, PLACE_TEXT_SEARCH_ENDPOINT);
  assertEquals(
    new Headers(outbound?.init?.headers).get("X-Goog-FieldMask"),
    FROZEN_DEFERRED_TEXT_SEARCH_FIELD_MASK,
  );
  assertEquals(rpcCalls, [{
    name: "fn_charge_sku_budget",
    args: { p_user_id: OWNER, p_sku: TEXT_SEARCH_SKU },
  }]);
});

Deno.test("authoritative freeze blocks all six logical paid paths before any outbound fetch", async () => {
  let fetches = 0;
  const rpcCalls: string[] = [];
  const supabase = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "fn_claim_place_attestation") {
        return {
          data: [{ outcome: "claimed", projection: null }],
          error: null,
        };
      }
      if (name === "fn_claim_media") {
        return {
          data: [{ outcome: "claimed", committed_url: null }],
          error: null,
        };
      }
      throw new Error(`frozen provider must not call ${name}`);
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
    spendFrozen: true,
    fetchImpl: async () => {
      fetches += 1;
      return Response.json(DETAILS_BODY);
    },
  });

  const paths: Array<{ name: string; run: () => Promise<unknown> }> = [
    {
      name: "save-time Details",
      run: () => provider.attest(OWNER, "place-save", crypto.randomUUID()),
    },
    {
      name: "deferred-resolution Text Search",
      run: () =>
        provider.searchText(OWNER, { name: "Kartuli", city: "London" }),
    },
    {
      name: "photo media",
      run: () =>
        provider.acquireMedia(
          OWNER,
          RESTAURANT,
          mediaProjection(),
          crypto.randomUUID(),
        ),
    },
    {
      name: "backfill",
      run: () => provider.attest(OWNER, "place-backfill", crypto.randomUUID()),
    },
    {
      name: "useLookupByPlaceId",
      run: () => provider.attest(OWNER, "place-lookup", crypto.randomUUID()),
    },
    {
      name: "useLazyBackfillRestaurant",
      run: () =>
        provider.attest(OWNER, "place-lazy-backfill", crypto.randomUUID()),
    },
  ];

  for (const path of paths) {
    const error = await assertRejects(path.run, CompletenessPaidPathError);
    assertEquals(
      error.code,
      "BUDGET_DEFERRED",
      `${path.name} must fail closed at the freeze`,
    );
  }
  assertEquals(fetches, 0);
  assertEquals(rpcCalls.includes("fn_charge_sku_budget"), false);
});

Deno.test("unattributed photo is suppressed atomically in the attestation projection", () => {
  const projection = parsePlaceAttestation("ChIJ-kartuli", {
    ...DETAILS_BODY,
    photos: [{
      name: "places/ChIJ-kartuli/photos/uncredited",
      authorAttributions: [],
    }],
  });
  assertEquals(projection?.photo_reference, null);
  assertEquals(projection?.photo_attribution_html, null);
});

function mediaProjection(): PlaceAttestationProjection {
  return parsePlaceAttestation("ChIJ-kartuli", DETAILS_BODY)!;
}

Deno.test("media claim race observes an already-complete hero before any debit", async () => {
  const rpcCalls: string[] = [];
  const supabase = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "fn_claim_media") {
        return {
          data: [{
            outcome: "satisfied",
            committed_url: "https://storage.test/table-hero.jpg",
          }],
          error: null,
        };
      }
      throw new Error(`Unexpected paid RPC ${name}`);
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
  });

  const hero = await provider.acquireMedia(
    OWNER,
    RESTAURANT,
    mediaProjection(),
    CLAIMANT,
  );
  assertEquals(hero, "https://storage.test/table-hero.jpg");
  assertEquals(rpcCalls, ["fn_claim_media"]);
});

Deno.test("media zero-row exact-URL CAS observes another hero and never commits its claim", async () => {
  const rpcNames: string[] = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcNames.push(name);
      if (name === "fn_claim_media") {
        return { data: [{ outcome: "claimed" }], error: null };
      }
      if (name === "fn_charge_sku_budget") {
        assertEquals(args.p_sku, PHOTO_SKU);
        return { data: true, error: null };
      }
      if (name === "fn_resolve_canonical") {
        return { data: RESTAURANT, error: null };
      }
      if (name === "fn_commit_media") {
        throw new Error("must not commit a lost exact-URL CAS");
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({
          data: { publicUrl: "https://storage.test/ours.jpg" },
        }),
      }),
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        update: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = async () => ({ data: null, error: null });
          return chain;
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: RESTAURANT,
                external_id: "ChIJ-kartuli",
                verification: "verified",
                merged_into: null,
                completeness_version: 1,
                lat: 51.45,
                lng: -0.07,
                photo_url: "https://storage.test/other-winner.jpg",
                photo_source: "places",
              },
              error: null,
            }),
          }),
        }),
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
    fetchImpl: async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/jpeg" },
      }),
  });

  const winnerUrl = await provider.acquireMedia(
    OWNER,
    RESTAURANT,
    mediaProjection(),
    CLAIMANT,
  );
  assertEquals(winnerUrl, "https://storage.test/other-winner.jpg");
  assertEquals(rpcNames.includes("fn_commit_media"), false);
});

Deno.test("merge-during-download keeps alias path, installs it on canonical, then commits canonical claim", async () => {
  let resolveCount = 0;
  let uploadedPath = "";
  let updatedRestaurantId = "";
  let committedArgs: Record<string, unknown> | null = null;
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "fn_claim_media") {
        return { data: [{ outcome: "claimed" }], error: null };
      }
      if (name === "fn_charge_sku_budget") return { data: true, error: null };
      if (name === "fn_resolve_canonical") {
        resolveCount += 1;
        // Before upload the row is live; after upload it has merged.
        return {
          data: resolveCount === 1 ? RESTAURANT : CANONICAL,
          error: null,
        };
      }
      if (name === "fn_commit_media") {
        committedArgs = args;
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploadedPath = path;
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.test/${path}` },
        }),
      }),
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        update: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = (_column: string, value: string) => {
            updatedRestaurantId = value;
            return chain;
          };
          chain.is = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = async () => ({
            data: {
              id: CANONICAL,
              photo_url: `https://storage.test/${uploadedPath}`,
            },
            error: null,
          });
          return chain;
        },
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
    fetchImpl: async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/jpeg" },
      }),
  });

  const url = await provider.acquireMedia(
    OWNER,
    RESTAURANT,
    mediaProjection(),
    CLAIMANT,
  );
  assertStringIncludes(uploadedPath, `${RESTAURANT}/`);
  assertEquals(updatedRestaurantId, CANONICAL);
  assertEquals(committedArgs?.p_canonical_restaurant_id, CANONICAL);
  assertEquals(committedArgs?.p_committed_url, url);
  assertStringIncludes(url!, `${RESTAURANT}/`);
});

Deno.test("shared attested persistence cannot overwrite a concurrent manual repair", async () => {
  let stateReads = 0;
  let expectedVersionFilter: number | null = null;
  const state = {
    id: RESTAURANT,
    external_id: "ChIJ-kartuli",
    verification: "verified",
    merged_into: null,
    completeness_version: 7,
    lat: 51.45,
    lng: -0.07,
    photo_url: null,
    photo_source: null,
    created_by: OWNER,
  };
  const supabase = {
    rpc: async (name: string) => {
      if (name === "fn_resolve_canonical" || name === "fn_canonicalize_ghost") {
        return { data: RESTAURANT, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              stateReads += 1;
              return { data: state, error: null };
            },
          }),
        }),
        update: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = (column: string, value: unknown) => {
            if (column === "completeness_version") {
              expectedVersionFilter = value as number;
            }
            return chain;
          };
          chain.is = () => chain;
          chain.select = () => chain;
          // A manual repair committed after the provider's version read,
          // so the expected-version UPDATE affected zero rows.
          chain.maybeSingle = async () => ({ data: null, error: null });
          return chain;
        },
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
  });

  const error = await assertRejects(
    () =>
      provider.persistAttestedRestaurant(
        OWNER,
        RESTAURANT,
        mediaProjection(),
        CLAIMANT,
        false,
      ),
    Error,
    "lost completeness CAS",
  );
  assertStringIncludes(error.message, "lost completeness CAS");
  assertEquals(stateReads, 2);
  assertEquals(expectedVersionFilter, 7);
});

Deno.test("coordinate repair preserves a complete hero without a media claim or debit", async () => {
  let stateReads = 0;
  let mediaClaimed = false;
  const state = {
    id: RESTAURANT,
    external_id: "ChIJ-kartuli",
    verification: "verified",
    merged_into: null,
    completeness_version: 8,
    lat: null,
    lng: null,
    photo_url: "https://storage.test/user-hero.jpg",
    photo_source: "user",
    places_photo_attribution_html: null,
    created_by: OWNER,
  };
  const supabase = {
    rpc: async (name: string) => {
      if (name === "fn_resolve_canonical" || name === "fn_canonicalize_ghost") {
        return { data: RESTAURANT, error: null };
      }
      if (name === "fn_claim_media" || name === "fn_charge_sku_budget") {
        mediaClaimed = true;
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.maybeSingle = async () => {
            stateReads += 1;
            return { data: state, error: null };
          };
          return chain;
        },
        update: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = async () => ({
            data: { id: RESTAURANT },
            error: null,
          });
          return chain;
        },
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
  });

  const result = await provider.persistAttestedRestaurant(
    OWNER,
    RESTAURANT,
    mediaProjection(),
    CLAIMANT,
    true,
  );
  assertEquals(result.restaurant_id, RESTAURANT);
  assertEquals(result.hero_url, state.photo_url);
  assertEquals(stateReads, 3);
  assertEquals(mediaClaimed, false);
});

Deno.test("coordinate repair gives a new Places reference a fresh media claim", async () => {
  let mediaClaims = 0;
  const state = {
    id: RESTAURANT,
    external_id: "ChIJ-kartuli",
    verification: "verified",
    merged_into: null,
    completeness_version: 9,
    lat: null,
    lng: null,
    photo_url: "https://storage.test/old-places-hero.jpg",
    photo_reference: "places/ChIJ-kartuli/photos/old",
    photo_source: "places",
    places_photo_attribution_html: "<a>Old Author</a>",
    created_by: OWNER,
  };
  const supabase = {
    rpc: async (name: string) => {
      if (name === "fn_resolve_canonical" || name === "fn_canonicalize_ghost") {
        return { data: RESTAURANT, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.maybeSingle = async () => ({ data: state, error: null });
          return chain;
        },
        update: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = async () => ({
            data: { id: RESTAURANT },
            error: null,
          });
          return chain;
        },
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
  });
  provider.acquireMedia = async () => {
    mediaClaims += 1;
    return "https://storage.test/new-places-hero.jpg";
  };

  const result = await provider.persistAttestedRestaurant(
    OWNER,
    RESTAURANT,
    mediaProjection(),
    CLAIMANT,
    true,
  );
  assertEquals(result.hero_url, "https://storage.test/new-places-hero.jpg");
  assertEquals(mediaClaims, 1);
});

Deno.test("null-target attested persistence CASes an existing external identity without upsert", async () => {
  let usedUpsert = false;
  let usedInsert = false;
  let expectedVersionFilter: number | null = null;
  const existing = {
    id: CANONICAL,
    external_id: "ChIJ-kartuli",
    verification: "verified",
    merged_into: null,
    completeness_version: 11,
    lat: 51.45,
    lng: -0.07,
    photo_url: null,
    photo_source: null,
    created_by: null,
  };
  const supabase = {
    rpc: async (name: string) => {
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          chain.maybeSingle = async () => ({ data: existing, error: null });
          return chain;
        },
        update: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = (column: string, value: unknown) => {
            if (column === "completeness_version") {
              expectedVersionFilter = value as number;
            }
            return chain;
          };
          chain.is = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = async () => ({ data: null, error: null });
          return chain;
        },
        insert: () => {
          usedInsert = true;
          throw new Error("must not insert over an existing identity");
        },
        upsert: () => {
          usedUpsert = true;
          throw new Error("must never upsert an attested projection");
        },
      };
    },
  };
  const provider = new CompletenessProvider(supabase, {
    googleApiKey: "google-key",
  });

  await assertRejects(
    () =>
      provider.persistAttestedRestaurant(
        OWNER,
        null,
        mediaProjection(),
        CLAIMANT,
        false,
      ),
    Error,
    "lost completeness CAS",
  );
  assertEquals(expectedVersionFilter, 11);
  assertEquals(usedInsert, false);
  assertEquals(usedUpsert, false);
});
