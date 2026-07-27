import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImagePanelComponent } from './image-panel.component';
import { LoadedImage } from '../../core/diff.service';
import { Box } from '../../core/diff/diff-types';

/**
 * The frame geometry lives here, so the alignment checks do too. They moved from the
 * compare page's spec with the markup they guard — they are the only thing standing
 * between a misplaced border and an overlay that is a pixel out everywhere.
 */

function box(partial: Partial<Box> = {}): Box {
  return { x: 10, y: 20, width: 30, height: 40, changedPixels: 5, kind: 'change', ...partial };
}

/** A real, loadable image so the browser gives the elements a genuine layout. */
function dataUrlImage(width: number, height: number, name = 'shot.png'): LoadedImage {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d')!;
  context.fillStyle = '#cccccc';
  context.fillRect(0, 0, width, height);

  return { name, objectUrl: canvas.toDataURL('image/png'), width, height, decodeMs: 1 };
}

/**
 * The area the picture itself occupies — borders excluded.
 *
 * This distinction is the whole point of the alignment check. `getBoundingClientRect`
 * includes borders, so comparing it against the overlay's rect would pass even when the
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

describe('ImagePanelComponent', () => {
  let fixture: ComponentFixture<ImagePanelComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ImagePanelComponent] });
    fixture = TestBed.createComponent(ImagePanelComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function render(image: LoadedImage | null, boxes: Box[] = [], stale = false): void {
    fixture.componentRef.setInput('label', 'BEFORE');
    fixture.componentRef.setInput('image', image);
    fixture.componentRef.setInput('boxes', boxes);
    fixture.componentRef.setInput('stale', stale);
    fixture.detectChanges();
  }

  /** Render and wait for the browser to actually lay the picture out. */
  async function renderImage(width: number, height: number, boxes: Box[] = []): Promise<void> {
    render(dataUrlImage(width, height), boxes);

    const img = host.querySelector('img') as HTMLImageElement;
    if (!img.complete) {
      await new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
    }
    fixture.detectChanges();
  }

  describe('the label', () => {
    it('is the text it was given, not something inferred from position', () => {
      render(null);

      expect(host.querySelector('.label')?.textContent?.trim()).toBe('BEFORE');
    });

    it('stays put when the panel holds no image', () => {
      // The header is permanent: a user must be able to tell which slot is empty.
      render(null);

      expect(host.querySelector('.label')).toBeTruthy();
      expect(host.querySelector('img')).toBeNull();
    });

    it('shows the dimensions and the file name beside it', () => {
      render(dataUrlImage(1920, 1080, 'homepage.png'));

      const meta = host.querySelector('.meta')?.textContent ?? '';
      expect(meta).toContain('1920');
      expect(meta).toContain('1080');
      expect(meta).toContain('homepage.png');
    });
  });

  describe('the empty state', () => {
    it('says what to do, naming the slot', () => {
      render(null);

      expect(host.querySelector('.empty')?.textContent).toContain('Choose a BEFORE image');
    });

    it('reads correctly for a label starting with a vowel', () => {
      fixture.componentRef.setInput('label', 'AFTER');
      fixture.componentRef.setInput('image', null);
      fixture.componentRef.setInput('boxes', []);
      fixture.detectChanges();

      expect(host.querySelector('.empty')?.textContent).toContain('Choose an AFTER image');
    });
  });

  describe('the overlay', () => {
    it('is given the panel image natural size and the boxes', async () => {
      await renderImage(400, 300, [box(), box({ x: 100, kind: 'size' })]);

      const svg = host.querySelector('svg') as SVGSVGElement;
      expect(svg.getAttribute('viewBox')).toBe('0 0 400 300');
      expect(host.querySelectorAll('g.strokes rect').length).toBe(2);
    });

    it('dims when the result is stale, leaving the picture at full strength', async () => {
      await renderImage(200, 150, [box()]);
      const overlay = host.querySelector('app-box-overlay') as HTMLElement;
      const img = host.querySelector('img') as HTMLImageElement;

      expect(parseFloat(getComputedStyle(overlay).opacity)).toBe(1);

      render(dataUrlImage(200, 150), [box()], true);

      // The picture is exactly what the user loaded and is not out of date; the boxes
      // describe settings that have since changed. Only they should fade.
      expect(parseFloat(getComputedStyle(overlay).opacity)).toBeLessThan(1);
      expect(parseFloat(getComputedStyle(img).opacity)).toBe(1);
    });
  });

  describe('the frame, which the overlay is inset to', () => {
    async function expectOverlayToCoverThePicture(width: number, height: number): Promise<void> {
      await renderImage(width, height);

      const image = pictureRect(host.querySelector('img') as HTMLImageElement);
      const overlay = pictureRect(host.querySelector('svg') as SVGSVGElement);

      expect(image.width).toBeGreaterThan(0);
      expect(overlay.left).toBeCloseTo(image.left, 1);
      expect(overlay.top).toBeCloseTo(image.top, 1);
      expect(overlay.width).toBeCloseTo(image.width, 1);
      expect(overlay.height).toBeCloseTo(image.height, 1);
    }

    it('covers the picture when the image is smaller than the panel', async () => {
      await expectOverlayToCoverThePicture(80, 60);
    });

    it('covers the picture when the image is wider than the panel', async () => {
      // `max-width: 100%` shrinks the picture; the frame must shrink with it.
      await expectOverlayToCoverThePicture(4000, 3000);
    });

    it('covers the picture when the image is tall enough to hit the height cap', async () => {
      // `max-height` shrinks the used *width* too, and `width: fit-content` on the frame
      // has to track that. Measured rather than assumed: a 400x4000 image in a 728px
      // panel renders 29.8x298.1 against a 298.2px cap, so height is what binds here and
      // the width collapsed from 400 to 30. The frame follows it.
      await expectOverlayToCoverThePicture(400, 4000);
    });
  });
});
