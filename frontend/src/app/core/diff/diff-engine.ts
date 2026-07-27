/**
 * The engine's single entry point.
 *
 * Everything above this file is a stage; everything below it — the worker, the service,
 * the UI — sees one pure function that takes two images and returns boxes, timings and
 * warnings. Nothing here touches the DOM, Angular or the worker API, which is what lets
 * the whole engine be unit-tested without a browser.
 */

import { buildChangeMask } from './change-mask';
import { Box, DiffResult, DiffSettings, ImageDataLike } from './diff-types';
import { groupRegions } from './region-grouper';
import { mergeAndFinalise } from './region-merger';
import { DENSITY_GUARD_RATIO, deriveParams } from './sensitivity';
import { screenTiles } from './tile-screener';

/**
 * Compare two images and return the regions that differ.
 *
 * Timing note: the per-stage figures do not add up to `totalMs`, which also covers
 * parameter derivation and assembling the result. The difference is small and the gap is
 * deliberate — attributing every microsecond would mean timestamping between statements.
 */
export function runDiff(
  before: ImageDataLike,
  after: ImageDataLike,
  settings: DiffSettings,
): DiffResult {
  assertUsableImage(before, 'before');
  assertUsableImage(after, 'after');

  const startedAt = performance.now();
  const warnings: string[] = [];
  const params = deriveParams(settings.sensitivity);

  /*
   * Stage 0 — reconcile dimensions.
   *
   * Compare the overlap, anchored top-left, and never rescale. Resampling would
   * interpolate every pixel in the image, and the sub-pixel error it introduces is the
   * same order as a real anti-aliasing difference — so the entire image would come back
   * as changed. Top-left is the right prior for screenshots: UI grows down and right.
   */
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);

  const beforeScreening = performance.now();
  const screen = screenTiles(before, after, width, height);

  const beforeScoring = performance.now();
  const mask = buildChangeMask(
    before,
    after,
    width,
    height,
    screen,
    params,
    settings.suppressAntiAliasing,
  );

  if (mask.highChangeDensity) {
    // Stage 2 abandoned refinement partway through, so say so. Without this the guard is
    // a silent speed-up and the user is left to wonder why the boxes look coarse.
    warnings.push(
      `Over ${Math.round(DENSITY_GUARD_RATIO * 100)}% of the image differs — the images ` +
        `may be globally offset or re-rendered. Boxes are approximate.`,
    );
  }

  const beforeGrouping = performance.now();
  const regions = groupRegions(mask, params.minChangedPixels);

  const beforeMerging = performance.now();
  const boxes = mergeAndFinalise(regions, width, height, warnings);

  // Appended *after* merging, deliberately: a change touching the overlap boundary would
  // otherwise absorb the size band and the two would be reported as one region.
  boxes.push(...sizeDifferenceBoxes(before, after, width, height, warnings));

  const finishedAt = performance.now();

  return {
    boxes,
    timings: {
      screenMs: beforeScoring - beforeScreening,
      scoreMs: beforeGrouping - beforeScoring,
      groupMs: beforeMerging - beforeGrouping,
      mergeMs: finishedAt - beforeMerging,
      totalMs: finishedAt - startedAt,
    },
    stats: {
      width,
      height,
      candidateTiles: screen.candidateCount,
      totalTiles: screen.tilesX * screen.tilesY,
      changedPixels: mask.totalChanged,
      changedCells: mask.changedCells,
      rawRegions: regions.length,
    },
    warnings,
  };
}

/**
 * At most two boxes covering the parts of the larger image that had nothing to compare
 * against: the band to the right, and the band below.
 *
 * The two never overlap — the bottom band is only as wide as the compared overlap — so a
 * pair differing on both axes produces two adjacent bands rather than a double-counted
 * corner.
 */
function sizeDifferenceBoxes(
  before: ImageDataLike,
  after: ImageDataLike,
  width: number,
  height: number,
  warnings: string[],
): Box[] {
  const widest = Math.max(before.width, after.width);
  const tallest = Math.max(before.height, after.height);

  if (widest === width && tallest === height) {
    return [];
  }

  warnings.push(
    `Images differ in size (${before.width}x${before.height} vs ${after.width}x${after.height}). ` +
      `Compared the top-left ${width}x${height} overlap; the remainder is marked as a size difference.`,
  );

  const bands: Box[] = [];

  if (widest > width) {
    bands.push({
      x: width,
      y: 0,
      width: widest - width,
      height: tallest,
      changedPixels: 0,
      kind: 'size',
    });
  }
  if (tallest > height) {
    bands.push({
      x: 0,
      y: height,
      width,
      height: tallest - height,
      changedPixels: 0,
      kind: 'size',
    });
  }

  return bands;
}

/** Both images, both dimensions — an empty one has no overlap to compare. */
function assertUsableImage(image: ImageDataLike, label: string): void {
  if (image.width <= 0 || image.height <= 0) {
    throw new Error(
      `The ${label} image must have non-zero dimensions, got ${image.width}x${image.height}`,
    );
  }
}
