import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalizeImage,
  generateCanonicalCanary,
  inspectImageHeaders,
  sha256Hex,
} from "./imageCanonical.ts";
import { ImageScriptImage } from "./imageScriptCodec.ts";

function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function pngChunk(type: string, data: number[]): number[] {
  return [
    ...u32(data.length),
    ...new TextEncoder().encode(type),
    ...data,
    0,
    0,
    0,
    0, // CRC is irrelevant to bounded header inspection.
  ];
}

function png(
  width: number,
  height: number,
  animated = false,
  animationAfterIdat = false,
): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk("IHDR", [
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
  ]);
  const animation = animated ? pngChunk("acTL", [...u32(2), ...u32(0)]) : [];
  return new Uint8Array([
    ...signature,
    ...ihdr,
    ...(animationAfterIdat ? [] : animation),
    ...pngChunk("IDAT", []),
    ...(animationAfterIdat ? animation : []),
    ...pngChunk("IEND", []),
  ]);
}

function jpeg(width: number, height: number, mpo = false): Uint8Array {
  const app2 = mpo ? [0xff, 0xe2, 0x00, 0x06, 0x4d, 0x50, 0x46, 0x00] : [];
  return new Uint8Array([
    0xff,
    0xd8,
    ...app2,
    // Baseline SOF, one component.
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    // SOS followed by a tiny entropy payload and EOI.
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x00,
    0xff,
    0xd9,
  ]);
}

Deno.test("inspectImageHeaders accepts bounded single-frame PNG dimensions", () => {
  assertEquals(inspectImageHeaders(png(1200, 800)), {
    ok: true,
    image: {
      format: "png",
      mimeType: "image/png",
      width: 1200,
      height: 800,
      pixels: 960000,
      frames: 1,
    },
  });
});

Deno.test("inspectImageHeaders rejects APNG before decode", () => {
  const result = inspectImageHeaders(png(100, 100, true));
  assertEquals(result.ok, false);
  if (result.ok === false) assertEquals(result.code, "animated_image");

  const adversarialLateChunk = inspectImageHeaders(png(100, 100, true, true));
  assertEquals(adversarialLateChunk.ok, false);
  if (adversarialLateChunk.ok === false) {
    assertEquals(adversarialLateChunk.code, "animated_image");
  }

  const first = png(10, 10);
  const second = png(20, 20);
  const concatenated = new Uint8Array(first.byteLength + second.byteLength);
  concatenated.set(first);
  concatenated.set(second, first.byteLength);
  const concatenatedResult = inspectImageHeaders(concatenated);
  assertEquals(concatenatedResult.ok, false);
});

Deno.test("inspectImageHeaders rejects compressed pixel bombs before decode", () => {
  const result = inspectImageHeaders(png(10_000, 10_000));
  assertEquals(result.ok, false);
  if (result.ok === false) assertEquals(result.code, "too_many_pixels");
});

Deno.test("inspectImageHeaders accepts JPEG and rejects MPO/multiple frames", () => {
  const single = inspectImageHeaders(jpeg(640, 480));
  assertEquals(single.ok, true);
  if (single.ok) {
    assertEquals(single.image.format, "jpeg");
    assertEquals(single.image.pixels, 307200);
  }

  const mpo = inspectImageHeaders(jpeg(640, 480, true));
  assertEquals(mpo.ok, false);
  if (mpo.ok === false) assertEquals(mpo.code, "animated_image");

  const a = jpeg(10, 10);
  const b = jpeg(20, 20);
  const joined = new Uint8Array(a.byteLength + b.byteLength);
  joined.set(a);
  joined.set(b, a.byteLength);
  const concatenated = inspectImageHeaders(joined);
  assertEquals(concatenated.ok, false);
  if (concatenated.ok === false) {
    assertEquals(concatenated.code, "animated_image");
  }

  const repeatedSof = jpeg(640, 480);
  const firstSof = repeatedSof.indexOf(0xc0);
  const sofSegment = repeatedSof.slice(firstSof - 1, firstSof + 12);
  const sos = repeatedSof.indexOf(0xda, firstSof);
  const twoFrameHeaders = new Uint8Array(
    repeatedSof.byteLength + sofSegment.byteLength,
  );
  twoFrameHeaders.set(repeatedSof.slice(0, sos - 1));
  twoFrameHeaders.set(sofSegment, sos - 1);
  twoFrameHeaders.set(repeatedSof.slice(sos - 1), sos - 1 + sofSegment.length);
  const repeatedHeader = inspectImageHeaders(twoFrameHeaders);
  assertEquals(repeatedHeader.ok, false);
  if (repeatedHeader.ok === false) {
    assertEquals(repeatedHeader.code, "animated_image");
  }
});

Deno.test("inspectImageHeaders rejects GIF and arbitrary magic bytes", () => {
  const gif = new TextEncoder().encode("GIF89a");
  const result = inspectImageHeaders(gif);
  assertEquals(result.ok, false);
  if (result.ok === false) assertEquals(result.code, "unsupported_format");
});

Deno.test("canonicalizeImage retains fail-closed null contract", async () => {
  assertEquals(await canonicalizeImage(new Uint8Array([1, 2, 3])), null);
  const controller = new AbortController();
  controller.abort();
  assertEquals(await canonicalizeImage(png(1, 1), controller.signal), null);
});

Deno.test("canonicalizeImage decodes a valid PNG into canonical JPEG bytes", async () => {
  const fixture = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );

  const canonical = await canonicalizeImage(fixture);
  assert(canonical !== null);
  assert(canonical.data.byteLength > 0);
  assertEquals(
    {
      mimeType: canonical.mimeType,
      width: canonical.width,
      height: canonical.height,
    },
    { mimeType: "image/jpeg", width: 1, height: 1 },
  );
  const output = inspectImageHeaders(canonical.data);
  assert(output.ok);
  assertEquals(output.image.format, "jpeg");
});

Deno.test("canonicalizeImage preserves non-white JPEG color through decode and re-encode", async () => {
  const source = new ImageScriptImage(16, 16);
  for (let offset = 0; offset < source.bitmap.byteLength; offset += 4) {
    source.bitmap[offset] = 220;
    source.bitmap[offset + 1] = 30;
    source.bitmap[offset + 2] = 40;
    source.bitmap[offset + 3] = 255;
  }

  const canonical = await canonicalizeImage(await source.encodeJPEG(95));
  assert(canonical !== null);
  const decoded = await ImageScriptImage.decode(canonical.data, "jpeg");
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let offset = 0; offset < decoded.bitmap.byteLength; offset += 4) {
    red += decoded.bitmap[offset];
    green += decoded.bitmap[offset + 1];
    blue += decoded.bitmap[offset + 2];
  }
  const pixels = decoded.width * decoded.height;
  assert(red / pixels > 160);
  assert(green / pixels < 100);
  assert(blue / pixels < 100);
});

Deno.test("canonicalizeImage floors a valid over-4MP JPEG to the pixel cap", async () => {
  const source = new ImageScriptImage(3000, 2000);
  source.bitmap.fill(0x7f);

  const canonical = await canonicalizeImage(await source.encodeJPEG(70));
  assert(canonical !== null);
  assertEquals(
    { width: canonical.width, height: canonical.height },
    { width: 2449, height: 1632 },
  );
  assert(canonical.width * canonical.height <= 4_000_000);
  const output = inspectImageHeaders(canonical.data);
  assert(output.ok);
  assertEquals(output.image.pixels, 2449 * 1632);
});

Deno.test("canonicalizeImage uses the bounded JPEG DCT downscale path", async () => {
  const source = new ImageScriptImage(4096, 4096);
  source.bitmap.fill(0x7f);

  const canonical = await canonicalizeImage(await source.encodeJPEG(70));
  assert(canonical !== null);
  assertEquals(
    { width: canonical.width, height: canonical.height },
    { width: 2000, height: 2000 },
  );
  assert(canonical.width * canonical.height <= 4_000_000);
});

Deno.test("sha256Hex hashes the exact canonical byte sequence", async () => {
  const first = await sha256Hex(new TextEncoder().encode("canonical-a"));
  const again = await sha256Hex(new TextEncoder().encode("canonical-a"));
  const second = await sha256Hex(new TextEncoder().encode("canonical-b"));
  assertEquals(first, again);
  assertNotEquals(first, second);
  assertMatch(first, /^[a-f0-9]{64}$/);
});

Deno.test("generateCanonicalCanary preserves uniqueness after the real JPEG canonicalization path", async () => {
  const seedA = new Uint8Array(32).fill(0x19);
  const seedB = seedA.slice();
  seedB[seedB.byteLength - 1] = 0xa7;

  const first = await generateCanonicalCanary(seedA);
  const second = await generateCanonicalCanary(seedB);

  assert(first !== null);
  assert(second !== null);
  assertEquals(
    { mimeType: first.mimeType, width: first.width, height: first.height },
    { mimeType: "image/jpeg", width: 2000, height: 2000 },
  );
  assertEquals(
    { mimeType: second.mimeType, width: second.width, height: second.height },
    { mimeType: "image/jpeg", width: 2000, height: 2000 },
  );
  assertEquals(inspectImageHeaders(first.data).ok, true);
  assertEquals(inspectImageHeaders(second.data).ok, true);
  assert(first.data.byteLength < 1024 * 1024);
  assert(second.data.byteLength < 1024 * 1024);
  assertNotEquals(await sha256Hex(first.data), await sha256Hex(second.data));
});
