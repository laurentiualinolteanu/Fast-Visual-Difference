import { DiffRunContext, formatDiffRun, logDiffRun } from './log-diff-run';
import { DiffResult } from './diff/diff-types';
import { DEFAULT_SETTINGS } from './diff/sensitivity';

function diffResult(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    boxes: [{ x: 0, y: 0, width: 4, height: 4, changedPixels: 3, kind: 'change' }],
    timings: { screenMs: 3.5, scoreMs: 1.25, groupMs: 0.6, mergeMs: 0.2, totalMs: 5.7 },
    stats: {
      width: 400,
      height: 300,
      candidateTiles: 7,
      totalTiles: 1900,
      changedPixels: 241,
      changedCells: 19,
      rawRegions: 2,
    },
    warnings: [],
    ...overrides,
  };
}

const context: DiffRunContext = {
  settings: DEFAULT_SETTINGS,
  elapsedMs: 25.9,
  decodeMs: { before: 33.9, after: 32.8 },
};

describe('formatDiffRun', () => {
  it('reports the proportion of tiles the screen let through', () => {
    // The number T20 tunes against, and the one that decides whether the tile screen is
    // earning its place. It appears nowhere else in the application.
    const line = formatDiffRun(diffResult(), context);

    expect(line).toContain('tiles 7/1900 (0.4% screened in)');
  });

  it('carries every stage, the engine total and the click-to-paint interval', () => {
    const line = formatDiffRun(diffResult(), context);

    expect(line).toContain('screen 3.5 score 1.3 group 0.6 merge 0.2 = 5.7ms engine');
    expect(line).toContain('25.9ms click-to-paint');
  });

  it('states the decode cost it excluded from that interval', () => {
    // The whole argument for decoding at file-pick rests on this number being visible
    // rather than merely defensible.
    expect(formatDiffRun(diffResult(), context)).toContain('decode 33.9/32.8ms at load');
  });

  it('records the settings the numbers were produced under', () => {
    // A timing without its sensitivity is not a measurement, it is an anecdote.
    const line = formatDiffRun(diffResult(), {
      ...context,
      settings: { sensitivity: 9, suppressAntiAliasing: false },
    });

    expect(line).toContain('sensitivity 9 AA off');
    expect(formatDiffRun(diffResult(), context)).toContain('sensitivity 6 AA on');
  });

  it('describes what the stages produced', () => {
    expect(formatDiffRun(diffResult(), context)).toContain('px 241 cells 19 regions 2 -> 1 boxes');
  });

  it('mentions warnings only when there are some', () => {
    expect(formatDiffRun(diffResult(), context)).not.toContain('warning');
    expect(formatDiffRun(diffResult({ warnings: ['Images differ in size'] }), context)).toContain(
      '1 warning(s)',
    );
  });

  it('stays on one line', () => {
    // It is read in a console alongside everything else the browser prints.
    expect(formatDiffRun(diffResult(), context)).not.toContain('\n');
  });
});

describe('logDiffRun', () => {
  it('writes the formatted line once', () => {
    const info = spyOn(console, 'info');

    logDiffRun(diffResult(), context);

    expect(info).toHaveBeenCalledOnceWith(formatDiffRun(diffResult(), context));
  });
});
