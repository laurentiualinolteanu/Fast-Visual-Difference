import { buildChangeMask } from './change-mask';
import { Box, DiffSettings, ImageDataLike } from './diff-types';
import { groupRegions } from './region-grouper';
import { BRIDGE_CELLS, CELL, DEFAULT_SETTINGS, deriveParams } from './sensitivity';
import { BLACK, cloneImage, fillRect, setPixel, solidImage, withSettings } from './test-support';
import { screenTiles } from './tile-screener';

/**
 * Run the whole pipeline so far: screen, score, group. Regions are what a reviewer
 * eventually sees, so it is worth exercising the real path rather than a hand-built mask.
 */
function regionsFor(
  before: ImageDataLike,
  after: ImageDataLike,
  settings: DiffSettings = DEFAULT_SETTINGS,
): Box[] {
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  const params = deriveParams(settings.sensitivity);
  const screen = screenTiles(before, after, width, height);
  const mask = buildChangeMask(
    before,
    after,
    width,
    height,
    screen,
    params,
    settings.suppressAntiAliasing,
  );

  return groupRegions(mask, params.minChangedPixels);
}

/** A blank canvas plus the pixels a spec wants changed. */
function pair(width: number, height: number, edit: (after: ImageDataLike) => void) {
  const before = solidImage(width, height);
  const after = cloneImage(before);
  edit(after);
  return { before, after };
}

describe('groupRegions', () => {
  describe('separating and joining', () => {
    it('keeps distant changes apart, each with its own bounds', () => {
      const { before, after } = pair(200, 200, (image) => {
        setPixel(image, 20, 20, BLACK);
        setPixel(image, 150, 20, BLACK);
      });

      // Asserting both boxes rather than just the count: accumulators declared outside
      // the outer loop would still produce two regions, but the second would inherit the
      // first's bounds. This also pins the documented raster ordering.
      expect(regionsFor(before, after)).toEqual([
        { x: 20, y: 20, width: 1, height: 1, changedPixels: 1, kind: 'change' },
        { x: 150, y: 20, width: 1, height: 1, changedPixels: 1, kind: 'change' },
      ]);
    });

    it('joins changes that are close together', () => {
      const { before, after } = pair(200, 200, (image) => {
        setPixel(image, 20, 20, BLACK);
        setPixel(image, 25, 20, BLACK);
      });

      const regions = regionsFor(before, after);

      expect(regions.length).toBe(1);
      expect(regions[0]).toEqual({
        x: 20,
        y: 20,
        width: 6,
        height: 1,
        changedPixels: 2,
        kind: 'change',
      });
    });

    it('joins vertically and diagonally, not only along a row', () => {
      // The bridge is a square window, so a changed cell reaches its diagonal
      // neighbours as readily as its orthogonal ones.
      const vertical = pair(200, 200, (image) => {
        setPixel(image, 20, 20, BLACK);
        setPixel(image, 20, 28, BLACK);
      });
      const diagonal = pair(200, 200, (image) => {
        setPixel(image, 20, 20, BLACK);
        setPixel(image, 28, 28, BLACK);
      });

      expect(regionsFor(vertical.before, vertical.after).length).toBe(1);
      expect(regionsFor(diagonal.before, diagonal.after).length).toBe(1);
    });

    it('bridges up to BRIDGE_CELLS and no further', () => {
      // The bridge is measured in cells, so the boundary is a cell distance, not a pixel
      // distance. x=20 lands in cell 5; x=28 in cell 7 (distance 2, joined); x=32 in
      // cell 8 (distance 3, separate).
      expect(Math.floor(20 / CELL)).toBe(5);
      expect(Math.floor(28 / CELL)).toBe(5 + BRIDGE_CELLS);
      expect(Math.floor(32 / CELL)).toBe(5 + BRIDGE_CELLS + 1);

      const atLimit = pair(200, 200, (image) => {
        setPixel(image, 20, 20, BLACK);
        setPixel(image, 28, 20, BLACK);
      });
      const beyondLimit = pair(200, 200, (image) => {
        setPixel(image, 20, 20, BLACK);
        setPixel(image, 32, 20, BLACK);
      });

      expect(regionsFor(atLimit.before, atLimit.after).length).toBe(1);
      expect(regionsFor(beyondLimit.before, beyondLimit.after).length).toBe(2);
    });
  });

  describe('box geometry', () => {
    it('gives a one-pixel change a one-pixel box', () => {
      // The point of recording pixel extents per cell: grouping never looks at an
      // individual pixel, yet the box is not rounded out to the 4px cell grid.
      const { before, after } = pair(200, 200, (image) => setPixel(image, 50, 60, BLACK));

      expect(regionsFor(before, after)).toEqual([
        { x: 50, y: 60, width: 1, height: 1, changedPixels: 1, kind: 'change' },
      ]);
    });

    it('fits a rectangle exactly, across many cells', () => {
      const { before, after } = pair(64, 64, (image) => fillRect(image, 10, 12, 13, 7, BLACK));

      expect(regionsFor(before, after)).toEqual([
        { x: 10, y: 12, width: 13, height: 7, changedPixels: 13 * 7, kind: 'change' },
      ]);
    });

    it('does not extend a box to the cells it merely bridged across', () => {
      // Two single pixels 8px apart become one region, but the box spans only from the
      // first to the last changed pixel — the empty gap is inside it, nothing beyond.
      const { before, after } = pair(200, 200, (image) => {
        setPixel(image, 20, 20, BLACK);
        setPixel(image, 28, 20, BLACK);
      });

      expect(regionsFor(before, after)).toEqual([
        { x: 20, y: 20, width: 9, height: 1, changedPixels: 2, kind: 'change' },
      ]);
    });
  });

  describe('minChangedPixels', () => {
    it('keeps a single-pixel region at the default sensitivity', () => {
      // The design's headline claim, now end to end: at S=6 the minimum is 1, so noise
      // rejection comes from the threshold and the shift suppression, never from area.
      expect(deriveParams(DEFAULT_SETTINGS.sensitivity).minChangedPixels).toBe(1);

      const { before, after } = pair(200, 200, (image) => setPixel(image, 50, 60, BLACK));

      expect(regionsFor(before, after).length).toBe(1);
    });

    it('discards regions below the minimum at a tolerant sensitivity', () => {
      // At S=1 the minimum is 8, which is what the tolerant end of the slider is for.
      const params = deriveParams(1);
      expect(params.minChangedPixels).toBe(8);

      const tooSmall = pair(64, 64, (image) => fillRect(image, 10, 10, 3, 2, BLACK)); // 6px
      const largeEnough = pair(64, 64, (image) => fillRect(image, 10, 10, 4, 2, BLACK)); // 8px
      const tolerant = withSettings({ sensitivity: 1 });

      expect(regionsFor(tooSmall.before, tooSmall.after, tolerant).length).toBe(0);
      expect(regionsFor(largeEnough.before, largeEnough.after, tolerant).length).toBe(1);
    });
  });

  describe('degenerate input', () => {
    it('returns nothing for identical images', () => {
      const before = solidImage(64, 64);

      expect(regionsFor(before, cloneImage(before))).toEqual([]);
    });

    it('walks a region spanning the whole grid without recursing', () => {
      // 400x400 is 10,000 cells in a single region. A recursive fill would be 10,000
      // frames deep; the explicit stack is sized once and never grows.
      const before = solidImage(400, 400);
      const after = solidImage(400, 400, [0, 0, 0]);

      expect(regionsFor(before, after)).toEqual([
        { x: 0, y: 0, width: 400, height: 400, changedPixels: 400 * 400, kind: 'change' },
      ]);
    });
  });

  describe('validation', () => {
    it('rejects a mask whose arrays do not match its grid', () => {
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      setPixel(after, 4, 4, BLACK);
      const screen = screenTiles(before, after, 32, 32);
      const params = deriveParams(DEFAULT_SETTINGS.sensitivity);
      const mask = buildChangeMask(before, after, 32, 32, screen, params, true);

      const inconsistent = { ...mask, cellsX: mask.cellsX + 1 };

      expect(() => groupRegions(inconsistent, 1)).toThrowError(/grid needs/);
    });
  });
});
