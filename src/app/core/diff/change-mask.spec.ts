import { ChangeMask, buildChangeMask } from './change-mask';
import { DiffSettings, ImageDataLike } from './diff-types';
import { CELL, DEFAULT_SENSITIVITY, DEFAULT_SETTINGS, deriveParams } from './sensitivity';
import {
  BLACK,
  cloneImage,
  fillRect,
  paintRowGradient,
  setPixel,
  solidImage,
  withSettings,
} from './test-support';
import { ScreenResult, screenTiles } from './tile-screener';

/** Build the mask the way the engine will: screen first, then score the candidates. */
function maskFor(
  before: ImageDataLike,
  after: ImageDataLike,
  settings: DiffSettings = DEFAULT_SETTINGS,
): ChangeMask {
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  const screen = screenTiles(before, after, width, height);

  return buildChangeMask(
    before,
    after,
    width,
    height,
    screen,
    deriveParams(settings.sensitivity),
    settings.suppressAntiAliasing,
  );
}

/**
 * Columns *spanned* by the changed cells' extents.
 *
 * Not literally every changed pixel's x: the mask keeps per-cell bounds, not per-pixel
 * data, so a cell whose only changes are at x=0 and x=3 reports 1 and 2 as well. Exact
 * for fixtures whose changes form contiguous columns, which is every fixture here.
 */
function changedColumns(mask: ChangeMask): Set<number> {
  const columns = new Set<number>();
  for (let i = 0; i < mask.changed.length; i++) {
    if (mask.changed[i] === 1) {
      for (let x = mask.minX[i]; x <= mask.maxX[i]; x++) {
        columns.add(x);
      }
    }
  }
  return columns;
}

/**
 * Paint rows `fromY`..`toY` with a column pattern, optionally shifted right by `offset`.
 *
 * Every column is a distinct grey, so neighbouring columns differ far more than the
 * detection threshold. Shifting the pattern by one pixel therefore makes *every* pixel a
 * candidate — which is what stops the suppression and density specs from passing
 * vacuously. Columns with no source (shifted in from beyond the left edge) are filled
 * white, standing in for genuinely new content.
 */
function paintColumns(
  image: ImageDataLike,
  fromY: number,
  toY: number,
  offset: number = 0,
): void {
  for (let y = fromY; y <= toY; y++) {
    for (let x = 0; x < image.width; x++) {
      const source = x - offset;
      const grey = source < 0 ? 255 : ((source + 1) * 37) % 256;
      setPixel(image, x, y, [grey, grey, grey]);
    }
  }
}

/** Index of the cell containing pixel (x, y). */
function cellIndex(x: number, y: number, cellsX: number): number {
  return Math.floor(y / CELL) * cellsX + Math.floor(x / CELL);
}

/** Every cell flagged as changed. */
function changedCellIndices(mask: ChangeMask): number[] {
  const indices: number[] = [];
  for (let i = 0; i < mask.changed.length; i++) {
    if (mask.changed[i] === 1) {
      indices.push(i);
    }
  }
  return indices;
}

describe('buildChangeMask', () => {
  describe('a single changed pixel', () => {
    it('marks one cell whose extents are that exact pixel', () => {
      const before = solidImage(200, 200);
      const after = cloneImage(before);
      setPixel(after, 50, 60, BLACK);

      const mask = maskFor(before, after);

      // Asserted as a literal as well as via the helper: a helper that mirrors the
      // production formula would confirm a wrong formula self-consistently.
      // cellsX = ceil(200 / 4) = 50; floor(60 / 4) * 50 + floor(50 / 4) = 15 * 50 + 12.
      const cell = 762;
      expect(mask.cellsX).toBe(50);
      expect(cellIndex(50, 60, mask.cellsX)).toBe(cell);

      expect(mask.totalChanged).toBe(1);
      expect(mask.changedCells).toBe(1);
      expect(changedCellIndices(mask)).toEqual([cell]);

      expect(mask.minX[cell]).toBe(50);
      expect(mask.maxX[cell]).toBe(50);
      expect(mask.minY[cell]).toBe(60);
      expect(mask.maxY[cell]).toBe(60);
      expect(mask.pixelCount[cell]).toBe(1);
    });
  });

  describe('counters', () => {
    it('agrees with the number of pixels actually changed', () => {
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      fillRect(after, 0, 0, 6, 6, BLACK); // 36 pixels, straddling four cells

      const mask = maskFor(before, after);

      expect(mask.totalChanged).toBe(36);
      expect(mask.changedCells).toBe(4);

      // cellsX = 8, so the four touched cells are 0, 1, 8 and 9.
      expect(changedCellIndices(mask)).toEqual([0, 1, 8, 9]);
      expect(mask.pixelCount[0]).toBe(16); // x 0..3, y 0..3
      expect(mask.pixelCount[1]).toBe(8); //  x 4..5, y 0..3
      expect(mask.pixelCount[8]).toBe(8); //  x 0..3, y 4..5
      expect(mask.pixelCount[9]).toBe(4); //  x 4..5, y 4..5
    });

    it('keeps per-cell counts summing to the total', () => {
      const before = solidImage(64, 64);
      const after = cloneImage(before);
      fillRect(after, 7, 9, 13, 11, BLACK);

      const mask = maskFor(before, after);

      let sum = 0;
      for (let i = 0; i < mask.pixelCount.length; i++) {
        sum += mask.pixelCount[i];
      }

      expect(sum).toBe(mask.totalChanged);
      expect(mask.totalChanged).toBe(13 * 11);
      expect(changedCellIndices(mask).length).toBe(mask.changedCells);
    });
  });

  describe('a change spanning a cell boundary', () => {
    it('marks both cells, each with only its own pixels', () => {
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      setPixel(after, 3, 10, BLACK); // last column of cell 0 in this cell row
      setPixel(after, 4, 10, BLACK); // first column of cell 1

      const mask = maskFor(before, after);

      const leftCell = cellIndex(3, 10, mask.cellsX);
      const rightCell = cellIndex(4, 10, mask.cellsX);
      expect(rightCell).toBe(leftCell + 1);

      expect(mask.changedCells).toBe(2);
      expect(mask.totalChanged).toBe(2);

      expect(mask.minX[leftCell]).toBe(3);
      expect(mask.maxX[leftCell]).toBe(3);
      expect(mask.minX[rightCell]).toBe(4);
      expect(mask.maxX[rightCell]).toBe(4);
      expect(mask.minY[leftCell]).toBe(10);
      expect(mask.maxY[leftCell]).toBe(10);
    });
  });

  describe('extents within one cell', () => {
    it('widens as further pixels arrive, in either direction', () => {
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      // Scanned in row-major order, so (3,1) is seen before (1,2): the later pixel has
      // the smaller x and must pull `minX` down, exercising the branch that a purely
      // ascending scan would never reach.
      setPixel(after, 3, 1, BLACK);
      setPixel(after, 1, 2, BLACK);

      const mask = maskFor(before, after);
      const cell = cellIndex(1, 1, mask.cellsX);

      expect(mask.changedCells).toBe(1);
      expect(mask.pixelCount[cell]).toBe(2);
      expect(mask.minX[cell]).toBe(1);
      expect(mask.maxX[cell]).toBe(3);
      expect(mask.minY[cell]).toBe(1);
      expect(mask.maxY[cell]).toBe(2);
    });
  });

  describe('trust in Stage 1', () => {
    it('scores nothing when no tile is a candidate, even though the images differ', () => {
      // The mask must never rescan the image on its own: if it did, the tile screen
      // would be pure overhead rather than the reason this stage is affordable.
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      fillRect(after, 0, 0, 32, 32, BLACK); // every pixel differs

      const blindScreen: ScreenResult = {
        candidates: new Uint8Array(4 * 4), // all zero
        tilesX: 4,
        tilesY: 4,
        candidateCount: 0,
      };

      const mask = buildChangeMask(
        before,
        after,
        32,
        32,
        blindScreen,
        deriveParams(DEFAULT_SENSITIVITY),
        true,
      );

      expect(mask.totalChanged).toBe(0);
      expect(mask.changedCells).toBe(0);
    });
  });

  describe('the threshold', () => {
    it('ignores a difference below it, even though Stage 1 flagged the tile', () => {
      // The two stages have different jobs: Stage 1 asks "do any bytes differ", Stage 2
      // asks "is the difference visible". A one-step grey shift is the second answering no.
      const before = solidImage(32, 32, [100, 100, 100]);
      const after = cloneImage(before);
      fillRect(after, 8, 8, 4, 4, [101, 101, 101]);

      expect(screenTiles(before, after, 32, 32).candidateCount).toBeGreaterThan(0);
      expect(maskFor(before, after).totalChanged).toBe(0);
    });

    it('records a difference above it', () => {
      const before = solidImage(32, 32, [100, 100, 100]);
      const after = cloneImage(before);
      fillRect(after, 8, 8, 4, 4, [130, 130, 130]);

      expect(maskFor(before, after).totalChanged).toBe(16);
    });

    it('records more at a stricter sensitivity than at a tolerant one', () => {
      const before = solidImage(32, 32, [100, 100, 100]);
      const after = cloneImage(before);
      fillRect(after, 8, 8, 4, 4, [112, 112, 112]); // a faint change

      expect(maskFor(before, after, withSettings({ sensitivity: 1 })).totalChanged).toBe(0);
      expect(maskFor(before, after, withSettings({ sensitivity: 10 })).totalChanged).toBe(16);
    });
  });

  describe('the cell grid', () => {
    it('covers dimensions that are not a multiple of the cell size', () => {
      const before = solidImage(10, 6);
      const after = cloneImage(before);
      setPixel(after, 9, 5, BLACK); // last pixel, inside a partial edge cell

      const mask = maskFor(before, after);

      expect(mask.cellsX).toBe(Math.ceil(10 / CELL));
      expect(mask.cellsY).toBe(Math.ceil(6 / CELL));
      expect(mask.changed.length).toBe(mask.cellsX * mask.cellsY);
      expect(mask.changedCells).toBe(1);
      expect(mask.minX[cellIndex(9, 5, mask.cellsX)]).toBe(9);
    });
  });

  describe('anti-aliasing and sub-pixel suppression', () => {
    /**
     * A vertical edge with one column of intermediate coverage — what anti-aliasing
     * actually looks like: solid on the left, a partial pixel, solid on the right.
     */
    function paintAntiAliasedEdge(image: ImageDataLike, edgeX: number, coverage: number): void {
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const grey = x < edgeX ? 0 : x === edgeX ? coverage : 255;
          setPixel(image, x, y, [grey, grey, grey]);
        }
      }
    }

    it('suppresses an anti-aliased edge that moved by one pixel', () => {
      // The feature's namesake case, and the artefact that actually dominates in
      // practice: font hinting and sub-pixel layout move an edge, so the same coverage
      // values reappear one column over. Every value has an exact match one pixel away
      // in both directions, so the whole edge is dismissed.
      const before = solidImage(32, 32);
      paintAntiAliasedEdge(before, 16, 128);
      const after = solidImage(32, 32);
      paintAntiAliasedEdge(after, 17, 128);

      expect(maskFor(before, after).totalChanged).toBe(0);
    });

    it('reports an edge whose coverage changed without moving', () => {
      // The boundary of the feature, asserted rather than assumed. The edge is in the
      // same place but rendered differently (128 -> 100); no neighbour holds the new
      // value, so nothing explains it as a shift and it is reported. That is the right
      // call — a differently rendered edge is a real visual difference — but it means
      // "anti-aliasing suppression" forgives *movement*, not every rendering change.
      const before = solidImage(32, 32);
      paintAntiAliasedEdge(before, 16, 128);
      const after = solidImage(32, 32);
      paintAntiAliasedEdge(after, 16, 100);

      const mask = maskFor(before, after);

      expect(changedColumns(mask)).toEqual(new Set([16]));
      expect(mask.totalChanged).toBe(32);
    });

    it('keeps a single added pixel — the case a one-way check would lose', () => {
      // Test 5b, and the reason the check is bidirectional. Forward finds a match: the
      // white background around the new dot is present in both images. Only the backward
      // direction notices that the dot's colour appears nowhere in the original.
      const before = solidImage(40, 40);
      const after = cloneImage(before);
      setPixel(after, 20, 20, BLACK);

      const mask = maskFor(before, after);

      expect(mask.totalChanged).toBe(1);
      expect(mask.changedCells).toBe(1);
    });

    it('keeps a single removed pixel', () => {
      const before = solidImage(40, 40);
      setPixel(before, 20, 20, BLACK);
      const after = solidImage(40, 40);

      const mask = maskFor(before, after);

      expect(mask.totalChanged).toBe(1);
      expect(mask.changedCells).toBe(1);
    });

    it('suppresses an element shifted one pixel inside the canvas', () => {
      // Nothing touches the border, so every changed pixel has a match one pixel away in
      // both directions and the shift vanishes completely.
      const before = solidImage(40, 40);
      fillRect(before, 10, 10, 10, 10, BLACK);
      const after = solidImage(40, 40);
      fillRect(after, 11, 10, 10, 10, BLACK);

      expect(maskFor(before, after).totalChanged).toBe(0);
    });

    it('suppresses the interior of a whole-content shift, leaving only the edges', () => {
      // Test 5a. Asserting zero here would be wrong: the vacated left column has no
      // source pixel to match against, and the right column loses its match to the
      // neighbourhood clamp. Both legitimately survive; the interior must not.
      const before = solidImage(40, 40);
      paintColumns(before, 0, 39);

      const after = solidImage(40, 40);
      paintColumns(after, 0, 39, 1);

      const mask = maskFor(before, after);

      expect(changedColumns(mask)).toEqual(new Set([0, 39]));
      expect(mask.totalChanged).toBe(2 * 40);
    });

    it('reports the whole shift when suppression is turned off', () => {
      // Proves the previous spec is not passing because nothing was a candidate: with the
      // toggle off, all 1600 pixels are reported.
      const before = solidImage(40, 40);
      paintColumns(before, 0, 39);

      const after = solidImage(40, 40);
      paintColumns(after, 0, 39, 1);

      const strict = maskFor(before, after, withSettings({ suppressAntiAliasing: false }));

      expect(strict.totalChanged).toBe(40 * 40);
    });

    it('clamps the neighbourhood to the bounds of the image being scanned', () => {
      // The discriminating case. The compared overlap is 30 wide; the moved block ends on
      // column 29, the last column of the narrower image. Scanning B's neighbourhood must
      // stop at x = 29. Clamping to the wider image instead would read B[30] — which is
      // the first pixel of the *next row*, plain white — find a false match, and wrongly
      // suppress the whole column.
      const wide = solidImage(40, 20);
      fillRect(wide, 24, 5, 5, 10, BLACK); // x 24..28

      const narrow = solidImage(30, 20);
      fillRect(narrow, 25, 5, 5, 10, BLACK); // x 25..29, touching the right edge

      const mask = maskFor(wide, narrow);

      expect(changedColumns(mask)).toEqual(new Set([29]));
      // Eight of the block's ten rows, not all ten: at the top and bottom rows the
      // neighbourhood reaches into the blank row beyond the block, which matches in both
      // directions, so those two pixels really are explained by a one-pixel diagonal
      // shift. The eight interior rows have an all-black neighbourhood and survive.
      //
      // Clamping to the wider image instead would yield 0 here, not 8 — every pixel
      // would find a false match in the next row and the column would vanish.
      expect(mask.totalChanged).toBe(8);
    });
  });

  describe('the change-density guard', () => {
    it('trips on a uniform brightness shift and reports the whole image', () => {
      // The engine's worst input: every pixel is a candidate, every pixel exceeds the
      // threshold, and because the neighbourhood shifted too, nothing matches — so
      // nothing short-circuits and every pixel would pay the full bidirectional scan.
      const before = solidImage(64, 64, [100, 100, 100]);
      const after = solidImage(64, 64, [130, 130, 130]);

      const mask = maskFor(before, after);

      expect(mask.highChangeDensity).toBeTrue();
      expect(mask.totalChanged).toBe(64 * 64);
    });

    it('leaves an ordinary change untouched', () => {
      // The guard must be invisible below its limit. A 6x6 edit on a 32x32 image is
      // 3.5% of the area; results must be exactly what T05 produced.
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      fillRect(after, 0, 0, 6, 6, BLACK);

      const mask = maskFor(before, after);

      expect(mask.highChangeDensity).toBeFalse();
      expect(mask.totalChanged).toBe(36);
      expect(mask.changedCells).toBe(4);
    });

    it('is not tripped by a whole-image shift, because suppressed pixels do not count', () => {
      // Every pixel differs here, but almost every one is explained as a shift and
      // discarded. The guard counts what survives, so it correctly reads this as "two
      // near-identical images" rather than "two different images".
      const before = solidImage(40, 40);
      paintColumns(before, 0, 39, 0);
      const after = solidImage(40, 40);
      paintColumns(after, 0, 39, 1);

      const mask = maskFor(before, after);

      expect(mask.highChangeDensity).toBeFalse();
      expect(mask.totalChanged).toBe(2 * 40); // the two edge columns only
    });

    it('stops refining the pixels it finds after the limit', () => {
      // Top half: a solid change that survives suppression, 800 pixels on a 1600 pixel
      // image — so the limit of 400 is crossed while still inside it.
      // Bottom half: a one-pixel shift that suppression *would* discard.
      //
      // Because the guard has already fired by the time the bottom is scanned, the shift
      // is reported instead of suppressed: 1600 rather than the ~840 that refinement
      // throughout would have produced. That difference is the guard being observable.
      const before = solidImage(40, 40);
      fillRect(before, 0, 0, 40, 20, BLACK);
      paintColumns(before, 20, 39, 0);

      const after = solidImage(40, 40);
      paintColumns(after, 20, 39, 1);

      const mask = maskFor(before, after);

      expect(mask.highChangeDensity).toBeTrue();
      expect(mask.totalChanged).toBe(40 * 40);
    });

    it('flags high density even when the caller disabled suppression', () => {
      const before = solidImage(64, 64, [100, 100, 100]);
      const after = solidImage(64, 64, [130, 130, 130]);

      const mask = maskFor(before, after, withSettings({ suppressAntiAliasing: false }));

      expect(mask.highChangeDensity).toBeTrue();
    });
  });

  describe('images of different widths', () => {
    // Stage 2 does its own per-image row arithmetic (`y * a.width`, `y * b.width`), so
    // the stride hazard the screener specs guard against exists here independently.
    // Every other spec in this file compares an image with a clone of itself, which
    // cannot catch it.

    it('finds nothing when the overlap is identical', () => {
      const wide = solidImage(200, 100);
      const narrow = solidImage(160, 100);
      paintRowGradient(wide);
      paintRowGradient(narrow);

      const mask = maskFor(wide, narrow);

      expect(mask.totalChanged).toBe(0);
      expect(mask.changedCells).toBe(0);
    });

    it('records a real change inside the overlap at the right cell', () => {
      const wide = solidImage(200, 100);
      const narrow = solidImage(160, 100);
      paintRowGradient(wide);
      paintRowGradient(narrow);
      setPixel(narrow, 100, 50, BLACK);

      const mask = maskFor(wide, narrow);

      // The compared region is 160x100, so cellsX = ceil(160 / 4) = 40;
      // floor(50 / 4) * 40 + floor(100 / 4) = 12 * 40 + 25.
      const cell = 505;
      expect(mask.cellsX).toBe(40);
      expect(cellIndex(100, 50, mask.cellsX)).toBe(cell);

      expect(mask.totalChanged).toBe(1);
      expect(changedCellIndices(mask)).toEqual([cell]);
      expect(mask.minX[cell]).toBe(100);
      expect(mask.maxX[cell]).toBe(100);
      expect(mask.minY[cell]).toBe(50);
      expect(mask.maxY[cell]).toBe(50);
    });
  });

  describe('validation', () => {
    it('rejects a region that does not fit inside both images', () => {
      // Without this guard the scoring loop reads past both buffers. Those reads yield
      // `undefined` -> `NaN`, and `NaN <= threshold` is false, so every out-of-range
      // pixel would be recorded as changed: a mask full of differences that do not exist.
      const small = solidImage(10, 10);
      const large = solidImage(40, 40);
      const screen = screenTiles(large, large, 40, 40);

      expect(() =>
        buildChangeMask(small, small, 40, 40, screen, deriveParams(DEFAULT_SENSITIVITY), true),
      ).toThrowError(/does not fit inside both/);
    });

    it('rejects a screening result with too few tile flags', () => {
      const image = solidImage(32, 32);
      const shortScreen: ScreenResult = {
        candidates: new Uint8Array(3), // grid says 4x4 = 16
        tilesX: 4,
        tilesY: 4,
        candidateCount: 0,
      };

      expect(() =>
        buildChangeMask(image, image, 32, 32, shortScreen, deriveParams(DEFAULT_SENSITIVITY), true),
      ).toThrowError(/tile flags/);
    });

    it('rejects a screening result describing a different region', () => {
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      const wrongSizedScreen = screenTiles(before, after, 16, 16);

      expect(() =>
        buildChangeMask(
          before,
          after,
          32,
          32,
          wrongSizedScreen,
          deriveParams(DEFAULT_SENSITIVITY),
          true,
        ),
      ).toThrowError(/tile grid/);
    });
  });
});

