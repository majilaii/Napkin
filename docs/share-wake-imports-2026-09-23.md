# Share-time imports and Google Maps links (TICKET-248)

## Outcome

Founder report, 23 September: imports from TikTok and Instagram "never work anymore", and Google Maps shares do not import. He wants a share to start processing straight away, without leaving TikTok, so the import is not dormant until Napkin is opened. Switching to the app from the share sheet is explicitly not the goal.

Diagnosis:

1. **Google Maps app links time out on the server.** A link made by the Google Maps app redirects `maps.app.goo.gl` → `maps.google.com/?q=Name,+Address&ftid=…` → `maps.google.com/maps?q=…` → `www.google.com/maps?q=…`, a 220 KB page. `expandMapsShare` followed every hop under one 2.5 s signal and read the place only from the final URL. The full chain takes about 3.2 s, so the abort fired and the import ended with no spots. Links made by Google Maps on the web redirect once to `/maps/place/…`, which is why earlier tests passed. Separately, a single shared place was searched with no location, so Places welded the sharer's home city into the query: a London user sharing a Paris restaurant searched "…, London".
2. **The server lane from PR #387 blocked the phone.** Share uploads created server jobs, and the app refused to process a share locally while its job was pending. The server cannot read TikTok or Instagram content (TikTok short links reach a login wall from a server; Instagram has no caption server-side), so almost every job ended `needs_device` anyway. The worker ran once at enqueue. When that attempt failed, the next came from the scheduled rescue, which GitHub runs every two to five hours rather than every five minutes, and the app showed "processing in background" in the meantime.
3. **Server failures looped silently.** Since the extraction model switch, timeouts and provider errors return 5xx instead of an empty result. The drain treated every 5xx as transient, never counted it and never showed it, then repeated perception on every foreground.

What iOS allows: an extension cannot run the import (about 120 MB of memory, killed when the sheet closes) and cannot start the app directly. It can start a background URLSession transfer; when that finishes, iOS launches or resumes the containing app in the background and calls `application(_:handleEventsForBackgroundURLSession:completionHandler:)` (App Extension Programming Guide, "Performing Uploads and Downloads"). That launch is the wake-up. iOS gives the app roughly 30 seconds of background time per wake; a later background download finishing wakes it again. A force-quit app is not relaunched.

Intended behavior: a share queues the import as before and starts a tiny wake upload. When it lands, Napkin wakes in the background, processes the share on the phone and posts "N spots ready to review" if notifications are allowed. Short imports (Maps, web links, a named TikTok, an Instagram caption) finish before the app is opened. Longer video work that iOS pauses resumes the next time Napkin runs. Maps app links resolve to the shared place. A repeated server failure becomes a visible, retryable failure.

## Done when

- Maps short links resolve from the first redirect that names the place; real app-made and web-made links return a place within budget; the Places search uses the link's own location.
- `background-imports` hands every enqueued job to the device at once, so installed builds stop waiting on the server; a new intake-only `wake` action authenticates and stores nothing.
- The share card keeps its single action. After the manifest is durable it starts the wake upload when a scoped credential exists, and says "Napkin is finding the spots now"; without a credential it says to open Napkin.
- A wake holds background time until the JS drain holds its own; expo-file-system no longer swallows the wake session's completion handler.
- Legacy server-lane manifests process locally at once and the server copy is dismissed; the five-second remote polling is gone; server housekeeping runs after local work.
- A server-answered 5xx retries once after ten seconds, then fails visibly with try-again.
- Tests, typecheck, lint, Deno tests, FEATURE-MAP.md, independent review, CI, merge, deploy smoke and a TestFlight build.

## Constraints

- Review-first stays: a woken import only prepares spots; nothing saves without the review screen.
- No DB migration. The worker, push tables and cron stay deployed; deleting the server lane is a separate, approval-gated cleanup.
- The extraction model is the founder's decision and is not changed here; production latency and failure evidence is needed first.
- No perception inside the share extension.

## Evidence

- A Deno probe of the server's own `expandMapsShare` on a real app-made link (`maps.app.goo.gl/QS9xeZqTY7BzB6Vq6`) returned no place after 2,502 ms; a web-made link (`maps.app.goo.gl/CEDqyVFDApSaRZc4A`) returned "Dishoom Covent Garden" in 1.4 s. Hop by hop, the first redirect answered in 0.37 s with `?q=` already present; the full follow took 3.19 s. After the fix the same links return in 466 ms and 300 ms (with the pin's coordinates), and a real 40-item shared list still returns all 40.
- `restaurant-completeness-cron.yml`, which also drives background-imports, ran every two to five hours. Its background-imports step reported `processed: 1` in consecutive runs hours apart on 14, 16, 18, 19, 20 and 22 September, and returned 503 on 22 September at 00:51.
- A TikTok short link fetched from a server redirects `vm.tiktok.com` → `/@/video/<id>` → `/login`.
- `expo-file-system` 19.0.22's `FileSystemBackgroundSessionHandler` stores every session's completion handler and releases only its own (bare-UUID identifiers); Expo's subscriber manager calls UIKit's handler only after every subscriber finishes.
- Production database and log reads were blocked by this session's permission classifier; production model latency and failure rates are unverified.
