/**
 * Stage 2 — per-pixel scoring, accumulated into a coarse cell grid.
 *
 * Only the tiles Stage 1 flagged are visited: for a typical screenshot pair that is a
 * small percentage of the image, and it is why the expensive per-pixel metric is
 * affordable at all.
 *
 * Changed pixels are recorded into 4x4 cells rather than a per-pixel bitmask, so the
 * connected-components pass in Stage 3 has sixteen times fewer elements to walk. Each
 * cell also remembers the exact pixel extents of what changed inside it, so boxes stay
 * pixel-tight instead of being quantised to the cell grid — cheap grouping, exact bounds.
 *
 * Anti-aliasing suppression is deliberately *not* here yet; T05 adds it.
 */

import { ImageDataLike } from './diff-types';
import { deltaAt } from './pixel-metrics';
import { CELL, DerivedParams, TILE } from './sensitivity';
import { ScreenResult } from './tile-screener';

export interface ChangeMask {
  readonly cellsX: number;
  readonly cellsY: number;
  /** One flag per cell, row-major: 1 = this cell contains at least one changed pixel. */
  readonly changed: Uint8Array;
  /**
   * Exact pixel extents of the changed pixels within each cell — the reason boxes are
   * not quantised to the grid. Only meaningful where `changed[i]` is 1.
   */
  readonly minX: Int32Array;
  readonly minY: Int32Array;
  readonly maxX: Int32Array;
  readonly maxY: Int32Array;
  /** Changed pixels per cell. Summed per region in Stage 3 to apply `minChangedPixels`. */
  readonly pixelCount: Int32Array;
  readonly totalChanged: number;
  readonly changedCells: number;
}

/**
 * Score the candidate tiles of the compared overlap and build the cell grid.
 *
 * @param screen result of `screenTiles` for the same region — its tile grid must match.
 */
export function buildChangeMask(
  a: ImageDataLike,
  b: ImageDataLike,
  width: number,
  height: number,
  screen: ScreenResult,
  params: DerivedParams,
): ChangeMask {
  assertScreenMatchesRegion(screen, width, height);

  const cellsX = Math.ceil(width / CELL);
  const cellsY = Math.ceil(height / CELL);
  const cellCount = cellsX * cellsY;

  // Allocated once, up front: nothing inside the pixel loop allocates.
  const changed = new Uint8Array(cellCount);
  const minX = new Int32Array(cellCount);
  const minY = new Int32Array(cellCount);
  const maxX = new Int32Array(cellCount);
  const maxY = new Int32Array(cellCount);
  const pixelCount = new Int32Array(cellCount);

  const { candidates, tilesX, tilesY } = screen;
  const threshold = params.colorThreshold;

  // Counters are locals rather than fields so the hot loop touches no object.
  let totalChanged = 0;
  let changedCells = 0;

  for (let tileY = 0; tileY < tilesY; tileY++) {
    const top = tileY * TILE;
    const bottom = Math.min(top + TILE, height);

    for (let tileX = 0; tileX < tilesX; tileX++) {
      if (candidates[tileY * tilesX + tileX] === 0) {
        continue; // Stage 1 already proved every pixel in this tile is byte-identical.
      }

      const left = tileX * TILE;
      const right = Math.min(left + TILE, width);

      for (let y = top; y < bottom; y++) {
        // Each image is indexed with its own row stride; the two need not be the same width.
        const rowA = y * a.width;
        const rowB = y * b.width;
        const cellRow = Math.floor(y / CELL) * cellsX;

        for (let x = left; x < right; x++) {
          if (deltaAt(a.data, (rowA + x) * 4, b.data, (rowB + x) * 4) <= threshold) {
            continue;
          }

          const cell = cellRow + Math.floor(x / CELL);

          if (changed[cell] === 0) {
            changed[cell] = 1;
            minX[cell] = x;
            maxX[cell] = x;
            minY[cell] = y;
            maxY[cell] = y;
            changedCells++;
          } else {
            // Both directions are tested on both axes. Within one tile `y` only
            // increases, so `y < minY` looks unreachable — but that holds only while
            // TILE is a multiple of CELL, which keeps a cell inside a single tile.
            // Both are constants that may be retuned, and a bound that is correct by
            // coincidence fails silently.
            if (x < minX[cell]) {
              minX[cell] = x;
            } else if (x > maxX[cell]) {
              maxX[cell] = x;
            }
            if (y < minY[cell]) {
              minY[cell] = y;
            } else if (y > maxY[cell]) {
              maxY[cell] = y;
            }
          }

          pixelCount[cell]++;
          totalChanged++;
        }
      }
    }
  }

  return {
    cellsX,
    cellsY,
    changed,
    minX,
    minY,
    maxX,
    maxY,
    pixelCount,
    totalChanged,
    changedCells,
  };
}

/**
 * The screening result must describe the same region we are about to score. Passing a
 * stale or mismatched `ScreenResult` would silently read the wrong candidate flags and
 * skip real changes, which is far harder to diagnose than a thrown error.
 */
function assertScreenMatchesRegion(screen: ScreenResult, width: number, height: number): void {
  const expectedTilesX = Math.ceil(width / TILE);
  const expectedTilesY = Math.ceil(height / TILE);

  if (screen.tilesX !== expectedTilesX || screen.tilesY !== expectedTilesY) {
    throw new Error(
      `Screening result covers a ${screen.tilesX}x${screen.tilesY} tile grid, ` +
        `but ${width}x${height} needs ${expectedTilesX}x${expectedTilesY}`,
    );
  }
}
