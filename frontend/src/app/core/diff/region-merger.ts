/**
 * Stage 4 — turn raw regions into the box list the UI renders.
 *
 * Merge what is close enough to be one thing, pad for legibility, sort so the largest
 * change leads, and cap the result. The cap matters because rendering happens *inside*
 * the measured window: an unbounded box count would make paint the bottleneck on exactly
 * the inputs that are already the slowest.
 *
 * Nothing here is silent. Coarsening and truncation both add a warning, because a
 * quietly shortened list looks identical to a clean result.
 */

import { Box } from './diff-types';
import {
  BOX_PADDING_PX,
  MAX_BOXES,
  MAX_MERGE_GAP_PX,
  MERGE_GAP_ESCALATION,
  MERGE_GAP_PX,
  MERGE_PASSES,
} from './sensitivity';

/**
 * Merge, pad, sort and cap.
 *
 * @param regions raw regions from Stage 3, in image pixel coordinates.
 * @param width bounds for padding — the compared region, not either full image.
 * @param warnings appended to when the result had to be degraded.
 */
export function mergeAndFinalise(
  regions: Box[],
  width: number,
  height: number,
  warnings: string[],
): Box[] {
  assertBounds(width, height);

  if (regions.length === 0) {
    return [];
  }

  let gap = MERGE_GAP_PX;
  let merged = mergeAtGap(regions, gap);
  const countAtDefaultGap = merged.length;

  /*
   * Still too many? Widen the gap and merge again — from the previous result rather than
   * from the raw regions. Merging is monotone (anything joined at gap 8 is joined at gap
   * 24), so this merges at least as much for a fraction of the work.
   */
  while (merged.length > MAX_BOXES && gap < MAX_MERGE_GAP_PX) {
    gap *= MERGE_GAP_ESCALATION;
    merged = mergeAtGap(merged, gap);
  }

  /*
   * Warn only if widening the gap actually joined something. Testing `gap` alone would
   * report coarsening whenever the escalation *ran* — and on regions spread further
   * apart than the widest gap, it runs four times and changes nothing. Claiming boxes
   * were coarsened when they are identical costs the user's trust in the warning below,
   * which is true.
   */
  if (merged.length < countAtDefaultGap) {
    warnings.push(`Too many separate regions — merged more aggressively (gap ${gap}px).`);
  }

  const padded = merged.map((box) => pad(box, width, height)).sort(byProminence);

  if (padded.length <= MAX_BOXES) {
    return padded;
  }

  /*
   * Escalation gave up and there are still too many. Truncate — but say so, and keep the
   * largest, which are the ones a reviewer is most likely to care about.
   */
  warnings.push(
    `Too many regions to display: kept the ${MAX_BOXES} largest and dropped ${padded.length - MAX_BOXES}.`,
  );

  return padded.slice(0, MAX_BOXES);
}

/** Repeatedly merge until nothing changes, or until MERGE_PASSES is spent. */
function mergeAtGap(input: Box[], gap: number): Box[] {
  let boxes = input;

  for (let pass = 0; pass < MERGE_PASSES; pass++) {
    const next: Box[] = [];
    const consumed = new Uint8Array(boxes.length);
    let didMerge = false;

    for (let i = 0; i < boxes.length; i++) {
      if (consumed[i] === 1) {
        continue;
      }

      // Absorb into a growing box, so a chain of boxes each close to the next becomes
      // one region rather than several pairs.
      let accumulated = boxes[i];

      for (let j = i + 1; j < boxes.length; j++) {
        if (consumed[j] === 1 || !isWithinGap(accumulated, boxes[j], gap)) {
          continue;
        }
        accumulated = union(accumulated, boxes[j]);
        consumed[j] = 1;
        didMerge = true;
      }

      next.push(accumulated);
    }

    boxes = next;

    if (!didMerge) {
      break;
    }
  }

  return boxes;
}

/**
 * Are two boxes within `gap` on both axes?
 *
 * The separation is negative when the boxes overlap, so overlap merges by definition and
 * a separate intersection-over-union test would add nothing.
 */
function isWithinGap(p: Box, q: Box, gap: number): boolean {
  const dx = Math.max(p.x - (q.x + q.width), q.x - (p.x + p.width));
  const dy = Math.max(p.y - (q.y + q.height), q.y - (p.y + p.height));

  return dx <= gap && dy <= gap;
}

/**
 * Smallest box containing both. Changed-pixel counts add; the empty gap contributes none.
 *
 * The result is always a `change` box, which relies on a precondition: only Stage 3
 * regions reach this stage, and those are all `change`. The `size` boxes for a dimension
 * mismatch are appended by the engine *after* merging, precisely so they are never
 * merged into a neighbouring change.
 */
function union(p: Box, q: Box): Box {
  const x = Math.min(p.x, q.x);
  const y = Math.min(p.y, q.y);
  const right = Math.max(p.x + p.width, q.x + q.width);
  const bottom = Math.max(p.y + p.height, q.y + q.height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    changedPixels: p.changedPixels + q.changedPixels,
    kind: 'change',
  };
}

/**
 * Inflate for legibility — without it a one-pixel change renders as a stroke drawn on
 * top of itself and is effectively invisible.
 *
 * Computed from edges rather than by adding to the width. Clamping the left edge at zero
 * and *then* adding twice the padding would leave the whole inflation on the right, so
 * every box touching an edge would come out systematically too wide.
 */
function pad(box: Box, width: number, height: number): Box {
  const left = Math.max(0, box.x - BOX_PADDING_PX);
  const top = Math.max(0, box.y - BOX_PADDING_PX);
  const right = Math.min(width, box.x + box.width + BOX_PADDING_PX);
  const bottom = Math.min(height, box.y + box.height + BOX_PADDING_PX);

  return { ...box, x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Largest first, then top-to-bottom, then left-to-right.
 *
 * The tie-breaks are not cosmetic: without them equal-area boxes come out in merge
 * order, which makes the results list reshuffle between runs and specs brittle.
 */
function byProminence(p: Box, q: Box): number {
  const areaDifference = q.width * q.height - p.width * p.height;
  if (areaDifference !== 0) {
    return areaDifference;
  }
  if (p.y !== q.y) {
    return p.y - q.y;
  }
  return p.x - q.x;
}

/** Padding clamps against these, so a non-positive bound would produce negative sizes. */
function assertBounds(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new Error(`Compared region must be non-empty, got ${width}x${height}`);
  }
}
