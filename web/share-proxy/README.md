# napkin share-proxy

Renders the public wishlist/list share pages. Supabase free-tier edge functions
on `*.supabase.co` force `Content-Type: text/plain` + a sandbox CSP, so the
`share-page` HTML shows as raw source in a browser. This tiny Vercel proxy
fetches that HTML and re-serves it as proper `text/html; charset=utf-8`
(also fixing the charset mojibake). All live/verified/escaping/410 logic stays
in the Supabase `share-page` function — this only fixes the content-type.

- Deployed to **napkinshare.vercel.app** (Vercel team majilaiis-projects).
- Share links: `https://napkinshare.vercel.app/s/<token>` → proxies
  `…supabase.co/functions/v1/share-page?t=<token>`.
- The `handoff` edge fn returns this base via `SHARE_WEB_BASE`
  (default `https://napkinshare.vercel.app`).
- Table invite links: `https://napkinshare.vercel.app/j/<code>` → proxies
  `…supabase.co/functions/v1/table-invite-page?c=<code>`. The `table-management`
  edge fn composes this base via the same `SHARE_WEB_BASE` env, path `/j/<code>`.
- Deployment Protection is OFF on this project (the pages must be public).
- Redeploy: `cd web/share-proxy && npx vercel deploy --prod --yes`.
