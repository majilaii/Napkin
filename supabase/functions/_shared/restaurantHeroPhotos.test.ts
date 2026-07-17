/**
 * restaurantHeroPhotos.test.ts — TICKET-187 deferred hero-photo acquisition.
 *
 * Tests acquireAndMirrorHeroPhotos (_shared/restaurant.ts) with a capturing mock
 * supabase client + a stubbed globalThis.fetch. No live DB, no live Google.
 *
 * Verification-plan coverage:
 *   - ghost save (verification != 'verified') → ZERO claims + ZERO Google calls
 *   - already-complete / terminal / no-external-id rows skipped BEFORE any claim
 *   - weighted SKU budget fail-closed: denied OR rpc-error → zero Google calls
 *   - photoless attestation → terminal photo_source='none' under null guards
 *   - transient Details failure (404/500/network) → NO write (NULL, retryable)
 *   - success → exact frozen Enterprise mask, attestation + media single-flight claims,
 *     weighted Details/photo debits, reference-derived Storage key, exact-URL CAS
 *   - input ids deduplicated → one attestation claim per distinct row
 *   - buildPhotoAttributionHtml synthesis + escaping (places-search contract)
 *
 * Run with: deno test --allow-env supabase/functions/_shared/restaurantHeroPhotos.test.ts
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  acquireAndMirrorHeroPhotos,
  buildPhotoAttributionHtml,
} from "./restaurant.ts";

const USER_ID = "aabbccdd-0000-4000-8000-000000000001";

async function sha1Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

// ── Capturing mock supabase client ────────────────────────────────────────────

interface Captured {
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    eq: Record<string, unknown>;
    isNull: string[];
  }>;
  uploads: Array<{ bucket: string; path: string; contentType?: string }>;
}

function makeMockSupabase(opts: {
  rows: Array<Record<string, unknown>>;
  budgetAllowed?: boolean | "rpc-error";
  attestationOutcome?: "claimed" | "pending";
  mediaOutcome?: "claimed" | "pending";
  /** Returned Supabase error on the initial restaurants read. */
  readError?: unknown;
  /** The initial restaurants read REJECTS (unexpected throw inside the job). */
  readRejects?: boolean;
}) {
  const calls: Captured = { rpc: [], updates: [], uploads: [] };
  const rows = new Map<string, Record<string, unknown>>(
    opts.rows.map((row) => [String(row.id), {
      completeness_version: 0,
      merged_into: null,
      lat: null,
      lng: null,
      photo_url: null,
      photo_source: null,
      ...row,
    }]),
  );

  function query(table: string, payload?: Record<string, unknown>) {
    const eq: Record<string, unknown> = {};
    const isNull: string[] = [];
    let executed = false;
    let result: { data: unknown; error: unknown } | null = null;

    const execute = () => {
      if (executed) return result!;
      executed = true;
      const id = typeof eq.id === "string" ? eq.id : null;
      const current = id ? rows.get(id) ?? null : null;
      if (!payload) {
        result = { data: current, error: null };
        return result;
      }

      calls.updates.push({
        table,
        payload,
        eq: { ...eq },
        isNull: [...isNull],
      });
      const matches = current !== null &&
        Object.entries(eq).every(([key, value]) => current[key] === value) &&
        isNull.every((key) =>
          current[key] === null || current[key] === undefined
        );
      if (!matches) {
        result = { data: null, error: null };
        return result;
      }
      const updated = { ...current, ...payload };
      rows.set(id!, updated);
      result = { data: updated, error: null };
      return result;
    };

    const chain = {
      eq(col: string, value: unknown) {
        eq[col] = value;
        return chain;
      },
      is(col: string, value: unknown) {
        if (value === null) isNull.push(col);
        else eq[col] = value;
        return chain;
      },
      select(_cols: string) {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve(execute());
      },
      single() {
        return Promise.resolve(execute());
      },
      then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
        onfulfilled?:
          | ((
            value: { data: unknown; error: unknown },
          ) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ) {
        return Promise.resolve(execute()).then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  const client = {
    from: (table: string) => ({
      select: (_cols: string) => ({
        in: (_col: string, ids: string[]) =>
          opts.readRejects
            ? Promise.reject(new Error("restaurants read blew up"))
            : Promise.resolve(
              opts.readError ? { data: null, error: opts.readError } : {
                data: ids.flatMap((id) => rows.get(id) ?? []),
                error: null,
              },
            ),
        eq: (col: string, value: unknown) => query(table).eq(col, value),
      }),
      update: (payload: Record<string, unknown>) => query(table, payload),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      if (name === "fn_claim_place_attestation") {
        return Promise.resolve({
          data: [{
            outcome: opts.attestationOutcome ?? "claimed",
            projection: null,
          }],
          error: null,
        });
      }
      if (name === "fn_charge_sku_budget") {
        if (opts.budgetAllowed === "rpc-error") {
          return Promise.resolve({ data: null, error: { message: "db blip" } });
        }
        return Promise.resolve({
          data: opts.budgetAllowed !== false,
          error: null,
        });
      }
      if (name === "fn_commit_place_attestation") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "fn_resolve_canonical") {
        return Promise.resolve({ data: args.p_id, error: null });
      }
      if (name === "fn_canonicalize_ghost") {
        return Promise.resolve({ data: args.p_ghost_id, error: null });
      }
      if (name === "fn_claim_media") {
        return Promise.resolve({
          data: [{
            outcome: opts.mediaOutcome ?? "claimed",
            committed_url: null,
          }],
          error: null,
        });
      }
      if (name === "fn_commit_media") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: `unexpected RPC: ${name}` },
      });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (
          path: string,
          _bytes: ArrayBuffer,
          o?: { contentType?: string },
        ) => {
          calls.uploads.push({ bucket, path, contentType: o?.contentType });
          return Promise.resolve({ error: null });
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl:
              `https://sb.example/storage/v1/object/public/${bucket}/${path}`,
          },
        }),
      }),
    },
  };
  return { client, calls };
}

// ── fetch stub ────────────────────────────────────────────────────────────────

interface SeenFetch {
  url: string;
  fieldMask: string | null;
  body: string | null;
}

function stubFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  const seen: SeenFetch[] = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    seen.push({
      url,
      fieldMask: headers.get("X-Goog-FieldMask"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// ── reportError observation (TICKET-187 review fix) ──────────────────────────
// reportError (_shared/report.ts) activates on the SENTRY_DSN env and emits a
// fire-and-forget fetch to the DSN host — the only observable spy point without
// injection. Steps that assert reporting set TEST_DSN and count sentry-bound
// requests through the same fetch stub; steps that assert exact Google-call
// counts leave SENTRY_DSN unset (reportError no-ops).

const TEST_DSN = "https://pubkey@sentry.example/42";

/** Sentry-bound requests made by reportError (host from TEST_DSN). */
function sentryCalls(seen: SeenFetch[]): SeenFetch[] {
  return seen.filter((s) => s.url.includes("sentry.example"));
}

function detailsBody(
  photoName: string | null,
  displayName: string | null,
  uri: string | null,
) {
  return {
    displayName: { text: "Test Restaurant" },
    location: { latitude: 51.5074, longitude: -0.1278 },
    formattedAddress: "1 Test Street, London, UK",
    addressComponents: [
      { longText: "London", types: ["locality"] },
      { longText: "United Kingdom", shortText: "GB", types: ["country"] },
    ],
    ...(photoName
      ? {
        photos: [{
          name: photoName,
          authorAttributions: displayName
            ? [{ displayName, uri: uri ?? undefined }]
            : [],
        }],
      }
      : {}),
  };
}

function rpcs(calls: Captured, name: string) {
  return calls.rpc.filter((call) => call.name === name);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("acquireAndMirrorHeroPhotos (TICKET-187)", async (t) => {
  Deno.env.set("GOOGLE_PLACES_API_KEY", "test-key");
  Deno.env.delete("COMPLETENESS_SPEND_FROZEN");

  await t.step(
    "ghost row (unverified) → ZERO claims + ZERO Google calls",
    async () => {
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r-ghost",
          external_id: `ghost_${USER_ID}_nonce1`,
          photo_url: null,
          photo_source: null,
          verification: "unverified",
        }],
      });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        await acquireAndMirrorHeroPhotos(client, ["r-ghost"], USER_ID);
      } finally {
        fetchStub.restore();
      }
      assertEquals(
        calls.rpc.length,
        0,
        "ghost must be filtered BEFORE any claim",
      );
      assertEquals(fetchStub.seen.length, 0, "ghost must never reach Google");
      assertEquals(calls.updates.length, 0, "ghost row must not be touched");
    },
  );

  await t.step(
    "complete / terminal / no-external-id rows skipped pre-claim",
    async () => {
      const { client, calls } = makeMockSupabase({
        rows: [
          {
            id: "r-mirrored",
            external_id: "ChIJ-a",
            lat: 1,
            lng: 2,
            photo_url: "https://x/p.jpg",
            photo_source: "places",
            places_photo_attribution_html: "<a>A</a>",
            verification: "verified",
            merged_into: null,
          },
          {
            id: "r-terminal",
            external_id: "ChIJ-b",
            lat: 1,
            lng: 2,
            photo_url: null,
            photo_source: "none",
            places_photo_attribution_html: null,
            verification: "verified",
            merged_into: null,
          },
          {
            id: "r-no-ext",
            external_id: null,
            photo_url: null,
            photo_source: null,
            verification: "verified",
          },
        ],
      });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        await acquireAndMirrorHeroPhotos(client, [
          "r-mirrored",
          "r-terminal",
          "r-no-ext",
        ], USER_ID);
      } finally {
        fetchStub.restore();
      }
      assertEquals(
        calls.rpc.length,
        0,
        "repeat imports must be free — no claims for complete rows",
      );
      assertEquals(fetchStub.seen.length, 0);
      assertEquals(calls.updates.length, 0);
    },
  );

  await t.step(
    "Details SKU budget denied → fail-closed, zero Google calls, row untouched",
    async () => {
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: "ChIJ-real",
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
        budgetAllowed: false,
      });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
      }
      assertEquals(rpcs(calls, "fn_claim_place_attestation").length, 1);
      assertEquals(rpcs(calls, "fn_charge_sku_budget").length, 1);
      assertEquals(rpcs(calls, "fn_charge_sku_budget")[0].args, {
        p_user_id: USER_ID,
        p_sku: "places_details_pro",
      });
      assertEquals(
        fetchStub.seen.length,
        0,
        "denied budget must spend nothing",
      );
      assertEquals(
        calls.updates.length,
        0,
        "row stays NULL (retryable via backfill)",
      );
    },
  );

  await t.step(
    "budget RPC error → fail-closed (a DB blip must not uncork spend)",
    async () => {
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: "ChIJ-real",
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
        budgetAllowed: "rpc-error",
      });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
      }
      assertEquals(rpcs(calls, "fn_claim_place_attestation").length, 1);
      assertEquals(rpcs(calls, "fn_charge_sku_budget").length, 1);
      assertEquals(fetchStub.seen.length, 0);
      assertEquals(calls.updates.length, 0);
    },
  );

  await t.step(
    "photoless place → TERMINAL photo_source='none' (CAS on photo_url IS NULL)",
    async () => {
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: "ChIJ-photoless",
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
      });
      const fetchStub = stubFetch(() =>
        new Response(JSON.stringify(detailsBody(null, null, null)), {
          status: 200,
        })
      );
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
      }
      assertEquals(
        fetchStub.seen.length,
        1,
        "exactly one Details call, no media fetch",
      );
      const terminal = calls.updates.find((update) =>
        update.payload.photo_source === "none"
      );
      assertEquals(terminal?.payload, { photo_source: "none" });
      assertEquals(terminal?.eq, { id: "r1" });
      assertEquals(
        terminal?.isNull,
        ["merged_into", "photo_url", "photo_source"],
        "terminal stamp must preserve a concurrent hero/source and reject merged aliases",
      );
      assertEquals(
        rpcs(calls, "fn_claim_media").length,
        0,
        "photoless projections never claim media",
      );
    },
  );

  await t.step(
    "empty attribution (photo but no author) → terminal none, no media fetch",
    async () => {
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: "ChIJ-noattr",
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
      });
      const fetchStub = stubFetch(() =>
        new Response(
          JSON.stringify(
            detailsBody("places/ChIJ-noattr/photos/p1", null, null),
          ),
          { status: 200 },
        )
      );
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
      }
      assertEquals(
        fetchStub.seen.length,
        1,
        "no paid media fetch without attribution",
      );
      const terminal = calls.updates.find((update) =>
        update.payload.photo_source === "none"
      );
      assertEquals(terminal?.payload, { photo_source: "none" });
      assertEquals(
        rpcs(calls, "fn_claim_media").length,
        0,
        "reference and attribution are paired; an unattributed photo never enters media claims",
      );
    },
  );

  await t.step(
    "transient Details failure (404 stale id / 500) → NO write, row stays NULL",
    async () => {
      for (const status of [404, 500]) {
        const { client, calls } = makeMockSupabase({
          rows: [{
            id: "r1",
            external_id: "ChIJ-stale",
            photo_url: null,
            photo_source: null,
            verification: "verified",
          }],
        });
        const fetchStub = stubFetch(() =>
          new Response("not found", { status })
        );
        try {
          await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
        } finally {
          fetchStub.restore();
        }
        assertEquals(
          calls.updates.length,
          0,
          `HTTP ${status} must leave photo_source NULL — retryable by the backfill sweep`,
        );
      }
    },
  );

  await t.step(
    "success → frozen Enterprise mask, weighted claims/debits, sha1 key, exact-URL CAS",
    async () => {
      const externalId = "ChIJ-success";
      const photoName = "places/ChIJ-success/photos/photoref-XYZ";
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: externalId,
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
      });
      const fetchStub = stubFetch((url) => {
        if (url.includes("/media?")) {
          return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        return new Response(
          JSON.stringify(
            detailsBody(
              photoName,
              "Ana Photographer",
              "https://maps.google.com/u/ana",
            ),
          ),
          { status: 200 },
        );
      });
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
      }

      // Details call: DB-derived external_id + exact frozen completeness projection.
      const detailsCall = fetchStub.seen[0];
      assertStringIncludes(
        detailsCall.url,
        `https://places.googleapis.com/v1/places/${externalId}`,
      );
      assertEquals(
        detailsCall.fieldMask,
        "displayName,location,addressComponents,formattedAddress,photos.name,photos.authorAttributions,rating,userRatingCount,priceLevel,types,primaryType,websiteUri,googleMapsUri,nationalPhoneNumber,regularOpeningHours",
        "all callers share the frozen Enterprise Details projection",
      );

      const charges = rpcs(calls, "fn_charge_sku_budget");
      assertEquals(charges.map((call) => call.args.p_sku), [
        "places_details_pro",
        "places_photo",
      ]);
      assertEquals(charges.map((call) => call.args.p_user_id), [
        USER_ID,
        USER_ID,
      ]);
      assertEquals(rpcs(calls, "fn_claim_place_attestation").length, 1);
      assertEquals(rpcs(calls, "fn_commit_place_attestation").length, 1);
      const mediaClaim = rpcs(calls, "fn_claim_media")[0];
      assertEquals(mediaClaim.args.p_canonical_restaurant_id, "r1");
      assertEquals(mediaClaim.args.p_photo_reference, photoName);

      // Media fetch uses the photo resource name from Details.
      assertStringIncludes(fetchStub.seen[1].url, `${photoName}/media?`);

      // Reference-derived Storage key: <id>/<sha1(photoName)>.jpg.
      const expectedKey = `r1/${await sha1Hex(photoName)}.jpg`;
      assertEquals(calls.uploads.length, 1);
      assertEquals(calls.uploads[0].bucket, "restaurant-photos");
      assertEquals(calls.uploads[0].path, expectedKey);

      // Atomic four-column CAS with THAT exact object URL, guarded on the
      // canonical row and photo_url IS NULL. The other update is the minimal
      // attested restaurant projection.
      const u = calls.updates.find((update) =>
        typeof update.payload.photo_url === "string"
      );
      assertEquals(
        u.payload.photo_url,
        `https://sb.example/storage/v1/object/public/restaurant-photos/${expectedKey}`,
      );
      assertEquals(u.payload.photo_reference, photoName);
      assertEquals(u.payload.photo_source, "places");
      assertEquals(
        u.payload.places_photo_attribution_html,
        '<a href="https://maps.google.com/u/ana">Ana Photographer</a>',
      );
      assertEquals(
        u.isNull,
        ["merged_into", "photo_url"],
        "exact-URL CAS must reject aliases and guard on photo_url IS NULL",
      );
      const mediaCommit = rpcs(calls, "fn_commit_media")[0];
      assertEquals(mediaCommit.args.p_canonical_restaurant_id, "r1");
      assertEquals(mediaCommit.args.p_photo_reference, photoName);
      assertEquals(
        mediaCommit.args.p_committed_url,
        u.payload.photo_url,
        "the media claim is acknowledged only with the exact installed URL",
      );
    },
  );

  await t.step(
    "duplicate input ids → deduplicated (single row processed, single claim)",
    async () => {
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: "ChIJ-dup",
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
      });
      const fetchStub = stubFetch(() =>
        new Response(JSON.stringify(detailsBody(null, null, null)), {
          status: 200,
        })
      );
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1", "r1", "r1"], USER_ID);
      } finally {
        fetchStub.restore();
      }
      assertEquals(rpcs(calls, "fn_claim_place_attestation").length, 1);
      assertEquals(rpcs(calls, "fn_charge_sku_budget").length, 1);
      assertEquals(fetchStub.seen.length, 1);
    },
  );

  await t.step(
    "missing GOOGLE_PLACES_API_KEY → claim only, no debit/call (transient)",
    async () => {
      Deno.env.delete("GOOGLE_PLACES_API_KEY");
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: "ChIJ-real",
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
      });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
        Deno.env.set("GOOGLE_PLACES_API_KEY", "test-key");
      }
      assertEquals(rpcs(calls, "fn_claim_place_attestation").length, 1);
      assertEquals(rpcs(calls, "fn_charge_sku_budget").length, 0);
      assertEquals(fetchStub.seen.length, 0);
      assertEquals(calls.updates.length, 0);
    },
  );

  // ── TICKET-187 review fix: deferred-job failures must reach reportError ──
  // (monitoring doctrine: a fleet-wide deferred-photo failure must never
  // surface only as missing photos.)

  await t.step(
    "unexpected throw inside the job → EXACTLY ONE reportError, wrapper resolves",
    async () => {
      Deno.env.set("SENTRY_DSN", TEST_DSN);
      const { client } = makeMockSupabase({ rows: [], readRejects: true });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        // Must RESOLVE — the job never throws into the isolate/waitUntil.
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
        Deno.env.delete("SENTRY_DSN");
      }
      const reports = sentryCalls(fetchStub.seen);
      assertEquals(reports.length, 1, "exactly one reportError emission");
      // Context contract: { fn: 'resolve-url', action: 'photo-mirror', extra.user_id }.
      const event = JSON.parse(reports[0].body ?? "{}");
      assertEquals(event.tags?.fn, "resolve-url");
      assertEquals(event.tags?.action, "photo-mirror");
      assertEquals(event.extra?.user_id, USER_ID);
    },
  );

  await t.step(
    "restaurants read returns a DB error → reported once, job stops, no Google calls",
    async () => {
      Deno.env.set("SENTRY_DSN", TEST_DSN);
      const { client, calls } = makeMockSupabase({
        rows: [],
        readError: { message: "connection refused", code: "08006" },
      });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1", "r2"], USER_ID);
      } finally {
        fetchStub.restore();
        Deno.env.delete("SENTRY_DSN");
      }
      const reports = sentryCalls(fetchStub.seen);
      assertEquals(
        reports.length,
        1,
        "returned Supabase read error must be reported",
      );
      assertEquals(
        fetchStub.seen.length - reports.length,
        0,
        "no Google calls after a dead read",
      );
      assertEquals(calls.rpc.length, 0, "no tokens after a dead read");
      assertEquals(calls.updates.length, 0);
    },
  );

  await t.step(
    "budget RPC error → designed fail-closed deferral, not reported",
    async () => {
      Deno.env.set("SENTRY_DSN", TEST_DSN);
      const { client, calls } = makeMockSupabase({
        rows: [{
          id: "r1",
          external_id: "ChIJ-real",
          photo_url: null,
          photo_source: null,
          verification: "verified",
        }],
        budgetAllowed: "rpc-error",
      });
      const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
      try {
        await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
      } finally {
        fetchStub.restore();
        Deno.env.delete("SENTRY_DSN");
      }
      const reports = sentryCalls(fetchStub.seen);
      assertEquals(
        reports.length,
        0,
        "budget infrastructure errors are normalized to a retryable deferral",
      );
      assertEquals(
        fetchStub.seen.length - reports.length,
        0,
        "fail-closed: still zero Google calls",
      );
      assertEquals(calls.updates.length, 0);
    },
  );

  await t.step(
    "DESIGNED transient states (Details 404/5xx, budget denial) are NOT reported",
    async () => {
      Deno.env.set("SENTRY_DSN", TEST_DSN);
      try {
        // Details 404 + 500 → transient NULL, non-reported.
        for (const status of [404, 500]) {
          const { client } = makeMockSupabase({
            rows: [{
              id: "r1",
              external_id: "ChIJ-stale",
              photo_url: null,
              photo_source: null,
              verification: "verified",
            }],
          });
          const fetchStub = stubFetch(() => new Response("nope", { status }));
          try {
            await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
          } finally {
            fetchStub.restore();
          }
          assertEquals(
            sentryCalls(fetchStub.seen).length,
            0,
            `Details ${status} is a designed retry state — never reported`,
          );
        }
        // Budget exhausted (allowed=false, no error) → designed, non-reported.
        const { client } = makeMockSupabase({
          rows: [{
            id: "r1",
            external_id: "ChIJ-real",
            photo_url: null,
            photo_source: null,
            verification: "verified",
          }],
          budgetAllowed: false,
        });
        const fetchStub = stubFetch(() => new Response("{}", { status: 200 }));
        try {
          await acquireAndMirrorHeroPhotos(client, ["r1"], USER_ID);
        } finally {
          fetchStub.restore();
        }
        assertEquals(
          sentryCalls(fetchStub.seen).length,
          0,
          "budget denial is the designed state — never reported",
        );
      } finally {
        Deno.env.delete("SENTRY_DSN");
      }
    },
  );
});

// ── buildPhotoAttributionHtml — places-search sanitizePlace contract ──────────

Deno.test("buildPhotoAttributionHtml (TICKET-187)", async (t) => {
  await t.step("displayName + uri → escaped anchor", () => {
    assertEquals(
      buildPhotoAttributionHtml(detailsBody("p", "Ana", "https://g.co/ana")),
      '<a href="https://g.co/ana">Ana</a>',
    );
  });

  await t.step("displayName only → escaped text, no anchor", () => {
    assertEquals(
      buildPhotoAttributionHtml(detailsBody("p", "Ana", null)),
      "Ana",
    );
  });

  await t.step("escapes HTML in both fields (escape-on-write contract)", () => {
    const html = buildPhotoAttributionHtml({
      photos: [{
        name: "p",
        authorAttributions: [{
          displayName: "A<b>&\"c'",
          uri: 'https://g.co/?a=1&b="x"',
        }],
      }],
    });
    assertEquals(
      html,
      '<a href="https://g.co/?a=1&amp;b=&quot;x&quot;">A&lt;b&gt;&amp;&quot;c&#39;</a>',
    );
  });

  await t.step(
    "missing/empty/whitespace displayName → null (→ none sentinel)",
    () => {
      assertEquals(
        buildPhotoAttributionHtml(detailsBody("p", null, null)),
        null,
      );
      assertEquals(
        buildPhotoAttributionHtml({
          photos: [{ name: "p", authorAttributions: [{ displayName: "   " }] }],
        }),
        null,
      );
      assertEquals(buildPhotoAttributionHtml({}), null);
      assertEquals(buildPhotoAttributionHtml(null), null);
    },
  );

  await t.step(
    "version-skewed non-string fields degrade to null, never throw",
    () => {
      assertEquals(
        buildPhotoAttributionHtml({
          photos: [{
            name: "p",
            authorAttributions: [{ displayName: 42, uri: {} }],
          }],
        }),
        null,
      );
    },
  );
});
