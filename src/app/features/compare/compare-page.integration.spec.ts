import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService, ToastMessageOptions } from 'primeng/api';

import { ComparePageComponent } from './compare-page.component';

/**
 * Everything the user's click touches, except the click.
 *
 * Real PNG files through the browser's decoder, the real `DiffService`, and a real
 * `Worker` started from the same `new URL(...)` the production bundle uses. The rest of
 * the suite stubs one of those out; nothing else proves they fit together — a worker URL
 * that fails to resolve, or an engine that never sees the pixels, would pass every other
 * spec in this project and produce an app that does nothing.
 *
 * T12's first acceptance criterion is "loading two real files and clicking Compare
 * produces plausible boxes". This is that criterion, minus the mouse.
 */

/** A real PNG, encoded by the browser, so the decode path is genuinely exercised. */
async function pngFile(
  name: string,
  width: number,
  height: number,
  paint?: (context: CanvasRenderingContext2D) => void,
): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  paint?.(context);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob failed'))), 'image/png'),
  );

  return new File([blob], name, { type: 'image/png' });
}

describe('compare page against a real worker', () => {
  it('turns two picked files into boxes on the changes', async () => {
    // Nothing should reach the user: a toast here means some layer reported a failure.
    const toasts: ToastMessageOptions[] = [];
    const messages = new MessageService();
    spyOn(messages, 'add').and.callFake((message: ToastMessageOptions) => toasts.push(message));

    TestBed.configureTestingModule({
      imports: [ComparePageComponent],
      providers: [provideNoopAnimations(), { provide: MessageService, useValue: messages }],
    });

    const fixture = TestBed.createComponent(ComparePageComponent);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    await page.onFile('before', await pngFile('before.png', 400, 300));
    await page.onFile(
      'after',
      await pngFile('after.png', 400, 300, (context) => {
        context.fillStyle = '#000000';
        context.fillRect(50, 40, 20, 12); // an obvious block
        context.fillRect(300, 200, 1, 1); // and the hard case
      }),
    );

    expect(toasts.map((toast) => toast.detail)).withContext('a file failed to load').toEqual([]);
    expect(page.canCompare()).toBeTrue();

    await page.onCompare();

    expect(toasts.map((toast) => toast.detail))
      .withContext('the run reported a problem')
      .toEqual([]);

    const boxes = page.boxes();
    expect(boxes.length).toBe(2);

    // The block: 20x12 changed pixels, padded by 2 on every edge for legibility.
    expect(boxes[0]).toEqual({
      x: 48,
      y: 38,
      width: 24,
      height: 16,
      changedPixels: 240,
      kind: 'change',
    });

    // The single pixel — the design's headline claim, through the whole stack at the
    // default sensitivity rather than against a hand-built ImageData.
    expect(boxes[1]).toEqual({
      x: 298,
      y: 198,
      width: 5,
      height: 5,
      changedPixels: 1,
      kind: 'change',
    });

    // The reported interval covers the paint, so it must exceed the engine's own total.
    expect(page.elapsedMs()).toBeGreaterThan(page.result()!.timings.totalMs);

    // Decode was measured at load, outside that interval — the number T16 puts on screen.
    expect(page.before()!.decodeMs).toBeGreaterThan(0);
    expect(page.after()!.decodeMs).toBeGreaterThan(0);

    /*
     * And they reach the screen.
     *
     * Everything above this point would still pass if the overlay were bound to an empty
     * array, or to the wrong signal: the engine's output is asserted, and the overlay's
     * own spec proves it draws whatever it is handed, but nothing joined the two. This is
     * the join — the engine's coordinates, read back off the rendered SVG.
     */
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const strokes = Array.from(host.querySelectorAll<SVGRectElement>('g.strokes rect'));
    const halos = host.querySelectorAll('g.halos rect');

    // Two boxes, on both panels.
    expect(strokes.length).toBe(boxes.length * 2);
    expect(halos.length).toBe(strokes.length);

    expect(strokes[0].getAttribute('x')).toBe('48');
    expect(strokes[0].getAttribute('y')).toBe('38');
    // `contains`, not equality: Angular's animation renderer stamps `ng-star-inserted`
    // onto elements inserted by control flow once any animated component is in the tree.
    expect(strokes[0].classList.contains('change')).toBeTrue();
    expect(strokes[1].getAttribute('x')).toBe('298');
    expect(strokes[1].getAttribute('width')).toBe('5');

    /*
     * And the summary describes this run rather than an empty one.
     *
     * Same reasoning as the SVG above: the summary's own spec proves it renders correctly
     * when handed data, and the page's spec proves the signals hold the right values, but
     * nothing joined them. A binding reading `null` would delete the decode disclosure —
     * the whole point of T16 — while every other spec stayed green.
     */
    const summary = (selector: string) =>
      (host.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ');

    expect(summary('.loaded')).toContain('before 400×300');
    expect(summary('.loaded')).toContain('after 400×300');
    expect(summary('.loaded')).toContain('outside the measured comparison');

    expect(summary('.compared')).toContain('2 differences');
    expect(summary('.compared')).toContain('click to painted boxes');

    expect(summary('.stages')).toContain('tiles screened in');

    /*
     * The headline must be the click-to-paint interval, not the engine total. Binding the
     * smaller number is the one mistake that would quietly undo this task — the app would
     * claim a time faster than the brief's own markers measure.
     *
     * Both figures are read back off the screen and compared as displayed. Comparing the
     * rendered headline against the raw `timings.totalMs` would be comparing a rounded
     * string to an unrounded number, and a value rounded *up* can exceed its own source —
     * which made an earlier version of this assertion pass against the very bug it exists
     * to catch.
     */
    const displayed = (text: string) => Number(/(\d+(?:\.\d+)?) ms/.exec(text)?.[1]);
    const headlineMs = displayed(summary('.compared').replace(/^.*?in /, ''));
    const engineMs = displayed(summary('.stages').replace(/^.*?Engine /, ''));

    expect(engineMs).toBeGreaterThan(0);
    expect(headlineMs).toBeGreaterThan(engineMs!);
  });

  /**
   * The click-to-paint measurement, at the size of the committed sample pair.
   *
   * `npm run measure` times the engine in Node, which is the right instrument for tuning
   * but is not the interval the brief asks about: that one starts at the click and ends
   * when the boxes are on screen, and it can only be measured in a browser driving a real
   * worker. This is where that number comes from — the one quoted in the README.
   *
   * It logs rather than asserting a threshold. A timing assertion on shared CI hardware
   * is a flaky test wearing a useful disguise; the assertions here are about correctness,
   * and the number is printed for a human to read.
   */
  it('reports click-to-paint for a 1280x840 pair', async () => {
    const messages = new MessageService();
    TestBed.configureTestingModule({
      imports: [ComparePageComponent],
      providers: [provideNoopAnimations(), { provide: MessageService, useValue: messages }],
    });

    const fixture = TestBed.createComponent(ComparePageComponent);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    const scene = (variant: 'before' | 'after') =>
      pngFile(`${variant}.png`, 1280, 840, (context) => {
        // A dense-ish page: panels, a chart and text-sized marks, so the tile screen has
        // something to reject rather than a flat expanse it trivially skips.
        context.fillStyle = '#1e293b';
        context.fillRect(0, 0, 1280, 72);
        context.fillStyle = '#7dd3fc';
        for (let bar = 0; bar < 12; bar++) {
          context.fillRect(316 + bar * 78, 360 + (bar % 5) * 12, 48, 200 - (bar % 5) * 12);
        }
        context.fillStyle = '#334155';
        for (let line = 0; line < 40; line++) {
          context.fillRect(300 + (line % 4) * 240, 620 + Math.floor(line / 4) * 18, 180, 8);
        }

        if (variant === 'after') {
          context.fillStyle = '#0d9142';
          context.fillRect(288, 640, 200, 56); // a recolour
          context.fillStyle = '#f43f5e';
          context.fillRect(1180, 38, 3, 3); // the 3px case
        }
      });

    await page.onFile('before', await scene('before'));
    await page.onFile('after', await scene('after'));
    await page.onCompare();

    const result = page.result()!;
    expect(result.boxes.length).toBeGreaterThan(0);

    console.warn(
      `MEASURED 1280x840 in-browser: engine ${result.timings.totalMs.toFixed(1)} ms · ` +
        `click-to-paint ${page.elapsedMs().toFixed(1)} ms · ` +
        `decode ${page.before()!.decodeMs.toFixed(1)}/${page.after()!.decodeMs.toFixed(1)} ms · ` +
        `${result.stats.candidateTiles}/${result.stats.totalTiles} tiles screened in · ` +
        `${result.boxes.length} boxes`,
    );
  });

  /**
   * Anti-aliased text, re-rendered at a subpixel offset.
   *
   * Every other pair this project measures is drawn from `fillRect` — hard edges, no
   * anti-aliasing, no font rasterisation. That makes the tile screen look better than it
   * is and leaves the suppression path in §1.2 — the design's central claim — exercised
   * only by synthetic 1px shifts of solid shapes.
   *
   * This is the real case. The same words are drawn twice at x and x+0.3, which is what
   * happens when a page reflows by a fraction of a pixel or is captured on a machine that
   * rounds layout differently: identical content, genuinely different pixels, thousands
   * of them. A comparison without suppression reports that as change everywhere. The
   * whole point of the feature is that this produces nothing.
   */
  it('does not report anti-aliased text re-rendered a third of a pixel across', async () => {
    const messages = new MessageService();
    TestBed.configureTestingModule({
      imports: [ComparePageComponent],
      providers: [provideNoopAnimations(), { provide: MessageService, useValue: messages }],
    });

    const fixture = TestBed.createComponent(ComparePageComponent);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    const prose = (offset: number) =>
      pngFile(`text-${offset}.png`, 900, 600, (context) => {
        context.fillStyle = '#1f2937';
        context.font = '15px system-ui, -apple-system, Segoe UI, sans-serif';
        for (let row = 0; row < 26; row++) {
          context.fillText(
            'The quick brown fox jumps over the lazy dog — 0123456789 // renders anti-aliased.',
            24 + offset,
            40 + row * 21,
          );
        }
      });

    await page.onFile('before', await prose(0));

    for (const offset of [0, 0.3, 1]) {
      await page.onFile('after', await prose(offset));

      page.onSettingsChange({ sensitivity: 6, suppressAntiAliasing: true });
      await page.onCompare();
      const on = page.result()!;

      page.onSettingsChange({ sensitivity: 6, suppressAntiAliasing: false });
      await page.onCompare();
      const off = page.result()!;

      console.warn(
        `MEASURED anti-aliased text re-rendered ${offset}px across, 900x600: ` +
          `suppression OFF -> ${off.stats.changedPixels} changed px, ${off.boxes.length} boxes · ` +
          `ON -> ${on.stats.changedPixels} changed px, ${on.boxes.length} boxes`,
      );

      if (offset === 0) {
        // Identical rendering: the floor. Anything here is a false positive outright.
        expect(off.stats.changedPixels).toBe(0);
        expect(on.boxes.length).toBe(0);
      } else {
        // Suppression must at least reduce it; how far is the measurement, not the claim.
        expect(on.stats.changedPixels).toBeLessThan(off.stats.changedPixels);
      }
    }
  });
});
