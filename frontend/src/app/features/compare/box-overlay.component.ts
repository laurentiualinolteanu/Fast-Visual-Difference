import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { Box } from '../../core/diff/diff-types';

/**
 * Smallest a box may appear on screen, in CSS pixels.
 *
 * A 1-pixel change on a 4000-pixel-wide screenshot shown at 600px is a sixth of a pixel
 * of box — a correct detection that reads as a miss. Ten pixels is small enough not to
 * misrepresent the size of the change and large enough to see and to click towards.
 */
export const MIN_BOX_DISPLAY_PX = 10;

/** A box as it will be drawn. Same coordinate space as `Box`; possibly enlarged. */
type RenderedBox = Pick<Box, 'x' | 'y' | 'width' | 'height' | 'kind'>;

/**
 * Draws the difference boxes over an image.
 *
 * **No box position is ever multiplied by a display ratio.** The `viewBox` is the image's
 * natural pixel size and every coordinate below is arithmetic on natural units alone; the
 * browser maps that space onto whatever the image is currently displayed at. Window
 * resizes, browser zoom, a panel that reflows — all handled by the same mechanism that
 * scales the image itself, so the boxes cannot drift out of alignment without the image
 * drifting with them.
 *
 * The usual alternative — reading `clientWidth`, computing `displayed / natural`, and
 * multiplying every coordinate through it — is correct only for as long as every code
 * path that changes the layout remembers to recompute. This one is correct by
 * construction.
 *
 * There is one display measurement, added for the minimum on-screen box size, and it is
 * worth being exact about what it does. A box a few pixels across on a 4000px screenshot
 * is drawn sub-pixel: a correct detection that reads as a miss. So the scale converts
 * `MIN_BOX_DISPLAY_PX` from screen pixels into natural units, and that number is used to
 * *enlarge* boxes that would be invisible. It is never applied to an x or a y. Two lines
 * mention `scale`; both are in `renderedBoxes`, and neither produces a position.
 */
@Component({
  selector: 'app-box-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      aria-hidden: the boxes are decorative here. Their count, the warnings and the
      timings are all conveyed as text by the results summary, and announcing the same
      overlay twice (once per panel) would be noise rather than information.
    -->
    <svg
      class="overlay"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      preserveAspectRatio="xMinYMin meet"
      aria-hidden="true"
      focusable="false"
    >
      <!--
        Two passes, not one halo/stroke pair per box. Merging and the 2px padding make
        adjacent boxes common, and with interleaved pairs the next box's white halo paints
        over the previous box's coloured stroke. Every halo goes underneath every stroke.
      -->
      <g class="halos">
        @for (box of renderedBoxes(); track $index) {
          <rect
            [attr.x]="box.x"
            [attr.y]="box.y"
            [attr.width]="box.width"
            [attr.height]="box.height"
            vector-effect="non-scaling-stroke"
          />
        }
      </g>

      <g class="strokes">
        @for (box of renderedBoxes(); track $index) {
          <rect
            [attr.class]="box.kind"
            [attr.x]="box.x"
            [attr.y]="box.y"
            [attr.width]="box.width"
            [attr.height]="box.height"
            vector-effect="non-scaling-stroke"
          />
        }
      </g>
    </svg>
  `,
  styles: `
    /*
     * The component owns its own placement: it is an overlay, and the only sensible
     * position for it is over the whole of the positioned ancestor it is dropped into.
     */
    :host {
      position: absolute;
      inset: 0;
      /* The image underneath stays selectable, right-clickable and hoverable. */
      pointer-events: none;
    }

    .overlay {
      display: block;
      width: 100%;
      height: 100%;
      /* Clips a size band that reaches past this image's own bounds. */
      overflow: hidden;
    }

    rect {
      fill: none;
    }

    /*
     * Because every rect carries vector-effect="non-scaling-stroke", these widths are
     * device pixels rather than image pixels. A 2px stroke stays 2px whether the image is
     * displayed at a quarter of its natural size or at four times it — without that, a box
     * on a 4000px screenshot shown at 600px would draw a stroke a third of a pixel wide.
     */
    .halos rect {
      stroke: #ffffff;
      stroke-width: 4;
      opacity: 0.75;
    }

    .strokes .change {
      stroke: #ff2d55;
      stroke-width: 2;
    }

    .strokes .size {
      stroke: #ffa000;
      stroke-width: 2;
      /* Dashed as well as amber: distinguishable without relying on colour alone. */
      stroke-dasharray: 6 4;
    }
  `,
})
export class BoxOverlayComponent {
  readonly boxes = input.required<Box[]>();

  /**
   * The natural pixel size of *this panel's* image — not the union of both.
   *
   * A size band can reach beyond one of the two images: comparing a 160x100 before with a
   * 200x140 after produces a band at x=160..200, which does not exist in the before image
   * at all. Sizing each overlay to its own image keeps the SVG box exactly equal to the
   * `<img>` box, and the out-of-range band is clipped rather than drawn over nothing.
   */
  readonly width = input.required<number>();
  readonly height = input.required<number>();

  /**
   * The width this overlay currently occupies on screen, in CSS pixels.
   *
   * Measured from this component's own host, which T14 sizes to exactly the picture area
   * — the same fact the panel's alignment specs assert. Zero until the first observation,
   * which simply means boxes render at their natural size for one frame.
   */
  private readonly displayedWidth = signal(0);

  /**
   * The boxes as drawn: engine geometry, with anything too small to see enlarged.
   *
   * Both the halo pass and the stroke pass read this one list. Inflating in the template
   * instead would mean doing it twice, and a halo that stopped surrounding its stroke is
   * the kind of defect that looks like a rendering glitch rather than a bug.
   *
   * **The display scale multiplies exactly one quantity: the minimum size.** It converts
   * "ten pixels on screen" into natural image units. No coordinate is ever multiplied by
   * it — every x and y below is arithmetic on natural units alone. That is what keeps the
   * coordinate logic free of `displayed / natural` ratios, and it is checkable by reading
   * the one line where `scale` appears.
   */
  protected readonly renderedBoxes = computed<RenderedBox[]>(() => {
    const boxes = this.boxes();
    const displayed = this.displayedWidth();
    const natural = this.width();

    if (displayed <= 0 || natural <= 0) {
      return boxes;
    }

    const scale = natural / displayed;
    const minimumSize = MIN_BOX_DISPLAY_PX * scale;

    return boxes.map((box) => enlargeToMinimum(box, minimumSize, natural, this.height()));
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

    // Resize, browser zoom and panel reflow all change the scale, and all of them arrive
    // here. Measuring once on load would leave the boxes wrong after the first resize.
    const observer = new ResizeObserver(([entry]) =>
      this.displayedWidth.set(entry.contentRect.width),
    );
    observer.observe(host);

    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}

/**
 * Grow a box to at least `minimumSize` in each axis, about its own centre, without
 * leaving the image.
 *
 * Centred so the box still marks the place it described. Clamped so a change at the very
 * edge of the picture does not end up half outside the viewBox, where it would be drawn
 * with a stroke on three sides.
 */
function enlargeToMinimum(
  box: Box,
  minimumSize: number,
  imageWidth: number,
  imageHeight: number,
): RenderedBox {
  if (box.width >= minimumSize && box.height >= minimumSize) {
    return box;
  }

  const width = Math.max(box.width, minimumSize);
  const height = Math.max(box.height, minimumSize);

  return {
    x: clamp(box.x + box.width / 2 - width / 2, 0, imageWidth - width),
    y: clamp(box.y + box.height / 2 - height / 2, 0, imageHeight - height),
    width,
    height,
    kind: box.kind,
  };
}

function clamp(value: number, low: number, high: number): number {
  // `high` can fall below `low` when a box is wider than the image it sits on.
  return Math.max(low, Math.min(value, Math.max(low, high)));
}
