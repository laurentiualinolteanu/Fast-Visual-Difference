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
 * This stage also carries the sub-pixel suppression that lets the engine report a
 * one-pixel change while ignoring anti-aliasing shimmer — see `isExplainedByShift`.
 */

import { ImageDataLike } from './diff-types';
import { deltaAt } from './pixel-metrics';
import {
  CELL,
  DENSITY_GUARD_RATIO,
  DerivedParams,
  SHIFT_TOLERANCE_PX,
  SUPPRESSION_MATCH_RATIO,
  TILE,
} from './sensitivity';
import { ScreenResult, assertComparableRegion } from './tile-screener';

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
  /**
   * More than DENSITY_GUARD_RATIO of the compared area differed, so refinement was
   * abandoned partway through: pixels found before that point were checked for
   * anti-aliasing and shifts, pixels found after were not.
   *
   * The results are therefore approximate and scan-order dependent — by design, since
   * at this density the two images are not the same screen with an edit. The engine
   * turns this into a user-facing warning.
   */
  readonly highChangeDensity: boolean;
}

/**
 * Score the candidate tiles of the compared overlap and build the cell grid.
 *
 * @param screen result of `screenTiles` for the same region — its tile grid must match.
 * @param suppressAntiAliasing drop pixels explained by anti-aliasing or a shift of at
 *   most one pixel. On by default in the app; turning it off restores strict comparison.
 */
export function buildChangeMask(
  a: ImageDataLike,
  b: ImageDataLike,
  width: number,
  height: number,
  screen: ScreenResult,
  params: DerivedParams,
  suppressAntiAliasing: boolean,
): ChangeMask {
  // Both guards matter, and they check different things: the region must fit inside the
  // two images (or we read past the buffers), and the screening result must describe
  // that same region (or we consult the wrong candidate flags).
  assertComparableRegion(a, b, width, height);
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
  // See SUPPRESSION_MATCH_RATIO for why a match must beat the threshold by this margin.
  const matchThreshold = threshold * SUPPRESSION_MATCH_RATIO;

  /*
   * Density guard. Computed once as an absolute pixel count so the hot loop compares two
   * integers instead of dividing, and floored to at least one so a tiny region cannot
   * produce a limit of zero.
   */
  const densityLimit = Math.max(1, Math.floor(width * height * DENSITY_GUARD_RATIO));

  // Counters are locals rather than fields so the hot loop touches no object.
  let totalChanged = 0;
  let changedCells = 0;
  let highChangeDensity = false;
  // Starts as the caller asked, but the guard below may switch it off mid-pass.
  let refining = suppressAntiAliasing;

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
          if (refining && isExplainedByShift(a, b, x, y, matchThreshold)) {
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

          if (!highChangeDensity && totalChanged >= densityLimit) {
            // Past this density the images are not the same screen with an edit, so
            // refining each remaining pixel buys nothing and costs the most expensive
            // operation in the pipeline. Note the flag even when the caller had already
            // turned suppression off: "most of the image differs" is worth reporting
            // either way.
            highChangeDensity = true;
            refining = false;
          }
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
    highChangeDensity,
  };
}

/**
 * Is this difference explained by anti-aliasing, or by a shift of at most one pixel?
 *
 * Both directions must find a match, and that is not a symmetry nicety — a one-way
 * check silently loses *added* elements:
 *
 *   - an element **removed** (A has a dark dot, B is uniform): A's dark colour appears
 *     nowhere in B's neighbourhood, so the forward check already keeps it;
 *   - an element **added** (A is uniform, B has a dark dot): the forward check compares
 *     A's *background* pixel against B's neighbourhood, which still contains background
 *     in the ring around the dot. It matches, and the new dot disappears.
 *
 * Requiring both directions keeps the addition: B's dark colour appears nowhere in A's
 * neighbourhood. Genuine anti-aliasing passes both, because it only redistributes
 * colours that exist on both sides of the edge.
 */
function isExplainedByShift(
  a: ImageDataLike,
  b: ImageDataLike,
  x: number,
  y: number,
  matchThreshold: number,
): boolean {
  // Does A's colour exist somewhere in B's neighbourhood?
  const forward = neighbourhoodMin(a.data, (y * a.width + x) * 4, b, x, y);
  if (forward >= matchThreshold) {
    return false; // No point scanning the other direction.
  }

  // ...and does B's colour exist somewhere in A's?
  return neighbourhoodMin(b.data, (y * b.width + x) * 4, a, x, y) < matchThreshold;
}

/**
 * Smallest distance between one pixel and any pixel within SHIFT_TOLERANCE_PX of (x, y)
 * in `scan`. Argument order is irrelevant because `deltaAt` is symmetric, which is why
 * this takes a pixel and an image to search rather than a direction flag.
 */
function neighbourhoodMin(
  fixed: Uint8ClampedArray,
  fixedIndex: number,
  scan: ImageDataLike,
  x: number,
  y: number,
): number {
  // Clamped to the *scanned* image's own bounds. The two images need not be the same
  // size, and clamping to the wrong one would read across into the next row.
  const firstY = Math.max(0, y - SHIFT_TOLERANCE_PX);
  const lastY = Math.min(scan.height - 1, y + SHIFT_TOLERANCE_PX);
  const firstX = Math.max(0, x - SHIFT_TOLERANCE_PX);
  const lastX = Math.min(scan.width - 1, x + SHIFT_TOLERANCE_PX);

  let best = Infinity;

  for (let ny = firstY; ny <= lastY; ny++) {
    const row = ny * scan.width;

    for (let nx = firstX; nx <= lastX; nx++) {
      const candidate = deltaAt(fixed, fixedIndex, scan.data, (row + nx) * 4);

      if (candidate < best) {
        best = candidate;

        if (best === 0) {
          return 0; // An exact match; nothing can beat it.
        }
      }
    }
  }

  return best;
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

  // A short flag array would read `undefined`, and `undefined === 0` is false — so every
  // missing tile would be treated as a candidate and scored. Checking the dimensions
  // without checking the array implies a coverage this guard would not actually give.
  const expectedFlags = expectedTilesX * expectedTilesY;
  if (screen.candidates.length !== expectedFlags) {
    throw new Error(
      `Screening result holds ${screen.candidates.length} tile flags, but its ` +
        `${expectedTilesX}x${expectedTilesY} grid needs ${expectedFlags}`,
    );
  }
}
