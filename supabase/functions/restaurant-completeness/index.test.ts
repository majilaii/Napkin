import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { CompletenessWorkerBackend } from "./_worker.ts";
import { createRestaurantCompletenessHandler } from "./index.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";
const RESTAURANT = "00000000-0000-4000-8000-000000000002";
const NONCE = "00000000-0000-4000-8000-000000000003";
const ITEM = "00000000-0000-4000-8000-000000000004";

function environment(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "runtime-service-role-secret",
    COMPLETENESS_SERVICE_ROLE_KEY: "caller-service-secret",
    COMPLETENESS_CRON_SECRET: "cron-secret",
    COMPLETENESS_WORKER_ENABLED: "false",
    ...overrides,
  };
  return (name: string) => values[name];
}

function request(
  action: string | null,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Request {
  const query = action ? `?action=${action}` : "";
  return new Request(
    `https://test.supabase.co/functions/v1/restaurant-completeness${query}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}

function cronHeaders() {
  return {
    apikey: "caller-service-secret",
    "x-completeness-cron": "cron-secret",
  };
}

function fakeSupabase(userId = OWNER) {
  return {
    auth: {
      getUser: async (token: string) =>
        token === "owner-jwt"
          ? { data: { user: { id: userId } }, error: null }
          : { data: { user: null }, error: new Error("bad token") },
    },
  };
}

Deno.test("cron secret is required even while the worker is default-disabled", async () => {
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
  });
  const response = await handler(request(null, {}, {
    apikey: "caller-service-secret",
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHORIZED");
});

Deno.test("cron caller key is independently pinned from the runtime DB key", async () => {
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
  });
  const response = await handler(request(null, {}, {
    apikey: "runtime-service-role-secret",
    "x-completeness-cron": "cron-secret",
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHORIZED");
});

Deno.test("cron caller key is rejected when sent as a bearer token", async () => {
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
  });
  const response = await handler(request(null, {}, {
    Authorization: "Bearer caller-service-secret",
    "x-completeness-cron": "cron-secret",
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHORIZED");
});

Deno.test("cron caller key must match the pinned apikey", async () => {
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
  });
  const response = await handler(request(null, {}, {
    apikey: "wrong-caller-secret",
    "x-completeness-cron": "cron-secret",
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHORIZED");
});

Deno.test("configured cron credentials tolerate secret-store whitespace", async () => {
  const handler = createRestaurantCompletenessHandler({
    env: environment({
      COMPLETENESS_SERVICE_ROLE_KEY: "  caller-service-secret  ",
      COMPLETENESS_CRON_SECRET: "  cron-secret  ",
    }),
    createSupabase: () => fakeSupabase(),
  });
  const response = await handler(request(null, {}, cronHeaders()));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).data.enabled, false);
});

Deno.test("runtime DB client keeps the hosted service-role credential", async () => {
  let createdWith: [string, string] | null = null;
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: (url, key) => {
      createdWith = [url, key];
      return fakeSupabase();
    },
  });
  const response = await handler(request(null, {}, cronHeaders()));
  assertEquals(response.status, 200);
  assertEquals(createdWith, [
    "https://test.supabase.co",
    "runtime-service-role-secret",
  ]);
});

Deno.test("default-disabled cron is inert 200 and performs no DB drain", async () => {
  let backendCreated = false;
  let drained = false;
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
    createBackend: () => {
      backendCreated = true;
      return {} as CompletenessWorkerBackend;
    },
    drain: async () => {
      drained = true;
      throw new Error("must stay inert");
    },
  });
  const response = await handler(request(null, {}, cronHeaders()));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.data.enabled, false);
  assertEquals(body.data.claimed, 0);
  assertEquals(backendCreated, false);
  assertEquals(drained, false);
});

Deno.test("deploy_gate requires the worker to be enabled", async () => {
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
  });
  const response = await handler(request("deploy_gate", {
    owner_id: OWNER,
    restaurant_id: RESTAURANT,
    import_nonce: NONCE,
  }, cronHeaders()));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "WORKER_DISABLED");
});

Deno.test("exhausted read derives owner from JWT and never from request body", async () => {
  let observedOwner = "";
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
    listExhausted: async (_supabase, ownerId) => {
      observedOwner = ownerId;
      return {
        items: [{
          id: ITEM,
          job_id: NONCE,
          item_nonce: NONCE,
          restaurant_id: null,
          // import_nonce carries the provenance the client needs to mint a
          // match correction; null here exercises the row shape where the
          // UI must HIDE "find it" rather than offer a call that can't be made.
          import_nonce: null,
          resolution_id: null,
          external_id: null,
          restaurant_name: "Kartuli",
          restaurant_city: "London",
          last_error: "ambiguous",
          created_at: "2026-07-16T12:00:00.000Z",
        }],
        next_cursor: null,
        has_more: false,
      };
    },
  });
  const response = await handler(request("exhausted", {
    owner_id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
  }, { Authorization: "Bearer owner-jwt" }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(observedOwner, OWNER);
  assertEquals(body.data.items[0].restaurant_name, "Kartuli");
});

Deno.test("exhausted read rejects malformed cursors before querying the queue", async () => {
  let listed = false;
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
    listExhausted: async () => {
      listed = true;
      return { items: [], next_cursor: null, has_more: false };
    },
  });
  const response = await handler(request("exhausted", {
    cursor: btoa("2026-07-16T12:00:00Z|not-a-uuid"),
  }, { Authorization: "Bearer owner-jwt" }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "INVALID_INPUT");
  assertEquals(listed, false);
});

Deno.test("retry passes JWT actor and item id to the owner-locking RPC adapter", async () => {
  let observed: [string, string] | null = null;
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
    retryExhausted: async (_supabase, actorId, itemId) => {
      observed = [actorId, itemId];
      return true;
    },
  });
  const response = await handler(request("retry", { item_id: ITEM }, {
    Authorization: "Bearer owner-jwt",
  }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(observed, [OWNER, ITEM]);
  assertEquals(body.data, { item_id: ITEM, state: "pending" });
});

Deno.test("dismiss passes only the JWT actor and durably retires the exhausted item", async () => {
  let observed: [string, string] | null = null;
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
    dismissExhausted: async (_supabase, actorId, itemId) => {
      observed = [actorId, itemId];
      return true;
    },
  });
  const response = await handler(request("dismiss", {
    item_id: ITEM,
    owner_id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
  }, { Authorization: "Bearer owner-jwt" }));
  assertEquals(response.status, 200);
  assertEquals(observed, [OWNER, ITEM]);
  assertEquals((await response.json()).data, {
    item_id: ITEM,
    state: "exhausted",
    dismissed: true,
  });
});

Deno.test("correct binds JWT actor, original item, and fresh resolution", async () => {
  let observed: [string, string, string] | null = null;
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
    correctExhausted: async (_supabase, actorId, itemId, resolutionId) => {
      observed = [actorId, itemId, resolutionId];
      return { item_id: itemId, resolution_id: resolutionId, state: "pending" };
    },
  });
  const response = await handler(request("correct", {
    item_id: ITEM,
    resolution_id: NONCE,
    owner_id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
  }, { Authorization: "Bearer owner-jwt" }));
  assertEquals(response.status, 200);
  assertEquals(observed, [OWNER, ITEM, NONCE]);
  assertEquals((await response.json()).data.state, "pending");
});

Deno.test("status derives owner from JWT and returns terminal destination identities", async () => {
  let observed: [string, string] | null = null;
  const handler = createRestaurantCompletenessHandler({
    env: environment(),
    createSupabase: () => fakeSupabase(),
    getStatus: async (_supabase, ownerId, jobId) => {
      observed = [ownerId, jobId];
      return {
        job_id: jobId,
        sealed: true,
        done_emitted: true,
        items: [{
          id: ITEM,
          item_nonce: NONCE,
          state: "resolved",
          restaurant_id: RESTAURANT,
          last_error: null,
          destinations: [{
            destination_nonce: NONCE,
            destination_kind: "wishlist",
            target_list_id: null,
            target_list_title: null,
            outcome: "fulfilled",
            result: { wishlist_id: ITEM, restaurant_id: RESTAURANT },
          }],
        }],
      };
    },
  });
  const response = await handler(request("status", {
    job_id: NONCE,
    owner_id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
  }, { Authorization: "Bearer owner-jwt" }));

  assertEquals(response.status, 200);
  assertEquals(observed, [OWNER, NONCE]);
  assertEquals(
    (await response.json()).data.items[0].destinations[0].result.wishlist_id,
    ITEM,
  );
});

Deno.test("enabled cron forwards bounded options to the drain", async () => {
  let observedOptions: Record<string, unknown> | undefined;
  const handler = createRestaurantCompletenessHandler({
    env: environment({ COMPLETENESS_WORKER_ENABLED: "true" }),
    createSupabase: () => fakeSupabase(),
    createBackend: () => ({} as CompletenessWorkerBackend),
    drain: async (_backend, options) => {
      observedOptions = options;
      return {
        worker_id: "worker-1",
        claimed: 0,
        processed: [],
        swept_jobs: 0,
      };
    },
  });
  const response = await handler(request("drain", {
    batch_limit: 12,
    sweep_limit: 20,
  }, cronHeaders()));
  assertEquals(response.status, 200);
  assertEquals(observedOptions, { batchLimit: 12, sweepLimit: 20 });
  assertEquals((await response.json()).data.enabled, true);
});

Deno.test("enabled deploy gate validates UUIDs and invokes the same backend gate", async () => {
  let gateInput: unknown = null;
  const handler = createRestaurantCompletenessHandler({
    env: environment({ COMPLETENESS_WORKER_ENABLED: "true" }),
    createSupabase: () => fakeSupabase(),
    createBackend: () => ({} as CompletenessWorkerBackend),
    deployGate: async (_backend, input) => {
      gateInput = input;
      return {
        job_id: NONCE,
        item_id: ITEM,
        restaurant_id: RESTAURANT,
        state: "verified",
      };
    },
  });
  const response = await handler(request("deploy_gate", {
    owner_id: OWNER,
    restaurant_id: RESTAURANT,
    import_nonce: NONCE,
  }, cronHeaders()));
  assertEquals(response.status, 200);
  assertEquals(gateInput, {
    owner_id: OWNER,
    restaurant_id: RESTAURANT,
    import_nonce: NONCE,
  });
  assertEquals((await response.json()).data.state, "verified");
});
