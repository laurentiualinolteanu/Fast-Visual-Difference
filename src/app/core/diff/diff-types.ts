/**
 * Shared vocabulary for the diff engine.
 *
 * These interfaces double as the DTOs crossing the main-thread <-> worker boundary,
 * so they must stay plain data: structured clone drops prototypes, and a class
 * instance would arrive on the other side with its methods silently gone.
 *
 * Nothing in `core/diff` imports Angular, the DOM, or the worker API.
 */

/**
 * Structurally compatible with the DOM's `ImageData`, so a real `ImageData` can be
 * passed straight in with no conversion or copy — while keeping `core/diff` free of
 * DOM types and unit-testable without a browser.
 */
export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** User-facing comparison settings. Mapped to algorithm parameters by `deriveParams`. */
export interface DiffSettings {
  /** 1 = very tolerant … 10 = very strict. Default 6. */
  sensitivity: number;
  /**
   * Suppress anti-aliasing shimmer and shifts of at most one pixel. Default true.
   * Turning it off restores strict pixel comparison.
   */
  suppressAntiAliasing: boolean;
}

/**
 * A detected region, in **natural image pixel coordinates** of the compared overlap.
 * The overlay renders these directly; there is no display-scale arithmetic anywhere.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pixels that actually differed inside this box. Zero for `size` boxes. */
  changedPixels: number;
  /** `change` = real visual difference. `size` = the non-overlapping band of a dimension mismatch. */
  kind: 'change' | 'size';
}

/** Per-stage wall-clock cost of one comparison, in milliseconds. */
export interface StageTimings {
  /** Stage 1 — tile screening. */
  screenMs: number;
  /** Stage 2 — per-pixel scoring and noise suppression. */
  scoreMs: number;
  /** Stage 3 — connected components over the cell grid. */
  groupMs: number;
  /** Stage 4 — box merging, capping and padding. */
  mergeMs: number;
  /**
   * Whole `runDiff` call. Slightly larger than the sum of the stages: it also covers
   * parameter derivation and result assembly.
   */
  totalMs: number;
}

/** Diagnostics for one comparison. Drives the console tuning line and the results panel. */
export interface DiffStats {
  /** Compared overlap, not necessarily the size of either input. */
  width: number;
  height: number;
  /** Tiles containing at least one differing pixel. Should be a small fraction of the total. */
  candidateTiles: number;
  totalTiles: number;
  changedPixels: number;
  changedCells: number;
  /** Regions found before merging — useful for spotting an over-fragmented mask. */
  rawRegions: number;
}

/** Everything one comparison produces. */
export interface DiffResult {
  boxes: Box[];
  timings: StageTimings;
  stats: DiffStats;
  /** User-facing notes: dimension mismatch, coarsened boxes, suspected global offset. */
  warnings: string[];
}
