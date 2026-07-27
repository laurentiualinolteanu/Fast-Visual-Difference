import { ChangeMask, buildChangeMask } from './change-mask';
import { ImageDataLike } from './diff-types';
import { CELL, DEFAULT_SENSITIVITY, deriveParams } from './sensitivity';
import { BLACK, cloneImage, fillRect, setPixel, solidImage } from './test-support';
import { ScreenResult, screenTiles } from './tile-screener';

/** Build the mask the way the engine will: screen first, then score the candidates. */
function maskFor(
  before: ImageDataLike,
  after: ImageDataLike,
  sensitivity = DEFAULT_SENSITIVITY,
): ChangeMask {
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  const screen = screenTiles(before, after, width, height);

  return buildChangeMask(before, after, width, height, screen, deriveParams(sensitivity));
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

      expect(maskFor(before, after, 1).totalChanged).toBe(0);
      expect(maskFor(before, after, 10).totalChanged).toBe(16);
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

  describe('validation', () => {
    it('rejects a screening result describing a different region', () => {
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      const wrongSizedScreen = screenTiles(before, after, 16, 16);

      expect(() =>
        buildChangeMask(before, after, 32, 32, wrongSizedScreen, deriveParams(DEFAULT_SENSITIVITY)),
      ).toThrowError(/tile grid/);
    });
  });
});
