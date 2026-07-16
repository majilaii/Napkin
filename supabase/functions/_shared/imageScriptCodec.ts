/**
 * Minimal, self-contained ImageScript codec surface for canonical moderation.
 *
 * This wraps ImageScript v1.3.1's MIT-licensed `wasm/any` JPEG codec and
 * preserves ImageScript's nearest-neighbour resize semantics. PNG decoding is
 * streamed by pngStreamCodec.ts to avoid lodepng's full 40MP framebuffer.
 * Only the formats accepted by the moderation contract are linked, avoiding
 * ImageScript's historical request-time fetch of every optional codec.
 *
 * Copyright (c) 2023 Mathis Mensing
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

import { JPEG_CODEC_WASM_BASE64 } from "./imageCodecWasm.ts";
import { decodePngBounded } from "./pngStreamCodec.ts";

type ImageFormat = "jpeg" | "png";

export interface ImageScriptDecodeOptions {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  signal?: AbortSignal;
}

export const IMAGE_SCRIPT_MAX_PIXELS = 40_000_000;

type JpegExports = {
  memory: WebAssembly.Memory;
  wlen(): number;
  walloc(size: number): number;
  wfree(pointer: number, size?: number): void;
  encode(
    pointer: number,
    width: number,
    height: number,
    quality: number,
  ): number;
  decode(
    pointer: number,
    length: number,
    width: number,
    height: number,
  ): number;
  decode_width(pointer: number): number;
  decode_height(pointer: number): number;
  decode_format(pointer: number): number;
  decode_buffer(pointer: number): number;
  decode_free(pointer: number): void;
};

let jpegModule: WebAssembly.Module | undefined;
let jpegExportsRef: WeakRef<JpegExports> | undefined;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replaceAll("\n", ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function moduleFromBase64(value: string): WebAssembly.Module {
  const bytes = decodeBase64(value);
  return new WebAssembly.Module(bytes.slice().buffer as ArrayBuffer);
}

function getJpegModule(): WebAssembly.Module {
  jpegModule ??= moduleFromBase64(JPEG_CODEC_WASM_BASE64);
  return jpegModule;
}

function jpegExports(): JpegExports {
  const cached = jpegExportsRef?.deref();
  if (cached) return cached;
  const created = new WebAssembly.Instance(getJpegModule())
    .exports as unknown as JpegExports;
  jpegExportsRef = new WeakRef(created);
  return created;
}

function checkedPixels(width: number, height: number): number {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width < 1 ||
    height < 1
  ) {
    throw new RangeError("invalid ImageScript framebuffer dimensions");
  }
  const pixels = BigInt(width) * BigInt(height);
  if (pixels > BigInt(IMAGE_SCRIPT_MAX_PIXELS)) {
    throw new RangeError("ImageScript framebuffer exceeds the pixel limit");
  }
  return Number(pixels);
}

function decodeJpeg(
  bytes: Uint8Array,
  options?: ImageScriptDecodeOptions,
): ImageScriptImage {
  const wasm = jpegExports();
  const inputPointer = wasm.walloc(bytes.byteLength);
  new Uint8Array(wasm.memory.buffer, inputPointer, bytes.byteLength).set(bytes);

  // The ImageScript codec takes ownership of the input allocation here.
  // Asking libjpeg for the canonical target lets it use a bounded DCT scale
  // before materializing pixels. It returns the smallest native 1/2^n scale
  // at least as large as requested; the exact ImageScript nearest resize is
  // still applied below.
  const decodedPointer = wasm.decode(
    inputPointer,
    bytes.byteLength,
    options?.targetWidth ?? 0,
    options?.targetHeight ?? 0,
  );
  if (decodedPointer === 0) throw new Error("jpg: failed to decode");
  if (decodedPointer === 1) throw new Error("jpg: failed to scale decoder");

  try {
    const width = wasm.decode_width(decodedPointer);
    const height = wasm.decode_height(decodedPointer);
    if (
      options &&
      (width < options.targetWidth || height < options.targetHeight ||
        width > options.sourceWidth || height > options.sourceHeight)
    ) {
      throw new Error("jpg: decoded dimensions disagree with the header");
    }
    const pixelFormat = wasm.decode_format(decodedPointer);
    const pixels = checkedPixels(width, height);
    const sourcePointer = wasm.decode_buffer(decodedPointer);
    const sourceLength = wasm.wlen();
    const channels = pixelFormat === 0
      ? 1
      : pixelFormat === 1
      ? 3
      : pixelFormat === 2
      ? 4
      : 0;
    if (channels === 0 || sourceLength !== channels * pixels) {
      throw new Error("jpg: invalid decoded framebuffer");
    }
    const source = new Uint8Array(
      wasm.memory.buffer,
      sourcePointer,
      sourceLength,
    );
    const outputWidth = options?.targetWidth ?? width;
    const outputHeight = options?.targetHeight ?? height;
    const bitmap = new Uint8Array(4 * outputWidth * outputHeight);

    // Convert and apply the exact ImageScript nearest-neighbour sampling in
    // one pass while the decoder-owned framebuffer is live. This avoids both
    // a full source copy and a second full RGBA framebuffer at the native DCT
    // scale.
    for (let outputY = 0; outputY < outputHeight; outputY += 1) {
      const sourceY = Math.floor(outputY * height / outputHeight);
      for (let outputX = 0; outputX < outputWidth; outputX += 1) {
        const sourceX = Math.floor(outputX * width / outputWidth);
        const sourceOffset = (sourceY * width + sourceX) * channels;
        const outputOffset = (outputY * outputWidth + outputX) * 4;
        if (pixelFormat === 0) {
          const value = source[sourceOffset];
          bitmap[outputOffset] = value;
          bitmap[outputOffset + 1] = value;
          bitmap[outputOffset + 2] = value;
        } else if (pixelFormat === 1) {
          bitmap[outputOffset] = source[sourceOffset];
          bitmap[outputOffset + 1] = source[sourceOffset + 1];
          bitmap[outputOffset + 2] = source[sourceOffset + 2];
        } else {
          const key = source[sourceOffset + 3];
          bitmap[outputOffset] = key * source[sourceOffset] / 0xff;
          bitmap[outputOffset + 1] = key * source[sourceOffset + 1] / 0xff;
          bitmap[outputOffset + 2] = key * source[sourceOffset + 2] / 0xff;
        }
        bitmap[outputOffset + 3] = 0xff;
      }
    }
    return new ImageScriptImage(outputWidth, outputHeight, bitmap);
  } finally {
    wasm.decode_free(decodedPointer);
  }
}

async function decodePng(
  bytes: Uint8Array,
  options?: ImageScriptDecodeOptions,
): Promise<ImageScriptImage> {
  const decoded = await decodePngBounded(
    bytes,
    IMAGE_SCRIPT_MAX_PIXELS,
    options?.targetWidth,
    options?.targetHeight,
    options?.signal,
    options?.sourceWidth,
    options?.sourceHeight,
  );
  if (
    options &&
    (decoded.width !== options.targetWidth ||
      decoded.height !== options.targetHeight)
  ) {
    throw new Error("png: decoded dimensions disagree with the header");
  }
  return new ImageScriptImage(decoded.width, decoded.height, decoded.bitmap);
}

function encodeJpeg(
  bitmap: Uint8Array,
  width: number,
  height: number,
  quality: number,
): Uint8Array {
  const wasm = jpegExports();
  const inputPointer = wasm.walloc(bitmap.byteLength);
  new Uint8Array(wasm.memory.buffer, inputPointer, bitmap.byteLength).set(
    bitmap,
  );

  // As in ImageScript, encode owns the input allocation and returns a
  // separately allocated output which the caller releases after copying.
  const outputPointer = wasm.encode(inputPointer, width, height, quality);
  const outputLength = wasm.wlen();
  try {
    return new Uint8Array(
      wasm.memory.buffer,
      outputPointer,
      outputLength,
    ).slice();
  } finally {
    wasm.wfree(outputPointer, outputLength);
  }
}

export class ImageScriptImage {
  public width: number;
  public height: number;
  public bitmap: Uint8Array;

  constructor(width: number, height: number, bitmap?: Uint8Array) {
    const pixels = checkedPixels(width, height);
    if (bitmap && bitmap.byteLength !== 4 * pixels) {
      throw new RangeError("invalid ImageScript framebuffer dimensions");
    }
    this.width = width;
    this.height = height;
    this.bitmap = bitmap ?? new Uint8Array(4 * pixels);
  }

  static async decode(
    bytes: Uint8Array,
    format: ImageFormat,
    options?: ImageScriptDecodeOptions,
  ): Promise<ImageScriptImage> {
    if (format === "png") {
      return await decodePng(bytes, options);
    }
    return decodeJpeg(bytes, options);
  }

  resize(width: number, height: number): ImageScriptImage {
    width |= 0;
    height |= 0;
    if (width < 1 || height < 1) {
      throw new RangeError("ImageScript resize dimensions must be positive");
    }
    if (width === this.width && height === this.height) return this;

    const source = new Uint32Array(
      this.bitmap.buffer,
      this.bitmap.byteOffset,
      this.bitmap.byteLength / 4,
    );
    const output = new Uint32Array(width * height);
    const xScale = this.width / width;
    const yScale = this.height / height;

    for (let y = 0; y < height; y += 1) {
      const outputRow = y * width;
      const sourceRow = this.width * Math.floor(y * yScale);
      for (let x = 0; x < width; x += 1) {
        output[x + outputRow] = source[sourceRow + Math.floor(x * xScale)];
      }
    }

    this.width = width;
    this.height = height;
    this.bitmap = new Uint8Array(output.buffer);
    return this;
  }

  async encodeJPEG(quality: number): Promise<Uint8Array> {
    const boundedQuality = Math.max(1, Math.min(100, quality));
    return encodeJpeg(this.bitmap, this.width, this.height, boundedQuality);
  }
}
