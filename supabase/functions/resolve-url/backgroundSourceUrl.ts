/** Network policy for URL-only background imports; interactive intake is unchanged. */
import { parsePlaceFromMapsUrl } from "./mapsList.ts";

function plainHttps(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port;
}

export function isTrustedTikTokUrl(url: URL): boolean {
  return plainHttps(url) &&
    (url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com"));
}

export function isCanonicalTikTokVideo(url: URL): boolean {
  return isTrustedTikTokUrl(url) && /^\/@[A-Za-z0-9_.]+\/video\/\d+\/?$/.test(url.pathname);
}

/**
 * Short links can point at photo carousels. Inspect only first-party HTTPS
 * redirects, without downloading a page or letting fetch follow an unchecked
 * hop. Unknown/blocked/photo targets keep the existing on-device perception path.
 */
export async function expandBackgroundTikTokVideo(
  input: URL,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<URL | null> {
  let url = input;
  const seen = new Set<string>();
  for (let hops = 0; hops <= 4; hops++) {
    if (!isTrustedTikTokUrl(url) || seen.has(url.href)) return null;
    if (isCanonicalTikTokVideo(url)) {
      // Tracking and user-provided query parameters are not source evidence.
      return new URL(url.origin + url.pathname);
    }
    if (hops === 4 || url.pathname.includes("/photo/")) return null;
    seen.add(url.href);
    let response: Response;
    try {
      response = await fetcher(url.href, { signal, redirect: "manual", credentials: "omit" });
    } catch {
      return null;
    }
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (![301, 302, 303, 307, 308].includes(response.status) ||
      !location || location.length > 2048) return null;
    try {
      url = new URL(location, url);
    } catch {
      return null;
    }
  }
  return null;
}

/** Direct place names only: the interactive Maps short/list expander fetches pages. */
export function isDirectBackgroundMapsPlace(url: URL): boolean {
  return plainHttps(url) &&
    ["www.google.com", "google.com", "maps.google.com"].includes(url.hostname) &&
    /^\/maps\/place\/[^/]+(?:\/|$)/.test(url.pathname) &&
    !!parsePlaceFromMapsUrl(url.href);
}
