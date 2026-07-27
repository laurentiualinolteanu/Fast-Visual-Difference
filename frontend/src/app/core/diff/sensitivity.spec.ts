import { DEFAULT_SENSITIVITY, MAX_SENSITIVITY, MIN_SENSITIVITY, deriveParams } from './sensitivity';

/** Every slider position, for the monotonicity checks. */
const ALL_POSITIONS = Array.from(
  { length: MAX_SENSITIVITY - MIN_SENSITIVITY + 1 },
  (_, i) => MIN_SENSITIVITY + i,
);

describe('deriveParams', () => {
  describe('at the default sensitivity', () => {
    it('detects a single changed pixel', () => {
      // The design's central claim is that noise is rejected structurally, not by area.
      // If this is ever > 1, a one-pixel change is silently filtered out and the
      // "tiny 1-10 pixel changes" case fails at the setting everyone will use.
      expect(deriveParams(DEFAULT_SENSITIVITY).minChangedPixels).toBe(1);
    });

    it('fires on a luminance step of about 18/255', () => {
      // This is the number the UI shows the user, so it has to be meaningful:
      // low enough to catch a #333 -> #555 text edit, high enough to ignore shimmer.
      // Asserted as the band the backlog allows rather than the exact current value,
      // so T20 can retune the curve within spec without breaking the build.
      const step = deriveParams(DEFAULT_SENSITIVITY).equivalentLumaStep;

      expect(step).toBeGreaterThanOrEqual(17);
      expect(step).toBeLessThanOrEqual(19);
    });
  });

  describe('monotonicity across the slider', () => {
    it('lowers the colour threshold at every step', () => {
      const thresholds = ALL_POSITIONS.map((s) => deriveParams(s).colorThreshold);

      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i])
          .withContext(`S=${ALL_POSITIONS[i]} must be stricter than S=${ALL_POSITIONS[i - 1]}`)
          .toBeLessThan(thresholds[i - 1]);
      }
    });

    it('never raises the minimum cluster size', () => {
      // Non-increasing, not strictly decreasing: the curve floors at 1 from S=4 upwards,
      // which is the point — the strict end of the slider must still report single pixels.
      const clusters = ALL_POSITIONS.map((s) => deriveParams(s).minChangedPixels);

      for (let i = 1; i < clusters.length; i++) {
        expect(clusters[i])
          .withContext(`S=${ALL_POSITIONS[i]} must not be coarser than S=${ALL_POSITIONS[i - 1]}`)
          .toBeLessThanOrEqual(clusters[i - 1]);
      }
      expect(clusters[clusters.length - 1]).toBe(1);
    });

    it('produces positive parameters at every position', () => {
      for (const s of ALL_POSITIONS) {
        const params = deriveParams(s);
        expect(params.colorThreshold).withContext(`S=${s}`).toBeGreaterThan(0);
        expect(params.minChangedPixels).withContext(`S=${s}`).toBeGreaterThanOrEqual(1);
        expect(params.equivalentLumaStep).withContext(`S=${s}`).toBeGreaterThan(0);
      }
    });
  });

  describe('input handling', () => {
    it('clamps below the minimum', () => {
      expect(deriveParams(0)).toEqual(deriveParams(MIN_SENSITIVITY));
      expect(deriveParams(-5)).toEqual(deriveParams(MIN_SENSITIVITY));
    });

    it('clamps above the maximum', () => {
      expect(deriveParams(99)).toEqual(deriveParams(MAX_SENSITIVITY));
    });

    it('rounds fractional positions', () => {
      expect(deriveParams(5.4)).toEqual(deriveParams(5));
      expect(deriveParams(5.6)).toEqual(deriveParams(6));
    });
  });
});
