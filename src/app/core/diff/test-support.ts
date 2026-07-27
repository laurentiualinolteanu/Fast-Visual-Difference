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

import { DiffSettings, ImageDataLike } from './diff-types';
import { DEFAULT_SENSITIVITY } from './sensitivity';

/** Opaque colour as [r, g, b], each 0..255. */
export type Rgb = readonly [number, number, number];

export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];

/** The settings the app starts with — what most specs should assert against. */
export const DEFAULT_SETTINGS: DiffSettings = {
  sensitivity: DEFAULT_SENSITIVITY,
  suppressAntiAliasing: true,
};

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

/** Independent copy — for building an "after" image from a "before". */
export function cloneImage(image: ImageDataLike): ImageDataLike {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}
