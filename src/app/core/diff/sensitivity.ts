/**
 * Tuning constants and the one pure function that turns the sensitivity slider into
 * algorithm parameters.
 *
 * Every constant here carries the assumption it encodes. If you change one, change the
 * comment — these are the numbers a reviewer will ask about.
 */

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
 * Stage 3 gap bridged during grouping, in cells. 2 cells = 8px.
 * Assumption: body text is 12-16px and inter-glyph gaps are under 8px, so a changed word
 * becomes one box rather than one box per stroke.
 */
export const BRIDGE_CELLS = 2;

/** Stage 4 box merging distance, in pixels. The same 8px assumption as BRIDGE_CELLS. */
export const MERGE_GAP_PX = 8;

/**
 * Hard ceiling on returned boxes. Rendering is inside the measured window, so an
 * unbounded box count would make paint the bottleneck. Exceeding it coarsens the merge
 * and, failing that, truncates — always with a warning, never silently.
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

/** Round to a whole slider position and clamp into range. */
export function clampSensitivity(sensitivity: number): number {
  return Math.min(MAX_SENSITIVITY, Math.max(MIN_SENSITIVITY, Math.round(sensitivity)));
}
