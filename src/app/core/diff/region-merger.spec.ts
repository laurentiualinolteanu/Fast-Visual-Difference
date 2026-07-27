import { Box } from './diff-types';
import { mergeAndFinalise } from './region-merger';
import { BOX_PADDING_PX, MAX_BOXES, MERGE_GAP_PX } from './sensitivity';

/** A raw region, before merging or padding. */
function region(x: number, y: number, width: number, height: number, changedPixels = 1): Box {
  return { x, y, width, height, changedPixels, kind: 'change' };
}

/** Run the stage and hand back both halves of its output. */
function finalise(regions: Box[], width = 1000, height = 1000) {
  const warnings: string[] = [];
  const boxes = mergeAndFinalise(regions, width, height, warnings);
  return { boxes, warnings };
}

describe('mergeAndFinalise', () => {
  describe('merging', () => {
    it('merges overlapping boxes into their union', () => {
      const { boxes } = finalise([region(100, 100, 20, 20), region(110, 105, 30, 10)]);

      expect(boxes.length).toBe(1);
      // Union is x 100..139, y 100..119; padding then adds 2px on every side.
      expect(boxes[0].x).toBe(98);
      expect(boxes[0].y).toBe(98);
      expect(boxes[0].width).toBe(44);
      expect(boxes[0].height).toBe(24);
    });

    it('merges boxes that are close and keeps distant ones apart', () => {
      const close = finalise([region(100, 100, 10, 10), region(116, 100, 10, 10)]); // 6px apart
      const distant = finalise([region(100, 100, 10, 10), region(150, 100, 10, 10)]); // 40px apart

      expect(MERGE_GAP_PX).toBe(8);
      expect(close.boxes.length).toBe(1);
      expect(distant.boxes.length).toBe(2);
    });

    it('merges vertically as readily as horizontally', () => {
      const { boxes } = finalise([region(100, 100, 10, 10), region(100, 116, 10, 10)]);

      expect(boxes.length).toBe(1);
    });

    it('does not merge boxes that are near on one axis but far on the other', () => {
      // Both conditions must hold: a box directly below but far away stays separate,
      // however well its columns line up.
      const { boxes } = finalise([region(100, 100, 10, 10), region(104, 300, 10, 10)]);

      expect(boxes.length).toBe(2);
    });

    it('joins a chain of boxes each close to the next', () => {
      // None of the ends are within the gap of each other; they belong together because
      // the growing box reaches each one in turn.
      const { boxes } = finalise([
        region(100, 100, 10, 10),
        region(115, 100, 10, 10),
        region(130, 100, 10, 10),
        region(145, 100, 10, 10),
      ]);

      expect(boxes.length).toBe(1);
      expect(boxes[0].width).toBe(55 + 2 * BOX_PADDING_PX); // x 100..154, plus padding
    });

    it('adds up the changed pixels of everything it merges', () => {
      const { boxes } = finalise([
        region(100, 100, 10, 10, 40),
        region(116, 100, 10, 10, 25),
      ]);

      expect(boxes[0].changedPixels).toBe(65);
    });
  });

  describe('padding', () => {
    it('inflates a small change so it is visible', () => {
      // Test 8: a 3x3 change at (100,100) becomes (98, 98, 7, 7).
      const { boxes } = finalise([region(100, 100, 3, 3)]);

      expect(boxes).toEqual([
        { x: 98, y: 98, width: 7, height: 7, changedPixels: 1, kind: 'change' },
      ]);
    });

    it('clamps at the top-left without spilling the padding to the other side', () => {
      // A 1x1 change at the origin can only grow right and down, so it becomes 3x3 — not
      // 5x5. Adding twice the padding to the width after clamping x at zero would put
      // the whole inflation on one side and oversize every box touching an edge.
      const { boxes } = finalise([region(0, 0, 1, 1)]);

      expect(boxes).toEqual([
        { x: 0, y: 0, width: 3, height: 3, changedPixels: 1, kind: 'change' },
      ]);
    });

    it('clamps at the bottom-right', () => {
      const { boxes } = finalise([region(999, 999, 1, 1)], 1000, 1000);

      expect(boxes).toEqual([
        { x: 997, y: 997, width: 3, height: 3, changedPixels: 1, kind: 'change' },
      ]);
    });

    it('never produces a box outside the compared region', () => {
      const { boxes } = finalise(
        [region(0, 0, 1, 1), region(0, 49, 1, 1), region(49, 0, 1, 1), region(49, 49, 1, 1)],
        50,
        50,
      );

      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(50);
        expect(box.y + box.height).toBeLessThanOrEqual(50);
      }
    });
  });

  describe('ordering', () => {
    it('puts the largest box first', () => {
      const { boxes } = finalise([
        region(10, 10, 5, 5),
        region(400, 400, 50, 50),
        region(200, 200, 20, 20),
      ]);

      expect(boxes.map((box) => box.width)).toEqual([54, 24, 9]);
    });

    it('breaks ties top-to-bottom then left-to-right', () => {
      // Without a tie-break these come out in merge order, so the results list would
      // reshuffle whenever grouping happened to visit cells differently.
      const { boxes } = finalise([
        region(300, 300, 10, 10),
        region(100, 300, 10, 10),
        region(200, 100, 10, 10),
      ]);

      expect(boxes.map((box) => [box.x, box.y])).toEqual([
        [198, 98],
        [98, 298],
        [298, 298],
      ]);
    });
  });

  describe('the box cap', () => {
    /** `count` regions spaced far enough apart that no gap the escalation reaches can join them. */
    function scatteredRegions(count: number, spacing: number): Box[] {
      const perRow = Math.ceil(Math.sqrt(count));
      const regions: Box[] = [];
      for (let i = 0; i < count; i++) {
        const x = (i % perRow) * spacing;
        const y = Math.floor(i / perRow) * spacing;
        regions.push(region(x + 1, y + 1, 2, 2));
      }
      return regions;
    }

    it('caps the result and says how many it dropped', () => {
      // The defect this task exists to fix: escalating the merge gap and then returning
      // the oversized array anyway. Paint happens inside the measured window, so an
      // uncapped list makes rendering the bottleneck on the very worst inputs.
      const regions = scatteredRegions(5000, 250);
      const { boxes, warnings } = finalise(regions, 20000, 20000);

      expect(boxes.length).toBeLessThanOrEqual(MAX_BOXES);
      expect(warnings.some((warning) => warning.includes('dropped 4800'))).toBeTrue();
    });

    it('keeps the largest boxes when it truncates', () => {
      const regions = scatteredRegions(400, 250);
      regions.push(region(19000, 19000, 100, 100)); // clearly the biggest

      const { boxes } = finalise(regions, 20000, 20000);

      expect(boxes.length).toBe(MAX_BOXES);
      expect(boxes[0].width).toBe(100 + 2 * BOX_PADDING_PX);
    });

    it('warns when it had to coarsen, even if that avoided truncating', () => {
      // Spaced so the first escalation joins them: the count comes back under the cap,
      // but the boxes are no longer what the default gap would have produced.
      const regions = scatteredRegions(300, 20);
      const { boxes, warnings } = finalise(regions, 20000, 20000);

      expect(boxes.length).toBeLessThanOrEqual(MAX_BOXES);
      expect(warnings.some((warning) => warning.includes('coarsened'))).toBeTrue();
    });

    it('says nothing when the result fits comfortably', () => {
      const { boxes, warnings } = finalise([region(10, 10, 5, 5), region(500, 500, 5, 5)]);

      expect(boxes.length).toBe(2);
      expect(warnings).toEqual([]);
    });
  });

  describe('degenerate input', () => {
    it('returns nothing for no regions', () => {
      const { boxes, warnings } = finalise([]);

      expect(boxes).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('rejects a non-positive compared region', () => {
      expect(() => mergeAndFinalise([region(0, 0, 1, 1)], 0, 10, [])).toThrowError(/non-empty/);
      expect(() => mergeAndFinalise([region(0, 0, 1, 1)], 10, -1, [])).toThrowError(/non-empty/);
    });
  });
});
