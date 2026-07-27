import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BoxOverlayComponent } from './box-overlay.component';
import { Box } from '../../core/diff/diff-types';

/**
 * The rendered SVG *is* this component's contract, so it is asserted rather than the
 * class. The claim under test — a rect's coordinates equal the engine's coordinates, at
 * any display size — is what the whole no-ratio-arithmetic design rests on.
 */

function box(partial: Partial<Box> = {}): Box {
  return { x: 10, y: 20, width: 30, height: 40, changedPixels: 5, kind: 'change', ...partial };
}

describe('BoxOverlayComponent', () => {
  let fixture: ComponentFixture<BoxOverlayComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BoxOverlayComponent] });
    fixture = TestBed.createComponent(BoxOverlayComponent);
  });

  /** Render the given boxes over an image of the given natural size. */
  function render(boxes: Box[], width = 400, height = 300): SVGSVGElement {
    fixture.componentRef.setInput('boxes', boxes);
    fixture.componentRef.setInput('width', width);
    fixture.componentRef.setInput('height', height);
    fixture.detectChanges();

    return fixture.nativeElement.querySelector('svg') as SVGSVGElement;
  }

  function rects(svg: SVGSVGElement, group: 'halos' | 'strokes'): SVGRectElement[] {
    return Array.from(svg.querySelectorAll<SVGRectElement>(`g.${group} rect`));
  }

  describe('the coordinate space', () => {
    it('is the image natural size, so the browser does the scaling', () => {
      const svg = render([box()], 1920, 1080);

      expect(svg.getAttribute('viewBox')).toBe('0 0 1920 1080');
    });

    it('emits engine coordinates verbatim, whatever the element is displayed at', () => {
      // The host is squeezed to a fraction of the natural size. If any part of this
      // component multiplied by a displayed/natural ratio, these attributes would change.
      fixture.nativeElement.style.width = '120px';
      fixture.nativeElement.style.height = '90px';

      const svg = render([box({ x: 1234, y: 900, width: 3, height: 3 })], 4000, 3000);
      const [rect] = rects(svg, 'strokes');

      expect(rect.getAttribute('x')).toBe('1234');
      expect(rect.getAttribute('y')).toBe('900');
      expect(rect.getAttribute('width')).toBe('3');
      expect(rect.getAttribute('height')).toBe('3');
    });

    it('anchors top-left and scales uniformly if the box is ever not an exact match', () => {
      // The frame is sized to the image, so this is a safety net rather than a behaviour
      // in daily use: a sub-pixel mismatch must offset the boxes, never stretch them.
      expect(render([]).getAttribute('preserveAspectRatio')).toBe('xMinYMin meet');
    });
  });

  describe('what gets drawn', () => {
    it('gives every box a halo and a stroke', () => {
      const svg = render([box(), box({ x: 100 }), box({ x: 200 })]);

      expect(rects(svg, 'halos').length).toBe(3);
      expect(rects(svg, 'strokes').length).toBe(3);
    });

    it('paints every halo before any stroke', () => {
      // Not one halo/stroke pair per box: merging plus the 2px padding makes adjacent
      // boxes common, and interleaved pairs let the next box's white halo paint over the
      // previous box's coloured stroke.
      const svg = render([box(), box({ x: 12 })]);
      const groups = Array.from(svg.querySelectorAll('g')).map((g) => g.getAttribute('class'));

      expect(groups).toEqual(['halos', 'strokes']);
    });

    it('distinguishes a size band from a change', () => {
      const svg = render([box({ kind: 'change' }), box({ kind: 'size', x: 100 })]);
      const [change, size] = rects(svg, 'strokes');

      expect(change.getAttribute('class')).toBe('change');
      expect(size.getAttribute('class')).toBe('size');

      const styleOf = (rect: SVGRectElement) => getComputedStyle(rect);
      expect(styleOf(change).stroke).not.toBe(styleOf(size).stroke);
      // Dashed as well as amber, so the two are not distinguished by colour alone.
      expect(styleOf(size).strokeDasharray).not.toBe(styleOf(change).strokeDasharray);
    });

    it('renders nothing but an empty frame when there are no boxes', () => {
      const svg = render([]);

      expect(svg).toBeTruthy();
      expect(svg.querySelectorAll('rect').length).toBe(0);
    });
  });

  describe('the minimum on-screen size', () => {
    /**
     * Render at a known display width so the scale is known.
     *
     * A 4000px-wide image shown at 400px is a scale of 10, so the 10px minimum becomes
     * 100 natural units — the case from the backlog, with round numbers.
     */
    async function renderScaled(boxes: Box[], natural = 4000, displayed = 400) {
      fixture.nativeElement.style.display = 'block';
      fixture.nativeElement.style.width = `${displayed}px`;
      fixture.nativeElement.style.height = `${displayed * 0.75}px`;

      const svg = render(boxes, natural, natural * 0.75);

      // ResizeObserver reports on a later frame than the one that sized the host.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      fixture.detectChanges();

      return svg;
    }

    it('enlarges a change too small to see, keeping it on the same spot', async () => {
      // A single changed pixel, padded by the engine to 5x5, on a 4000px image.
      const svg = await renderScaled([box({ x: 1000, y: 800, width: 5, height: 5 })]);
      const [rect] = rects(svg, 'strokes');

      // 10 display px x scale 10 = 100 natural units.
      expect(Number(rect.getAttribute('width'))).toBe(100);
      expect(Number(rect.getAttribute('height'))).toBe(100);

      // Centred on the original, so it still marks where the change is.
      expect(Number(rect.getAttribute('x'))).toBe(1000 + 2.5 - 50);
      expect(Number(rect.getAttribute('y'))).toBe(800 + 2.5 - 50);
    });

    it('leaves a box that is already big enough exactly as the engine emitted it', async () => {
      const svg = await renderScaled([box({ x: 40, y: 60, width: 300, height: 220 })]);
      const [rect] = rects(svg, 'strokes');

      expect(rect.getAttribute('x')).toBe('40');
      expect(rect.getAttribute('y')).toBe('60');
      expect(rect.getAttribute('width')).toBe('300');
      expect(rect.getAttribute('height')).toBe('220');
    });

    it('enlarges the halo identically, so it still surrounds its stroke', async () => {
      // Both passes read one derived list. Inflating only one would draw a halo that no
      // longer contains the box it exists to separate from the picture.
      const svg = await renderScaled([box({ x: 1000, y: 800, width: 5, height: 5 })]);
      const geometry = (rect: SVGRectElement) =>
        ['x', 'y', 'width', 'height'].map((name) => rect.getAttribute(name));

      expect(geometry(rects(svg, 'halos')[0])).toEqual(geometry(rects(svg, 'strokes')[0]));
    });

    it('keeps an enlarged box at the edge inside the picture', async () => {
      // Otherwise half the box falls outside the viewBox and is clipped, drawing a stroke
      // on three sides — which reads as a rendering fault rather than an edge change.
      const svg = await renderScaled([box({ x: 0, y: 0, width: 3, height: 3 })]);
      const [rect] = rects(svg, 'strokes');

      expect(Number(rect.getAttribute('x'))).toBe(0);
      expect(Number(rect.getAttribute('y'))).toBe(0);
      expect(Number(rect.getAttribute('width'))).toBe(100);
    });

    it('recalculates when the panel is resized', async () => {
      const small = box({ x: 1000, y: 800, width: 5, height: 5 });

      await renderScaled([small], 4000, 400);
      expect(Number(rects(fixture.nativeElement.querySelector('svg'), 'strokes')[0].getAttribute('width'))).toBe(100);

      // Twice as wide on screen: half the scale, so half the natural minimum.
      fixture.nativeElement.style.width = '800px';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      fixture.detectChanges();

      expect(Number(rects(fixture.nativeElement.querySelector('svg'), 'strokes')[0].getAttribute('width'))).toBe(50);
    });

    it('draws boxes at engine size until it has been measured', async () => {
      // The host has no layout in this case, so there is no scale to apply. Natural size
      // is the honest fallback: correct, merely not yet enlarged.
      const svg = render([box({ x: 10, y: 20, width: 3, height: 3 })], 4000, 3000);
      const [rect] = rects(svg, 'strokes');

      expect(rect.getAttribute('width')).toBe('3');
    });
  });

  describe('how it behaves on the page', () => {
    it('keeps the stroke width in device pixels rather than image pixels', () => {
      const svg = render([box()]);

      for (const rect of svg.querySelectorAll('rect')) {
        expect(rect.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      }
    });

    it('does not intercept pointer events', () => {
      render([box()]);

      expect(getComputedStyle(fixture.nativeElement).pointerEvents).toBe('none');
    });

    it('is hidden from assistive technology, which reads the results summary instead', () => {
      // Two panels show the same boxes; announcing them twice would be noise, and the
      // count, warnings and timings are all available as text.
      expect(render([box()]).getAttribute('aria-hidden')).toBe('true');
    });
  });
});
