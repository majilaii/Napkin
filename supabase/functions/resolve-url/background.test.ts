import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BackgroundImportJob,
  type BackgroundResolveContext,
  type BackgroundResolveDependencies,
  resolveBackgroundImport,
} from "./background.ts";
import { evaluateFastPath } from "./backgroundFastPath.ts";
import { evaluateFastPath as evaluateNativeFastPath } from "../../../napkin-app/lib/importFastPath.ts";

const JOB = "1f4cd3fb-5da8-4de6-8a09-b891d1f73b82";
const OWNER = "bb0a2f2e-7887-401d-9360-a068c23f5d73";
const NONCE = "ed4e7559-8910-43d1-805a-f5b42fdbd489";
const LEASE = "2c3a1afd-0f89-4373-9040-d1d71169770b";
const NOW = Date.parse("2026-09-13T20:00:00Z");
const SECRET = "test-internal-secret";

const candidate = {
  candidate_id: "a",
  restaurant_id: null,
  restaurant: { external_id: "place-a", name: "Brat", city: "London" },
  confidence: "high" as const,
  stance: "recommended" as const,
  resolution_decision: "matched",
};
const result = {
  source_type: "video",
  candidates: [candidate],
  list_count_raw: null,
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function fixture(request: Record<string, unknown> = { url: "https://www.tiktok.com/@chef/video/123" }) {
  const job: BackgroundImportJob = {
    id: JOB,
    user_id: OWNER,
    import_nonce: NONCE,
    request,
    status: "processing",
    lease_token: LEASE,
    lease_until: new Date(NOW + 90_000).toISOString(),
  };
  const calls: Array<{ name: string; values?: unknown[] }> = [];
  const dependencies: BackgroundResolveDependencies = {
    internalSecret: SECRET,
    now: () => NOW,
    loadJob: async (id) => { calls.push({ name: "load", values: [id] }); return job; },
    rateAllowed: async (owner) => { calls.push({ name: "rate", values: [owner] }); return true; },
    detectSource: (url) => url.hostname.includes("tiktok") ? "tiktok"
      : url.hostname.includes("instagram") ? "instagram"
      : url.hostname.includes("google") ? "google_maps" : "web",
    expandTikTokVideo: async (url) => {
      calls.push({ name: "expand", values: [url.href] });
      return new URL("https://www.tiktok.com/@chef/video/123");
    },
    fetchTikTok: async (url) => {
      calls.push({ name: "oembed", values: [url] });
      return { title: "Brat in London", author_unique_id: "chef", thumbnail_url: "https://image.example/cover.jpg" };
    },
    resolveVideo: async (...args) => { calls.push({ name: "video", values: args }); return response({ data: result }); },
    resolveUrl: async (...args) => { calls.push({ name: "url", values: args }); return response({ data: result }); },
    attachProvenance: async (context, resolved) => {
      calls.push({ name: "provenance", values: [context] });
      const envelope = await resolved.json();
      envelope.data.candidates = envelope.data.candidates.map((row: unknown) => ({ ...row as object, resolution_id: "proof-a" }));
      return response(envelope);
    },
  };
  const req = new Request("https://functions.example/resolve-url", { headers: { "x-internal-secret": SECRET } });
  return {
    job, calls, dependencies, req,
    run: (body: Record<string, unknown> = { job_id: JOB, lease_token: LEASE }) =>
      resolveBackgroundImport(req, body, dependencies),
  };
}

Deno.test("background resolution requires the internal secret before any database read", async () => {
  for (const secret of [undefined, "", "wrong-secret"]) {
    const f = fixture();
    f.dependencies.internalSecret = secret;
    assertEquals((await f.run()).status, 401);
    assertEquals(f.calls, []);
  }
  const f = fixture();
  assertEquals((await resolveBackgroundImport(new Request(f.req.url), { job_id: JOB, lease_token: LEASE }, f.dependencies)).status, 401);
  assertEquals(f.calls, []);
});

Deno.test("background resolution rejects malformed job and lease ids before loading", async () => {
  for (const body of [{ job_id: "not-uuid", lease_token: LEASE }, { job_id: JOB }, { job_id: JOB, lease_token: "bad" }]) {
    const f = fixture();
    assertEquals((await f.run(body)).status, 400);
    assertEquals(f.calls, []);
  }
});

Deno.test("background resolution refuses missing, stale, expired, cancelled and reclaimed leases", async () => {
  for (const patch of [
    { status: "pending" }, { status: "dismissed" }, { lease_token: NONCE },
    { lease_until: new Date(NOW).toISOString() }, { lease_until: "invalid" }, { id: NONCE },
  ]) {
    const f = fixture();
    Object.assign(f.job, patch);
    assertEquals((await f.run()).status, 409);
    assertEquals(f.calls.map(c => c.name), ["load"]);
  }
  const f = fixture();
  f.dependencies.loadJob = async () => null;
  assertEquals((await f.run()).status, 409);
});

Deno.test("background resolution ignores supplied owner and source and binds job provenance", async () => {
  const f = fixture();
  const value = await (await f.run({ job_id: JOB, lease_token: LEASE, user_id: NONCE, request: { url: "https://attacker.example" } })).json();
  assertEquals(value.data.state, "ready");
  assertEquals(value.data.result.source_type, "tiktok");
  assertEquals(value.data.result.candidates[0].resolution_id, "proof-a");
  assertEquals(value.data.result.partial_source.author_handle, "chef");
  const context: BackgroundResolveContext = { ownerId: OWNER, importNonce: NONCE, internalSecret: SECRET };
  assertEquals(f.calls.find(c => c.name === "video")?.values?.slice(0, 3), [context, "", "Brat in London"]);
  assertEquals(f.calls.find(c => c.name === "provenance")?.values, [context]);
  assertEquals(f.calls.find(c => c.name === "rate")?.values, [OWNER]);
  assertEquals(f.calls.map(c => c.name), ["load", "rate", "oembed", "video", "load", "provenance"]);
});

Deno.test("background Instagram without perception and TikTok photo posts require the phone before paid resolution", async () => {
  for (const url of ["https://www.instagram.com/reel/abcdef", "https://instagr.am/p/abcdef", "https://m.instagram.com/reel/abcdef", "https://www.tiktok.com/@chef/photo/123"]) {
    const f = fixture({ url });
    assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "perception_required" } });
    assertEquals(f.calls.map(c => c.name), ["load"]);
  }
});

Deno.test("background TikTok short hosts still use the strict social evidence gate", async () => {
  const f = fixture({ url: "https://vt.tiktok.com/abcdef" });
  f.dependencies.detectSource = () => "web";
  f.dependencies.resolveVideo = async () => response({ data: { ...result, candidates: [candidate, candidate] } });
  assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "insufficient_evidence" } });
  assertEquals(f.calls.some(c => c.name === "url"), false);
  assertEquals(f.calls.find(c => c.name === "oembed")?.values, ["https://www.tiktok.com/@chef/video/123"]);
});

Deno.test("background TikTok aliases cannot complete from photo or unknown targets even with a caption", async () => {
  for (const expanded of [null, new URL("https://www.tiktok.com/@chef/photo/123"), new URL("https://www.tiktok.com/@chef")]) {
    const f = fixture({ url: "https://vm.tiktok.com/abcdef", caption: "Brat in London" });
    f.dependencies.expandTikTokVideo = async () => expanded;
    assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "perception_required" } });
    assertEquals(f.calls.map(c => c.name), ["load"]);
  }
});

Deno.test("background TikTok plain HTTP, credentials and custom ports never trigger expansion", async () => {
  for (const url of ["http://vt.tiktok.com/abc", "https://u:p@vt.tiktok.com/abc", "https://vt.tiktok.com:8443/abc"]) {
    const f = fixture({ url });
    assertEquals((await (await f.run()).json()).data.state, "needs_device");
    assertEquals(f.calls.map(c => c.name), ["load"]);
  }
});

Deno.test("background rejects private URLs and oversized evidence before external calls", async () => {
  for (const input of [{ url: "https://127.0.0.1/a" }, { url: "https://www.tiktok.com/@chef/video/123", caption: "a".repeat(8001) }]) {
    const f = fixture(input);
    assertEquals((await f.run()).status, 400);
    assertEquals(f.calls.map(c => c.name), ["load"]);
  }
});

Deno.test("background rate limit denial never spends on providers", async () => {
  const f = fixture();
  f.dependencies.rateAllowed = async () => false;
  assertEquals((await f.run()).status, 429);
  assertEquals(f.calls.map(c => c.name), ["load"]);
});

Deno.test("background never completes a TikTok list from caption or ASR alone", async () => {
  const f = fixture({ url: "https://www.tiktok.com/@chef/video/123", caption: "Brat and Manteca", extracted_text: "Brat and Manteca are great" });
  f.dependencies.resolveVideo = async () => response({ data: { ...result, candidates: [candidate, { ...candidate, candidate_id: "b" }] } });
  assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "insufficient_evidence" } });
  assertEquals(f.calls.some(c => c.name === "provenance"), false);
});

Deno.test("background social fast path rejects uncorroborated, warned, ghost, low confidence, incomplete and old results", async () => {
  for (const data of [
    { ...result, candidates: [{ ...candidate, restaurant: { ...candidate.restaurant, name: "Manteca" } }] },
    { ...result, candidates: [{ ...candidate, stance: "warned" }] },
    { ...result, candidates: [{ ...candidate, restaurant: { ...candidate.restaurant, external_id: null } }] },
    { ...result, candidates: [{ ...candidate, confidence: "low" }] },
    { ...result, list_count_raw: 2 },
    { ...result, list_count_raw: undefined },
  ]) {
    const f = fixture();
    f.dependencies.resolveVideo = async () => response({ data });
    assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "insufficient_evidence" } });
    assertEquals(f.calls.some(c => c.name === "provenance"), false);
  }
});

Deno.test("background full native perception resolves multiple venues and preserves photo context", async () => {
  const f = fixture({ source_type: "video", perception_complete: true, extracted_text: "[OCR] Brat\nManteca", photo_context: { sourceKind: "photo", slideCount: 2 } });
  const multiple = { ...result, candidates: [candidate, { ...candidate, candidate_id: "b" }] };
  f.dependencies.resolveVideo = async (...args) => { f.calls.push({ name: "video", values: args }); return response({ data: multiple }); };
  const value = await (await f.run()).json();
  assertEquals(value.data.state, "ready");
  assertEquals(value.data.result.candidates.length, 2);
  assertEquals(f.calls.find(c => c.name === "video")?.values?.[3], { sourceKind: "photo", slideCount: 2 });
  assertEquals(f.calls.some(c => c.name === "oembed"), false);
});

Deno.test("background perception-complete flag without evidence cannot bypass quality gates", async () => {
  const f = fixture({ source_type: "video", perception_complete: true, extracted_text: "   " });
  assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "perception_required" } });
});

Deno.test("background only resolves direct named Maps URLs without fetching the source URL", async () => {
  for (const url of ["https://www.google.com/maps/place/Brat", "https://maps.google.com/maps/place/Brat/", "https://google.com/maps/place/Brat+London"]) {
    const f = fixture({ url });
    assertEquals((await (await f.run()).json()).data.state, "ready");
    assertEquals(f.calls.some(c => c.name === "url"), true);
    assertEquals(f.calls.some(c => c.name === "video"), false);
  }
  const f = fixture({ url: "https://www.google.com/maps/place/Brat" });
  f.dependencies.resolveUrl = async () => response({ data: { mode: "large_list", list_count: 21, items: [] } });
  assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "large_list" } });
  assertEquals(f.calls.some(c => c.name === "provenance"), false);
});

Deno.test("background defers arbitrary web, unsafe and short/list Maps URLs without network or paid calls", async () => {
  for (const url of [
    "https://food.example/article", "https://[::ffff:7f00:1]/internal", "https://[::]/internal",
    "https://maps.app.goo.gl/abc", "https://maps.google.com/list/abc",
    "https://www.google.com/maps?query=Brat", "https://www.google.com/maps/place/%FF",
    "https://maps.google.com.evil.example/maps/place/Brat", "http://www.google.com/maps/place/Brat",
    "https://u:p@www.google.com/maps/place/Brat", "https://www.google.com:8443/maps/place/Brat",
  ]) {
    const f = fixture({ url });
    assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "url_requires_device" } });
    assertEquals(f.calls.map(c => c.name), ["load"]);
  }
});

Deno.test("background provider or budget failures remain retryable and mint no provenance", async () => {
  for (const decision of ["transient", "unattempted_budget"]) {
    const f = fixture();
    f.dependencies.resolveVideo = async () => response({ data: { ...result, candidates: [{ ...candidate, resolution_decision: decision }] } });
    assertEquals((await f.run()).status, 503);
    assertEquals(f.calls.some(c => c.name === "provenance"), false);
  }
  const f = fixture();
  f.dependencies.resolveVideo = async () => response({ error: { code: "EXTRACTION_UNAVAILABLE" } }, 503);
  assertEquals((await f.run()).status, 503);
});

Deno.test("background empty or malformed upstream results never become ready", async () => {
  const f = fixture();
  f.dependencies.resolveVideo = async () => response({ data: { ...result, candidates: [] } });
  assertEquals(await (await f.run()).json(), { data: { state: "needs_device", reason: "no_candidates" } });
  f.dependencies.resolveVideo = async () => response({ data: null });
  assertEquals((await f.run()).status, 503);
});

Deno.test("background checks lease again before minting resolution provenance", async () => {
  const f = fixture();
  f.dependencies.resolveVideo = async () => {
    f.job.lease_token = NONCE;
    return response({ data: result });
  };
  assertEquals((await f.run()).status, 409);
  assertEquals(f.calls.some(c => c.name === "provenance"), false);
});

Deno.test("background and native caption/ASR gates remain behaviorally identical", () => {
  for (const provider of ["tiktok", "instagram"] as const) {
    for (const confidence of ["high", "low", "exact"] as const) {
      for (const stance of ["recommended", "warned", "neutral", null] as const) {
        for (const listCountRaw of [undefined, null, 1, 2, 3]) {
          for (const count of [0, 1, 2]) {
            for (const external_id of [null, "place-id"]) {
              for (const caption of [undefined, "great restaurant London", "Brat London"]) {
                const input = {
                  provider, listCountRaw, transcriptChars: 120, caption,
                  candidates: Array.from({ length: count }, () => ({
                    ...candidate, confidence, stance, restaurant: { ...candidate.restaurant, external_id },
                  })),
                };
                assertEquals(evaluateFastPath(input), evaluateNativeFastPath(input));
              }
            }
          }
        }
      }
    }
  }
});
