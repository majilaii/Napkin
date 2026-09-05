import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ExtractedCandidate } from "../_shared/visionExtract.ts";
import { classifyInteractiveCandidate } from "../_shared/candidateDedupe.ts";
import {
  buildVerifiedUpsertInput,
  resolveImportPlaceSearch,
} from "./_helpers.ts";
import {
  buildPlacesPayloadFromDb,
  type RestaurantPlaceRow,
  reuseVerifiedRejectedPlace,
} from "./verifiedPlaceReuse.ts";

// Name, provider identity, locality and coordinates are from the founder's
// second TikTok and its verified DB record (2026-09-05 investigation). Metadata
// and internal UUID below are synthetic; these tests perform no live I/O.
const POSADA_ID = "ChIJp8__LlImTw0R3QbmGeDqWTY";
const extracted: ExtractedCandidate = {
  name: "Posada Real Torre Berrueza",
  city: "Espinosa de los Monteros",
  city_inferred: false,
  area: null,
  address: null,
  cuisine: null,
  booking_url: null,
  hours: null,
  confidence: "high",
  google_place_id: null,
};
const stored: RestaurantPlaceRow = {
  id: "00000000-0000-4000-8000-000000000245",
  external_id: POSADA_ID,
  name: "Posada Real Torre Berrueza",
  city: "Espinosa de los Monteros",
  address: "Espinosa de los Monteros, Burgos, Spain",
  country: "Spain",
  lat: 43.0767263,
  lng: -3.5487042,
  verification: "verified",
  merged_into: null,
  place_types: ["lodging", "point_of_interest", "establishment"],
  cuisine: "Spanish",
  google_rating: 4.6,
  google_rating_count: 100,
  price_level: 2,
  website: "https://example.com/posada",
  google_maps_uri: "https://maps.google.com/?cid=example",
};
const rejected = {
  id: POSADA_ID,
  name: stored.name,
  city: stored.city,
  categories: ["lodging", "point_of_interest", "establishment"],
};

Deno.test("verified reuse: Posada type rejection reuses the exact verified identity with its location", async () => {
  let searchCalls = 0;
  const result = await resolveImportPlaceSearch(() => {
    searchCalls++;
    return [rejected, {
      ...rejected,
      id: "lower-food-result",
      categories: ["food"],
    }];
  });
  assertEquals(result.candidates, []);
  assertEquals(result.typeRejected, true);
  const lookupIds: string[] = [];
  const place = await reuseVerifiedRejectedPlace(
    extracted,
    result.rejectedCandidate,
    (id) => {
      lookupIds.push(id);
      return Promise.resolve({ data: stored });
    },
  );
  assertEquals(searchCalls, 1);
  assertEquals(lookupIds, [POSADA_ID]);
  assertEquals(place?.id, POSADA_ID);
  assertEquals(place?.external_id, POSADA_ID);
  assertEquals(place?.city, "Espinosa de los Monteros");
  assertEquals(place?.country, "Spain");
  assertEquals(place?.latitude, 43.0767263);
  assertEquals(place?.longitude, -3.5487042);
  assertEquals(place?.location, {
    address: stored.address,
    locality: stored.city,
    country: stored.country,
  });
});

Deno.test("verified reuse: actual provider city survives a compatible extracted locality", async () => {
  const place = await reuseVerifiedRejectedPlace(
    { ...extracted, city: "Espinosa", cuisine: "model guess" },
    rejected,
    () => Promise.resolve({ data: stored }),
  );
  assertEquals(place?.city, stored.city);
  assertEquals(place?.location?.locality, stored.city);
  assertEquals(place?.cuisine, stored.cuisine);
});

Deno.test("verified DB projection: explicit provider-id path retains existing metadata", () => {
  const place = buildPlacesPayloadFromDb(stored, extracted);
  assertEquals(place.categories, stored.place_types);
  assertEquals(place.googleRating, stored.google_rating);
  assertEquals(place.googleRatingCount, stored.google_rating_count);
  assertEquals(place.priceLevel, stored.price_level);
  assertEquals(place.website, stored.website);
  assertEquals(place.link, stored.google_maps_uri);
  assertEquals(place.latitude, stored.lat);
  assertEquals(place.longitude, stored.lng);
  assertEquals(place.country, stored.country);
  assertEquals(place.photoReference, null);
});

Deno.test("verified reuse: save projection retains provider city, country and coordinates", async () => {
  const place = await reuseVerifiedRejectedPlace(
    { ...extracted, city: "Espinosa" },
    rejected,
    () => Promise.resolve({ data: stored }),
  );
  const save = buildVerifiedUpsertInput(POSADA_ID, {
    restaurant_name: extracted.name,
    restaurant_city: "Espinosa",
    place,
  });
  assertEquals(save.location, {
    address: stored.address,
    locality: stored.city,
    country: stored.country,
  });
  assertEquals(save.latitude, stored.lat);
  assertEquals(save.longitude, stored.lng);
});

Deno.test("verified reuse: stored name must pass the original match gate", async () => {
  assertEquals(
    await reuseVerifiedRejectedPlace(
      extracted,
      rejected,
      () =>
        Promise.resolve({
          data: { ...stored, name: "Different Venue" },
        }),
    ),
    null,
  );
});

Deno.test("verified reuse: stored locality must pass the original match gate", async () => {
  assertEquals(
    await reuseVerifiedRejectedPlace(
      extracted,
      rejected,
      () =>
        Promise.resolve({
          data: {
            ...stored,
            city: "Amsterdam",
            address: "Amsterdam, Netherlands",
          },
        }),
    ),
    null,
  );
});

Deno.test("verified reuse: Lezo still fails an extracted San Sebastian locality", async () => {
  // Synthetic name/identity isolates the real, separately deferred geography
  // failure: Google locality Lezo does not corroborate San Sebastian.
  const lezoExtracted = {
    ...extracted,
    name: "Asador Example",
    city: "San Sebastián",
  };
  const lezo = {
    ...stored,
    name: "Asador Example",
    city: "Lezo",
    address: "Lezo, Gipuzkoa, Spain",
  };
  assertEquals(
    classifyInteractiveCandidate(lezoExtracted, {
      name: lezo.name,
      city: lezo.city,
      formattedAddress: lezo.address,
    }),
    "locality_reject",
  );
  assertEquals(
    await reuseVerifiedRejectedPlace(
      lezoExtracted,
      rejected,
      () => Promise.resolve({ data: lezo }),
    ),
    null,
  );
});

for (
  const [label, overrides] of [
    ["different provider id", { external_id: "other-provider-id" }],
    ["unverified row", { verification: "unverified" }],
    ["merged row", { merged_into: "00000000-0000-4000-8000-000000000246" }],
    ["missing name", { name: "" }],
    ["missing latitude", { lat: null }],
    ["missing longitude", { lng: null }],
    ["nonfinite latitude", { lat: Number.NaN }],
    ["nonfinite longitude", { lng: Number.POSITIVE_INFINITY }],
    ["out of range latitude", { lat: 91 }],
    ["out of range longitude", { lng: -181 }],
  ] satisfies Array<[string, Partial<RestaurantPlaceRow>]>
) {
  Deno.test(`verified reuse: ${label} keeps the type-rejected ghost`, async () => {
    assertEquals(
      await reuseVerifiedRejectedPlace(
        extracted,
        rejected,
        () =>
          Promise.resolve({
            data: { ...stored, ...overrides },
          }),
      ),
      null,
    );
  });
}

Deno.test("verified reuse: zero coordinates are valid", async () => {
  const place = await reuseVerifiedRejectedPlace(
    extracted,
    rejected,
    () => Promise.resolve({ data: { ...stored, lat: 0, lng: 0 } }),
  );
  assertEquals(place?.latitude, 0);
  assertEquals(place?.longitude, 0);
});

Deno.test("verified reuse: no DB match preserves the rejected ghost", async () => {
  assertEquals(
    await reuseVerifiedRejectedPlace(
      extracted,
      rejected,
      () => Promise.resolve({ data: null }),
    ),
    null,
  );
});

Deno.test("verified reuse: returned DB error preserves the rejected ghost even with data", async () => {
  assertEquals(
    await reuseVerifiedRejectedPlace(
      extracted,
      rejected,
      () =>
        Promise.resolve({ data: stored, error: { message: "unavailable" } }),
    ),
    null,
  );
});

Deno.test("verified reuse: thrown DB error preserves the rejected ghost", async () => {
  assertEquals(
    await reuseVerifiedRejectedPlace(
      extracted,
      rejected,
      () => Promise.reject(new Error("unavailable")),
    ),
    null,
  );
});

Deno.test("verified reuse: no rejected identity performs no DB lookup", async () => {
  const emptySearch = await resolveImportPlaceSearch(() => []);
  let calls = 0;
  for (
    const missing of [emptySearch.rejectedCandidate, {}, { id: "" }, {
      id: "  ",
    }]
  ) {
    assertEquals(
      await reuseVerifiedRejectedPlace(extracted, missing, () => {
        calls++;
        return Promise.resolve({ data: stored });
      }),
      null,
    );
  }
  assertEquals(calls, 0);
});
