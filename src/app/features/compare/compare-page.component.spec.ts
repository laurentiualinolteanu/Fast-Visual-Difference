import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ComparePageComponent } from './compare-page.component';
import { DiffService, ImageSlot, LoadedImage } from '../../core/diff.service';
import { DiffResult, DiffSettings } from '../../core/diff/diff-types';
import { DEFAULT_SETTINGS } from '../../core/diff/sensitivity';

/**
 * The page's state machine, not its markup.
 *
 * Four of T12's acceptance criteria are claims about state — when Compare is enabled,
 * what a settings change does, what a failed load leaves behind — and none of them are
 * visible to a rendering test. The layout itself is temporary and is replaced in T13–T16.
 */

function loadedImage(name: string): LoadedImage {
  return { name, objectUrl: `blob:${name}`, width: 64, height: 64, decodeMs: 3 };
}

function diffResult(boxCount = 1): DiffResult {
  return {
    boxes: Array.from({ length: boxCount }, (_, index) => ({
      x: index,
      y: 0,
      width: 4,
      height: 4,
      changedPixels: 1,
      kind: 'change' as const,
    })),
    timings: { screenMs: 1, scoreMs: 1, groupMs: 0, mergeMs: 0, totalMs: 2 },
    stats: {
      width: 64,
      height: 64,
      candidateTiles: 1,
      totalTiles: 64,
      changedPixels: 1,
      changedCells: 1,
      rawRegions: 1,
    },
    warnings: [],
  };
}

/** A `DiffService` whose two async methods are settled by the spec, one call at a time. */
class FakeDiffService {
  readonly loadCalls: { slot: ImageSlot; file: File }[] = [];
  readonly compareCalls: DiffSettings[] = [];

  private settleLoad?: (loaded: LoadedImage) => void;
  private failLoad?: (error: Error) => void;
  private settleCompare?: (result: DiffResult) => void;
  private failCompare?: (error: Error) => void;

  loadImage(slot: ImageSlot, file: File): Promise<LoadedImage> {
    this.loadCalls.push({ slot, file });
    return new Promise<LoadedImage>((resolve, reject) => {
      this.settleLoad = resolve;
      this.failLoad = reject;
    });
  }

  compare(settings: DiffSettings): Promise<DiffResult> {
    this.compareCalls.push(settings);
    return new Promise<DiffResult>((resolve, reject) => {
      this.settleCompare = resolve;
      this.failCompare = reject;
    });
  }

  resolveLoad(name = 'image.png'): void {
    this.settleLoad?.(loadedImage(name));
  }

  rejectLoad(message: string): void {
    this.failLoad?.(new Error(message));
  }

  resolveCompare(result = diffResult()): void {
    this.settleCompare?.(result);
  }

  rejectCompare(message: string): void {
    this.failCompare?.(new Error(message));
  }
}

describe('ComparePageComponent', () => {
  let fixture: ComponentFixture<ComparePageComponent>;
  let page: ComparePageComponent;
  let service: FakeDiffService;

  beforeEach(() => {
    // The page logs each result until T16 replaces that with a structured line. These
    // specs have no interest in it, and left alone it buries the suite output.
    spyOn(console, 'log');

    service = new FakeDiffService();

    TestBed.configureTestingModule({
      imports: [ComparePageComponent],
      providers: [provideNoopAnimations(), { provide: DiffService, useValue: service }],
    });

    fixture = TestBed.createComponent(ComparePageComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Fill a slot and wait for the load to settle. */
  async function load(slot: ImageSlot, name = `${slot}.png`): Promise<void> {
    const loading = page.onFile(slot, new File([], name, { type: 'image/png' }));
    service.resolveLoad(name);
    await loading;
  }

  async function loadBothAndCompare(): Promise<void> {
    await load('before');
    await load('after');

    const comparing = page.onCompare();
    service.resolveCompare();
    await comparing;
  }

  describe('when Compare is available', () => {
    it('needs both slots', async () => {
      expect(page.canCompare()).toBeFalse();

      await load('before');
      expect(page.canCompare()).toBeFalse();

      await load('after');
      expect(page.canCompare()).toBeTrue();
    });

    it('is unavailable while a comparison is in flight', async () => {
      await load('before');
      await load('after');

      const comparing = page.onCompare();
      expect(page.busy()).toBeTrue();
      expect(page.canCompare()).toBeFalse();

      service.resolveCompare();
      await comparing;

      expect(page.busy()).toBeFalse();
      expect(page.canCompare()).toBeTrue();
    });

    it('is unavailable while a file is decoding', async () => {
      await load('before');
      await load('after');
      expect(page.canCompare()).toBeTrue();

      // Both slots are already filled, so the in-flight load is the only reason left.
      const loading = page.onFile('before', new File([], 'replacement.png', { type: 'image/png' }));
      expect(page.loading()).toBeTrue();
      expect(page.canCompare()).toBeFalse();

      service.resolveLoad('replacement.png');
      await loading;
      expect(page.canCompare()).toBeTrue();
    });

    it('ignores a second click while the first is running', async () => {
      await load('before');
      await load('after');

      const comparing = page.onCompare();
      await page.onCompare();

      expect(service.compareCalls.length).toBe(1);

      service.resolveCompare();
      await comparing;
    });
  });

  describe('onFile', () => {
    it('gates both inputs while decoding and releases them afterwards', async () => {
      expect(page.loading()).toBeFalse();

      const loading = page.onFile('before', new File([], 'a.png', { type: 'image/png' }));
      expect(page.loading()).toBeTrue();

      service.resolveLoad('a.png');
      await loading;

      expect(page.loading()).toBeFalse();
      expect(page.before()?.name).toBe('a.png');
    });

    it('releases the inputs and reports the reason when a load fails', async () => {
      await load('before', 'good.png');

      const failing = page.onFile('after', new File([], 'bad.png', { type: 'image/png' }));
      service.rejectLoad('"bad.png" could not be decoded.');
      await failing;

      expect(page.loading()).toBeFalse();
      expect(page.errorMessage()).toContain('could not be decoded');
      // The service guarantees the other slot survives; the page must not clear it either.
      expect(page.before()?.name).toBe('good.png');
      expect(page.after()).toBeNull();
    });

    it('discards a result that described the previous images', async () => {
      await loadBothAndCompare();
      expect(page.result()).not.toBeNull();

      await load('after', 'replacement.png');

      expect(page.result()).toBeNull();
      expect(page.boxes()).toEqual([]);
      expect(page.stale()).toBeFalse();
    });
  });

  describe('onSettingsChange', () => {
    it('marks a displayed result stale without recomputing it', async () => {
      await loadBothAndCompare();
      expect(service.compareCalls.length).toBe(1);

      page.onSettingsChange({ ...DEFAULT_SETTINGS, sensitivity: 9 });

      expect(page.stale()).toBeTrue();
      expect(page.settings().sensitivity).toBe(9);
      // The whole point: dragging a slider must not queue a comparison per step.
      expect(service.compareCalls.length).toBe(1);
      expect(page.result()).not.toBeNull();
    });

    it('does not mark anything stale before the first run', () => {
      page.onSettingsChange({ ...DEFAULT_SETTINGS, sensitivity: 3 });

      expect(page.stale()).toBeFalse();
    });

    it('is what the temporary slider and checkbox go through', () => {
      page.onSensitivityInput({ target: { value: '2' } } as unknown as Event);
      expect(page.settings().sensitivity).toBe(2);

      page.onSuppressionInput({ target: { checked: false } } as unknown as Event);
      expect(page.settings()).toEqual({ sensitivity: 2, suppressAntiAliasing: false });
    });
  });

  describe('the overlay frame', () => {
    /** A real, loadable image so the browser gives the elements a genuine layout. */
    function dataUrlImage(width: number, height: number): LoadedImage {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#cccccc';
      context.fillRect(0, 0, width, height);

      return { name: 'framed.png', objectUrl: canvas.toDataURL('image/png'), width, height, decodeMs: 1 };
    }

    async function renderImage(width: number, height: number): Promise<void> {
      page.before.set(dataUrlImage(width, height));
      fixture.detectChanges();

      const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
      if (!img.complete) {
        await new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
      }
      fixture.detectChanges();
    }

    /**
     * The area the picture itself occupies — borders excluded.
     *
     * This distinction is the whole point of the check. `getBoundingClientRect` includes
     * borders, so comparing it against the overlay's rect would pass even when the
     * overlay covers the image's border box: both grow together. But the `viewBox` maps
     * 0..naturalWidth across the overlay, so an overlay two pixels wider than the picture
     * draws every box a pixel off and a hair too large — plausible enough on screen to
     * survive a look, and wrong.
     */
    function pictureRect(element: Element): DOMRect {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const left = parseFloat(style.borderLeftWidth);
      const top = parseFloat(style.borderTopWidth);
      const right = parseFloat(style.borderRightWidth);
      const bottom = parseFloat(style.borderBottomWidth);

      return new DOMRect(
        rect.left + left,
        rect.top + top,
        rect.width - left - right,
        rect.height - top - bottom,
      );
    }

    /**
     * The overlay is positioned, not measured: it inherits the frame's box. So the only
     * thing that can silently break alignment is that box not matching the picture —
     * which is exactly what a border on the wrong element does.
     */
    async function expectOverlayToCoverTheImage(width: number, height: number): Promise<void> {
      await renderImage(width, height);

      const image = pictureRect(fixture.nativeElement.querySelector('img') as HTMLImageElement);
      const overlay = pictureRect(fixture.nativeElement.querySelector('svg') as SVGSVGElement);

      expect(image.width).toBeGreaterThan(0);
      expect(overlay.left).toBeCloseTo(image.left, 1);
      expect(overlay.top).toBeCloseTo(image.top, 1);
      expect(overlay.width).toBeCloseTo(image.width, 1);
      expect(overlay.height).toBeCloseTo(image.height, 1);
    }

    it('covers the image exactly when the image is smaller than the panel', async () => {
      await expectOverlayToCoverTheImage(80, 60);
    });

    it('covers the image exactly when the image is wider than the panel', async () => {
      // `max-width: 100%` shrinks the image; the frame must shrink with it.
      await expectOverlayToCoverTheImage(4000, 3000);
    });
  });

  describe('onCompare', () => {
    it('stores the result, clears stale and sends the current settings', async () => {
      await load('before');
      await load('after');
      page.onSettingsChange({ ...DEFAULT_SETTINGS, sensitivity: 8 });

      const comparing = page.onCompare();
      service.resolveCompare(diffResult(3));
      await comparing;

      expect(service.compareCalls).toEqual([{ ...DEFAULT_SETTINGS, sensitivity: 8 }]);
      expect(page.result()?.boxes.length).toBe(3);
      expect(page.boxes().length).toBe(3);
      expect(page.stale()).toBeFalse();
    });

    it('measures click to painted boxes, so the number covers more than the engine time', async () => {
      await loadBothAndCompare();

      // The engine's own total is 2 ms in the fake; the page's number also includes the
      // two animation frames it waits for, which is the interval the markers bracket.
      expect(page.elapsedMs()).toBeGreaterThan(0);
      expect(page.elapsedMs()).toBeGreaterThanOrEqual(page.result()!.timings.totalMs);
    });

    it('reports a failure and stays usable', async () => {
      await load('before');
      await load('after');

      const comparing = page.onCompare();
      service.rejectCompare('Both images must be loaded before comparing.');
      await comparing;

      expect(page.errorMessage()).toContain('Both images must be loaded');
      expect(page.busy()).toBeFalse();
      expect(page.canCompare()).toBeTrue();
    });

    it('clears a previous error when a new run starts', async () => {
      await load('before');
      await load('after');

      const failing = page.onCompare();
      service.rejectCompare('boom');
      await failing;
      expect(page.errorMessage()).toBe('boom');

      const comparing = page.onCompare();
      service.resolveCompare();
      await comparing;

      expect(page.errorMessage()).toBeNull();
    });
  });
});
