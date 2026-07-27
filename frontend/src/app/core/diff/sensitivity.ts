/**
 * Tuning constants and the one pure function that turns the sensitivity slider into
 * algorithm parameters.
 *
 * Every constant here carries the assumption it encodes. If you change one, change the
 * comment — these are the numbers a reviewer will ask about.
 */

import { DiffSettings } from './diff-types';

// ---------------------------------------------------------------------------------
// Perceptual metric constants (shared with pixel-metrics.ts)
// ---------------------------------------------------------------------------------

/**
 * Largest possible weighted-YIQ distance between two 8-bit RGB pixels.
 * Used to express the colour threshold as a fraction of "maximally different".
 */
export const MAX_YIQ_DELTA = 35215;

/**
 * Weight of the squared luma term in the YIQ distance.
 * Declared here rather than in pixel-metrics.ts because `equivalentLumaStep` inverts it
 * to explain the threshold in human terms; pixel-metrics.ts imports it so the number
 * exists in exactly one place.
 */
export const LUMA_DELTA_WEIGHT = 0.5053;

// ---------------------------------------------------------------------------------
// Pipeline constants
// ---------------------------------------------------------------------------------

/**
 * Stage 1 screening tile, in pixels. 8 RGBA pixels is a 32-byte row segment, so a tile
 * row stays inside a cache line; small enough that one changed pixel does not drag a
 * large neighbourhood into the expensive scoring pass.
 */
export const TILE = 8;

/**
 * Stage 2/3 grouping cell, in pixels. Grouping on 4x4 cells is 16x fewer elements than
 * per-pixel connected components, while each cell still records the exact pixel extents
 * of what changed inside it — so boxes stay pixel-tight rather than quantised to the grid.
 */
export const CELL = 4;

/**
 * Radius of the Stage 2 suppression neighbourhood, in pixels. 1 gives the 3x3 scan.
 *
 * This is the shift the engine forgives. Raising it to 2 would tolerate two-pixel
 * movement, but it would also erase genuinely thin features — a 2px-wide line moved
 * anywhere within the window becomes invisible — and it more than doubles the cost of
 * the most expensive operation in the pipeline. 1 is the smallest radius that covers
 * anti-aliasing and font-hinting jitter, which is what this exists for.
 */
export const SHIFT_TOLERANCE_PX = 1;

/**
 * How much better than the detection threshold a neighbouring pixel must match before a
 * difference is dismissed as a shift, as a fraction of that threshold.
 *
 * Deliberately conservative at half: we discard a difference only on strong evidence,
 * because a wrongly suppressed pixel is an invisible false negative while a wrongly kept
 * one is merely a box the user can see and judge for themselves.
 */
export const SUPPRESSION_MATCH_RATIO = 0.5;

/**
 * Fraction of the compared area that may differ before Stage 2 stops refining.
 *
 * Past this point the two images are not "the same screen with an edit" — they are
 * different renders, or offset, and per-pixel suppression is both pointless and the most
 * expensive thing the engine does. Abandoning it bounds the worst case and gives the UI
 * something honest to say instead of a wall of boxes.
 *
 * A quarter is deliberately generous: a genuinely large edit (a whole panel replaced)
 * should still get the careful treatment, and only wholesale difference should trip it.
 */
export const DENSITY_GUARD_RATIO = 0.25;

/**
 * Stage 3 gap bridged during grouping, in cells. 2 cells = 8px.
 *
 * Deliberately the conservative of the two gap constants: grouping runs on the coarse
 * cell grid and joining too eagerly here cannot be undone later. Measured (T20): between
 * 1 and 4 cells this changes no box count on any test pair, because Stage 4 closes the
 * remaining gaps anyway. At 6 it starts merging changes that should stay separate. Two is
 * inside the flat part of that range.
 */
export const BRIDGE_CELLS = 2;

/**
 * Stage 4 box merging distance, in pixels.
 *
 * **16, not 8 — this was measured rather than reasoned.** The original 8 assumed body text
 * at 12-16px with inter-glyph gaps under 8px, which holds for a 1x screenshot and fails
 * for every other capture. On a 2x display — most modern laptops — the same interface is
 * captured with everything twice as far apart, and a single changed digit was reported as
 * four separate marks: 7 boxes for 4 edits. At 16 both the 2x and 3x cases collapse back
 * to 4.
 *
 * The cost is real and bounded: two distinct changes 12px apart now merge into one box,
 * while changes 24px apart still stay separate. Raising it further to 24 loses that, which
 * is why it stops here.
 */
export const MERGE_GAP_PX = 16;

/**
 * How many times Stage 4 re-runs the merge at a given gap. Each pass can only join boxes
 * that a previous pass has already grown, so the sequence converges quickly; the limit
 * exists because each pass is O(k^2) and the tail passes rarely change anything.
 */
export const MERGE_PASSES = 3;

/**
 * Factor by which the merge gap grows when there are still too many boxes, and the point
 * at which growing it further is admitting defeat. Tripling reaches the ceiling in three
 * steps from the base gap (16, 48, 144), so the escalation cannot spin.
 */
export const MERGE_GAP_ESCALATION = 3;
export const MAX_MERGE_GAP_PX = 128;

/**
 * Ceiling on *change* boxes. Rendering is inside the measured window, so an unbounded
 * box count would make paint the bottleneck. Exceeding it coarsens the merge and,
 * failing that, truncates — always with a warning, never silently.
 *
 * The at most two size bands for a dimension mismatch are additional, so a result can
 * hold 202 boxes. They are a fixed, tiny cost and a different kind of statement, so
 * spending part of the change budget on them would be the wrong trade.
 */
export const MAX_BOXES = 200;

/**
 * Legibility padding applied to every box, in pixels. Without it a 1px change renders as
 * a stroke drawn on top of itself and is effectively invisible.
 */
export const BOX_PADDING_PX = 2;

// ---------------------------------------------------------------------------------
// Sensitivity mapping
// ---------------------------------------------------------------------------------

/** Lowest and highest slider positions. Input outside this range is clamped. */
export const MIN_SENSITIVITY = 1;
export const MAX_SENSITIVITY = 10;
/** Slider position the UI starts on. */
export const DEFAULT_SENSITIVITY = 6;

/**
 * The settings the app starts with, and the settings the specs assert against.
 *
 * Declared here rather than in the component so there is exactly one answer to "what
 * are the defaults": if the app and the specs each kept their own literal, changing the
 * app default would leave every spec quietly testing the old behaviour.
 */
export const DEFAULT_SETTINGS: DiffSettings = {
  sensitivity: DEFAULT_SENSITIVITY,
  suppressAntiAliasing: true,
};

/**
 * Threshold curve: `fraction = THRESHOLD_AT_MIN * THRESHOLD_DECAY^(S-1)`, as a fraction
 * of MAX_YIQ_DELTA. Calibrated so the default (S=6) fires on a luminance step of about
 * 18/255 — sensitive enough for low-contrast text edits, tolerant enough that noise
 * rejection is left to the anti-aliasing suppression rather than to the threshold.
 */
const THRESHOLD_AT_MIN = 0.04;
const THRESHOLD_DECAY = 0.65;

/**
 * Minimum-cluster curve: `max(1, round(CLUSTER_AT_MIN * CLUSTER_DECAY^(S-1)))`.
 * Reaches 1 by S=4 and stays there, so a single changed pixel is reported at the default
 * setting. This is deliberate: anti-aliasing noise is also small, so filtering it by area
 * would fail the tiny-change case. Noise rejection is structural (see change-mask.ts),
 * not statistical — the area filter only trims the very tolerant end of the slider.
 */
const CLUSTER_AT_MIN = 8;
const CLUSTER_DECAY = 0.55;

/** Algorithm parameters for one sensitivity setting. */
export interface DerivedParams {
  /** Weighted-YIQ distance above which a pixel is a candidate change. */
  colorThreshold: number;
  /** Regions with fewer changed pixels than this are discarded. */
  minChangedPixels: number;
  /**
   * `colorThreshold` expressed as an equivalent greyscale step out of 255.
   * This is what the UI shows: "detects brightness/colour steps of about 18/255" means
   * something to a reader, "0.46% of the maximum" does not.
   */
  equivalentLumaStep: number;
}

/**
 * Map a sensitivity slider position to algorithm parameters. Pure; the single source of
 * truth for what the slider means, in the UI and in the engine alike.
 *
 * @param sensitivity slider position, clamped to 1..10 and rounded.
 */
export function deriveParams(sensitivity: number): DerivedParams {
  const s = clampSensitivity(sensitivity);

  const fraction = THRESHOLD_AT_MIN * Math.pow(THRESHOLD_DECAY, s - 1);
  const colorThreshold = MAX_YIQ_DELTA * fraction;

  return {
    colorThreshold,
    minChangedPixels: Math.max(1, Math.round(CLUSTER_AT_MIN * Math.pow(CLUSTER_DECAY, s - 1))),
    equivalentLumaStep: Math.round(Math.sqrt(colorThreshold / LUMA_DELTA_WEIGHT)),
  };
}

/**
 * Round to a whole slider position and clamp into range.
 * Module-private: the slider already emits integers in range, so nothing outside this
 * file has a reason to clamp — exporting it would be surface without a caller.
 */
function clampSensitivity(sensitivity: number): number {
  return Math.min(MAX_SENSITIVITY, Math.max(MIN_SENSITIVITY, Math.round(sensitivity)));
}
