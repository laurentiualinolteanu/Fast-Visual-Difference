import {
  BLACK,
  WHITE,
  cloneImage,
  fillRect,
  paintRowGradient,
  setPixel,
  solidImage,
} from './test-support';

/**
 * The harness is the ruler every other spec in `core/diff` measures with. If `setPixel`
 * wrote to the wrong offset, the engine specs would not fail — they would agree with an
 * equally-wrong engine, or fail in ways that look like engine bugs. So the ruler gets
 * checked against raw byte offsets computed by hand, not against itself.
 */
describe('test-support', () => {
  describe('solidImage', () => {
    it('allocates exactly four bytes per pixel', () => {
      const image = solidImage(7, 5);

      expect(image.width).toBe(7);
      expect(image.height).toBe(5);
      expect(image.data.length).toBe(7 * 5 * 4);
    });

    it('fills every pixel with the requested opaque colour', () => {
      const image = solidImage(3, 2, [10, 20, 30]);

      for (let i = 0; i < image.data.length; i += 4) {
        expect(image.data[i]).toBe(10);
        expect(image.data[i + 1]).toBe(20);
        expect(image.data[i + 2]).toBe(30);
        expect(image.data[i + 3]).toBe(255);
      }
    });

    it('defaults to opaque white', () => {
      expect(Array.from(solidImage(1, 1).data)).toEqual([255, 255, 255, 255]);
    });
  });

  describe('setPixel', () => {
    it('writes at (y * width + x) * 4 and nowhere else', () => {
      // A 4x3 image: (2,1) must land at byte 24, not 12 (transposed) or 8 (stride bug).
      const image = solidImage(4, 3);
      setPixel(image, 2, 1, BLACK);

      const expectedOffset = (1 * 4 + 2) * 4;
      expect(expectedOffset).toBe(24);
      expect(image.data[expectedOffset]).toBe(0);
      expect(image.data[expectedOffset + 1]).toBe(0);
      expect(image.data[expectedOffset + 2]).toBe(0);

      // Exactly one pixel changed: every other byte is still white.
      let changedBytes = 0;
      for (let i = 0; i < image.data.length; i++) {
        if (image.data[i] !== 255) {
          changedBytes++;
        }
      }
      expect(changedBytes).toBe(3);
    });

    it('distinguishes (x, y) from (y, x)', () => {
      // The one bug this whole file exists to catch.
      const image = solidImage(8, 8);
      setPixel(image, 5, 1, BLACK);

      expect(image.data[(1 * 8 + 5) * 4]).toBe(0);
      expect(image.data[(5 * 8 + 1) * 4]).toBe(255);
    });

    it('writes the requested alpha', () => {
      const image = solidImage(2, 2);
      setPixel(image, 1, 1, WHITE, 128);

      expect(image.data[(1 * 2 + 1) * 4 + 3]).toBe(128);
    });

    it('throws rather than wrapping into a neighbouring row', () => {
      const image = solidImage(4, 4);

      expect(() => setPixel(image, 4, 0, BLACK)).toThrowError(/outside 4x4/);
      expect(() => setPixel(image, 0, 4, BLACK)).toThrowError(/outside 4x4/);
      expect(() => setPixel(image, -1, 0, BLACK)).toThrowError(/outside 4x4/);
    });
  });

  describe('fillRect', () => {
    it('covers exactly the requested rectangle', () => {
      const image = solidImage(6, 6);
      fillRect(image, 1, 2, 3, 2, BLACK); // x 1..3, y 2..3

      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          const inside = x >= 1 && x <= 3 && y >= 2 && y <= 3;
          expect(image.data[(y * 6 + x) * 4])
            .withContext(`pixel (${x}, ${y})`)
            .toBe(inside ? 0 : 255);
        }
      }
    });

    it('rejects a rectangle that runs off the edge', () => {
      const image = solidImage(4, 4);
      expect(() => fillRect(image, 2, 2, 3, 3, BLACK)).toThrowError(/outside 4x4/);
    });
  });

  describe('paintRowGradient', () => {
    it('makes every row a uniform grey that differs from its neighbours', () => {
      // Both properties matter: uniform *within* a row so a spec can change one pixel
      // and know nothing else moved, and distinct *between* rows so a shared-stride bug
      // in the code under test cannot hide.
      const image = solidImage(5, 4);
      paintRowGradient(image);

      const rowValue = (y: number) => image.data[y * 5 * 4];

      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 5; x++) {
          expect(image.data[(y * 5 + x) * 4])
            .withContext(`pixel (${x}, ${y})`)
            .toBe(rowValue(y));
        }
      }
      expect(new Set([rowValue(0), rowValue(1), rowValue(2), rowValue(3)]).size).toBe(4);
    });
  });

  describe('cloneImage', () => {
    it('copies the pixels', () => {
      const original = solidImage(3, 3);
      setPixel(original, 1, 1, BLACK);

      expect(Array.from(cloneImage(original).data)).toEqual(Array.from(original.data));
    });

    it('does not share the buffer', () => {
      // Every "before/after" spec builds the after image with cloneImage and then edits
      // it; if the buffers were shared, both images would change and the spec would see
      // no difference at all.
      const original = solidImage(3, 3);
      const copy = cloneImage(original);
      setPixel(copy, 0, 0, BLACK);

      expect(copy.data[0]).toBe(0);
      expect(original.data[0]).toBe(255);
    });
  });
});
