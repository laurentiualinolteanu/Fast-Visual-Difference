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
  let logged: jasmine.Spy;

  beforeEach(() => {
    // Every completed run emits one structured line (see `core/log-diff-run.ts`). These
    // specs have no interest in it, and left alone it buries the suite output.
    logged = spyOn(console, 'info');

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

    it('says why it is blocked, in words meant for the user', async () => {
      // The tooltip on a greyed-out button is the only place this can be explained, so
      // the reason has to be a sentence rather than a boolean.
      expect(page.compareBlockedReason()).toBe('Load a before and an after image first.');

      const loading = page.onFile('before', new File([], 'a.png', { type: 'image/png' }));
      expect(page.compareBlockedReason()).toBe('Waiting for an image to finish loading.');
      service.resolveLoad('a.png');
      await loading;

      await load('after');
      expect(page.compareBlockedReason()).toBeNull();

      const comparing = page.onCompare();
      expect(page.compareBlockedReason()).toBe('A comparison is already running.');
      service.resolveCompare();
      await comparing;
    });

    it('cannot disagree with its own reason', async () => {
      // `canCompare` is derived from the reason rather than computed alongside it: two
      // expressions for "may we run" would eventually drift, and the drift would show as
      // a button that is enabled while claiming to be blocked.
      await load('before');
      expect(page.canCompare()).toBe(page.compareBlockedReason() === null);

      await load('after');
      expect(page.canCompare()).toBe(page.compareBlockedReason() === null);
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

    it('replaces the settings wholesale, whichever control emitted them', () => {
      // The controls bar always emits a complete `DiffSettings`; the page stores it.
      page.onSettingsChange({ sensitivity: 2, suppressAntiAliasing: false });

      expect(page.settings()).toEqual({ sensitivity: 2, suppressAntiAliasing: false });
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

    it('emits exactly one structured line per completed run', async () => {
      // The tuning instrument T20 reads. One line per run, carrying the settings it was
      // produced under — a timing without its sensitivity is an anecdote, not a datum.
      await loadBothAndCompare();

      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.calls.mostRecent().args[0]).toContain('[diff]');
      expect(logged.calls.mostRecent().args[0]).toContain('sensitivity 6');
    });

    it('logs nothing when the comparison failed', async () => {
      await load('before');
      await load('after');

      const comparing = page.onCompare();
      service.rejectCompare('boom');
      await comparing;

      expect(logged).not.toHaveBeenCalled();
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
