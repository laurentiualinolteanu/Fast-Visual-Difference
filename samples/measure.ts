/**
 * Measures the diff engine against a set of fixed pairs, and prints the table.
 *
 *     npm run measure
 *
 * Exists because the tuning constants in `sensitivity.ts` were chosen by reasoning during
 * design and never checked against an image. This is the instrument that checks them, and
 * the source of every performance number quoted anywhere in this repository — nothing is
 * an estimate, and re-running this reproduces the lot.
 *
 * These are **engine** timings, measured in Node. They exclude decode, which happens when
 * the user picks a file, and they exclude the render, which is the part the brief's own
 * markers bracket. The click-to-paint figure is a browser measurement and comes from the
 * integration spec instead; see README.md.
 */

import { cpus, totalmem } from 'node:os';

import { runDiff } from '../src/app/core/diff/diff-engine';
import { screenedInPercent } from '../src/app/core/log-diff-run';
import {
  BRIDGE_CELLS,
  CELL,
  DEFAULT_SETTINGS,
  MERGE_GAP_PX,
  TILE,
  deriveParams,
} from '../src/app/core/diff/sensitivity';
import type { Canvas } from './scene';
import { AFTER, BEFORE, drawScene, fillRect } from './scene';

const WARMUP_RUNS = 2;
const TIMED_RUNS = 7;

interface Case {
  name: string;
  note: string;
  before: Canvas;
  after: Canvas;
}

const cases: Case[] = [
  {
    name: 'identical',
    note: 'false-positive floor',
    before: drawScene(BEFORE),
    after: drawScene(BEFORE),
  },
  {
    name: 'one digit',
    note: 'smallest realistic edit',
    before: drawScene(BEFORE),
    after: drawScene({ ...BEFORE, sessions: '1384' }),
  },
  {
    name: 'one word',
    note: 'four glyphs, must be one box',
    before: drawScene(BEFORE),
    after: drawScene({ ...BEFORE, sessions: '9375' }),
  },
  {
    name: 'sample pair',
    note: 'the committed samples',
    before: drawScene(BEFORE),
    after: drawScene(AFTER),
  },
  {
    name: 'two dots 12px apart',
    note: 'over-merging: should these be one box?',
    before: drawScene(BEFORE),
    after: withDots(drawScene(BEFORE), [
      [600, 760],
      [615, 760],
    ]),
  },
  {
    name: 'two dots 24px apart',
    note: 'over-merging: these should stay two',
    before: drawScene(BEFORE),
    after: withDots(drawScene(BEFORE), [
      [600, 760],
      [627, 760],
    ]),
  },
  {
    name: 'HiDPI 2560x1680',
    note: '2x capture, the common case',
    before: drawScene(BEFORE, 2),
    after: drawScene(AFTER, 2),
  },
  {
    name: 'large 3840x2520',
    note: '3x capture, 9.7 MP',
    before: drawScene(BEFORE, 3),
    after: drawScene(AFTER, 3),
  },
  {
    name: 'global recolour',
    note: 'worst case: the density guard',
    before: drawScene(BEFORE),
    after: darken(drawScene(BEFORE), 30),
  },
];

/**
 * Every pixel a little darker — a whole-page theme change, or a screenshot captured at a
 * different gamma.
 *
 * This is the case the change-density guard exists for: past 25% changed pixels the
 * refinement pass is abandoned, because a comparison where everything differs cannot be
 * usefully refined and would otherwise cost the most while saying the least.
 *
 * Darker rather than lighter on purpose. This scene is mostly white, and adding to a
 * channel already at 255 clamps to no change at all — a "worst case" that brightened the
 * page turned out to alter only a fifth of it.
 */
function darken(image: Canvas, amount: number): Canvas {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] -= amount;
    data[i + 1] -= amount;
    data[i + 2] -= amount;
  }
  return { width: image.width, height: image.height, data };
}

/** Small marks at chosen separations, to find where two changes stop being two boxes. */
function withDots(base: Canvas, positions: [number, number][]): Canvas {
  const copy: Canvas = { ...base, data: new Uint8ClampedArray(base.data) };
  for (const [x, y] of positions) {
    fillRect(copy, x, y, 3, 3, [244, 63, 94]);
  }
  return copy;
}

/** Median rather than mean: one scheduling hiccup should not colour the result. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(testCase: Case) {
  for (let run = 0; run < WARMUP_RUNS; run++) {
    runDiff(testCase.before, testCase.after, DEFAULT_SETTINGS);
  }

  const totals: number[] = [];
  let result = runDiff(testCase.before, testCase.after, DEFAULT_SETTINGS);

  for (let run = 0; run < TIMED_RUNS; run++) {
    const started = performance.now();
    result = runDiff(testCase.before, testCase.after, DEFAULT_SETTINGS);
    totals.push(performance.now() - started);
  }

  return { result, totalMs: median(totals) };
}

// --- Report -----------------------------------------------------------------------

const derived = deriveParams(DEFAULT_SETTINGS.sensitivity);

console.log('machine   ', `${cpus()[0].model.trim()}, ${cpus().length} threads`);
console.log('           ', `${process.platform} ${process.arch}, node ${process.version}, ` +
  `${Math.round(totalmem() / 1024 ** 3)} GB RAM`);
console.log(
  'settings  ',
  `sensitivity ${DEFAULT_SETTINGS.sensitivity}/10 ` +
    `(threshold ~${derived.equivalentLumaStep}/255, min cluster ${derived.minChangedPixels} px), ` +
    `AA suppression ${DEFAULT_SETTINGS.suppressAntiAliasing ? 'on' : 'off'}`,
);
console.log('constants  ', `TILE ${TILE}, CELL ${CELL}, BRIDGE_CELLS ${BRIDGE_CELLS}, MERGE_GAP_PX ${MERGE_GAP_PX}`);
console.log('runs       ', `median of ${TIMED_RUNS} after ${WARMUP_RUNS} warm-up runs\n`);

/** `--csv` prints one comma-separated row per case, for sweeping a constant. */
const asCsv = process.argv.includes('--csv');

const header = ['case', 'megapixels', 'tiles in', 'changed px', 'regions', 'boxes', 'engine ms'];
const rows: string[][] = [];

/**
 * Measured once, then both printed and checked.
 *
 * Re-running a case to verify what was already reported means the verdict is computed
 * from different numbers than the table shows. They agree while the engine is
 * deterministic, which is exactly how long such a thing stays invisible.
 */
const measured = new Map(cases.map((testCase) => [testCase.name, measure(testCase)]));

function resultFor(name: string) {
  const found = measured.get(name);
  if (!found) {
    throw new Error(`No case named "${name}" — the checks below name their cases.`);
  }
  return found;
}

for (const testCase of cases) {
  const { result, totalMs } = resultFor(testCase.name);
  const { stats } = result;

  rows.push([
    `${testCase.name}`,
    ((stats.width * stats.height) / 1_000_000).toFixed(2),
    `${screenedInPercent(stats)}%`,
    `${stats.changedPixels}`,
    `${stats.rawRegions}`,
    `${result.boxes.length}`,
    totalMs.toFixed(1),
  ]);
}

const widths = header.map((_, column) =>
  Math.max(header[column].length, ...rows.map((row) => row[column].length)),
);
const line = (cells: string[]) =>
  cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');

if (asCsv) {
  rows.forEach((row) => console.log(`CSV,${row.join(',')}`));
} else {
  console.log(line(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  rows.forEach((row, index) => {
    console.log(`${line(row)}   ${cases[index].note}`);
  });
}

// --- The two claims this pass exists to check -------------------------------------

const localised = resultFor('one digit');
const word = resultFor('one word');
const localisedScreenedIn = Number(screenedInPercent(localised.result.stats));

const problems: string[] = [];

if (localisedScreenedIn >= 10) {
  problems.push(
    `tile screen let ${localisedScreenedIn}% through for a single-digit change; ` +
      'single digits expected, so something upstream is wrong',
  );
}

if (word.result.boxes.length !== 1) {
  problems.push(
    `a four-glyph word produced ${word.result.boxes.length} boxes; one expected — ` +
      `BRIDGE_CELLS (${BRIDGE_CELLS}) or MERGE_GAP_PX (${MERGE_GAP_PX}) is too small`,
  );
}

if (resultFor('identical').result.boxes.length !== 0) {
  problems.push('identical images produced a box');
}

/*
 * The large pair reports more boxes than there are edits, and it is worth being explicit
 * about why rather than leaving a reader to wonder.
 *
 * `MERGE_GAP_PX` is a fixed distance in image pixels. At three times the scale every gap
 * inside a glyph is three times wider too, so strokes that merged into one box at 1x no
 * longer reach each other. The engine is not wrong — those really are separate clusters
 * of changed pixels — but a changed digit drawn at 4K is reported as several marks.
 */
if (process.argv.includes('--boxes')) {
  console.log('\nboxes, large pair:');
  for (const box of resultFor('large 3840x2520').result.boxes) {
    console.log(`  ${box.width}x${box.height} at (${box.x},${box.y}) — ${box.changedPixels} px`);
  }
}

console.log('');
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`FAIL  ${problem}`);
  }
  process.exitCode = 1;
} else {
  console.log('OK    tile screen in single digits, one box per changed word, no false positives.');
}
