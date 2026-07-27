/**
 * Perceptual distance between two pixels — the innermost function of the diff engine.
 *
 * Weighted YIQ rather than plain RGB: luma dominates, and two chroma axes catch hue
 * changes that leave luminance untouched. Chosen over CIEDE2000, which needs an
 * sRGB -> Lab conversion per pixel (cube roots, roughly twenty times the arithmetic) for
 * fidelity that is irrelevant once the result is compared against a threshold.
 */

import { LUMA_DELTA_WEIGHT } from './sensitivity';

const INV_255 = 1 / 255;

/**
 * Weights of the two squared chroma terms. Deliberately much smaller than the luma
 * weight: a hue shift at constant brightness is a real change, but a less conspicuous
 * one than the equivalent brightness shift.
 */
const CHROMA_I_WEIGHT = 0.299;
const CHROMA_Q_WEIGHT = 0.1957;

/*
 * RGB -> YIQ coefficients. The transform is linear, so the *channel differences* can be
 * transformed once instead of converting each pixel and subtracting: nine multiplies
 * per comparison rather than eighteen.
 */
const Y_R = 0.29889531;
const Y_G = 0.58662247;
const Y_B = 0.11448223;
const I_R = 0.59597799;
const I_G = -0.2741761;
const I_B = -0.32180189;
const Q_R = 0.21147017;
const Q_G = -0.52261711;
const Q_B = 0.31114694;

/**
 * Weighted YIQ distance between the pixel at byte offset `ia` in `a` and the pixel at
 * byte offset `ib` in `b`.
 *
 * Both pixels are composited over opaque white first, so that a change in transparency
 * counts as a visible change while the same rendered colour expressed with a different
 * alpha does not.
 *
 * Byte offsets, not pixel indices: pass `(y * width + x) * 4`.
 *
 * @returns 0 for pixels that render identically, up to MAX_YIQ_DELTA (35215).
 */
export function deltaAt(
  a: Uint8ClampedArray,
  ia: number,
  b: Uint8ClampedArray,
  ib: number,
): number {
  const alphaA = a[ia + 3] * INV_255;
  const alphaB = b[ib + 3] * INV_255;

  // Contribution of the white backdrop showing through each pixel.
  const backdropA = 255 * (1 - alphaA);
  const backdropB = 255 * (1 - alphaB);

  const dr = a[ia] * alphaA + backdropA - (b[ib] * alphaB + backdropB);
  const dg = a[ia + 1] * alphaA + backdropA - (b[ib + 1] * alphaB + backdropB);
  const db = a[ia + 2] * alphaA + backdropA - (b[ib + 2] * alphaB + backdropB);

  // Overwhelmingly the common case in a candidate tile; skips nine multiplies.
  if (dr === 0 && dg === 0 && db === 0) {
    return 0;
  }

  const dy = Y_R * dr + Y_G * dg + Y_B * db;
  const di = I_R * dr + I_G * dg + I_B * db;
  const dq = Q_R * dr + Q_G * dg + Q_B * db;

  return LUMA_DELTA_WEIGHT * dy * dy + CHROMA_I_WEIGHT * di * di + CHROMA_Q_WEIGHT * dq * dq;
}
