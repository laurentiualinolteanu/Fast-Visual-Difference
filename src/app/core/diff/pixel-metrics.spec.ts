import { deltaAt } from './pixel-metrics';
import { DEFAULT_SENSITIVITY, MAX_YIQ_DELTA, deriveParams } from './sensitivity';

/**
 * A single pixel as a 4-byte buffer. Built here rather than via `test-support`, which is
 * image-oriented: these specs are about the metric alone and should not depend on the
 * image harness being correct.
 */
function pixel(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

/** Distance between two standalone pixels. */
function delta(p: Uint8ClampedArray, q: Uint8ClampedArray): number {
  return deltaAt(p, 0, q, 0);
}

const THRESHOLD = deriveParams(DEFAULT_SENSITIVITY).colorThreshold;

describe('deltaAt', () => {
  describe('scale', () => {
    it('is zero for identical pixels', () => {
      expect(delta(pixel(0, 0, 0), pixel(0, 0, 0))).toBe(0);
      expect(delta(pixel(17, 200, 99), pixel(17, 200, 99))).toBe(0);
    });

    it('is about 32857 for black against white', () => {
      // Pure luma: the two chroma terms cancel, leaving LUMA_DELTA_WEIGHT * 255^2.
      expect(delta(pixel(0, 0, 0), pixel(255, 255, 255))).toBeCloseTo(32857, 0);
    });

    it('peaks at MAX_YIQ_DELTA, which is therefore a tight ceiling', () => {
      // The whole sensitivity curve is expressed as a fraction of MAX_YIQ_DELTA, so it
      // has to be the *actual* maximum rather than merely an upper bound. Cyan against
      // red maximises the quadratic form over the RGB cube; asserting only "<= ceiling"
      // with some arbitrary pair would pass even if the constant were badly wrong.
      const peak = delta(pixel(0, 255, 255), pixel(255, 0, 0));

      expect(peak).toBeLessThanOrEqual(MAX_YIQ_DELTA);
      expect(peak).toBeGreaterThan(MAX_YIQ_DELTA * 0.999);
    });

    it('is symmetric', () => {
      const p = pixel(12, 200, 40);
      const q = pixel(200, 12, 90);
      expect(delta(p, q)).toBeCloseTo(delta(q, p), 6);
    });
  });

  describe('chroma sensitivity', () => {
    it('detects a hue swap at similar luminance (#808000 -> #008080)', () => {
      expect(delta(pixel(128, 128, 0), pixel(0, 128, 128))).toBeGreaterThan(THRESHOLD);
    });

    it('detects a hue change at *identical* luminance, which a luma-only metric could not', () => {
      // The argument, made entirely through the public API so that retuning the YIQ
      // coefficients cannot leave a stale hand-computed number asserting nothing:
      //
      //   1. a full one-step greyscale difference scores far below the threshold, so
      //      luma alone needs a much larger gap than that to trip it;
      expect(delta(pixel(76, 76, 76), pixel(77, 77, 77))).toBeLessThan(THRESHOLD);

      //   2. pure red and this grey differ in luminance by *less* than that single step
      //      (dY = 0.22 of 255), yet are reported as clearly different.
      //
      // So what makes them different cannot be the luma term. Only the chroma terms are
      // left, which is the entire reason they are computed.
      expect(delta(pixel(255, 0, 0), pixel(76, 76, 76))).toBeGreaterThan(THRESHOLD);
    });
  });

  describe('alpha flattening', () => {
    it('reports a difference when only alpha changes', () => {
      // Opaque black against half-transparent black: over white these render very
      // differently, so the change must be visible to the engine.
      expect(delta(pixel(0, 0, 0, 255), pixel(0, 0, 0, 128))).toBeGreaterThan(THRESHOLD);
    });

    it('reports no difference between colours that render identically', () => {
      // Fully transparent pixels composite to white whatever their colour channels say.
      expect(delta(pixel(255, 0, 0, 0), pixel(0, 0, 255, 0))).toBe(0);
      // ...and a fully transparent pixel matches opaque white.
      expect(delta(pixel(12, 34, 56, 0), pixel(255, 255, 255, 255))).toBe(0);
    });
  });

  describe('byte offsets', () => {
    it('reads the pixel at the given offset, not the start of the buffer', () => {
      // Two-pixel buffers: [white, black] and [white, white].
      const a = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
      const b = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);

      expect(deltaAt(a, 0, b, 0)).toBe(0);
      expect(deltaAt(a, 4, b, 4)).toBeCloseTo(32857, 0);
    });
  });
});
