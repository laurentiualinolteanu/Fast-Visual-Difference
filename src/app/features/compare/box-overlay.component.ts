import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Box } from '../../core/diff/diff-types';

/**
 * Draws the difference boxes over an image.
 *
 * The component performs no coordinate arithmetic of any kind. The `viewBox` is the
 * image's natural pixel size and the boxes are emitted at their engine coordinates
 * verbatim; the browser maps that space onto whatever the image is currently displayed
 * at. Window resizes, browser zoom, a panel that reflows — all handled by the same
 * mechanism that scales the image itself, so the boxes cannot drift out of alignment
 * without the image drifting too.
 *
 * The alternative — reading `clientWidth`, computing `displayed / natural` and multiplying
 * every coordinate — is correct only as long as every code path that changes the layout
 * remembers to recompute. This one is correct by construction.
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
        @for (box of boxes(); track $index) {
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
        @for (box of boxes(); track $index) {
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
}
