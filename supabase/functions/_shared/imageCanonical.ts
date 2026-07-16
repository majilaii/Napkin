/**
 * Canonical image pipeline for TICKET-196.
 *
 * The returned JPEG bytes are the moderation unit: callers must hash, scan,
 * and publish this exact Uint8Array. Inputs are limited to single-frame JPEG
 * and PNG, validated from bounded headers before the image codec is allowed
 * to decode them.
 */

import {
  IMAGE_SCRIPT_MAX_PIXELS,
  ImageScriptImage,
} from "./imageScriptCodec.ts";

export const MAX_INPUT_PIXELS = IMAGE_SCRIPT_MAX_PIXELS;
export const MAX_CANONICAL_PIXELS = 4_000_000;
export const CANONICAL_JPEG_QUALITY = 82;
export const MAX_HEADER_BYTES = 1024 * 1024;

export type SupportedImageFormat = "jpeg" | "png";

export type ImageValidationCode =
  | "empty_image"
  | "unsupported_format"
  | "invalid_header"
  | "header_too_large"
  | "invalid_dimensions"
  | "too_many_pixels"
  | "animated_image";

export interface ImageHeader {
  format: SupportedImageFormat;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  pixels: number;
  frames: 1;
}

export type ImageHeaderResult =
  | { ok: true; image: ImageHeader }
  | { ok: false; code: ImageValidationCode; message: string };

export interface CanonicalImage {
  data: Uint8Array;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

function invalid(
  code: ImageValidationCode,
  message: string,
): ImageHeaderResult {
  return { ok: false, code, message };
}

function dimensionsResult(
  format: SupportedImageFormat,
  width: number,
  height: number,
): ImageHeaderResult {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width < 1 ||
    height < 1
  ) {
    return invalid("invalid_dimensions", "Image dimensions are invalid");
  }

  const pixelsBig = BigInt(width) * BigInt(height);
  if (pixelsBig > BigInt(MAX_INPUT_PIXELS)) {
    return invalid(
      "too_many_pixels",
      `Image exceeds the ${MAX_INPUT_PIXELS} pixel limit`,
    );
  }

  return {
    ok: true,
    image: {
      format,
      mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      width,
      height,
      pixels: Number(pixelsBig),
      frames: 1,
    },
  };
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(bytes[offset + i]);
  }
  return value;
}

function inspectPng(bytes: Uint8Array): ImageHeaderResult {
  if (bytes.byteLength < 33) {
    return invalid("invalid_header", "PNG header is truncated");
  }

  const ihdrLength = readU32(bytes, 8);
  if (ihdrLength !== 13 || ascii(bytes, 12, 4) !== "IHDR") {
    return invalid(
      "invalid_header",
      "PNG does not begin with a valid IHDR chunk",
    );
  }

  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  const dimensions = dimensionsResult("png", width, height);
  if (!dimensions.ok) return dimensions;

  // Chunk traversal skips compressed payloads by their declared lengths. Keep
  // pre-IDAT metadata bounded, but continue through IEND so an adversary cannot
  // hide acTL after IDAT and get a multi-frame input flattened.
  let offset = 8;
  let sawImageData = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = readU32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const next = offset + 12 + length;
    if (!Number.isSafeInteger(next) || next > bytes.byteLength) {
      return invalid("invalid_header", "PNG chunk is truncated");
    }
    if (!sawImageData && next > MAX_HEADER_BYTES && type !== "IDAT") {
      return invalid(
        "header_too_large",
        "PNG metadata exceeds the bounded header limit",
      );
    }
    if (type === "acTL") {
      return invalid(
        "animated_image",
        "Animated or multi-frame PNG images are not supported",
      );
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.byteLength) {
        return invalid(
          "invalid_header",
          "PNG contains data after its terminal image chunk",
        );
      }
      return sawImageData
        ? dimensions
        : invalid("invalid_header", "PNG is missing image data");
    }
    offset = next;
  }

  return !sawImageData && offset >= MAX_HEADER_BYTES
    ? invalid(
      "header_too_large",
      "PNG metadata exceeds the bounded header limit",
    )
    : invalid("invalid_header", "PNG is missing image data");
}

const JPEG_SOF_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

function inspectJpeg(bytes: Uint8Array): ImageHeaderResult {
  if (bytes.byteLength < 4) {
    return invalid("invalid_header", "JPEG header is truncated");
  }

  let offset = 2;
  let width = 0;
  let height = 0;
  let frameHeaders = 0;
  let scanDataOffset = -1;

  while (offset < bytes.byteLength && offset < MAX_HEADER_BYTES) {
    if (bytes[offset] !== 0xff) {
      return invalid("invalid_header", "JPEG marker stream is malformed");
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;

    const marker = bytes[offset++];
    if (marker === 0xd9) break; // EOI before scan data is malformed below.
    if (marker === 0xda) {
      scanDataOffset = offset;
      break;
    }
    // SOI, TEM, and restart markers carry no length field.
    if (
      marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (offset + 2 > bytes.byteLength) {
      return invalid("invalid_header", "JPEG segment length is truncated");
    }
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) {
      return invalid("invalid_header", "JPEG segment is truncated");
    }

    // Multi-Picture Format (MPO) is a multi-image JPEG container.
    if (
      marker === 0xe2 &&
      length >= 6 &&
      ascii(bytes, offset + 2, 4) === "MPF\0"
    ) {
      return invalid(
        "animated_image",
        "Multi-frame JPEG images are not supported",
      );
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      frameHeaders += 1;
      if (frameHeaders > 1) {
        return invalid(
          "animated_image",
          "Multi-frame JPEG images are not supported",
        );
      }
      if (length < 8) {
        return invalid("invalid_header", "JPEG SOF segment is truncated");
      }
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
    }

    offset += length;
  }

  if (offset >= MAX_HEADER_BYTES && scanDataOffset < 0) {
    return invalid(
      "header_too_large",
      "JPEG metadata exceeds the bounded header limit",
    );
  }
  if (!width || !height || scanDataOffset < 0) {
    return invalid("invalid_header", "JPEG is missing dimensions or scan data");
  }

  // Find the first frame's EOI in entropy-coded data. 0xffd9 cannot occur
  // as literal entropy data without escaping, so this byte scan is safe.
  let firstEoi = -1;
  for (let i = scanDataOffset; i + 1 < bytes.byteLength; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      firstEoi = i;
      break;
    }
  }
  if (firstEoi < 0) {
    return invalid("invalid_header", "JPEG is missing an end marker");
  }

  // A second JPEG after the first EOI is another common multi-frame/MPO
  // representation. Embedded EXIF thumbnails are before EOI and are allowed.
  for (let i = firstEoi + 2; i + 1 < bytes.byteLength; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) {
      return invalid(
        "animated_image",
        "Multi-frame JPEG images are not supported",
      );
    }
  }

  return dimensionsResult("jpeg", width, height);
}

/** Parse format, dimensions, and frame count without decoding pixel data. */
export function inspectImageHeaders(bytes: Uint8Array): ImageHeaderResult {
  if (bytes.byteLength === 0) return invalid("empty_image", "Image is empty");

  const isPng = bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (isPng) return inspectPng(bytes);

  const isJpeg = bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  if (isJpeg) return inspectJpeg(bytes);

  return invalid(
    "unsupported_format",
    "Only JPEG and PNG images are supported",
  );
}

/**
 * Decode a validated single-frame image and produce the deterministic
 * ≤4-megapixel JPEG moderation unit. Like imageResize.ts, any load/decode/
 * encode failure returns null rather than leaking raw bytes to a provider.
 * The pinned ImageScript codecs are self-contained so the result does not
 * depend on a request-time network fetch for executable WASM.
 */
export async function canonicalizeImage(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<CanonicalImage | null> {
  if (signal?.aborted) return null;
  const inspected = inspectImageHeaders(bytes);
  if (!inspected.ok) return null;

  try {
    let width = inspected.image.width;
    let height = inspected.image.height;
    const pixels = width * height;
    if (pixels > MAX_CANONICAL_PIXELS) {
      const scale = Math.sqrt(MAX_CANONICAL_PIXELS / pixels);
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
      // Usually floor already leaves the product below the cap. The division
      // is O(1) for pathological aspect ratios where one dimension floors to
      // one; decrementing the long edge millions of times is attacker-driven
      // CPU work.
      if (width * height > MAX_CANONICAL_PIXELS) {
        if (width >= height) width = Math.floor(MAX_CANONICAL_PIXELS / height);
        else height = Math.floor(MAX_CANONICAL_PIXELS / width);
      }
    }

    const image = await ImageScriptImage.decode(
      bytes,
      inspected.image.format,
      {
        sourceWidth: inspected.image.width,
        sourceHeight: inspected.image.height,
        targetWidth: width,
        targetHeight: height,
        signal,
      },
    );
    if (signal?.aborted) return null;
    if (
      image.width !== width ||
      image.height !== height ||
      image.width < 1 ||
      image.height < 1
    ) {
      return null;
    }

    if (signal?.aborted) return null;
    const data = await image.encodeJPEG(CANONICAL_JPEG_QUALITY);
    if (
      signal?.aborted || !(data instanceof Uint8Array) || data.byteLength === 0
    ) return null;

    const output = inspectImageHeaders(data);
    if (
      !output.ok ||
      output.image.format !== "jpeg" ||
      output.image.width !== width ||
      output.image.height !== height ||
      output.image.pixels > MAX_CANONICAL_PIXELS
    ) {
      return null;
    }

    return { data, mimeType: "image/jpeg", width, height };
  } catch {
    return null;
  }
}

/** SHA-256 for canonical bytes, lowercase hexadecimal. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes.slice().buffer as ArrayBuffer;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Build a unique 4MP noise image and run it through the same q82 canonical
 * path as user uploads. Used only by the deploy-time provider canary.
 */
export async function generateCanonicalCanary(
  seed: Uint8Array = crypto.getRandomValues(new Uint8Array(32)),
  signal?: AbortSignal,
): Promise<CanonicalImage | null> {
  if (signal?.aborted || seed.byteLength === 0) return null;

  try {
    const width = 2000;
    const height = 2000;
    const image = new ImageScriptImage(width, height);
    const seedDigest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        seed.slice().buffer as ArrayBuffer,
      ),
    );
    if (signal?.aborted) return null;
    const seedView = new DataView(seedDigest.buffer);
    let state0 = seedView.getUint32(0);
    let state1 = seedView.getUint32(4);
    let state2 = seedView.getUint32(8);
    let state3 = seedView.getUint32(12);
    if ((state0 | state1 | state2 | state3) === 0) {
      state0 = 0x9e3779b9;
      state1 = 0x243f6a88;
      state2 = 0xb7e15162;
      state3 = 0xa341316c;
    }

    // xoshiro128** preserves 128 bits of collision resistance from the
    // SHA-256-derived state. A centered 512px block contains ample entropy to
    // survive JPEG quantization while avoiding a worst-case multi-megabyte
    // Vision request. The rest is a fixed neutral field and alpha is opaque.
    const bitmap = image.bitmap;
    for (let offset = 0; offset < bitmap.byteLength; offset += 4) {
      bitmap[offset] = 0xe0;
      bitmap[offset + 1] = 0xe0;
      bitmap[offset + 2] = 0xe0;
      bitmap[offset + 3] = 0xff;
    }
    const blockSize = 512;
    const blockStart = (width - blockSize) / 2;
    for (let y = blockStart; y < blockStart + blockSize; y += 1) {
      for (let x = blockStart; x < blockStart + blockSize; x += 1) {
        const multiplied = Math.imul(state1, 5) >>> 0;
        const rotated = (multiplied << 7 | multiplied >>> 25) >>> 0;
        const output = Math.imul(rotated, 9) >>> 0;
        const shifted = state1 << 9;
        state2 ^= state0;
        state3 ^= state1;
        state1 ^= state2;
        state0 ^= state3;
        state2 ^= shifted;
        state3 = (state3 << 11 | state3 >>> 21) >>> 0;
        state0 >>>= 0;
        state1 >>>= 0;
        state2 >>>= 0;

        const offset = (y * width + x) * 4;
        bitmap[offset] = output & 0xff;
        bitmap[offset + 1] = (output >>> 8) & 0xff;
        bitmap[offset + 2] = (output >>> 16) & 0xff;
      }
    }

    const sourceJpeg = await image.encodeJPEG(95);
    if (signal?.aborted) return null;
    return await canonicalizeImage(sourceJpeg, signal);
  } catch {
    return null;
  }
}
