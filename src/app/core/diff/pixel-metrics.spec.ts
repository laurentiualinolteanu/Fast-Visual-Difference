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

    it('never exceeds MAX_YIQ_DELTA', () => {
      // MAX_YIQ_DELTA is the ceiling the sensitivity curve is expressed as a fraction of;
      // the most extreme pair must actually sit under it.
      expect(delta(pixel(255, 0, 255), pixel(0, 255, 0))).toBeLessThanOrEqual(MAX_YIQ_DELTA);
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

    it('detects a hue change at *identical* luminance, which a luma-only metric cannot', () => {
      // Pure red and the grey of the same luminance: dY is 0.2 out of 255, so the luma
      // term contributes 0.024 - far below the threshold of ~163. Only the chroma terms
      // make this visible, which is the whole reason they are computed.
      const red = pixel(255, 0, 0);
      const equalLumaGrey = pixel(76, 76, 76);

      const full = delta(red, equalLumaGrey);
      const lumaOnlyContribution = 0.5053 * Math.pow(0.29889531 * 179 - 0.58662247 * 76 - 0.11448223 * 76, 2);

      expect(lumaOnlyContribution).toBeLessThan(THRESHOLD);
      expect(full).toBeGreaterThan(THRESHOLD);
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
