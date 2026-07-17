import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { PlaceAttestationProjection } from "../_shared/completeness.ts";
import {
  type ClaimedCompletenessItem,
  type CompletenessWorkerBackend,
  DeferredWithoutAttempt,
  drainCompletenessQueue,
  LostLeaseError,
  processClaimedCompletenessItem,
  type RestaurantCompletionState,
  runCompletenessDeployGate,
  settleClaimedCompletenessItem,
} from "./_worker.ts";

const ITEM: ClaimedCompletenessItem = {
  id: "00000000-0000-4000-8000-000000000001",
  owner_id: "00000000-0000-4000-8000-000000000002",
  job_id: "00000000-0000-4000-8000-000000000003",
  item_nonce: "00000000-0000-4000-8000-000000000004",
  restaurant_id: "00000000-0000-4000-8000-000000000005",
  external_id: "ChIJ-place",
  resolution_id: null,
  client_facts: { name: "Kartuli", city: "London" },
  state: "leased",
  attempts: 0,
  next_attempt_at: "2026-07-16T12:00:00.000Z",
  lease_token: "00000000-0000-4000-8000-000000000006",
};

const INCOMPLETE: RestaurantCompletionState = {
  id: ITEM.restaurant_id!,
  external_id: ITEM.external_id,
  verification: "verified",
  merged_into: null,
  completeness_version: 3,
  lat: null,
  lng: null,
  photo_url: null,
  photo_reference: null,
  photo_source: null,
  places_photo_attribution_html: null,
};

const COMPLETE: RestaurantCompletionState = {
  ...INCOMPLETE,
  lat: 51.45,
  lng: -0.07,
  photo_source: "none",
  completeness_version: 4,
};

const OUT_OF_BOUNDS: RestaurantCompletionState = {
  ...COMPLETE,
  lat: 999,
  lng: -181,
};

const PROJECTION: PlaceAttestationProjection = {
  place_id: "ChIJ-place",
  display_name: "Kartuli",
  formatted_address: "East Dulwich, London, UK",
  address_components: [],
  city: "London",
  country: "United Kingdom",
  lat: 51.45,
  lng: -0.07,
  google_rating: 4.6,
  google_rating_count: 287,
  price_level: 2,
  types: ["restaurant", "georgian_restaurant"],
  primary_type: "georgian_restaurant",
  website: "https://kartuli.example",
  phone: "+44 20 7946 0958",
  google_maps_uri: "https://maps.google.test/?cid=kartuli",
  opening_hours: {
    weekdayDescriptions: ["Monday: 12:00 PM – 10:00 PM"],
  },
  photo_reference: "places/ChIJ-place/photos/ref",
  photo_attribution_html:
    '<a href="https://maps.google.test/author">Author</a>',
};

function backend(
  overrides: Partial<CompletenessWorkerBackend> = {},
): CompletenessWorkerBackend {
  return {
    claimBatch: async () => [],
    claimItem: async () => null,
    sweep: async () => 0,
    getItem: async () => null,
    getRestaurantState: async () => COMPLETE,
    searchDeferred: async () => [],
    recordResolution: async () => crypto.randomUUID(),
    canonicalize: async () => COMPLETE,
    attest: async () => PROJECTION,
    applyAttestation: async () => COMPLETE,
    acquireMedia: async () => null,
    destinations: async () => [],
    route: async () => ({}),
    finalize: async () => ({}),
    defer: async () => "deferred",
    enqueueDeployGate: async () => ({
      job_id: ITEM.job_id,
      item_id: ITEM.id,
      destination_id: "00000000-0000-4000-8000-000000000007",
    }),
    ...overrides,
  };
}

Deno.test("worker heals finite but out-of-bounds coordinates instead of exhausting at SQL routing", async () => {
  const calls: string[] = [];
  const fake = backend({
    canonicalize: async () => OUT_OF_BOUNDS,
    attest: async () => {
      calls.push("attest");
      return PROJECTION;
    },
    applyAttestation: async () => {
      calls.push("apply");
      return COMPLETE;
    },
    destinations: async () => [],
    finalize: async () => {
      calls.push("finalize");
      return {};
    },
  });

  await processClaimedCompletenessItem(fake, ITEM, "worker-bounds");
  assertEquals(calls, ["attest", "apply", "finalize"]);
});

Deno.test("worker pipeline canonicalizes before attestation, then routes/finalizes with one lease token", async () => {
  const calls: string[] = [];
  const routedTokens: string[] = [];
  let canonicalizeCalls = 0;
  const fake = backend({
    canonicalize: async () => {
      calls.push("canonicalize");
      canonicalizeCalls += 1;
      return canonicalizeCalls === 1 ? INCOMPLETE : {
        ...COMPLETE,
        photo_url: "https://storage.test/hero.jpg",
        photo_source: "places",
        places_photo_attribution_html: PROJECTION.photo_attribution_html,
      };
    },
    attest: async () => {
      calls.push("attest");
      return PROJECTION;
    },
    applyAttestation: async (item) => {
      calls.push("apply");
      assertEquals(item.lease_token, ITEM.lease_token);
      return { ...COMPLETE, photo_source: null };
    },
    acquireMedia: async () => {
      calls.push("media");
      return "https://storage.test/hero.jpg";
    },
    destinations: async () => {
      calls.push("destinations");
      return [{
        id: "dest-1",
        owner_id: ITEM.owner_id,
        job_id: ITEM.job_id,
        item_nonce: ITEM.item_nonce,
        destination_nonce: "nonce-1",
        destination_kind: "wishlist",
        target_table_id: null,
        target_list_id: null,
        target_list_title: null,
        outcome: "pending",
      }];
    },
    route: async (item) => {
      calls.push("route");
      routedTokens.push(item.lease_token);
      return { outcome: "fulfilled", status: "already_pinned" };
    },
    finalize: async (item, state) => {
      calls.push(`finalize:${state}`);
      assertEquals(item.lease_token, ITEM.lease_token);
      return {};
    },
  });

  const result = await processClaimedCompletenessItem(fake, ITEM, "worker-a");
  assertEquals(result.state, "verified");
  assertEquals(result.already_pinned, true);
  assertEquals(calls, [
    "canonicalize",
    "attest",
    "apply",
    "media",
    "canonicalize",
    "destinations",
    "route",
    "finalize:verified",
  ]);
  assertEquals(routedTokens, [ITEM.lease_token]);
});

Deno.test("worker refuses to route a malformed hero after attestation/media", async () => {
  let routed = false;
  const malformed = {
    ...COMPLETE,
    photo_source: "places",
    photo_url: null,
    places_photo_attribution_html: PROJECTION.photo_attribution_html,
  };
  const fake = backend({
    canonicalize: async () => malformed,
    applyAttestation: async () => malformed,
    acquireMedia: async () => null,
    destinations: async () => {
      routed = true;
      return [];
    },
  });

  await assertRejects(
    () => processClaimedCompletenessItem(fake, ITEM, "worker-malformed"),
    Error,
    "restaurant remained incomplete",
  );
  assertEquals(routed, false);
});

Deno.test("coordinate repair preserves a photoless terminal without media spend", async () => {
  let attestations = 0;
  let applied = 0;
  let mediaClaims = 0;
  const missingCoordinates = { ...COMPLETE, lat: null, lng: null };
  const fake = backend({
    canonicalize: async () => missingCoordinates,
    attest: async () => {
      attestations += 1;
      return PROJECTION;
    },
    applyAttestation: async () => {
      applied += 1;
      return COMPLETE;
    },
    acquireMedia: async () => {
      mediaClaims += 1;
      throw new Error("photo_source=none must not acquire replacement media");
    },
  });

  const result = await processClaimedCompletenessItem(
    fake,
    ITEM,
    "worker-none",
  );
  assertEquals(result.state, "verified");
  assertEquals(attestations, 1);
  assertEquals(applied, 1);
  assertEquals(mediaClaims, 0);
});

Deno.test("coordinate repair keeps a new Places reference on the fresh-claim path", async () => {
  let canonicalizations = 0;
  let mediaClaims = 0;
  const oldReference = {
    ...COMPLETE,
    lat: null,
    lng: null,
    photo_url: "https://storage.test/old.jpg",
    photo_reference: "places/ChIJ-place/photos/old",
    photo_source: "places",
    places_photo_attribution_html: "<a>Old Author</a>",
  };
  const oldReferenceWithCoordinates = {
    ...oldReference,
    lat: PROJECTION.lat,
    lng: PROJECTION.lng,
  };
  const newReference = {
    ...oldReferenceWithCoordinates,
    photo_url: "https://storage.test/new.jpg",
    photo_reference: PROJECTION.photo_reference,
    places_photo_attribution_html: PROJECTION.photo_attribution_html,
  };
  const fake = backend({
    canonicalize: async () => {
      canonicalizations += 1;
      return canonicalizations === 1 ? oldReference : newReference;
    },
    applyAttestation: async () => oldReferenceWithCoordinates,
    acquireMedia: async () => {
      mediaClaims += 1;
      return newReference.photo_url;
    },
  });

  const result = await processClaimedCompletenessItem(
    fake,
    ITEM,
    "worker-new-reference",
  );
  assertEquals(result.state, "verified");
  assertEquals(mediaClaims, 1);
  assertEquals(canonicalizations, 2);
});

Deno.test("route-acked worker death followed by a merge skips terminal destinations and finalizes", async () => {
  const mergedId = "00000000-0000-4000-8000-000000000009";
  let routed = false;
  let finalizedRestaurantId: string | null = null;
  const fake = backend({
    canonicalize: async () => ({ ...COMPLETE, id: mergedId }),
    destinations: async () => [{
      id: "dest-acked-before-death",
      owner_id: ITEM.owner_id,
      job_id: ITEM.job_id,
      item_nonce: ITEM.item_nonce,
      destination_nonce: "nonce-acked-before-death",
      destination_kind: "wishlist",
      target_table_id: null,
      target_list_id: null,
      target_list_title: null,
      outcome: "fulfilled",
    }],
    route: async () => {
      routed = true;
      throw new Error("terminal destination must not be replayed");
    },
    finalize: async (_item, _state, restaurantId) => {
      finalizedRestaurantId = restaurantId;
      return {};
    },
  });

  const result = await processClaimedCompletenessItem(
    fake,
    ITEM,
    "worker-after-route-death",
  );
  assertEquals(result.state, "verified");
  assertEquals(result.restaurant_id, mergedId);
  assertEquals(routed, false);
  assertEquals(finalizedRestaurantId, mergedId);
});

Deno.test("owner-bound terminal resolution exhausts without another paid search or route", async () => {
  let searched = false;
  let routed = false;
  let finalized: { state: string; reason: string | null } | null = null;
  const terminalItem: ClaimedCompletenessItem = {
    ...ITEM,
    external_id: null,
    client_facts: {
      name: "Scene-text false positive",
      city: "London",
      resolution_decision: "no_result",
    },
  };
  const fake = backend({
    searchDeferred: async () => {
      searched = true;
      return [];
    },
    destinations: async () => {
      routed = true;
      return [];
    },
    finalize: async (_item, state, _restaurantId, reason) => {
      finalized = { state, reason };
      return {};
    },
  });

  const result = await processClaimedCompletenessItem(
    fake,
    terminalItem,
    "worker-terminal",
  );
  assertEquals(result.state, "exhausted");
  assertEquals(result.reason, "no_result");
  assertEquals(searched, false);
  assertEquals(routed, false);
  assertEquals(finalized, { state: "exhausted", reason: "no_result" });
});

Deno.test("nested advisory facts cannot impersonate server-copied resolution markers", async () => {
  const unresolved: ClaimedCompletenessItem = {
    ...ITEM,
    external_id: null,
    client_facts: {
      name: "Kartuli",
      city: "London",
      extracted: {
        resolution_decision: "no_result",
        attempted_external_id: "ChIJ-untrusted-nested-id",
      },
    },
  };
  let searched = false;
  let attested = false;
  const fake = backend({
    searchDeferred: async () => {
      searched = true;
      return [];
    },
    attest: async () => {
      attested = true;
      return PROJECTION;
    },
  });

  const result = await processClaimedCompletenessItem(
    fake,
    unresolved,
    "worker-advisory-markers",
  );
  assertEquals(result.state, "exhausted");
  assertEquals(searched, true);
  assertEquals(attested, false);
});

Deno.test("reclaimed stale worker cannot route, finalize, or defer over a newer lease", async () => {
  let finalized = false;
  let deferred = false;
  const fake = backend({
    destinations: async () => [{
      id: "dest-1",
      owner_id: ITEM.owner_id,
      job_id: ITEM.job_id,
      item_nonce: ITEM.item_nonce,
      destination_nonce: "nonce-1",
      destination_kind: "wishlist",
      target_table_id: null,
      target_list_id: null,
      target_list_title: null,
      outcome: "pending",
    }],
    route: async () => {
      throw new LostLeaseError("STALE_LEASE");
    },
    finalize: async () => {
      finalized = true;
    },
    defer: async () => {
      deferred = true;
      return "deferred";
    },
  });

  const result = await settleClaimedCompletenessItem(fake, ITEM, "old-worker");
  assertEquals(result.state, "lost_lease");
  assertEquals(finalized, false);
  assertEquals(deferred, false);
});

Deno.test("budget-unattempted resolution records provenance and defers without attempt consumption", async () => {
  const unresolved = { ...ITEM, external_id: null };
  let decision: string | null = null;
  let withoutAttempt: boolean | null = null;
  const fake = backend({
    searchDeferred: async () => {
      throw new DeferredWithoutAttempt("budget unavailable");
    },
    recordResolution: async (_item, resolution) => {
      decision = resolution.decision;
      return crypto.randomUUID();
    },
    defer: async (_item, _reason, noAttempt) => {
      withoutAttempt = noAttempt;
      return "deferred";
    },
  });

  const result = await settleClaimedCompletenessItem(
    fake,
    unresolved,
    "worker-budget",
  );
  assertEquals(result.state, "deferred");
  assertEquals(decision, "unattempted_budget");
  assertEquals(withoutAttempt, true);
});

Deno.test("failed Details retry uses server-evidenced place id without Text Search", async () => {
  const attemptedId = "ChIJ-known-details-id";
  const unresolved = {
    ...ITEM,
    external_id: null,
    client_facts: {
      name: "Kartuli",
      city: "London",
      attempted_external_id: attemptedId,
    },
  };
  let searched = false;
  let canonicalizedExternalId: string | null = null;
  let attestedExternalId: string | null = null;
  const calls: string[] = [];
  const fake = backend({
    searchDeferred: async () => {
      searched = true;
      throw new Error("known-id retry must not Text Search");
    },
    canonicalize: async (_item, externalId) => {
      calls.push("canonicalize");
      canonicalizedExternalId = externalId;
      return { ...INCOMPLETE, external_id: externalId };
    },
    attest: async (_ownerId, externalId) => {
      calls.push("attest");
      attestedExternalId = externalId;
      return {
        ...PROJECTION,
        place_id: externalId,
        photo_reference: null,
        photo_attribution_html: null,
      };
    },
    applyAttestation: async (_item, restaurant) => ({
      ...COMPLETE,
      id: restaurant.id,
      external_id: attemptedId,
    }),
  });

  const result = await processClaimedCompletenessItem(
    fake,
    unresolved,
    "worker-details-retry",
  );
  assertEquals(result.state, "resolved");
  assertEquals(searched, false);
  assertEquals(canonicalizedExternalId, attemptedId);
  assertEquals(attestedExternalId, attemptedId);
  assertEquals(calls.slice(0, 2), ["attest", "canonicalize"]);
});

Deno.test("failed known-id pre-attestation cannot canonicalize or merge", async () => {
  const unresolved = {
    ...ITEM,
    external_id: null,
    client_facts: {
      attempted_external_id: "ChIJ-stale-details-id",
    },
  };
  let canonicalized = false;
  const fake = backend({
    attest: async () => {
      throw new DeferredWithoutAttempt("details budget unavailable");
    },
    canonicalize: async () => {
      canonicalized = true;
      return COMPLETE;
    },
  });

  await assertRejects(
    () =>
      processClaimedCompletenessItem(fake, unresolved, "worker-details-frozen"),
    DeferredWithoutAttempt,
  );
  assertEquals(canonicalized, false);
});

Deno.test("deferred scorer terminalizes Kartuli → Cartouche and never canonicalizes", async () => {
  const unresolved = { ...ITEM, external_id: null };
  let canonicalized = false;
  let terminalState: string | null = null;
  let decision: string | null = null;
  const fake = backend({
    searchDeferred: async () => [{
      externalId: "cartouche-hertford",
      name: "Cartouche",
      city: "Hertford",
      formattedAddress: "Hertford, UK",
      raw: { id: "cartouche-hertford" },
    }],
    recordResolution: async (_item, resolution) => {
      decision = resolution.decision;
      return crypto.randomUUID();
    },
    canonicalize: async () => {
      canonicalized = true;
      return COMPLETE;
    },
    finalize: async (_item, state) => {
      terminalState = state;
    },
  });

  const result = await processClaimedCompletenessItem(
    fake,
    unresolved,
    "worker-score",
  );
  assertEquals(result.state, "exhausted");
  assertEquals(decision, "name_reject");
  assertEquals(terminalState, "exhausted");
  assertEquals(canonicalized, false);
});

Deno.test("drain clamps batch/sweep sizes and runs the bounded safety sweep", async () => {
  let batchLimit = 0;
  let sweepLimit = 0;
  const fake = backend({
    claimBatch: async (_worker, limit) => {
      batchLimit = limit;
      return [];
    },
    sweep: async (limit) => {
      sweepLimit = limit;
      return 2;
    },
  });
  const result = await drainCompletenessQueue(fake, {
    batchLimit: 9999,
    sweepLimit: 9999,
    workerId: "worker-bounded",
  });
  assertEquals(batchLimit, 50);
  assertEquals(sweepLimit, 100);
  assertEquals(result.swept_jobs, 2);
});

Deno.test("deploy gate exact-claims a complete item and uses normal route/finalize without spend", async () => {
  const calls: string[] = [];
  const fake = backend({
    getRestaurantState: async () => COMPLETE,
    enqueueDeployGate: async () => {
      calls.push("enqueue");
      return {
        job_id: ITEM.job_id,
        item_id: ITEM.id,
        destination_id: "dest-gate",
      };
    },
    claimItem: async () => {
      calls.push("claim-exact");
      return ITEM;
    },
    canonicalize: async () => {
      calls.push("canonicalize");
      return COMPLETE;
    },
    attest: async () => {
      throw new Error("deploy gate must stay no-spend");
    },
    acquireMedia: async () => {
      throw new Error("deploy gate must stay no-spend");
    },
    destinations: async () => {
      calls.push("destinations");
      return [{
        id: "dest-gate",
        owner_id: ITEM.owner_id,
        job_id: ITEM.job_id,
        item_nonce: ITEM.item_nonce,
        destination_nonce: ITEM.item_nonce,
        destination_kind: "wishlist",
        target_table_id: null,
        target_list_id: null,
        target_list_title: null,
        outcome: "pending",
      }];
    },
    route: async () => {
      calls.push("route");
      return {};
    },
    finalize: async () => {
      calls.push("finalize");
      return {};
    },
  });

  const result = await runCompletenessDeployGate(fake, {
    owner_id: ITEM.owner_id,
    restaurant_id: ITEM.restaurant_id!,
    import_nonce: ITEM.item_nonce,
  }, "gate-worker");
  assertEquals(result.state, "verified");
  assertEquals(calls, [
    "enqueue",
    "claim-exact",
    "canonicalize",
    "destinations",
    "route",
    "finalize",
  ]);
});

Deno.test("deploy gate rejects an incomplete restaurant before enqueue", async () => {
  let enqueued = false;
  const fake = backend({
    getRestaurantState: async () => INCOMPLETE,
    enqueueDeployGate: async () => {
      enqueued = true;
      return { job_id: "x", item_id: "y", destination_id: "z" };
    },
  });
  await assertRejects(
    () =>
      runCompletenessDeployGate(fake, {
        owner_id: ITEM.owner_id,
        restaurant_id: ITEM.restaurant_id!,
        import_nonce: ITEM.item_nonce,
      }),
    Error,
    "GATE_RESTAURANT_INCOMPLETE",
  );
  assert(!enqueued);
});
