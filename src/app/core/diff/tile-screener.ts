/**
 * Stage 1 — tile screening.
 *
 * Both images are read as 32-bit words, one per RGBA pixel, and every pixel of the
 * compared overlap is tested with a single integer compare. Tiles containing no
 * difference are dropped here and never reach the expensive per-pixel scoring in
 * Stage 2. For a screenshot pair — mostly identical by nature — that is the single
 * largest reason the engine is fast.
 *
 * Word equality is endianness-independent: we only ever ask "are these two words the
 * same", never what the bytes inside them mean.
 */

import { ImageDataLike } from './diff-types';
import { TILE } from './sensitivity';

export interface ScreenResult {
  /** One flag per tile, row-major: 1 = this tile contains at least one differing pixel. */
  readonly candidates: Uint8Array;
  readonly tilesX: number;
  readonly tilesY: number;
  /** Flagged tiles. Should be a small fraction of `tilesX * tilesY` for a typical pair. */
  readonly candidateCount: number;
}

/**
 * Screen the top-left `width` x `height` overlap of two images.
 *
 * The two images may have different dimensions; each is indexed with its own row
 * stride, so no assumption is made that their rows line up in memory.
 */
export function screenTiles(
  a: ImageDataLike,
  b: ImageDataLike,
  width: number,
  height: number,
): ScreenResult {
  assertComparableRegion(a, b, width, height);

  const wordsA = pixelWords(a, 'before image');
  const wordsB = pixelWords(b, 'after image');

  const tilesX = Math.ceil(width / TILE);
  const tilesY = Math.ceil(height / TILE);
  const candidates = new Uint8Array(tilesX * tilesY);

  // Row-major, so both buffers are read sequentially. A tile-ordered walk could stop
  // early once a tile is already flagged, but it would read each buffer in short
  // strided bursts; on this access pattern the locality is worth more than the
  // early exit, and the redundant writes land in a small, hot array.
  for (let y = 0; y < height; y++) {
    const tileRow = Math.floor(y / TILE) * tilesX;
    let ia = y * a.width;
    let ib = y * b.width;

    for (let x = 0; x < width; x++, ia++, ib++) {
      if (wordsA[ia] !== wordsB[ib]) {
        candidates[tileRow + Math.floor(x / TILE)] = 1;
      }
    }
  }

  let candidateCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    candidateCount += candidates[i];
  }

  return { candidates, tilesX, tilesY, candidateCount };
}

/**
 * View an image's RGBA bytes as one 32-bit word per pixel.
 *
 * Both preconditions are checked because the alternative is a bare `RangeError` thrown
 * from inside the `Uint32Array` constructor, with nothing to say which image was at
 * fault — and the worker rebuilds images from a transferred `ArrayBuffer`, where a
 * short or misaligned buffer is a plausible wiring mistake.
 */
function pixelWords(image: ImageDataLike, label: string): Uint32Array {
  const { data, width, height } = image;
  const requiredBytes = width * height * 4;

  if (data.length < requiredBytes) {
    throw new Error(
      `${label}: pixel buffer holds ${data.length} bytes, but ${width}x${height} needs ${requiredBytes}`,
    );
  }
  if (data.byteOffset % Uint32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(
      `${label}: pixel buffer starts at byte ${data.byteOffset}, which is not 4-byte aligned, so it cannot be read as 32-bit words`,
    );
  }

  return new Uint32Array(data.buffer, data.byteOffset, width * height);
}

/** The compared region must be a real overlap of both images. */
function assertComparableRegion(
  a: ImageDataLike,
  b: ImageDataLike,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) {
    throw new Error(`Compared region must be non-empty, got ${width}x${height}`);
  }
  if (width > a.width || width > b.width || height > a.height || height > b.height) {
    throw new Error(
      `Compared region ${width}x${height} does not fit inside both ` +
        `${a.width}x${a.height} and ${b.width}x${b.height}`,
    );
  }
}
