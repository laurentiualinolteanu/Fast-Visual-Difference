import { runDiff } from './diff-engine';
import { DiffSettings, ImageDataLike } from './diff-types';
import { DEFAULT_SETTINGS } from './sensitivity';
import { BLACK, cloneImage, fillRect, setPixel, solidImage } from './test-support';

function diff(
  before: ImageDataLike,
  after: ImageDataLike,
  settings: DiffSettings = DEFAULT_SETTINGS,
) {
  return runDiff(before, after, settings);
}

/** Did any warning mention this? */
function mentions(warnings: string[], fragment: string): boolean {
  return warnings.some((warning) => warning.includes(fragment));
}

describe('runDiff', () => {
  describe('the quiet case', () => {
    it('reports nothing at all for identical images', () => {
      const before = solidImage(200, 200);

      const result = diff(before, cloneImage(before));

      expect(result.boxes).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.stats.changedPixels).toBe(0);
      expect(result.stats.candidateTiles).toBe(0);
    });

    it('finds a single change end to end', () => {
      const before = solidImage(200, 200);
      const after = cloneImage(before);
      setPixel(after, 50, 60, BLACK);

      const result = diff(before, after);

      // One pixel through four stages: threshold, bidirectional suppression, grouping,
      // then 2px of padding for legibility.
      expect(result.boxes).toEqual([
        { x: 48, y: 58, width: 5, height: 5, changedPixels: 1, kind: 'change' },
      ]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('mismatched dimensions', () => {
    it('marks the extra height and says what it compared', () => {
      const before = solidImage(200, 100);
      const after = solidImage(200, 140);

      const result = diff(before, after);

      expect(result.boxes).toEqual([
        { x: 0, y: 100, width: 200, height: 40, changedPixels: 0, kind: 'size' },
      ]);
      expect(result.warnings.length).toBe(1);
      expect(mentions(result.warnings, '200x100 vs 200x140')).toBeTrue();
      expect(mentions(result.warnings, 'top-left 200x100 overlap')).toBeTrue();
      expect(result.stats.width).toBe(200);
      expect(result.stats.height).toBe(100);
    });

    it('marks the extra width', () => {
      const result = diff(solidImage(200, 100), solidImage(160, 100));

      expect(result.boxes).toEqual([
        { x: 160, y: 0, width: 40, height: 100, changedPixels: 0, kind: 'size' },
      ]);
    });

    it('marks both bands without overlapping them', () => {
      const result = diff(solidImage(200, 100), solidImage(160, 140));

      const [right, bottom] = result.boxes;
      expect(result.boxes.length).toBe(2);
      expect(right).toEqual({ x: 160, y: 0, width: 40, height: 140, changedPixels: 0, kind: 'size' });
      expect(bottom).toEqual({ x: 0, y: 100, width: 160, height: 40, changedPixels: 0, kind: 'size' });

      // The bottom band stops where the right band starts, so the corner is claimed once.
      expect(bottom.x + bottom.width).toBe(right.x);
    });

    it('never merges a size band into a change that touches the boundary', () => {
      // The change ends on the last row of the overlap and the band begins on the next,
      // so they are touching. Appending the bands after merging is what keeps them
      // separate — a red box and an amber one, not one red box spanning both.
      const before = solidImage(64, 64);
      fillRect(before, 10, 60, 5, 4, BLACK);
      const after = solidImage(64, 80);

      const result = diff(before, after);

      expect(result.boxes.length).toBe(2);
      expect(result.boxes.filter((box) => box.kind === 'change').length).toBe(1);
      expect(result.boxes.filter((box) => box.kind === 'size').length).toBe(1);
    });
  });

  describe('the change-density warning', () => {
    it('explains itself when refinement was abandoned', () => {
      // T06 sets the flag; without this the guard is a silent speed-up and the coarse
      // boxes have no explanation.
      const result = diff(solidImage(64, 64, [100, 100, 100]), solidImage(64, 64, [130, 130, 130]));

      expect(mentions(result.warnings, 'Over 25% of the image differs')).toBeTrue();
      expect(mentions(result.warnings, 'globally offset or re-rendered')).toBeTrue();
      expect(mentions(result.warnings, 'Boxes are approximate')).toBeTrue();
    });

    it('stays quiet for an ordinary change', () => {
      const before = solidImage(64, 64);
      const after = cloneImage(before);
      fillRect(after, 10, 10, 6, 6, BLACK);

      expect(mentions(diff(before, after).warnings, 'of the image differs')).toBeFalse();
    });
  });

  describe('timings', () => {
    it('reports a positive total and non-negative stages that fit inside it', () => {
      // Big enough that the diff outlasts the clock's granularity: performance.now() is
      // coarse in some browser configurations, and a 64x64 comparison can round to zero.
      const result = diff(solidImage(500, 500, [100, 100, 100]), solidImage(500, 500, [130, 130, 130]));
      const { screenMs, scoreMs, groupMs, mergeMs, totalMs } = result.timings;

      expect(totalMs).toBeGreaterThan(0);
      for (const stage of [screenMs, scoreMs, groupMs, mergeMs]) {
        expect(stage).toBeGreaterThanOrEqual(0);
      }

      // The stages are contiguous sub-intervals of the whole call, so they can never
      // exceed it — but they will not add up to it either, because the total also covers
      // deriving parameters and assembling the result.
      expect(screenMs + scoreMs + groupMs + mergeMs).toBeLessThanOrEqual(totalMs);
    });
  });

  describe('stats', () => {
    it('describes the compared overlap, not either whole image', () => {
      const before = solidImage(200, 100);
      const after = solidImage(160, 140);

      const result = diff(before, after);

      expect(result.stats.width).toBe(160);
      expect(result.stats.height).toBe(100);
    });

    it('cannot report more candidate tiles than there are tiles', () => {
      const before = solidImage(100, 60);
      const after = cloneImage(before);
      fillRect(after, 10, 10, 20, 20, BLACK);

      const { stats } = diff(before, after);

      expect(stats.candidateTiles).toBeGreaterThan(0);
      expect(stats.candidateTiles).toBeLessThanOrEqual(stats.totalTiles);
      expect(stats.totalTiles).toBe(Math.ceil(100 / 8) * Math.ceil(60 / 8));
    });

    it('counts what the stages actually produced', () => {
      const before = solidImage(64, 64);
      const after = cloneImage(before);
      setPixel(after, 10, 10, BLACK);
      setPixel(after, 40, 40, BLACK);

      const { stats } = diff(before, after);

      expect(stats.changedPixels).toBe(2);
      expect(stats.changedCells).toBe(2);
      expect(stats.rawRegions).toBe(2);
    });
  });

  describe('validation', () => {
    it('rejects an empty before image, naming it', () => {
      expect(() => diff(solidImage(1, 1), solidImage(10, 10))).not.toThrow();
      expect(() => runDiff({ width: 0, height: 10, data: new Uint8ClampedArray(0) }, solidImage(10, 10), DEFAULT_SETTINGS))
        .toThrowError(/before image.*0x10/);
      expect(() => runDiff({ width: 10, height: 0, data: new Uint8ClampedArray(0) }, solidImage(10, 10), DEFAULT_SETTINGS))
        .toThrowError(/before image.*10x0/);
    });

    it('rejects an empty after image, naming it', () => {
      expect(() => runDiff(solidImage(10, 10), { width: 0, height: 10, data: new Uint8ClampedArray(0) }, DEFAULT_SETTINGS))
        .toThrowError(/after image.*0x10/);
      expect(() => runDiff(solidImage(10, 10), { width: 10, height: 0, data: new Uint8ClampedArray(0) }, DEFAULT_SETTINGS))
        .toThrowError(/after image.*10x0/);
    });
  });
});
