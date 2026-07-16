import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canonicalizeImage } from "./imageCanonical.ts";
import { decodePngBounded } from "./pngStreamCodec.ts";

const SIGNATURE = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
);
const PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

type Mode = { colorType: number; bitDepth: number };

function concat(parts: Uint8Array<ArrayBufferLike>[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((length, part) => length + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    value >>> 24,
    value >>> 16,
    value >>> 8,
    value,
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(
  type: string,
  data: Uint8Array<ArrayBufferLike> = new Uint8Array(),
): Uint8Array {
  const name = new TextEncoder().encode(type);
  const body = concat([name, data]);
  return concat([u32(data.byteLength), body, u32(crc32(body))]);
}

function channels(colorType: number): number {
  return colorType === 0 || colorType === 3
    ? 1
    : colorType === 2
    ? 3
    : colorType === 4
    ? 2
    : 4;
}

function sample(mode: Mode, x: number, y: number, channel: number): number {
  if (mode.colorType === 3) {
    const entries = Math.min(16, 2 ** mode.bitDepth);
    return (x * 3 + y * 5) % entries;
  }
  const maximum = mode.bitDepth === 16 ? 0xffff : (1 << mode.bitDepth) - 1;
  return (x * 13 + y * 17 + channel * 23 + 3) % (maximum + 1);
}

function rawRow(
  mode: Mode,
  width: number,
  y: number,
  xStart: number,
  xStep: number,
): Uint8Array {
  const count = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep);
  const channelCount = channels(mode.colorType);
  const row = new Uint8Array(
    Math.ceil(count * channelCount * mode.bitDepth / 8),
  );
  for (let pixel = 0; pixel < count; pixel += 1) {
    const x = xStart + pixel * xStep;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = sample(mode, x, y, channel);
      const sampleIndex = pixel * channelCount + channel;
      if (mode.bitDepth < 8) {
        const bitOffset = sampleIndex * mode.bitDepth;
        const shift = 8 - mode.bitDepth - (bitOffset & 7);
        row[bitOffset >>> 3] |= value << shift;
      } else if (mode.bitDepth === 8) {
        row[sampleIndex] = value;
      } else {
        row[sampleIndex * 2] = value >>> 8;
        row[sampleIndex * 2 + 1] = value;
      }
    }
  }
  return row;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upperLeft);
  return dl <= du && dl <= dul ? left : du <= dul ? up : upperLeft;
}

function filteredRow(
  row: Uint8Array,
  previous: Uint8Array,
  filter: number,
  bytesPerPixel: number,
): Uint8Array {
  const output = new Uint8Array(row.byteLength + 1);
  output[0] = filter;
  for (let index = 0; index < row.byteLength; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel
      ? previous[index - bytesPerPixel]
      : 0;
    const predictor = filter === 1
      ? left
      : filter === 2
      ? up
      : filter === 3
      ? Math.floor((left + up) / 2)
      : filter === 4
      ? paeth(left, up, upperLeft)
      : 0;
    output[index + 1] = (row[index] - predictor) & 0xff;
  }
  return output;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fixture(
  mode: Mode,
  width: number,
  height: number,
  interlace: 0 | 1,
): Promise<Uint8Array> {
  const channelCount = channels(mode.colorType);
  const bytesPerPixel = Math.max(
    1,
    Math.ceil(channelCount * mode.bitDepth / 8),
  );
  const scanlines: Uint8Array[] = [];
  const passes = interlace === 0 ? [[0, 0, 1, 1] as const] : PASSES;
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep);
    const passHeight = height <= yStart
      ? 0
      : Math.ceil((height - yStart) / yStep);
    if (passWidth === 0 || passHeight === 0) continue;
    let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(
      Math.ceil(passWidth * channelCount * mode.bitDepth / 8),
    );
    for (let passY = 0; passY < passHeight; passY += 1) {
      const row = rawRow(
        mode,
        width,
        yStart + passY * yStep,
        xStart,
        xStep,
      );
      scanlines.push(
        filteredRow(row, previous, passY % 5, bytesPerPixel),
      );
      previous = row;
    }
  }

  const ihdr = concat([
    u32(width),
    u32(height),
    Uint8Array.of(mode.bitDepth, mode.colorType, 0, 0, interlace),
  ]);
  const chunks: Uint8Array<ArrayBufferLike>[] = [
    SIGNATURE,
    chunk("IHDR", ihdr),
  ];
  if (mode.colorType === 3) {
    const entries = Math.min(16, 2 ** mode.bitDepth);
    const palette = new Uint8Array(entries * 3);
    const alpha = new Uint8Array(entries);
    for (let index = 0; index < entries; index += 1) {
      palette[index * 3] = index * 37;
      palette[index * 3 + 1] = index * 71;
      palette[index * 3 + 2] = index * 109;
      alpha[index] = 255 - index * 11;
    }
    chunks.push(chunk("PLTE", palette), chunk("tRNS", alpha));
  } else if (mode.colorType === 0) {
    chunks.push(chunk("tRNS", Uint8Array.of(0, sample(mode, 0, 0, 0))));
  } else if (mode.colorType === 2) {
    chunks.push(chunk(
      "tRNS",
      concat([
        Uint8Array.of(0, sample(mode, 0, 0, 0)),
        Uint8Array.of(0, sample(mode, 0, 0, 1)),
        Uint8Array.of(0, sample(mode, 0, 0, 2)),
      ]),
    ));
  }
  chunks.push(chunk("IDAT", await deflate(concat(scanlines))), chunk("IEND"));
  return concat(chunks);
}

function to8(value: number, depth: number): number {
  return depth === 16
    ? value >>> 8
    : depth === 8
    ? value
    : Math.round(value * 255 / ((1 << depth) - 1));
}

function expectedPixel(mode: Mode, x: number, y: number): number[] {
  const s0 = sample(mode, x, y, 0);
  const s1 = sample(mode, x, y, 1);
  const s2 = sample(mode, x, y, 2);
  const s3 = sample(mode, x, y, 3);
  if (mode.colorType === 0) {
    const gray = to8(s0, mode.bitDepth);
    return [gray, gray, gray, s0 === sample(mode, 0, 0, 0) ? 0 : 255];
  }
  if (mode.colorType === 2) {
    const transparent = s0 === sample(mode, 0, 0, 0) &&
      s1 === sample(mode, 0, 0, 1) && s2 === sample(mode, 0, 0, 2);
    return [
      to8(s0, mode.bitDepth),
      to8(s1, mode.bitDepth),
      to8(s2, mode.bitDepth),
      transparent ? 0 : 255,
    ];
  }
  if (mode.colorType === 3) {
    return [s0 * 37 & 0xff, s0 * 71 & 0xff, s0 * 109 & 0xff, 255 - s0 * 11];
  }
  if (mode.colorType === 4) {
    const gray = to8(s0, mode.bitDepth);
    return [gray, gray, gray, to8(s1, mode.bitDepth)];
  }
  return [
    to8(s0, mode.bitDepth),
    to8(s1, mode.bitDepth),
    to8(s2, mode.bitDepth),
    to8(s3, mode.bitDepth),
  ];
}

Deno.test("bounded PNG decode covers filters, Adam7, legal color modes, and nearest sampling", async () => {
  const modes: Mode[] = [
    ...[1, 2, 4, 8, 16].map((bitDepth) => ({ colorType: 0, bitDepth })),
    ...[8, 16].map((bitDepth) => ({ colorType: 2, bitDepth })),
    ...[1, 2, 4, 8].map((bitDepth) => ({ colorType: 3, bitDepth })),
    ...[8, 16].map((bitDepth) => ({ colorType: 4, bitDepth })),
    ...[8, 16].map((bitDepth) => ({ colorType: 6, bitDepth })),
  ];
  const sourceWidth = 17;
  const sourceHeight = 13;
  const width = 7;
  const height = 5;

  for (const mode of modes) {
    for (const interlace of [0, 1] as const) {
      const bytes = await fixture(mode, sourceWidth, sourceHeight, interlace);
      const decoded = await decodePngBounded(
        bytes,
        40_000_000,
        width,
        height,
        undefined,
        sourceWidth,
        sourceHeight,
      );
      const expected = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          expected.set(
            expectedPixel(
              mode,
              Math.floor(x * sourceWidth / width),
              Math.floor(y * sourceHeight / height),
            ),
            (y * width + x) * 4,
          );
        }
      }
      assertEquals(
        decoded.bitmap,
        expected,
        `color=${mode.colorType} depth=${mode.bitDepth} adam7=${interlace}`,
      );
    }
  }
});

async function uniformGrayscalePng(
  width: number,
  height: number,
): Promise<Uint8Array> {
  let row = 0;
  const raw = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (row >= height) {
        controller.close();
        return;
      }
      const scanline = new Uint8Array(width + 1);
      scanline.fill(0x7f, 1);
      controller.enqueue(scanline);
      row += 1;
    },
  });
  const compressed = new Uint8Array(
    await new Response(
      raw.pipeThrough(
        new CompressionStream("deflate") as unknown as ReadableWritablePair<
          Uint8Array,
          Uint8Array
        >,
      ),
    ).arrayBuffer(),
  );
  return concat([
    SIGNATURE,
    chunk(
      "IHDR",
      concat([
        u32(width),
        u32(height),
        Uint8Array.of(8, 0, 0, 0, 0),
      ]),
    ),
    chunk("IDAT", compressed),
    chunk("IEND"),
  ]);
}

Deno.test("canonicalization accepts a conventional image at the full 40MP ceiling", async () => {
  const source = await uniformGrayscalePng(8000, 5000);
  const canonical = await canonicalizeImage(source);
  assertEquals(
    canonical && {
      width: canonical.width,
      height: canonical.height,
      mimeType: canonical.mimeType,
    },
    { width: 2529, height: 1581, mimeType: "image/jpeg" },
  );
});
