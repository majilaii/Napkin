import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { expandBackgroundTikTokVideo, isCanonicalTikTokVideo, isDirectBackgroundMapsPlace } from "./backgroundSourceUrl.ts";

const VIDEO = "https://www.tiktok.com/@chef/video/123";

function redirects(locations: Array<string | null>, status = 302) {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const fetcher: typeof fetch = (input, options) => {
    calls.push({ url: String(input), options });
    const location = locations.shift();
    return Promise.resolve(new Response(null, { status, headers: location ? { location } : {} }));
  };
  return { calls, fetcher };
}

Deno.test("background TikTok canonical videos require no page fetch and discard tracking", async () => {
  const f = redirects([]);
  const value = await expandBackgroundTikTokVideo(new URL(VIDEO + "?tracking=private#foo"), new AbortController().signal, f.fetcher);
  assertEquals(value?.href, VIDEO);
  assertEquals(f.calls, []);
});

Deno.test("background TikTok follows only bounded manual first-party HTTPS redirects", async () => {
  const f = redirects(["https://www.tiktok.com/t/abc", "/@chef/video/123?tracking=private"]);
  const signal = new AbortController().signal;
  const value = await expandBackgroundTikTokVideo(new URL("https://vm.tiktok.com/abc"), signal, f.fetcher);
  assertEquals(value?.href, VIDEO);
  assertEquals(f.calls.map(c => c.url), ["https://vm.tiktok.com/abc", "https://www.tiktok.com/t/abc"]);
  for (const call of f.calls) assertEquals(call.options, { signal, redirect: "manual", credentials: "omit" });
});

Deno.test("background TikTok rejects unsafe redirect targets before fetching them", async () => {
  for (const location of [
    "http://www.tiktok.com/@chef/video/123", "https://tiktok.com.evil.example/a",
    "https://evil.example/a", "https://127.0.0.1/a", "https://[::ffff:7f00:1]/a",
    "https://[::]/a", "https://u:p@www.tiktok.com/@chef/video/123",
    "https://www.tiktok.com:8443/@chef/video/123", "https://www.tiktok.com./@chef/video/123",
    "https://www.tiktok.com/@chef/photo/123", "file:///tmp/secret",
  ]) {
    const f = redirects([location]);
    assertEquals(await expandBackgroundTikTokVideo(new URL("https://vm.tiktok.com/abc"), new AbortController().signal, f.fetcher), null);
    assertEquals(f.calls.length, 1);
  }
});

Deno.test("background TikTok unknown pages, missing locations, loops and excessive hops defer to device", async () => {
  for (const f of [
    redirects([VIDEO], 200), redirects([null]), redirects(["https://vm.tiktok.com/abc"]),
    redirects(["/a", "/b", "/c", "/d", VIDEO]),
  ]) {
    assertEquals(await expandBackgroundTikTokVideo(new URL("https://vm.tiktok.com/abc"), new AbortController().signal, f.fetcher), null);
    assertEquals(f.calls.length <= 4, true);
  }
});

Deno.test("background TikTok aborted or unavailable redirect expansion remains a device fallback", async () => {
  const fetcher: typeof fetch = () => Promise.reject(new DOMException("aborted", "AbortError"));
  assertEquals(await expandBackgroundTikTokVideo(new URL("https://vm.tiktok.com/abc"), new AbortController().signal, fetcher), null);
});

Deno.test("background source gates reject lookalike domains, photo aliases and unparseable Maps places", () => {
  for (const raw of [
    "https://www.tiktok.com/@chef/photo/123", "https://www.tiktok.com/t/abc",
    "https://www.tiktok.com/@chef/video/abc", "https://www.tiktok.com.evil.example/@chef/video/123",
  ]) assertEquals(isCanonicalTikTokVideo(new URL(raw)), false);
  for (const raw of [
    "https://maps.google.com.evil.example/maps/place/Brat", "https://www.google.com/redirect?query=Brat",
    "https://www.google.com/maps/place/%FF", "https://www.google.com/maps/place/%20",
  ]) assertEquals(isDirectBackgroundMapsPlace(new URL(raw)), false);
});
