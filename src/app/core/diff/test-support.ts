/**
 * Synthetic image builders for the `core/diff` specs.
 *
 * TEST-ONLY. Nothing in the application imports this file, so it is tree-shaken out of
 * the bundle; it lives beside the code it supports rather than in a separate tree so the
 * specs read as one unit.
 *
 * Images are built in code rather than loaded from fixtures: a spec that says "one black
 * pixel at (50,60)" is its own documentation, and there is no binary to keep in sync.
 */

import { ImageDataLike } from './diff-types';

/** Opaque colour as [r, g, b], each 0..255. */
export type Rgb = readonly [number, number, number];

export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];

/**
 * Re-exported so specs have a single import for their fixtures. The value itself lives
 * in `sensitivity.ts`, beside the app default it must never drift from.
 */
export { DEFAULT_SETTINGS } from './sensitivity';

/** A uniformly filled, fully opaque image. */
export function solidImage(width: number, height: number, fill: Rgb = WHITE): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/**
 * Paint one pixel. Out-of-bounds coordinates throw rather than corrupting a neighbouring
 * row — a silently wrapped write would make a failing spec very hard to read.
 */
export function setPixel(
  image: ImageDataLike,
  x: number,
  y: number,
  colour: Rgb,
  alpha = 255,
): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    throw new Error(`setPixel(${x}, ${y}) is outside ${image.width}x${image.height}`);
  }
  const i = (y * image.width + x) * 4;
  image.data[i] = colour[0];
  image.data[i + 1] = colour[1];
  image.data[i + 2] = colour[2];
  image.data[i + 3] = alpha;
}

/** Paint a rectangle. Bounds are checked per pixel by `setPixel`. */
export function fillRect(
  image: ImageDataLike,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: Rgb,
  alpha = 255,
): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      setPixel(image, x + dx, y + dy, colour, alpha);
    }
  }
}

/**
 * Paint every row of an image a distinct grey.
 *
 * Row-dependent content is what makes the differing-width specs meaningful. Code that
 * used one shared row stride for both images would compare row N of one against part of
 * row N+1 of the other — and against a uniform image that mistake finds nothing at all.
 */
export function paintRowGradient(image: ImageDataLike): void {
  for (let y = 0; y < image.height; y++) {
    const grey = (y * 7) % 256;
    for (let x = 0; x < image.width; x++) {
      setPixel(image, x, y, [grey, grey, grey]);
    }
  }
}

/** Independent copy — for building an "after" image from a "before". */
export function cloneImage(image: ImageDataLike): ImageDataLike {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}
