import { ImageDataLike } from './diff-types';
import { TILE } from './sensitivity';
import { BLACK, WHITE, cloneImage, setPixel, solidImage } from './test-support';
import { screenTiles } from './tile-screener';

/** Index of the tile containing pixel (x, y). */
function tileIndex(x: number, y: number, tilesX: number): number {
  return Math.floor(y / TILE) * tilesX + Math.floor(x / TILE);
}

/**
 * Paint every row a distinct grey, across the given width.
 *
 * Row-dependent content is what makes the differing-widths specs meaningful: if the
 * screener used one shared row stride instead of each image's own, it would compare
 * row N of one image against part of row N+1 of the other, and a uniform image would
 * hide the mistake completely.
 */
function paintRowGradient(image: ImageDataLike, width: number): void {
  for (let y = 0; y < image.height; y++) {
    const grey = (y * 7) % 256;
    for (let x = 0; x < width; x++) {
      setPixel(image, x, y, [grey, grey, grey]);
    }
  }
}

describe('screenTiles', () => {
  describe('identical images', () => {
    it('flags no tiles', () => {
      const before = solidImage(200, 200);
      const after = cloneImage(before);

      const result = screenTiles(before, after, 200, 200);

      expect(result.candidateCount).toBe(0);
      expect(result.candidates.every((flag) => flag === 0)).toBeTrue();
    });
  });

  describe('a single changed pixel', () => {
    it('flags exactly one tile, and it is the right one', () => {
      const before = solidImage(200, 200);
      const after = cloneImage(before);
      setPixel(after, 50, 60, BLACK);

      const result = screenTiles(before, after, 200, 200);

      expect(result.candidateCount).toBe(1);
      expect(result.candidates[tileIndex(50, 60, result.tilesX)]).toBe(1);
    });

    it('attributes a pixel on a tile boundary to the tile it starts', () => {
      const before = solidImage(64, 64);
      const after = cloneImage(before);
      setPixel(after, TILE, 0, BLACK); // first pixel of the second tile in row 0

      const result = screenTiles(before, after, 64, 64);

      expect(result.candidateCount).toBe(1);
      expect(result.candidates[1]).toBe(1);
      expect(result.candidates[0]).toBe(0);
    });

    it('flags a change that differs only in alpha', () => {
      // Stage 1 compares whole RGBA words, so any byte change is a candidate. Whether
      // it is a *visible* change is Stage 2's decision, not this one's.
      const before = solidImage(32, 32);
      const after = cloneImage(before);
      setPixel(after, 4, 4, WHITE, 128);

      expect(screenTiles(before, after, 32, 32).candidateCount).toBe(1);
    });
  });

  describe('tile grid', () => {
    it('covers dimensions that are not a multiple of the tile size', () => {
      const before = solidImage(20, 12);
      const after = cloneImage(before);
      setPixel(after, 19, 11, BLACK); // last pixel, inside a partial edge tile

      const result = screenTiles(before, after, 20, 12);

      expect(result.tilesX).toBe(Math.ceil(20 / TILE));
      expect(result.tilesY).toBe(Math.ceil(12 / TILE));
      expect(result.candidates.length).toBe(result.tilesX * result.tilesY);
      expect(result.candidateCount).toBe(1);
      expect(result.candidates[tileIndex(19, 11, result.tilesX)]).toBe(1);
    });
  });

  describe('images of different widths', () => {
    it('finds no difference when the overlap is identical', () => {
      // 200x100 against 160x100: the row strides differ, so each image must be indexed
      // with its own. Sharing one stride would misalign every row after the first.
      const wide = solidImage(200, 100);
      const narrow = solidImage(160, 100);
      paintRowGradient(wide, 200);
      paintRowGradient(narrow, 160);

      const result = screenTiles(wide, narrow, 160, 100);

      expect(result.candidateCount).toBe(0);
    });

    it('still finds a real difference inside the overlap', () => {
      const wide = solidImage(200, 100);
      const narrow = solidImage(160, 100);
      paintRowGradient(wide, 200);
      paintRowGradient(narrow, 160);
      setPixel(narrow, 100, 50, BLACK);

      const result = screenTiles(wide, narrow, 160, 100);

      expect(result.candidateCount).toBe(1);
      expect(result.candidates[tileIndex(100, 50, result.tilesX)]).toBe(1);
    });
  });

  describe('validation', () => {
    it('rejects an empty region', () => {
      const image = solidImage(10, 10);
      expect(() => screenTiles(image, image, 0, 10)).toThrowError(/non-empty/);
    });

    it('rejects a region larger than either image', () => {
      const small = solidImage(10, 10);
      const large = solidImage(40, 40);
      expect(() => screenTiles(small, large, 40, 40)).toThrowError(/does not fit inside both/);
    });

    it('rejects a pixel buffer that is too short for its stated dimensions', () => {
      const truncated: ImageDataLike = {
        width: 10,
        height: 10,
        data: new Uint8ClampedArray(10 * 10 * 4 - 8),
      };
      const ok = solidImage(10, 10);

      expect(() => screenTiles(truncated, ok, 10, 10)).toThrowError(/before image.*needs 400/);
    });

    it('rejects a misaligned pixel buffer', () => {
      // A view starting one byte into its backing store cannot be read as 32-bit words.
      const backing = new ArrayBuffer(10 * 10 * 4 + 4);
      const misaligned: ImageDataLike = {
        width: 10,
        height: 10,
        data: new Uint8ClampedArray(backing, 1, 10 * 10 * 4),
      };
      const ok = solidImage(10, 10);

      expect(() => screenTiles(misaligned, ok, 10, 10)).toThrowError(/not 4-byte aligned/);
    });
  });
});
