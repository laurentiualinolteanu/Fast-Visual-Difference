/**
 * Stage 3 — group changed cells into regions.
 *
 * A flood fill over the cell grid, which is sixteen times smaller than the pixel grid.
 * Two things make the result better than a plain connected-components pass:
 *
 *  - **Gaps are bridged during traversal.** Cells within `BRIDGE_CELLS` of each other
 *    join the same region even with clean cells between them, so a changed word becomes
 *    one box rather than one box per stroke. Doing it inside the walk avoids a separate
 *    morphological dilation pass and its second buffer.
 *
 *  - **Boxes come from pixel extents, not cell boundaries.** Each cell recorded the
 *    exact bounds of what changed inside it, so a one-pixel change yields a one-pixel
 *    box even though grouping never looked at an individual pixel.
 */

import { ChangeMask } from './change-mask';
import { Box } from './diff-types';
import { BRIDGE_CELLS } from './sensitivity';

/**
 * Collect connected groups of changed cells into regions.
 *
 * @param minChangedPixels regions with fewer changed pixels than this are discarded.
 *   At the default sensitivity this is 1, so a single changed pixel survives — noise is
 *   rejected by the threshold and the shift suppression, not by area.
 * @returns one box per region, in raster order of the cell each region was entered from.
 */
export function groupRegions(mask: ChangeMask, minChangedPixels: number): Box[] {
  assertMaskIsConsistent(mask);

  const { cellsX, cellsY, changed } = mask;
  const cellCount = cellsX * cellsY;

  const visited = new Uint8Array(cellCount);
  /*
   * Explicit stack rather than recursion: one region can span every cell in the grid —
   * millions of them on a large image — and that depth would exhaust the call stack.
   *
   * Sizing it to the cell count is sufficient and cannot overflow: a cell is pushed only
   * at the moment it is first marked visited, so it is pushed at most once.
   */
  const stack = new Int32Array(cellCount);
  const regions: Box[] = [];

  for (let start = 0; start < cellCount; start++) {
    if (changed[start] === 0 || visited[start] === 1) {
      continue;
    }

    visited[start] = 1;
    stack[0] = start;
    let stackSize = 1;

    // Seeded from the starting cell, so these always hold real extents.
    let minX = mask.minX[start];
    let minY = mask.minY[start];
    let maxX = mask.maxX[start];
    let maxY = mask.maxY[start];
    let changedPixels = 0;

    while (stackSize > 0) {
      const cell = stack[--stackSize];

      if (mask.minX[cell] < minX) {
        minX = mask.minX[cell];
      }
      if (mask.minY[cell] < minY) {
        minY = mask.minY[cell];
      }
      if (mask.maxX[cell] > maxX) {
        maxX = mask.maxX[cell];
      }
      if (mask.maxY[cell] > maxY) {
        maxY = mask.maxY[cell];
      }
      changedPixels += mask.pixelCount[cell];

      // Scan a (2 * BRIDGE_CELLS + 1)^2 window rather than the immediate eight
      // neighbours: that is what bridges a gap instead of merely following contact.
      const cellX = cell % cellsX;
      const cellY = Math.floor(cell / cellsX);
      const firstY = Math.max(0, cellY - BRIDGE_CELLS);
      const lastY = Math.min(cellsY - 1, cellY + BRIDGE_CELLS);
      const firstX = Math.max(0, cellX - BRIDGE_CELLS);
      const lastX = Math.min(cellsX - 1, cellX + BRIDGE_CELLS);

      for (let ny = firstY; ny <= lastY; ny++) {
        const row = ny * cellsX;

        for (let nx = firstX; nx <= lastX; nx++) {
          const neighbour = row + nx;

          if (changed[neighbour] === 1 && visited[neighbour] === 0) {
            visited[neighbour] = 1;
            stack[stackSize++] = neighbour;
          }
        }
      }
    }

    if (changedPixels < minChangedPixels) {
      continue;
    }

    regions.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      changedPixels,
      kind: 'change',
    });
  }

  return regions;
}

/**
 * The mask's arrays must match its stated grid.
 *
 * A short array would read `undefined`, which compares as neither 1 nor 0 in the ways
 * this walk relies on — cells would be quietly treated as unchanged and whole regions
 * would go missing, with no error to explain it.
 */
function assertMaskIsConsistent(mask: ChangeMask): void {
  const expected = mask.cellsX * mask.cellsY;

  if (mask.changed.length !== expected) {
    throw new Error(
      `Change mask holds ${mask.changed.length} cells, but its ` +
        `${mask.cellsX}x${mask.cellsY} grid needs ${expected}`,
    );
  }
}
