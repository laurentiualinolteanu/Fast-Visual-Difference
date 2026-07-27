import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ResultsSummaryComponent } from './results-summary.component';
import { LoadedImage } from '../../core/diff.service';
import { DiffResult } from '../../core/diff/diff-types';

function loadedImage(decodeMs: number, width = 1920, height = 1080): LoadedImage {
  return { name: 'shot.png', objectUrl: 'blob:shot', width, height, decodeMs };
}

function diffResult(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    boxes: [
      { x: 0, y: 0, width: 4, height: 4, changedPixels: 3, kind: 'change' },
      { x: 20, y: 0, width: 4, height: 4, changedPixels: 3, kind: 'change' },
    ],
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

describe('ResultsSummaryComponent', () => {
  let fixture: ComponentFixture<ResultsSummaryComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ResultsSummaryComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(ResultsSummaryComponent);
    host = fixture.nativeElement as HTMLElement;

    render({ result: null, before: null, after: null, elapsedMs: 0 });
  });

  function render(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  function text(selector: string): string {
    return host.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  describe('the decode disclosure', () => {
    it('shows both decode times and says they sit outside the measurement', () => {
      // The point of the whole component: the expensive step this app moved out of the
      // measured window is named, with its cost, rather than left to the README.
      render({ before: loadedImage(84), after: loadedImage(91) });

      const loaded = text('.loaded');
      expect(loaded).toContain('before 1920×1080 (84 ms)');
      expect(loaded).toContain('after 1920×1080 (91 ms)');
      expect(loaded).toContain('outside the measured comparison');
    });

    it('appears as soon as one image is loaded, before any comparison', () => {
      render({ before: loadedImage(84) });

      expect(text('.loaded')).toContain('before');
      expect(host.querySelector('.compared')).toBeNull();
    });

    it('says nothing at all before anything is loaded', () => {
      expect(host.querySelector('.loaded')).toBeNull();
      expect(host.querySelector('.compared')).toBeNull();
    });
  });

  describe('the comparison line', () => {
    it('leads with click-to-paint, which is the interval the markers bracket', () => {
      // Not the engine total: that is the smaller number, and reporting the smaller one
      // as the headline is exactly the accusation this component exists to answer.
      render({
        result: diffResult(),
        before: loadedImage(84),
        after: loadedImage(91),
        elapsedMs: 25.9,
      });

      expect(text('.compared')).toContain('2 differences in 26 ms');
      expect(text('.compared')).toContain('click to painted boxes');
    });

    it('agrees with itself about singular and plural', () => {
      render({ result: diffResult({ boxes: [diffResult().boxes[0]] }), elapsedMs: 12 });
      expect(text('.compared')).toContain('1 difference in');
      expect(text('.compared')).not.toContain('1 differences');
    });

    it('adds "(re-run to update)" once the settings have moved on', () => {
      render({ result: diffResult(), elapsedMs: 25.9, stale: false });
      expect(text('.compared')).not.toContain('re-run');

      render({ stale: true });
      expect(text('.compared')).toContain('(re-run to update)');
    });
  });

  describe('the stage breakdown', () => {
    it('shows every stage and the engine total beneath the headline', () => {
      render({ result: diffResult(), elapsedMs: 25.9 });

      const stages = text('.stages');
      expect(stages).toContain('Engine 5.7 ms');
      expect(stages).toContain('screen 3.5');
      expect(stages).toContain('score 1.3');
      expect(stages).toContain('group 0.6');
      expect(stages).toContain('merge 0.2');
    });

    it('shows how little the tile screen let through', () => {
      render({ result: diffResult(), elapsedMs: 25.9 });

      expect(text('.stages')).toContain('7 of 1900 tiles screened in (0.4%)');
    });

    it('keeps a sub-millisecond stage legible rather than rounding it to zero', () => {
      // "0 ms" reads as a broken instrument; "0.2 ms" reads as a fast stage.
      render({
        result: diffResult({
          timings: { screenMs: 0.2, scoreMs: 0.1, groupMs: 0.05, mergeMs: 0.05, totalMs: 0.4 },
        }),
        elapsedMs: 18,
      });

      expect(text('.stages')).toContain('Engine 0.4 ms');
      expect(text('.stages')).not.toContain('Engine 0 ms');
    });
  });

  describe('warnings', () => {
    it('puts engine warnings on screen rather than only in the console', () => {
      render({
        result: diffResult({
          warnings: ['Images differ in size (200x100 vs 200x140).', 'Boxes are approximate.'],
        }),
        elapsedMs: 25.9,
      });

      const messages = host.querySelectorAll('p-message');
      expect(messages.length).toBe(2);
      expect(host.textContent).toContain('Images differ in size');
      expect(host.textContent).toContain('Boxes are approximate.');
    });

    it('shows none when the engine had nothing to say', () => {
      render({ result: diffResult(), elapsedMs: 25.9 });

      expect(host.querySelectorAll('p-message').length).toBe(0);
    });
  });
});
