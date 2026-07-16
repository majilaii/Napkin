import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CanonicalImage, sha256Hex } from "../_shared/imageCanonical.ts";
import {
  type SafeSearchLikelihoods,
  VisionSafeSearchError,
} from "../_shared/visionSafeSearch.ts";
import {
  advanceAccountDeletion,
  type DeletionAdapter,
  type DeletionInventory,
} from "../account/deletionSaga.ts";
import {
  BodyLimitError,
  createModerateImageHandler,
  MAX_STAGE_BYTES,
  moderateOwnedStorageObject,
  putStorageObject,
  readByteStreamLimited,
  StorageRequestError,
} from "./index.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const LEDGER_ID = "10000000-0000-4000-8000-000000000002";
const OBJECT_ID = "10000000-0000-4000-8000-000000000003";
const STAGING_PATH = `${USER_ID}/10000000-0000-4000-8000-000000000004`;

const unlikely: SafeSearchLikelihoods = {
  adult: "VERY_UNLIKELY",
  violence: "UNLIKELY",
  racy: "POSSIBLE",
  medical: "VERY_UNLIKELY",
  spoof: "UNLIKELY",
};

function pngHeader(width = 1, height = 1): Uint8Array {
  const u32 = (value: number) => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...new TextEncoder().encode(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...chunk("IDAT", []),
    ...chunk("IEND", []),
  ]);
}

function request(
  action: string,
  body?: BodyInit,
  contentType = "application/json",
  suffix = "",
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(
    `http://localhost/moderate-image?action=${action}${suffix}`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer user-jwt",
        "Content-Type": contentType,
        ...extraHeaders,
      },
      body,
    },
  );
}

function fakeClient(options: {
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  cached?:
    | { verdict: "pass" | "rejected"; likelihoods: SafeSearchLikelihoods }
    | null;
}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    rpc: options.rpc ?? (async () => ({ data: true, error: null })),
    from: (table: string) => {
      assertEquals(table, "image_hash_verdicts");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: options.cached ?? null,
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

function env(name: string): string | undefined {
  return {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    GOOGLE_VISION_API_KEY: "dedicated-vision-key",
    MODERATION_CRON_TOKEN: "dedicated-cron-token",
  }[name];
}

Deno.test("readByteStreamLimited enforces a byte count, independent of Content-Length", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  });
  await assertRejects(() => readByteStreamLimited(stream, 5), BodyLimitError);
});

Deno.test("putStorageObject wires AbortController into raw Storage upload and pins upsert false", async () => {
  let observedSignal: AbortSignal | null = null;
  let observedUpsert: string | null = null;
  const error = await assertRejects(
    () =>
      putStorageObject({
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            observedSignal = init?.signal as AbortSignal;
            observedUpsert = new Headers(init?.headers).get("x-upsert");
            observedSignal.addEventListener(
              "abort",
              () => reject(observedSignal?.reason),
              { once: true },
            );
          }),
        supabaseUrl: "https://project.supabase.co",
        serviceKey: "service-role-key",
        bucket: "image-staging",
        path: STAGING_PATH,
        bytes: new Uint8Array([1]),
        contentType: "image/jpeg",
        timeoutMs: 5,
      }),
    StorageRequestError,
  );
  assert(observedSignal instanceof AbortSignal);
  assertEquals(observedSignal.aborted, true);
  assertEquals(observedUpsert, "false");
  assertEquals(error.operation, "upload");
});

Deno.test("begin_stage returns the durable reservation generation", async () => {
  const client = fakeClient({
    rpc: async (name, args) => {
      assertEquals(name, "fn_begin_stage");
      assertEquals(args, { p_user_id: USER_ID });
      return {
        data: { staging_path: STAGING_PATH, generation: 1 },
        error: null,
      };
    },
  });
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
  });
  const response = await handler(
    request("begin_stage", JSON.stringify({ kind: "avatar" })),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    data: { staging_path: STAGING_PATH, generation: 1 },
  });
});

Deno.test("moderate-image rejects anonymous callers before any RPC", async () => {
  let rpcCalled = false;
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: { message: "bad jwt" },
      }),
    },
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: null };
    },
  };
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
  });
  const response = await handler(request("begin_stage", JSON.stringify({})));
  assertEquals(response.status, 401);
  assertEquals(rpcCalled, false);
});

Deno.test("finish_stage consumes generation immediately before abortable service upload", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = fakeClient({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "fn_claim_stage_put") {
        return {
          data: { staging_path: STAGING_PATH, generation: 2 },
          error: null,
        };
      }
      if (name === "fn_finish_stage") {
        return {
          data: { staging_path: STAGING_PATH, generation: 2, state: "staged" },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  let storageSignal: AbortSignal | null = null;
  let upsert: string | null = null;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    fetchImpl: async (_input, init) => {
      assertEquals(init?.method, "POST");
      storageSignal = init?.signal as AbortSignal;
      upsert = new Headers(init?.headers).get("x-upsert");
      return new Response(null, { status: 201 });
    },
  });
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const response = await handler(request(
    "finish_stage",
    bytes.slice().buffer as ArrayBuffer,
    "image/jpeg",
    `&staging_path=${encodeURIComponent(STAGING_PATH)}&generation=1`,
  ));
  assertEquals(response.status, 200);
  assert(storageSignal instanceof AbortSignal);
  assertEquals(upsert, "false");
  assertEquals(rpcCalls[0], {
    name: "fn_claim_stage_put",
    args: {
      p_user_id: USER_ID,
      p_staging_path: STAGING_PATH,
      p_generation: "1",
    },
  });
  assertEquals(rpcCalls[1].name, "fn_finish_stage");
  assertEquals(rpcCalls[1].args.p_generation, 2);
  assertEquals(await response.json(), {
    data: { staging_path: STAGING_PATH, generation: 2, state: "staged" },
  });
});

Deno.test("finish_stage stale generation is rejected before Storage byte arrival", async () => {
  const client = fakeClient({
    rpc: async (name) => {
      assertEquals(name, "fn_claim_stage_put");
      return { data: null, error: { message: "stage_claim_conflict" } };
    },
  });
  let storageCalled = false;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    fetchImpl: async () => {
      storageCalled = true;
      return new Response(null, { status: 201 });
    },
  });
  const response = await handler(request(
    "finish_stage",
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    "image/jpeg",
    `&staging_path=${encodeURIComponent(STAGING_PATH)}&generation=1`,
  ));
  assertEquals(response.status, 409);
  assertEquals(storageCalled, false);
  assertEquals((await response.json()).error.code, "STAGE_FENCE_REJECTED");
});

Deno.test("post-fence paused PUT cannot survive account deletion stable-zero", async () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const putEntered = deferred();
  const resumePut = deferred();
  const putLanded = deferred();
  const returnPutResponse = deferred();
  const knownPathDeleted = deferred();
  const storage = new Set<string>();
  const events: string[] = [];

  const client = fakeClient({
    rpc: async (name) => {
      if (name === "fn_claim_stage_put") {
        events.push("claim-generation-2");
        return {
          data: { staging_path: STAGING_PATH, generation: 2, state: "putting" },
          error: null,
        };
      }
      if (name === "fn_finish_stage") {
        events.push("finish-sees-tombstone");
        return { data: null, error: { message: "stage_finish_conflict" } };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    fetchImpl: async (_input, init) => {
      if (init?.method === "POST") {
        events.push("put-paused-after-claim");
        putEntered.resolve();
        await resumePut.promise;
        storage.add(STAGING_PATH);
        events.push("late-put-landed");
        putLanded.resolve();
        await returnPutResponse.promise;
        return new Response(null, { status: 201 });
      }
      if (init?.method === "DELETE") {
        storage.delete(STAGING_PATH);
        events.push("edge-cleanup-delete");
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected Storage method ${init?.method}`);
    },
  });
  const handlerPromise = handler(request(
    "finish_stage",
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    "image/jpeg",
    `&staging_path=${encodeURIComponent(STAGING_PATH)}&generation=1`,
  ));
  await putEntered.promise;

  const inventory: DeletionInventory = {
    storage: [],
    user_image_object_ids: [],
    image_object_ref_ids: [],
    quarantine_ids: [],
    reservation_ids: ["reservation-1"],
  };
  let firstList = true;
  const deletionEvents: string[] = [];
  const adapter: DeletionAdapter = {
    now: () => new Date("2026-07-16T12:30:00.000Z"),
    delay: async () => {
      deletionEvents.push("poll");
    },
    setState: async (state) => {
      deletionEvents.push(`state:${state}`);
    },
    cleanupKnownStagingPaths: async () => {
      storage.delete(STAGING_PATH);
      deletionEvents.push("known-path-delete");
      knownPathDeleted.resolve();
    },
    drainNonterminalObjects: async () => {
      deletionEvents.push("drain-nonterminal");
    },
    listScope: async () => {
      if (firstList) {
        firstList = false;
        // The final re-list starts only after the previously claimed handler
        // resumes and makes its late bytes visible.
        await putLanded.promise;
      }
      deletionEvents.push(`list:${storage.size}`);
      return [...storage];
    },
    recordStableZero: async () => {},
    releaseOwnedTables: async () => {
      deletionEvents.push("release-tables");
    },
    buildInventory: async () => inventory,
    removeStorageObjects: async () => {
      storage.clear();
    },
    deleteAuthUser: async () => {
      deletionEvents.push("delete-auth");
    },
    cleanupPerUserRows: async () => {},
  };
  const deletionRow = {
    user_id: USER_ID,
    state: "draining" as const,
    quiesce_after: "2026-07-16T12:00:00.000Z",
    inventory: null,
  };
  const firstDeletion = advanceAccountDeletion(deletionRow, adapter);
  await knownPathDeleted.promise;
  events.push("freeze-and-known-path-delete");
  resumePut.resolve();
  assertEquals(await firstDeletion, {
    deleted: false,
    pending: true,
    state: "draining",
  });
  assertEquals(storage.has(STAGING_PATH), true);
  assertEquals(deletionEvents.includes("delete-auth"), false);

  // Retry removes the now-discoverable late object, observes two empty lists,
  // and only then crosses the Auth deletion boundary.
  const secondDeletion = await advanceAccountDeletion(deletionRow, adapter);
  assertEquals(secondDeletion.deleted, true);
  assertEquals(storage.size, 0);
  assertEquals(
    deletionEvents.filter((event) => event === "delete-auth").length,
    1,
  );

  returnPutResponse.resolve();
  const handlerResponse = await handlerPromise;
  assertEquals(handlerResponse.status, 409);
  assertEquals(events, [
    "claim-generation-2",
    "put-paused-after-claim",
    "freeze-and-known-path-delete",
    "late-put-landed",
    "finish-sees-tombstone",
    "edge-cleanup-delete",
  ]);
});

Deno.test("paused approved PUT is drained after the durable writer bound before account inventory", async () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const approvedPutEntered = deferred();
  const resumeApprovedPut = deferred();
  const approvedPath = `approved/${USER_ID}/${await sha256Hex(
    new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
  )}.jpg`;
  const storage = new Set<string>([`image-staging:${STAGING_PATH}`]);
  const events: string[] = [];
  let promoting = false;

  const client = fakeClient({
    cached: { verdict: "pass", likelihoods: unlikely },
    rpc: async (name) => {
      if (
        name === "fn_assert_stage_moderatable" ||
        name === "fn_debit_image_compute"
      ) {
        return { data: true, error: null };
      }
      if (name === "fn_begin_image_promotion") {
        promoting = true;
        events.push("promotion-row-created");
        return {
          data: { object_id: OBJECT_ID, state: "promoting", needs_copy: true },
          error: null,
        };
      }
      if (name === "fn_finish_image_promotion") {
        events.push("promotion-finish-blocked-by-tombstone");
        return { data: null, error: { message: "account_deleting" } };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const canonical = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    canonicalize: async () => ({
      data: canonical,
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
    }),
    fetchImpl: async (input, init) => {
      const method = String(init?.method);
      if (method === "GET") {
        return new Response(pngHeader().slice().buffer as ArrayBuffer, {
          status: 200,
        });
      }
      if (method === "POST") {
        assert(String(input).includes(`/entry-photos/${approvedPath}`));
        events.push("approved-put-paused");
        approvedPutEntered.resolve();
        await resumeApprovedPut.promise;
        storage.add(`entry-photos:${approvedPath}`);
        events.push("approved-put-landed");
        return new Response(null, { status: 201 });
      }
      throw new Error(`Unexpected Storage method ${method}`);
    },
  });
  const handlerPromise = handler(request(
    "moderate",
    JSON.stringify({ staging_path: STAGING_PATH, kind: "entry_photo" }),
  ));
  await approvedPutEntered.promise;

  let now = new Date("2026-07-16T11:59:00.000Z");
  const deletionEvents: string[] = [];
  const emptyInventory: DeletionInventory = {
    storage: [],
    user_image_object_ids: [],
    image_object_ref_ids: [],
    quarantine_ids: [],
    reservation_ids: [],
  };
  const adapter: DeletionAdapter = {
    now: () => now,
    delay: async () => {
      deletionEvents.push("poll");
    },
    setState: async (state) => {
      deletionEvents.push(`state:${state}`);
    },
    cleanupKnownStagingPaths: async () => {
      storage.delete(`image-staging:${STAGING_PATH}`);
      deletionEvents.push("cleanup-staging");
    },
    drainNonterminalObjects: async () => {
      deletionEvents.push("drain-nonterminal");
      if (promoting) {
        storage.delete(`entry-photos:${approvedPath}`);
        promoting = false;
      }
    },
    listScope: async ({ bucket, prefix }) =>
      [...storage]
        .filter((key) => key.startsWith(`${bucket}:${prefix}/`))
        .map((key) => key.slice(bucket.length + 1)),
    recordStableZero: async () => {},
    releaseOwnedTables: async () => {},
    buildInventory: async () => emptyInventory,
    removeStorageObjects: async () => {},
    deleteAuthUser: async () => {
      deletionEvents.push("delete-auth");
    },
    cleanupPerUserRows: async () => {},
  };
  const deletionRow = {
    user_id: USER_ID,
    state: "draining" as const,
    // Represents fn_freeze_account_deletion deriving the bound from the
    // originating staged reservation before it marks it cleanup_required.
    quiesce_after: "2026-07-16T12:00:00.000Z",
    inventory: null,
  };

  const beforeBound = await advanceAccountDeletion(deletionRow, adapter);
  assertEquals(beforeBound, {
    deleted: false,
    pending: true,
    state: "draining",
  });
  assertEquals(deletionEvents.includes("drain-nonterminal"), false);
  assertEquals(deletionEvents.includes("delete-auth"), false);

  resumeApprovedPut.resolve();
  const handlerResponse = await handlerPromise;
  assertEquals(handlerResponse.status >= 400, true);
  assertEquals(storage.has(`entry-photos:${approvedPath}`), true);

  now = new Date("2026-07-16T12:30:00.000Z");
  const afterBound = await advanceAccountDeletion(deletionRow, adapter);
  assertEquals(afterBound, { deleted: true, pending: false, state: "done" });
  assertEquals(storage.size, 0);
  assertEquals(promoting, false);
  assertEquals(
    deletionEvents.indexOf("drain-nonterminal") <
      deletionEvents.indexOf("delete-auth"),
    true,
  );
  assertEquals(events, [
    "promotion-row-created",
    "approved-put-paused",
    "approved-put-landed",
    "promotion-finish-blocked-by-tombstone",
  ]);
});

Deno.test("finish_stage false Content-Length cannot bypass 5 MiB byte cap and cleanup runs", async () => {
  const rpcNames: string[] = [];
  const client = fakeClient({
    rpc: async (name) => {
      rpcNames.push(name);
      return { data: true, error: null };
    },
  });
  const storageMethods: string[] = [];
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    fetchImpl: async (_input, init) => {
      storageMethods.push(String(init?.method));
      return new Response(null, { status: 200 });
    },
  });
  const oversized = new Uint8Array(MAX_STAGE_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  const response = await handler(request(
    "finish_stage",
    oversized.slice().buffer as ArrayBuffer,
    "image/jpeg",
    `&staging_path=${encodeURIComponent(STAGING_PATH)}&generation=1`,
    { "Content-Length": "1" },
  ));
  assertEquals(response.status, 413);
  assertEquals(storageMethods, ["DELETE"]);
  assertEquals(rpcNames.includes("fn_claim_stage_put"), false);
  assertEquals(rpcNames[0], "fn_mark_stage_write_failed");
});

Deno.test("stale oversized finish_stage cannot delete current-generation bytes", async () => {
  const client = fakeClient({
    rpc: async (name) => {
      assertEquals(name, "fn_mark_stage_write_failed");
      return { data: null, error: { message: "stage_finish_conflict" } };
    },
  });
  let storageCalled = false;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    fetchImpl: async () => {
      storageCalled = true;
      return new Response(null, { status: 200 });
    },
  });
  const oversized = new Uint8Array(MAX_STAGE_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  const response = await handler(request(
    "finish_stage",
    oversized.slice().buffer as ArrayBuffer,
    "image/jpeg",
    `&staging_path=${encodeURIComponent(STAGING_PATH)}&generation=1`,
  ));
  assertEquals(response.status, 413);
  assertEquals(storageCalled, false);
});

Deno.test("moderate scans and publishes the identical canonical bytes, then discards staging", async () => {
  const events: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = fakeClient({
    rpc: async (name, args) => {
      events.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      const data: Record<string, unknown> = {
        fn_assert_stage_moderatable: { state: "staged" },
        fn_debit_image_compute: { user_used: 1, project_used: 1 },
        fn_acquire_scan_lease: { fencing_token: 4 },
        fn_debit_scan_budget: { ledger_id: LEDGER_ID },
        fn_commit_image_verdict: { committed: true },
        fn_record_scan_result: true,
        fn_begin_image_promotion: {
          object_id: OBJECT_ID,
          state: "promoting",
          needs_copy: true,
        },
        fn_finish_image_promotion: { object_id: OBJECT_ID, state: "approved" },
        fn_mark_stage_consumed: true,
      };
      if (!(name in data)) throw new Error(`Unexpected RPC ${name}`);
      return { data: data[name], error: null };
    },
  });

  const staged = pngHeader();
  const canonicalBytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0x11,
    0x22,
    0xff,
    0xd9,
  ]);
  const canonical: CanonicalImage = {
    data: canonicalBytes,
    mimeType: "image/jpeg",
    width: 1,
    height: 1,
  };
  let providerBytes: Uint8Array | null = null;
  let publishedBytes: Uint8Array | null = null;
  const storageMethods: string[] = [];
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    canonicalize: async () => canonical,
    scan: async (bytes) => {
      events.push("vision");
      providerBytes = bytes;
      return { verdict: "pass", likelihoods: unlikely, providerCalled: true };
    },
    fetchImpl: async (input, init) => {
      const method = String(init?.method);
      storageMethods.push(method);
      events.push(`storage:${method}`);
      if (method === "GET") {
        return new Response(staged.slice().buffer as ArrayBuffer, {
          status: 200,
        });
      }
      if (method === "POST") {
        assert(String(input).includes("/entry-photos/approved/"));
        publishedBytes = new Uint8Array(init?.body as ArrayBuffer);
        assertEquals(new Headers(init?.headers).get("x-upsert"), "false");
        return new Response(null, { status: 201 });
      }
      if (method === "DELETE") return new Response(null, { status: 200 });
      throw new Error(`Unexpected Storage method ${method}`);
    },
  });

  const response = await handler(request(
    "moderate",
    JSON.stringify({ staging_path: STAGING_PATH, kind: "entry_photo" }),
  ));
  const expectedSha = await sha256Hex(canonicalBytes);
  assertEquals(response.status, 200);
  assertEquals(providerBytes, canonicalBytes);
  assertEquals(publishedBytes, canonicalBytes);
  assert(
    events.indexOf("rpc:fn_debit_image_compute") <
      events.indexOf("storage:GET"),
  );
  assertEquals(storageMethods, ["GET", "POST", "DELETE"]);
  assertEquals(await response.json(), {
    data: {
      approved_url:
        `https://project.supabase.co/storage/v1/object/public/entry-photos/approved/${USER_ID}/${expectedSha}.jpg`,
      storage_path: `approved/${USER_ID}/${expectedSha}.jpg`,
      bucket: "entry-photos",
      sha256: expectedSha,
      verdict: "pass",
    },
  });

  const promotion = rpcCalls.find((call) =>
    call.name === "fn_begin_image_promotion"
  );
  assertEquals(promotion?.args.p_storage_path, undefined);
  assertEquals(
    promotion?.args.p_public_url,
    `https://project.supabase.co/storage/v1/object/public/entry-photos/approved/${USER_ID}/${expectedSha}.jpg`,
  );
  const debit = rpcCalls.find((call) => call.name === "fn_debit_scan_budget");
  assertEquals(debit?.args.p_scope, "general");
  const ledger = rpcCalls.find((call) => call.name === "fn_record_scan_result");
  assertEquals(ledger?.args.p_outcome, "pass");
  assertEquals(typeof ledger?.args.p_provider_call_marker, "string");
});

Deno.test("fresh provider rejection records the paid attempt and makes staged bytes unreachable", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = fakeClient({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      const data: Record<string, unknown> = {
        fn_assert_stage_moderatable: { state: "staged" },
        fn_debit_image_compute: { user_used: 1, project_used: 1 },
        fn_acquire_scan_lease: { fencing_token: 9 },
        fn_debit_scan_budget: { ledger_id: LEDGER_ID },
        fn_commit_image_verdict: { committed: true },
        fn_record_scan_result: true,
        fn_mark_stage_consumed: true,
      };
      if (!(name in data)) throw new Error(`Unexpected RPC ${name}`);
      return { data: data[name], error: null };
    },
  });
  const canonicalBytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0x44,
    0x55,
    0xff,
    0xd9,
  ]);
  const rejectedLikelihoods = { ...unlikely, adult: "LIKELY" as const };
  let providerBytes: Uint8Array | null = null;
  const storageMethods: string[] = [];
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    canonicalize: async () => ({
      data: canonicalBytes,
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
    }),
    scan: async (bytes) => {
      providerBytes = bytes;
      return {
        verdict: "rejected",
        likelihoods: rejectedLikelihoods,
        providerCalled: true,
      };
    },
    fetchImpl: async (_input, init) => {
      const method = String(init?.method);
      storageMethods.push(method);
      if (method === "GET") {
        return new Response(pngHeader().slice().buffer as ArrayBuffer, {
          status: 200,
        });
      }
      if (method === "DELETE") return new Response(null, { status: 200 });
      throw new Error(`Rejected bytes reached unexpected Storage ${method}`);
    },
  });

  const response = await handler(request(
    "moderate",
    JSON.stringify({ staging_path: STAGING_PATH, kind: "avatar" }),
  ));
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "MODERATION_REJECTED");
  assertEquals(providerBytes, canonicalBytes);
  assertEquals(storageMethods, ["GET", "DELETE"]);
  assertEquals(
    rpcCalls.some((call) => call.name === "fn_begin_image_promotion"),
    false,
  );
  const committed = rpcCalls.find((call) =>
    call.name === "fn_commit_image_verdict"
  );
  assertEquals(committed?.args.p_verdict, "rejected");
  assertEquals(committed?.args.p_likelihoods, rejectedLikelihoods);
  const ledger = rpcCalls.find((call) => call.name === "fn_record_scan_result");
  assertEquals(ledger?.args.p_outcome, "rejected");
  assertEquals(typeof ledger?.args.p_provider_call_marker, "string");
  assertEquals(
    rpcCalls.some((call) => call.name === "fn_mark_stage_consumed"),
    true,
  );
});

Deno.test("moderate maps cross-user/non-staged reservation to a closed error before download", async () => {
  const client = fakeClient({
    rpc: async (name) => {
      assertEquals(name, "fn_assert_stage_moderatable");
      return { data: null, error: { message: "stage_not_moderatable" } };
    },
  });
  let storageCalled = false;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    fetchImpl: async () => {
      storageCalled = true;
      return new Response(null, { status: 500 });
    },
  });
  const response = await handler(request(
    "moderate",
    JSON.stringify({ staging_path: `${USER_ID}-other/file`, kind: "avatar" }),
  ));
  assertEquals(response.status, 409);
  assertEquals(storageCalled, false);
  assertEquals((await response.json()).error.code, "STAGING_NOT_READY");
});

Deno.test("pixel bomb consumes compute but never paid scan budget or decoder/provider work", async () => {
  const rpcNames: string[] = [];
  const client = fakeClient({
    rpc: async (name) => {
      rpcNames.push(name);
      if (
        name === "fn_assert_stage_moderatable" ||
        name === "fn_debit_image_compute"
      ) {
        return { data: true, error: null };
      }
      if (name === "fn_mark_stage_consumed") return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  let canonicalCalled = false;
  let providerCalled = false;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    canonicalize: async () => {
      canonicalCalled = true;
      return null;
    },
    scan: async () => {
      providerCalled = true;
      throw new Error("must not run");
    },
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return new Response(
          pngHeader(10_000, 10_000).slice().buffer as ArrayBuffer,
          { status: 200 },
        );
      }
      return new Response(null, { status: 200 });
    },
  });
  const response = await handler(request(
    "moderate",
    JSON.stringify({ staging_path: STAGING_PATH, kind: "avatar" }),
  ));
  assertEquals(response.status, 422);
  assertEquals(rpcNames.slice(0, 2), [
    "fn_assert_stage_moderatable",
    "fn_debit_image_compute",
  ]);
  assertEquals(rpcNames.includes("fn_debit_scan_budget"), false);
  assertEquals(canonicalCalled, false);
  assertEquals(providerCalled, false);
});

Deno.test("deterministic transcode failure consumes compute only, even on retry", async () => {
  const rpcNames: string[] = [];
  const client = fakeClient({
    rpc: async (name) => {
      rpcNames.push(name);
      if (
        name === "fn_assert_stage_moderatable" ||
        name === "fn_debit_image_compute"
      ) {
        return { data: true, error: null };
      }
      if (name === "fn_mark_stage_consumed") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  let transcodeAttempts = 0;
  let providerCalled = false;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    canonicalize: async () => {
      transcodeAttempts += 1;
      return null;
    },
    scan: async () => {
      providerCalled = true;
      throw new Error("must not run");
    },
    fetchImpl: async (_input, init) =>
      init?.method === "GET"
        ? new Response(pngHeader().slice().buffer as ArrayBuffer, {
          status: 200,
        })
        : new Response(null, { status: 200 }),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await handler(request(
      "moderate",
      JSON.stringify({ staging_path: STAGING_PATH, kind: "avatar" }),
    ));
    assertEquals(response.status, 422);
  }
  assertEquals(transcodeAttempts, 2);
  assertEquals(providerCalled, false);
  assertEquals(
    rpcNames.filter((name) => name === "fn_debit_image_compute").length,
    2,
  );
  assertEquals(rpcNames.includes("fn_debit_scan_budget"), false);
});

Deno.test("cached rejection skips paid debit/provider/promotion and cleans private staging", async () => {
  const rpcNames: string[] = [];
  const storageMethods: string[] = [];
  const client = fakeClient({
    cached: {
      verdict: "rejected",
      likelihoods: { ...unlikely, adult: "LIKELY" },
    },
    rpc: async (name) => {
      rpcNames.push(name);
      if (
        name === "fn_assert_stage_moderatable" ||
        name === "fn_debit_image_compute"
      ) {
        return { data: true, error: null };
      }
      if (name === "fn_mark_stage_consumed") return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  let providerCalled = false;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    canonicalize: async () => ({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
    }),
    scan: async () => {
      providerCalled = true;
      throw new Error("must not run");
    },
    fetchImpl: async (_input, init) => {
      const method = String(init?.method);
      storageMethods.push(method);
      return method === "GET"
        ? new Response(pngHeader().slice().buffer as ArrayBuffer, {
          status: 200,
        })
        : new Response(null, { status: 200 });
    },
  });
  const response = await handler(request(
    "moderate",
    JSON.stringify({ staging_path: STAGING_PATH, kind: "avatar" }),
  ));
  assertEquals(response.status, 403);
  assertEquals(providerCalled, false);
  assertEquals(rpcNames.includes("fn_debit_scan_budget"), false);
  assertEquals(rpcNames.includes("fn_begin_image_promotion"), false);
  assertEquals(storageMethods, ["GET", "DELETE"]);
  assertEquals(rpcNames.includes("fn_mark_stage_consumed"), true);
});

Deno.test("same-hash cache pass dedupes paid scan and still creates independent object", async () => {
  const rpcNames: string[] = [];
  const client = fakeClient({
    cached: { verdict: "pass", likelihoods: unlikely },
    rpc: async (name) => {
      rpcNames.push(name);
      if (
        name === "fn_assert_stage_moderatable" ||
        name === "fn_debit_image_compute"
      ) {
        return { data: true, error: null };
      }
      if (name === "fn_begin_image_promotion") {
        return {
          data: { object_id: OBJECT_ID, state: "promoting", needs_copy: true },
          error: null,
        };
      }
      if (name === "fn_finish_image_promotion") {
        return {
          data: { object_id: OBJECT_ID, state: "approved" },
          error: null,
        };
      }
      if (name === "fn_mark_stage_consumed") return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  let providerCalled = false;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    canonicalize: async () => ({
      data: new Uint8Array([4, 5, 6]),
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
    }),
    scan: async () => {
      providerCalled = true;
      throw new Error("must not run");
    },
    fetchImpl: async (_input, init) =>
      init?.method === "GET"
        ? new Response(pngHeader().slice().buffer as ArrayBuffer, {
          status: 200,
        })
        : new Response(null, { status: init?.method === "POST" ? 201 : 200 }),
  });
  const response = await handler(request(
    "moderate",
    JSON.stringify({ staging_path: STAGING_PATH, kind: "entry_photo" }),
  ));
  assertEquals(response.status, 200);
  assertEquals(providerCalled, false);
  assertEquals(rpcNames.includes("fn_acquire_scan_lease"), false);
  assertEquals(rpcNames.includes("fn_debit_scan_budget"), false);
  assertEquals(rpcNames.includes("fn_begin_image_promotion"), true);
});

Deno.test("identical canonical bytes for two users make one paid provider call and two owned objects", async () => {
  const users = [
    "10000000-0000-4000-8000-000000000011",
    "10000000-0000-4000-8000-000000000012",
  ];
  const canonical = new Uint8Array([0xff, 0xd8, 9, 8, 7, 0xff, 0xd9]);
  const expectedSha = await sha256Hex(canonical);
  let cache: { verdict: "pass"; likelihoods: SafeSearchLikelihoods } | null =
    null;
  let nextClient = 0;
  let providerCalls = 0;
  let paidDebits = 0;
  const promoted: Array<{ userId: string; sha256: string; url: string }> = [];

  const clientFor = (userId: string) => ({
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    from: (table: string) => {
      assertEquals(table, "image_hash_verdicts");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: cache, error: null }),
          }),
        }),
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (
        name === "fn_assert_stage_moderatable" ||
        name === "fn_debit_image_compute" ||
        name === "fn_mark_stage_consumed" ||
        name === "fn_record_scan_result"
      ) {
        return { data: true, error: null };
      }
      if (name === "fn_acquire_scan_lease") {
        return { data: { fencing_token: 1 }, error: null };
      }
      if (name === "fn_debit_scan_budget") {
        paidDebits += 1;
        return { data: { ledger_id: LEDGER_ID }, error: null };
      }
      if (name === "fn_commit_image_verdict") {
        cache = { verdict: "pass", likelihoods: unlikely };
        return { data: { committed: true }, error: null };
      }
      if (name === "fn_begin_image_promotion") {
        promoted.push({
          userId: String(args.p_user_id),
          sha256: String(args.p_sha256),
          url: String(args.p_public_url),
        });
        return {
          data: {
            object_id: `${OBJECT_ID.slice(0, -1)}${promoted.length}`,
            state: "promoting",
            needs_copy: true,
          },
          error: null,
        };
      }
      if (name === "fn_finish_image_promotion") {
        return { data: { state: "approved" }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });

  const handler = createModerateImageHandler({
    createSupabase: () => clientFor(users[nextClient++]),
    env,
    canonicalize: async () => ({
      data: canonical,
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
    }),
    scan: async () => {
      providerCalls += 1;
      return { verdict: "pass", likelihoods: unlikely, providerCalled: true };
    },
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return new Response(pngHeader().slice().buffer as ArrayBuffer, {
          status: 200,
        });
      }
      return new Response(null, {
        status: init?.method === "POST" ? 201 : 200,
      });
    },
  });

  for (let index = 0; index < users.length; index += 1) {
    const response = await handler(request(
      "moderate",
      JSON.stringify({
        staging_path: `${users[index]}/10000000-0000-4000-8000-000000000099`,
        kind: "avatar",
      }),
    ));
    assertEquals(response.status, 200);
  }

  assertEquals(providerCalls, 1);
  assertEquals(paidDebits, 1);
  assertEquals(promoted.length, 2);
  assertEquals(promoted.map((row) => row.userId), users);
  assertEquals(promoted.every((row) => row.sha256 === expectedSha), true);
  assertEquals(promoted[0].url.includes(`/approved/${users[0]}/`), true);
  assertEquals(promoted[1].url.includes(`/approved/${users[1]}/`), true);
});

Deno.test("moderate rejects client-supplied destination before any RPC", async () => {
  let rpcCalled = false;
  const client = fakeClient({
    rpc: async () => {
      rpcCalled = true;
      return { data: true, error: null };
    },
  });
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
  });
  const response = await handler(request(
    "moderate",
    JSON.stringify({
      staging_path: STAGING_PATH,
      kind: "avatar",
      bucket: "entry-photos",
    }),
  ));
  assertEquals(response.status, 400);
  assertEquals(rpcCalled, false);
  const body = await response.json();
  assertEquals(body.error.code, "CLIENT_DESTINATION_FORBIDDEN");
});

Deno.test("moderate propagates one outer deadline through the staging download", async () => {
  const client = fakeClient({
    rpc: async (name) => {
      if (
        name === "fn_assert_stage_moderatable" ||
        name === "fn_debit_image_compute"
      ) {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  let observedSignal: AbortSignal | null = null;
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    moderationDeadlineMs: 5,
    fetchImpl: (_input, init) =>
      new Promise((_resolve, reject) => {
        observedSignal = init?.signal as AbortSignal;
        observedSignal.addEventListener("abort", () =>
          reject(observedSignal?.reason), { once: true });
      }),
  });
  const response = await handler(request(
    "moderate",
    JSON.stringify({ staging_path: STAGING_PATH, kind: "avatar" }),
  ));
  assert(observedSignal instanceof AbortSignal);
  assertEquals(observedSignal.aborted, true);
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "MODERATION_TIMEOUT");
});

Deno.test("grandfather helper rejects foreign URLs before compute or network", async () => {
  let rpcCalled = false;
  let fetchCalled = false;
  await assertRejects(
    () =>
      moderateOwnedStorageObject({
        client: {
          rpc: async () => {
            rpcCalled = true;
            return { data: true, error: null };
          },
        },
        supabaseUrl: "https://project.supabase.co",
        serviceKey: "service-role-key",
        visionApiKey: "vision-key",
        userId: USER_ID,
        sourceBucket: "avatars",
        sourcePath: "https://foreign.example/avatar.jpg",
        kind: "avatar",
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response(null, { status: 200 });
        },
      }),
    Error,
    "owned local object",
  );
  assertEquals(rpcCalled, false);
  assertEquals(fetchCalled, false);
});

Deno.test("grandfather helper uses the fenced sweep pool and promotes owned local bytes", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = fakeClient({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      const data: Record<string, unknown> = {
        fn_debit_image_compute: true,
        fn_acquire_scan_lease: { acquired: true, fencing_token: 12 },
        fn_debit_scan_budget: { ledger_id: LEDGER_ID },
        fn_commit_image_verdict: { committed: true },
        fn_record_scan_result: true,
        fn_begin_image_promotion: {
          object_id: OBJECT_ID,
          state: "promoting",
          needs_copy: true,
        },
        fn_finish_image_promotion: { object_id: OBJECT_ID, state: "approved" },
      };
      if (!(name in data)) throw new Error(`Unexpected RPC ${name}`);
      return { data: data[name], error: null };
    },
  });
  const result = await moderateOwnedStorageObject({
    client,
    supabaseUrl: "https://project.supabase.co",
    serviceKey: "service-role-key",
    visionApiKey: "vision-key",
    userId: USER_ID,
    sourceBucket: "avatars",
    sourcePath: `${USER_ID}/legacy.jpg`,
    kind: "avatar",
    canonicalize: async () => ({
      data: new Uint8Array([7, 7, 7]),
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
    }),
    scan: async () => ({
      verdict: "pass",
      likelihoods: unlikely,
      providerCalled: true,
    }),
    fetchImpl: async (_input, init) =>
      init?.method === "GET"
        ? new Response(pngHeader().slice().buffer as ArrayBuffer, {
          status: 200,
        })
        : new Response(null, { status: 201 }),
  });
  assertEquals(result.verdict, "pass");
  assertEquals(
    rpcCalls.find((call) => call.name === "fn_debit_scan_budget")?.args.p_scope,
    "sweep",
  );
  assertEquals(
    rpcCalls.some((call) => call.name === "fn_begin_image_promotion"),
    true,
  );
});

Deno.test("canary requires the dedicated token before spending its reserved pool", async () => {
  let authenticated = false;
  const client = fakeClient({});
  client.auth.getUser = async () => {
    authenticated = true;
    return { data: { user: { id: USER_ID } }, error: null };
  };
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
  });
  const response = await handler(request("canary", JSON.stringify({})));
  assertEquals(response.status, 403);
  assertEquals(authenticated, false);
});

Deno.test("canary fails closed when the dedicated token is not configured", async () => {
  let authenticated = false;
  const client = fakeClient({});
  client.auth.getUser = async () => {
    authenticated = true;
    return { data: { user: { id: USER_ID } }, error: null };
  };
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env: (name) => name === "MODERATION_CRON_TOKEN" ? undefined : env(name),
  });
  const response = await handler(request("canary", JSON.stringify({})));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "CANARY_NOT_CONFIGURED");
  assertEquals(authenticated, false);
});

Deno.test("canary asserts post-canonical uniqueness and provider-call marker", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = fakeClient({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "fn_acquire_scan_lease") {
        return { data: { fencing_token: 1 }, error: null };
      }
      if (name === "fn_debit_scan_budget") {
        return { data: { ledger_id: LEDGER_ID }, error: null };
      }
      if (name === "fn_commit_image_verdict") {
        return { data: { committed: true }, error: null };
      }
      if (name === "fn_record_scan_result") return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const canaryBytes = new Uint8Array([9, 8, 7, 6]);
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    generateCanary: async () => ({
      data: canaryBytes,
      mimeType: "image/jpeg",
      width: 2000,
      height: 2000,
    }),
    scan: async (bytes) => {
      assertEquals(bytes, canaryBytes);
      return { verdict: "pass", likelihoods: unlikely, providerCalled: true };
    },
  });
  const response = await handler(request(
    "canary",
    JSON.stringify({}),
    "application/json",
    "",
    { "x-moderation-cron-token": "dedicated-cron-token" },
  ));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.provider_called, true);
  assertEquals(body.data.cache_hit, false);
  assertEquals(body.data.canonical_pixels, 4_000_000);
  assertEquals(
    rpcCalls.find((call) => call.name === "fn_debit_scan_budget")?.args.p_scope,
    "canary",
  );
  assertEquals(
    typeof rpcCalls.find((call) => call.name === "fn_commit_image_verdict")
      ?.args.p_provider_call_marker,
    "string",
  );
});

Deno.test("canary fails once on a post-canonical collision without allocating retry frames", async () => {
  let generated = 0;
  let providerCalls = 0;
  const handler = createModerateImageHandler({
    createSupabase: () =>
      fakeClient({ cached: { verdict: "pass", likelihoods: unlikely } }),
    env,
    generateCanary: async () => {
      generated += 1;
      return {
        data: new Uint8Array([1, 2, 3, 4]),
        mimeType: "image/jpeg",
        width: 2000,
        height: 2000,
      };
    },
    scan: async () => {
      providerCalls += 1;
      return { verdict: "pass", likelihoods: unlikely, providerCalled: true };
    },
  });

  const response = await handler(request(
    "canary",
    JSON.stringify({}),
    "application/json",
    "",
    { "x-moderation-cron-token": "dedicated-cron-token" },
  ));

  assertEquals(response.status, 500);
  assertEquals((await response.json()).error.code, "CANARY_NOT_UNIQUE");
  assertEquals(generated, 1);
  assertEquals(providerCalls, 0);
});

Deno.test("canary provider failure is non-success and never emits a false terminal marker", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = fakeClient({
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "fn_acquire_scan_lease") {
        return { data: { fencing_token: 17 }, error: null };
      }
      if (name === "fn_debit_scan_budget") {
        return { data: { ledger_id: LEDGER_ID }, error: null };
      }
      if (
        name === "fn_record_scan_result" || name === "fn_release_scan_lease"
      ) {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const handler = createModerateImageHandler({
    createSupabase: () => client,
    env,
    generateCanary: async () => ({
      data: new Uint8Array([4, 3, 2, 1]),
      mimeType: "image/jpeg",
      width: 2000,
      height: 2000,
    }),
    scan: async () => {
      throw new VisionSafeSearchError(
        "provider_http",
        "injected Vision failure",
      );
    },
  });

  const response = await handler(request(
    "canary",
    JSON.stringify({}),
    "application/json",
    "",
    { "x-moderation-cron-token": "dedicated-cron-token" },
  ));
  const body = await response.json();

  assertEquals(response.status, 503);
  assertEquals(body.error.code, "VISION_UNAVAILABLE");
  assertEquals(body.data, undefined);
  assertEquals(
    rpcCalls.some((call) => call.name === "fn_commit_image_verdict"),
    false,
  );
  const ledger = rpcCalls.find((call) => call.name === "fn_record_scan_result");
  assertEquals(ledger?.args.p_outcome, "provider_error");
  assertEquals(typeof ledger?.args.p_provider_call_marker, "string");
});
