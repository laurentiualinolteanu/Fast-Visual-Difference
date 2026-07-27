import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

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
    TestBed.configureTestingModule({
      imports: [ComparePageComponent],
      providers: [provideNoopAnimations()],
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

    expect(page.errorMessage()).withContext('a file failed to load').toBeNull();
    expect(page.canCompare()).toBeTrue();

    await page.onCompare();

    expect(page.errorMessage()).withContext('the comparison failed').toBeNull();

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
    expect(strokes[0].getAttribute('class')).toBe('change');
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
});
