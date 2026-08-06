/**
 * videotext.test.ts — TICKET-209 caption authority on the video-text route.
 *
 * Pure helpers only (no serve(), no network): the route gate, the labeled
 * caption-first fusion with per-section budgets, and the caption-derived cap.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVideoFusion,
  CAPTION_SECTION_CAP,
  deriveCaptionCap,
  routesToVideoText,
  stripTrailingTagBlock,
  VIDEO_FUSION_CAP,
} from "./_helpers.ts";

// The founder repro (oEmbed-verified): enumerated, UNDELIMITED, 3 words between
// the digit and the list-noun.
const REPRO_CAPTION =
  "10 San Sebastián food spots that I LOVED last weekend: Casa Urola Bar " +
  "Txepetxa La Cuchara de San Telmo Akerbetlz Bar Sport El Patio de Simona " +
  "Casa Julián Gabarron Antonio Taberna";

// ── Route gate (A.1) ─────────────────────────────────────────────────────────

Deno.test("route: extracted_text alone still routes to video text", () => {
  assertEquals(routesToVideoText({ extracted_text: "CASA UROLA" }), true);
});

Deno.test("route: caption-only body routes to video text (IG + ASR-less TikTok)", () => {
  assertEquals(routesToVideoText({ caption: REPRO_CAPTION }), true);
});

Deno.test("route: caption stays a MODIFIER on the url and image routes", () => {
  // {url, caption} → URL pipeline (oEmbed / maps-list / supports_large_lists).
  assertEquals(
    routesToVideoText({ url: "https://tiktok.com/@a/video/1", caption: "hi" }),
    false,
  );
  // {image_path, caption} → vision/screenshot branch.
  assertEquals(
    routesToVideoText({ image_path: "u/1.jpg", caption: "hi" }),
    false,
  );
  // …and an empty image_path keeps today's fall-through semantics exactly
  // (the handler's own hasImage check is `typeof === "string"`).
  assertEquals(routesToVideoText({ image_path: "", caption: "hi" }), false);
});

Deno.test("route: extracted_text WINS even alongside a url (unchanged precedence)", () => {
  assertEquals(
    routesToVideoText({
      extracted_text: "CASA UROLA",
      url: "https://tiktok.com/@a/video/1",
    }),
    true,
  );
});

Deno.test("route: empty/whitespace/absent bodies do not route to video text", () => {
  assertEquals(routesToVideoText({}), false);
  assertEquals(routesToVideoText(null), false);
  assertEquals(routesToVideoText({ extracted_text: "   " }), false);
  assertEquals(routesToVideoText({ caption: "   " }), false);
  assertEquals(routesToVideoText({ caption: 12 as unknown as string }), false);
});

// ── Fusion (B) ───────────────────────────────────────────────────────────────

Deno.test("fusion: labeled caption-first sections", () => {
  const { fullText, hasVideoText } = buildVideoFusion(
    REPRO_CAPTION,
    "CASA UROLA\nBar Txepetxa, Parte Vieja",
  );
  assertEquals(
    fullText,
    `[caption]\n${REPRO_CAPTION}\n\n[video text]\nCASA UROLA\nBar Txepetxa, Parte Vieja`,
  );
  assertEquals(hasVideoText, true);
});

Deno.test("fusion: caption-only body paints NO [video text] header", () => {
  const { fullText, hasVideoText } = buildVideoFusion(REPRO_CAPTION, "");
  assertEquals(fullText, `[caption]\n${REPRO_CAPTION}`);
  assertEquals(fullText.includes("[video text]"), false);
  assertEquals(hasVideoText, false);
});

Deno.test("fusion: no caption → today's bare join, no labels", () => {
  const { fullText, hasVideoText } = buildVideoFusion(null, "CASA UROLA\nAkerbetlz");
  assertEquals(fullText, "CASA UROLA\nAkerbetlz");
  assertEquals(hasVideoText, true);
});

Deno.test("fusion: empty body → empty text, hasVideoText false", () => {
  assertEquals(buildVideoFusion(null, ""), { fullText: "", hasVideoText: false });
});

Deno.test("fusion: trailing hashtag/mention block is stripped before budgeting", () => {
  const { fullText } = buildVideoFusion(
    `${REPRO_CAPTION}\n\n#sansebastian #basquefood @topjaw`,
    "CASA UROLA",
  );
  assertEquals(fullText.includes("#sansebastian"), false);
  assertEquals(fullText.includes("@topjaw"), false);
  // The enumerated names live AFTER the preamble — they must survive.
  assertStringIncludes(fullText, "Casa Julián Gabarron Antonio Taberna");
});

Deno.test("fusion: a tags-ONLY caption keeps its raw text (city signal)", () => {
  // "#londonfood" is the only city hint Places gets on such a post.
  const { fullText } = buildVideoFusion("#londonfood #foodtok", "BRAT");
  assertStringIncludes(fullText, "#londonfood");
});

Deno.test("fusion: a huge caption cannot evict the video-text channel", () => {
  const hugeCaption = "a".repeat(20000);
  const videoText = "CASA UROLA\n" + "b".repeat(9000);
  const { fullText, hasVideoText } = buildVideoFusion(hugeCaption, videoText);

  assertEquals(hasVideoText, true);
  assertEquals(fullText.length <= VIDEO_FUSION_CAP, true);
  // Caption section is budgeted at 3k; the OCR channel keeps the remainder —
  // a join-then-slice would have dropped the video text entirely.
  const [captionSection, videoSection] = fullText.split("\n\n[video text]\n");
  assertEquals(captionSection.length, "[caption]\n".length + CAPTION_SECTION_CAP);
  assertEquals(videoSection.length > 4000, true);
  assertStringIncludes(videoSection, "CASA UROLA");
});

Deno.test("stripTrailingTagBlock: leaves inline tags alone", () => {
  assertEquals(
    stripTrailingTagBlock("best #ramen in Tokyo, all 3 spots"),
    "best #ramen in Tokyo, all 3 spots",
  );
});

// ── Caption-derived cap (C.3) ────────────────────────────────────────────────

Deno.test("cap: the repro caption caps at its own declared count", () => {
  assertEquals(deriveCaptionCap(REPRO_CAPTION, false), 10);
});

Deno.test("cap: OCR-embedded 'TOP 10' with NO caption body field does NOT cap", () => {
  // The count must come from the caption field alone — scene text that reads
  // "TOP 10" is noise, and old clients send no caption at all.
  assertEquals(deriveCaptionCap(null, false), null);
  assertEquals(deriveCaptionCap("", false), null);
});

Deno.test("cap: caption + photo context does NOT cap", () => {
  // Photo mode overrides the caller cap inside visionExtract, so a caption cap
  // there would apply at dedupe only — incoherent by construction.
  assertEquals(deriveCaptionCap(REPRO_CAPTION, true), null);
});

Deno.test("cap: bonus/exclusion captions are exempt", () => {
  assertEquals(deriveCaptionCap("6 spots and 2 to avoid in Soho", false), null);
  assertEquals(deriveCaptionCap("5 best places + 1 bonus pick", false), null);
  assertEquals(
    deriveCaptionCap("4 spots plus an honourable mention", false),
    null,
  );
  assertEquals(deriveCaptionCap("3 spots — and 1 to skip", false), null);
});

Deno.test("cap: only counts inside [2, 12] qualify", () => {
  assertEquals(deriveCaptionCap("top 1 ramen in Tokyo", false), null); // teaser
  assertEquals(deriveCaptionCap("top 2 ramen in Tokyo", false), 2);
  assertEquals(deriveCaptionCap("top 12 spots in London", false), 12);
  assertEquals(deriveCaptionCap("top 13 spots in London", false), null);
  assertEquals(deriveCaptionCap("my top 50 list", false), null);
});

Deno.test("cap: durations and prices never become a ceiling", () => {
  assertEquals(deriveCaptionCap("3 days in Lisbon: the spots I ate", false), null);
  assertEquals(deriveCaptionCap("£10 spots in London", false), null);
  // …but a real count later in the same caption still applies.
  assertEquals(deriveCaptionCap("24 hours in NYC: 8 spots you need", false), 8);
});

Deno.test("cap: a caption with no marker leaves the shared 12 cap in place", () => {
  assertEquals(deriveCaptionCap("we went to Nobu last night", false), null);
});

// ── Untrusted-body robustness ────────────────────────────────────────────────

Deno.test("fusion + cap tolerate a non-string caption (untrusted body)", () => {
  const junk = 42 as unknown as string;
  assertEquals(buildVideoFusion(junk, "CASA UROLA"), {
    fullText: "CASA UROLA",
    hasVideoText: true,
  });
  assertEquals(deriveCaptionCap(junk, false), null);
  assertEquals(
    buildVideoFusion(REPRO_CAPTION, 42 as unknown as string).hasVideoText,
    false,
  );
});
