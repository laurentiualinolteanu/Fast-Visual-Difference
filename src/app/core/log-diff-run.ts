import { DiffResult, DiffSettings } from './diff/diff-types';

/**
 * One structured console line per comparison.
 *
 * This is the tuning instrument. The constants in `sensitivity.ts` were chosen against
 * reasoning, not measurement, and T20 exists to check them against real screenshots — the
 * number that decides whether the tile screen is earning its place is the proportion of
 * tiles it lets through, and it is not visible anywhere else.
 *
 * `formatDiffRun` is pure so the line can be asserted as a string. A spy on `console`
 * proves only that something was logged, which is not the part that matters.
 */

/** What the page knows that the engine does not. */
export interface DiffRunContext {
  settings: DiffSettings;
  /** Click to painted boxes — the interval the brief's markers bracket. */
  elapsedMs: number;
  /** Decode cost per slot, measured at load and deliberately outside that interval. */
  decodeMs: { before: number; after: number };
}

export function formatDiffRun(result: DiffResult, context: DiffRunContext): string {
  const { stats, timings } = result;
  const { settings, elapsedMs, decodeMs } = context;

  const screenedIn = (stats.candidateTiles / stats.totalTiles) * 100;

  return (
    `[diff] ${stats.width}x${stats.height}` +
    ` | tiles ${stats.candidateTiles}/${stats.totalTiles} (${screenedIn.toFixed(1)}% screened in)` +
    ` | px ${stats.changedPixels} cells ${stats.changedCells} regions ${stats.rawRegions}` +
    ` -> ${result.boxes.length} boxes` +
    ` | screen ${ms(timings.screenMs)} score ${ms(timings.scoreMs)}` +
    ` group ${ms(timings.groupMs)} merge ${ms(timings.mergeMs)}` +
    ` = ${ms(timings.totalMs)}ms engine` +
    ` | ${ms(elapsedMs)}ms click-to-paint` +
    ` | decode ${ms(decodeMs.before)}/${ms(decodeMs.after)}ms at load` +
    ` | sensitivity ${settings.sensitivity}` +
    ` AA ${settings.suppressAntiAliasing ? 'on' : 'off'}` +
    (result.warnings.length ? ` | ${result.warnings.length} warning(s)` : '')
  );
}

export function logDiffRun(result: DiffResult, context: DiffRunContext): void {
  console.info(formatDiffRun(result, context));
}

function ms(value: number): string {
  return value.toFixed(1);
}
