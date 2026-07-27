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
