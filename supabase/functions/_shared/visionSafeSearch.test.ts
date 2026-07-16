import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifySafeSearch,
  resolveSafeSearchVerdict,
  SafeSearchLedgerError,
  type SafeSearchLikelihoods,
  scanSafeSearch,
  VisionSafeSearchError,
} from "./visionSafeSearch.ts";

const unlikely: SafeSearchLikelihoods = {
  adult: "VERY_UNLIKELY",
  violence: "UNLIKELY",
  racy: "POSSIBLE",
  medical: "VERY_UNLIKELY",
  spoof: "UNLIKELY",
};

Deno.test("classifySafeSearch applies the pinned thresholds", () => {
  assertEquals(classifySafeSearch(unlikely), "pass");
  assertEquals(
    classifySafeSearch({ ...unlikely, adult: "LIKELY" }),
    "rejected",
  );
  assertEquals(
    classifySafeSearch({ ...unlikely, violence: "VERY_LIKELY" }),
    "rejected",
  );
  assertEquals(classifySafeSearch({ ...unlikely, racy: "LIKELY" }), "pass");
  assertEquals(
    classifySafeSearch({ ...unlikely, racy: "VERY_LIKELY" }),
    "rejected",
  );
});

Deno.test("classifySafeSearch treats UNKNOWN as retryable, never terminal pass", () => {
  assertThrows(
    () => classifySafeSearch({ ...unlikely, spoof: "UNKNOWN" }),
    VisionSafeSearchError,
    "UNKNOWN",
  );
});

Deno.test("scanSafeSearch sends exact bytes to SAFE_SEARCH_DETECTION with a wired signal", async () => {
  const canonical = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  let called = false;
  const result = await scanSafeSearch(canonical, "dedicated-vision-key", {
    fetchImpl: async (input, init) => {
      called = true;
      assertStringIncludes(
        String(input),
        "vision.googleapis.com/v1/images:annotate",
      );
      assertStringIncludes(String(input), "key=dedicated-vision-key");
      assert(init?.signal instanceof AbortSignal);
      const body = JSON.parse(String(init?.body));
      assertEquals(body.requests[0].features, [{
        type: "SAFE_SEARCH_DETECTION",
        maxResults: 1,
      }]);
      assertEquals(
        atob(body.requests[0].image.content),
        String.fromCharCode(...canonical),
      );
      return new Response(
        JSON.stringify({
          responses: [{ safeSearchAnnotation: unlikely }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  assert(called);
  assertEquals(result, {
    verdict: "pass",
    likelihoods: unlikely,
    providerCalled: true,
  });
});

Deno.test("scanSafeSearch aborts the actual provider fetch at 8s-class deadline", async () => {
  const error = await assertRejects(
    () =>
      scanSafeSearch(new Uint8Array([1]), "vision-key", {
        timeoutMs: 5,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            assert(init?.signal instanceof AbortSignal);
            init.signal.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      }),
    VisionSafeSearchError,
  );
  assertEquals(error.code, "provider_timeout");
});

Deno.test("scanSafeSearch never exposes the API key from provider network errors", async () => {
  const secret = "vision-key-that-must-not-leak";
  const error = await assertRejects(
    () =>
      scanSafeSearch(new Uint8Array([1]), secret, {
        fetchImpl: (input) => {
          throw new TypeError(`network failure for ${String(input)}`);
        },
      }),
    VisionSafeSearchError,
  );
  assertEquals(error.code, "provider_network");
  assertEquals(error.message, "Vision request failed");
  assertEquals(error.message.includes(secret), false);
  assertEquals(error.message.includes("?key="), false);
});

Deno.test("scanSafeSearch rejects provider UNKNOWN without a terminal verdict", async () => {
  const error = await assertRejects(
    () =>
      scanSafeSearch(new Uint8Array([1]), "vision-key", {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              responses: [{
                safeSearchAnnotation: { ...unlikely, adult: "UNKNOWN" },
              }],
            }),
            { status: 200 },
          ),
      }),
    VisionSafeSearchError,
  );
  assertEquals(error.code, "provider_unknown");
});

function ledgerClient(options: {
  cached?:
    | { verdict: "pass" | "rejected"; likelihoods: SafeSearchLikelihoods }
    | null;
  calls?: Array<{ name: string; args: Record<string, unknown> }>;
}) {
  const calls = options.calls ?? [];
  return {
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "fn_acquire_scan_lease") {
        // Token-bearing legacy-compatible response, deliberately no
        // redundant acquired:true flag.
        return { data: { fencing_token: 9 }, error: null };
      }
      if (name === "fn_debit_scan_budget") {
        return {
          data: { ledger_id: "00000000-0000-4000-8000-000000000001" },
          error: null,
        };
      }
      if (name === "fn_commit_image_verdict") {
        return { data: { committed: true }, error: null };
      }
      if (
        name === "fn_record_scan_result" || name === "fn_release_scan_lease"
      ) {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
}

Deno.test("resolveSafeSearchVerdict owns cache → fence → general debit → commit → ledger", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const bytes = new Uint8Array([7, 8, 9]);
  let providerBytes: Uint8Array | null = null;
  const result = await resolveSafeSearchVerdict({
    client: ledgerClient({ calls }),
    canonicalJpeg: bytes,
    userId: "00000000-0000-4000-8000-000000000002",
    scope: "general",
    apiKey: "vision-key",
    owner: "lease-owner",
    scanImpl: async (scanned) => {
      providerBytes = scanned;
      return { verdict: "pass", likelihoods: unlikely, providerCalled: true };
    },
  });

  assertEquals(providerBytes, bytes);
  assertEquals(result.verdict, "pass");
  assertEquals(result.cacheHit, false);
  assertEquals(result.providerCalled, true);
  assertEquals(calls.map((call) => call.name), [
    "fn_acquire_scan_lease",
    "fn_debit_scan_budget",
    "fn_commit_image_verdict",
    "fn_record_scan_result",
  ]);
  assertEquals(calls[1].args.p_scope, "general");
  assertEquals(typeof calls[2].args.p_provider_call_marker, "string");
  assertEquals(calls[3].args.p_outcome, "pass");
  assertEquals(calls[3].args.p_sha256, result.sha256);
});

Deno.test("resolveSafeSearchVerdict cache hit skips lease, budget, and provider", async () => {
  let providerCalled = false;
  const result = await resolveSafeSearchVerdict({
    client: ledgerClient({
      cached: { verdict: "pass", likelihoods: unlikely },
    }),
    canonicalJpeg: new Uint8Array([1, 2, 3]),
    userId: "00000000-0000-4000-8000-000000000002",
    scope: "general",
    apiKey: "", // A terminal cache hit remains usable during provider outage.
    scanImpl: async () => {
      providerCalled = true;
      throw new Error("must not run");
    },
  });
  assertEquals(result.cacheHit, true);
  assertEquals(result.providerCalled, false);
  assertEquals(providerCalled, false);
});

Deno.test("post-acquire cache recheck closes the sequential double-scan race", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let cacheReads = 0;
  let providerCalled = false;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            cacheReads += 1;
            return cacheReads === 1 ? { data: null, error: null } : {
              data: { verdict: "pass", likelihoods: unlikely },
              error: null,
            };
          },
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "fn_acquire_scan_lease") {
        return { data: { acquired: true, fencing_token: 12 }, error: null };
      }
      if (name === "fn_release_scan_lease") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected paid/provider RPC ${name}`);
    },
  };

  const result = await resolveSafeSearchVerdict({
    client,
    canonicalJpeg: new Uint8Array([8, 8, 8]),
    userId: "00000000-0000-4000-8000-000000000002",
    scope: "general",
    apiKey: "vision-key",
    scanImpl: async () => {
      providerCalled = true;
      throw new Error("provider must not run after terminal verdict");
    },
  });

  assertEquals(result.cacheHit, true);
  assertEquals(result.providerCalled, false);
  assertEquals(providerCalled, false);
  assertEquals(calls.map((call) => call.name), [
    "fn_acquire_scan_lease",
    "fn_release_scan_lease",
  ]);
});

Deno.test("resolveSafeSearchVerdict records provider error and releases fenced lease", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  await assertRejects(
    () =>
      resolveSafeSearchVerdict({
        client: ledgerClient({ calls }),
        canonicalJpeg: new Uint8Array([4, 5, 6]),
        userId: "00000000-0000-4000-8000-000000000002",
        scope: "sweep",
        apiKey: "vision-key",
        owner: "failed-owner",
        scanImpl: async () => {
          throw new VisionSafeSearchError("provider_http", "provider failed");
        },
      }),
    VisionSafeSearchError,
  );
  assertEquals(calls.map((call) => call.name), [
    "fn_acquire_scan_lease",
    "fn_debit_scan_budget",
    "fn_record_scan_result",
    "fn_release_scan_lease",
  ]);
  assertEquals(calls[2].args.p_outcome, "provider_error");
  assertEquals(calls[3].args.p_fencing_token, 9);
});

Deno.test("stale lease owner cannot commit or release after takeover winner appears", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let cacheReads = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            cacheReads += 1;
            return cacheReads <= 2 ? { data: null, error: null } : {
              data: { verdict: "pass", likelihoods: unlikely },
              error: null,
            };
          },
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "fn_acquire_scan_lease") {
        return { data: { acquired: true, fencing_token: 41 }, error: null };
      }
      if (name === "fn_debit_scan_budget") {
        return {
          data: { ledger_id: "00000000-0000-4000-8000-000000000009" },
          error: null,
        };
      }
      // Simulates token 41 resuming after token 42 took over.
      if (name === "fn_commit_image_verdict") {
        return { data: { committed: false }, error: null };
      }
      if (name === "fn_record_scan_result") return { data: true, error: null };
      if (name === "fn_release_scan_lease") {
        throw new Error(
          "stale owner must not attempt to release the winner lease",
        );
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const result = await resolveSafeSearchVerdict({
    client,
    canonicalJpeg: new Uint8Array([3, 2, 1]),
    userId: "00000000-0000-4000-8000-000000000002",
    scope: "general",
    apiKey: "vision-key",
    owner: "stale-owner",
    scanImpl: async () => ({
      verdict: "rejected",
      likelihoods: unlikely,
      providerCalled: true,
    }),
  });
  assertEquals(result.verdict, "pass");
  assertEquals(
    calls.find((call) => call.name === "fn_commit_image_verdict")?.args
      .p_fencing_token,
    41,
  );
  assertEquals(
    calls.some((call) => call.name === "fn_release_scan_lease"),
    false,
  );
});

Deno.test("resolveSafeSearchVerdict canary rejects post-canonical cache hits", async () => {
  const error = await assertRejects(
    () =>
      resolveSafeSearchVerdict({
        client: ledgerClient({
          cached: { verdict: "pass", likelihoods: unlikely },
        }),
        canonicalJpeg: new Uint8Array([1]),
        userId: "00000000-0000-4000-8000-000000000002",
        scope: "canary",
        apiKey: "vision-key",
        requireProviderCall: true,
      }),
    SafeSearchLedgerError,
  );
  assertEquals(error.code, "canonical_not_unique");
});
