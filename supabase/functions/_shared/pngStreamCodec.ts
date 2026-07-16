/**
 * Bounded-memory PNG decoder for the moderation canonicalization path.
 *
 * PNG filters make the preceding scanline part of the decoding state. Keeping
 * one reconstructed row in place (plus a small input scratch buffer) avoids
 * the full-frame allocation made by ImageScript's lodepng WASM build. Pixels
 * are sampled directly into the requested nearest-neighbour output, so a
 * conventional 40MP image needs only its scanline plus the <=4MP framebuffer.
 */

export interface DecodedPng {
  width: number;
  height: number;
  bitmap: Uint8Array;
}

// A hostile, extremely wide PNG can make one filtered row larger than the
// entire Edge memory budget even while staying below the pixel ceiling. This
// fence leaves room for the isolate, the <=16MB output, and JPEG encoding.
export const MAX_PNG_SCANLINE_BYTES = 64 * 1024 * 1024;

const PNG_SIGNATURE = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
);
const INFLATE_SCRATCH_BYTES = 64 * 1024;

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface ParsedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  channels: number;
  bitsPerPixel: number;
  filterBytesPerPixel: number;
  palette?: Uint8Array;
  paletteAlpha?: Uint8Array;
  transparentGray?: number;
  transparentRgb?: readonly [number, number, number];
  idat: Uint8Array[];
}

let crcTable: Uint32Array | undefined;

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}

function chunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function pngCrc(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      crcTable[value] = crc >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return [1, 2, 4, 8, 16].includes(bitDepth);
    case 2:
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return [1, 2, 4, 8].includes(bitDepth);
    default:
      return false;
  }
}

function channelsFor(colorType: number): number {
  switch (colorType) {
    case 0:
    case 3:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return 0;
  }
}

function parsePng(bytes: Uint8Array, maxPixels: number): ParsedPng {
  if (
    bytes.byteLength < PNG_SIGNATURE.byteLength ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error("png: invalid signature");
  }

  let offset = PNG_SIGNATURE.byteLength;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let palette: Uint8Array | undefined;
  let paletteAlpha: Uint8Array | undefined;
  let transparentGray: number | undefined;
  let transparentRgb: readonly [number, number, number] | undefined;
  const idat: Uint8Array[] = [];
  let sawHeader = false;
  let sawPalette = false;
  let sawTransparency = false;
  let sawIdat = false;
  let idatEnded = false;
  let sawEnd = false;

  while (offset + 12 <= bytes.byteLength) {
    const length = readU32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const next = crcOffset + 4;
    if (!Number.isSafeInteger(next) || next > bytes.byteLength) {
      throw new Error("png: truncated chunk");
    }
    const type = chunkName(bytes, typeOffset);
    if (pngCrc(bytes, typeOffset, crcOffset) !== readU32(bytes, crcOffset)) {
      throw new Error(`png: invalid ${type} checksum`);
    }

    if (!sawHeader && type !== "IHDR") {
      throw new Error("png: IHDR must be first");
    }
    if (sawIdat && type !== "IDAT") idatEnded = true;

    switch (type) {
      case "IHDR": {
        if (sawHeader || offset !== 8 || length !== 13) {
          throw new Error("png: invalid IHDR");
        }
        width = readU32(bytes, dataOffset);
        height = readU32(bytes, dataOffset + 4);
        bitDepth = bytes[dataOffset + 8];
        colorType = bytes[dataOffset + 9];
        const compression = bytes[dataOffset + 10];
        const filter = bytes[dataOffset + 11];
        interlace = bytes[dataOffset + 12];
        if (
          width < 1 || height < 1 || width > 0x7fffffff ||
          height > 0x7fffffff ||
          BigInt(width) * BigInt(height) > BigInt(maxPixels) ||
          !validBitDepth(colorType, bitDepth) || compression !== 0 ||
          filter !== 0 || (interlace !== 0 && interlace !== 1)
        ) {
          throw new Error("png: unsupported IHDR");
        }
        sawHeader = true;
        break;
      }
      case "PLTE": {
        if (
          !sawHeader || sawPalette || sawIdat || colorType === 0 ||
          colorType === 4 || length < 3 || length > 768 || length % 3 !== 0
        ) {
          throw new Error("png: invalid PLTE");
        }
        if (colorType === 3 && length / 3 > 2 ** bitDepth) {
          throw new Error("png: palette exceeds bit depth");
        }
        palette = bytes.slice(dataOffset, crcOffset);
        sawPalette = true;
        break;
      }
      case "tRNS": {
        if (!sawHeader || sawTransparency || sawIdat) {
          throw new Error("png: invalid tRNS ordering");
        }
        if (colorType === 0 && length === 2) {
          transparentGray = (bytes[dataOffset] << 8) | bytes[dataOffset + 1];
        } else if (colorType === 2 && length === 6) {
          transparentRgb = [
            (bytes[dataOffset] << 8) | bytes[dataOffset + 1],
            (bytes[dataOffset + 2] << 8) | bytes[dataOffset + 3],
            (bytes[dataOffset + 4] << 8) | bytes[dataOffset + 5],
          ];
        } else if (
          colorType === 3 && sawPalette && length >= 1 && palette &&
          length <= palette.byteLength / 3
        ) {
          paletteAlpha = bytes.slice(dataOffset, crcOffset);
        } else {
          throw new Error("png: invalid tRNS");
        }
        sawTransparency = true;
        break;
      }
      case "IDAT":
        if (!sawHeader || idatEnded) {
          throw new Error("png: non-consecutive IDAT");
        }
        if (colorType === 3 && !sawPalette) {
          throw new Error("png: indexed image has no palette");
        }
        idat.push(bytes.subarray(dataOffset, crcOffset));
        sawIdat = true;
        break;
      case "IEND":
        if (!sawIdat || length !== 0 || next !== bytes.byteLength) {
          throw new Error("png: invalid IEND");
        }
        sawEnd = true;
        break;
      case "acTL":
      case "fcTL":
      case "fdAT":
        throw new Error("png: animated images are unsupported");
      default:
        // The first type byte's reserved case bit distinguishes critical
        // chunks. Unknown critical chunks cannot be decoded safely.
        if ((bytes[typeOffset] & 0x20) === 0) {
          throw new Error(`png: unknown critical chunk ${type}`);
        }
    }

    offset = next;
    if (sawEnd) break;
  }

  if (!sawHeader || !sawIdat || !sawEnd || offset !== bytes.byteLength) {
    throw new Error("png: incomplete image");
  }

  const channels = channelsFor(colorType);
  const bitsPerPixel = channels * bitDepth;
  return {
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    channels,
    bitsPerPixel,
    filterBytesPerPixel: Math.max(1, Math.ceil(bitsPerPixel / 8)),
    palette,
    paletteAlpha,
    transparentGray,
    transparentRgb,
    idat,
  };
}

class InflateReader {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #chunk: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  #offset = 0;

  constructor(parts: Uint8Array[]) {
    const compressed = new Blob(
      parts.map((part) => part.slice().buffer as ArrayBuffer),
    );
    this.#reader = compressed.stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader();
  }

  async readByte(): Promise<number> {
    const byte = new Uint8Array(1);
    await this.readExact(byte);
    return byte[0];
  }

  async readExact(target: Uint8Array): Promise<void> {
    let written = 0;
    while (written < target.byteLength) {
      if (this.#offset >= this.#chunk.byteLength) {
        const next = await this.#reader.read();
        if (next.done) throw new Error("png: truncated image data");
        this.#chunk = next.value;
        this.#offset = 0;
        if (this.#chunk.byteLength === 0) continue;
      }
      const count = Math.min(
        target.byteLength - written,
        this.#chunk.byteLength - this.#offset,
      );
      target.set(
        this.#chunk.subarray(this.#offset, this.#offset + count),
        written,
      );
      this.#offset += count;
      written += count;
    }
  }

  async expectEnd(): Promise<void> {
    if (this.#offset < this.#chunk.byteLength) {
      throw new Error("png: trailing image data");
    }
    while (true) {
      const next = await this.#reader.read();
      if (next.done) return;
      if (next.value.byteLength !== 0) {
        throw new Error("png: trailing image data");
      }
    }
  }

  async cancel(): Promise<void> {
    try {
      await this.#reader.cancel();
    } catch {
      // Preserve the decode error that caused cancellation.
    }
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance
    ? up
    : upperLeft;
}

async function reconstructRow(
  reader: InflateReader,
  row: Uint8Array,
  filter: number,
  bytesPerPixel: number,
  scratch: Uint8Array,
): Promise<void> {
  if (filter < 0 || filter > 4) throw new Error("png: invalid row filter");
  const oldUpperLeft = new Uint8Array(bytesPerPixel);

  for (let offset = 0; offset < row.byteLength;) {
    const count = Math.min(scratch.byteLength, row.byteLength - offset);
    const filtered = scratch.subarray(0, count);
    await reader.readExact(filtered);
    for (let local = 0; local < count; local += 1) {
      const index = offset + local;
      const ringIndex = index % bytesPerPixel;
      const up = row[index];
      const upperLeft = index >= bytesPerPixel ? oldUpperLeft[ringIndex] : 0;
      oldUpperLeft[ringIndex] = up;
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      row[index] = (filtered[local] + predictor) & 0xff;
    }
    offset += count;
  }
}

function scaledSample(value: number, bitDepth: number): number {
  if (bitDepth === 16) return value >>> 8;
  if (bitDepth === 8) return value;
  return Math.round(value * 255 / ((1 << bitDepth) - 1));
}

function packedSample(
  row: Uint8Array,
  pixel: number,
  bitDepth: number,
): number {
  const bitOffset = pixel * bitDepth;
  const shift = 8 - bitDepth - (bitOffset & 7);
  return (row[bitOffset >>> 3] >>> shift) & ((1 << bitDepth) - 1);
}

function writePixel(
  png: ParsedPng,
  row: Uint8Array,
  passPixel: number,
  output: Uint8Array,
  outputOffset: number,
): void {
  const { bitDepth, colorType, channels } = png;
  let sample0 = 0;
  let sample1 = 0;
  let sample2 = 0;
  let sample3 = 0;
  if (bitDepth < 8) {
    sample0 = packedSample(row, passPixel, bitDepth);
  } else if (bitDepth === 8) {
    const offset = passPixel * channels;
    sample0 = row[offset];
    if (channels > 1) sample1 = row[offset + 1];
    if (channels > 2) sample2 = row[offset + 2];
    if (channels > 3) sample3 = row[offset + 3];
  } else {
    const offset = passPixel * channels * 2;
    sample0 = (row[offset] << 8) | row[offset + 1];
    if (channels > 1) {
      sample1 = (row[offset + 2] << 8) | row[offset + 3];
    }
    if (channels > 2) {
      sample2 = (row[offset + 4] << 8) | row[offset + 5];
    }
    if (channels > 3) {
      sample3 = (row[offset + 6] << 8) | row[offset + 7];
    }
  }

  if (colorType === 0) {
    const gray = scaledSample(sample0, bitDepth);
    output[outputOffset] = gray;
    output[outputOffset + 1] = gray;
    output[outputOffset + 2] = gray;
    output[outputOffset + 3] = sample0 === png.transparentGray ? 0 : 255;
  } else if (colorType === 2) {
    output[outputOffset] = scaledSample(sample0, bitDepth);
    output[outputOffset + 1] = scaledSample(sample1, bitDepth);
    output[outputOffset + 2] = scaledSample(sample2, bitDepth);
    output[outputOffset + 3] = png.transparentRgb &&
        sample0 === png.transparentRgb[0] &&
        sample1 === png.transparentRgb[1] &&
        sample2 === png.transparentRgb[2]
      ? 0
      : 255;
  } else if (colorType === 3) {
    const index = sample0;
    const paletteOffset = index * 3;
    if (!png.palette || paletteOffset + 2 >= png.palette.byteLength) {
      throw new Error("png: palette index is out of bounds");
    }
    output[outputOffset] = png.palette[paletteOffset];
    output[outputOffset + 1] = png.palette[paletteOffset + 1];
    output[outputOffset + 2] = png.palette[paletteOffset + 2];
    output[outputOffset + 3] = png.paletteAlpha?.[index] ?? 255;
  } else if (colorType === 4) {
    const gray = scaledSample(sample0, bitDepth);
    output[outputOffset] = gray;
    output[outputOffset + 1] = gray;
    output[outputOffset + 2] = gray;
    output[outputOffset + 3] = scaledSample(sample1, bitDepth);
  } else {
    output[outputOffset] = scaledSample(sample0, bitDepth);
    output[outputOffset + 1] = scaledSample(sample1, bitDepth);
    output[outputOffset + 2] = scaledSample(sample2, bitDepth);
    output[outputOffset + 3] = scaledSample(sample3, bitDepth);
  }
}

function passSize(size: number, start: number, step: number): number {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

/** Decode PNG pixels directly into a nearest-neighbour output framebuffer. */
export async function decodePngBounded(
  bytes: Uint8Array,
  maxPixels: number,
  targetWidth?: number,
  targetHeight?: number,
  signal?: AbortSignal,
  expectedSourceWidth?: number,
  expectedSourceHeight?: number,
): Promise<DecodedPng> {
  if (signal?.aborted) throw signal.reason;
  const png = parsePng(bytes, maxPixels);
  if (
    (expectedSourceWidth !== undefined && png.width !== expectedSourceWidth) ||
    (expectedSourceHeight !== undefined && png.height !== expectedSourceHeight)
  ) {
    throw new Error("png: decoded dimensions disagree with the header");
  }
  const outputWidth = targetWidth ?? png.width;
  const outputHeight = targetHeight ?? png.height;
  if (
    !Number.isInteger(outputWidth) || !Number.isInteger(outputHeight) ||
    outputWidth < 1 || outputHeight < 1 || outputWidth > png.width ||
    outputHeight > png.height ||
    BigInt(outputWidth) * BigInt(outputHeight) > BigInt(maxPixels)
  ) {
    throw new RangeError("png: invalid output dimensions");
  }

  const output = new Uint8Array(4 * outputWidth * outputHeight);
  const reader = new InflateReader(png.idat);
  const scratch = new Uint8Array(INFLATE_SCRATCH_BYTES);
  const passes = png.interlace === 0 ? [[0, 0, 1, 1] as const] : ADAM7;

  try {
    for (const [xStart, yStart, xStep, yStep] of passes) {
      const passWidth = passSize(png.width, xStart, xStep);
      const passHeight = passSize(png.height, yStart, yStep);
      if (passWidth === 0 || passHeight === 0) continue;
      const rowBytes = Math.ceil(passWidth * png.bitsPerPixel / 8);
      if (rowBytes > MAX_PNG_SCANLINE_BYTES) {
        throw new RangeError("png: filtered scanline exceeds memory limit");
      }
      const row = new Uint8Array(rowBytes);

      for (let passY = 0; passY < passHeight; passY += 1) {
        if (signal?.aborted) throw signal.reason;
        const filter = await reader.readByte();
        await reconstructRow(
          reader,
          row,
          filter,
          png.filterBytesPerPixel,
          scratch,
        );

        const sourceY = yStart + passY * yStep;
        const outputY = Math.ceil(sourceY * outputHeight / png.height);
        if (
          outputY >= outputHeight ||
          Math.floor(outputY * png.height / outputHeight) !== sourceY
        ) continue;

        const outputRow = outputY * outputWidth;
        for (let outputX = 0; outputX < outputWidth; outputX += 1) {
          const sourceX = Math.floor(outputX * png.width / outputWidth);
          if (sourceX < xStart || (sourceX - xStart) % xStep !== 0) continue;
          const passPixel = (sourceX - xStart) / xStep;
          writePixel(
            png,
            row,
            passPixel,
            output,
            (outputRow + outputX) * 4,
          );
        }
      }
    }
    await reader.expectEnd();
  } catch (error) {
    await reader.cancel();
    throw error;
  }

  return { width: outputWidth, height: outputHeight, bitmap: output };
}
