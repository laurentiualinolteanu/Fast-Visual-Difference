import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { BoxOverlayComponent } from './box-overlay.component';
import { LoadedImage } from '../../core/diff.service';
import { Box } from '../../core/diff/diff-types';

/**
 * One side of the comparison: its label, its dimensions, the picture and the boxes.
 *
 * The label is an input rather than something derived from position or index. Panels are
 * in a wrapping flex row, so on a narrow window the "right" panel is underneath the other
 * one — a label inferred from where the panel sits would then be wrong, and wrong in the
 * way that matters most, because the whole output is a claim about which image changed.
 */
@Component({
  selector: 'app-image-panel',
  imports: [BoxOverlayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="panel">
      <figcaption>
        <strong class="label">{{ label() }}</strong>
        @if (image(); as loaded) {
          <span class="meta">{{ loaded.width }}&times;{{ loaded.height }} &middot; {{ loaded.name }}</span>
        }
      </figcaption>

      @if (image(); as loaded) {
        <!--
          The frame hugs the picture exactly, because the overlay is inset to all four of
          its edges. A plain block wrapper would be the full width of the panel while an
          image narrower than the panel would not, and every box would sit that difference
          to the left of where it belongs.
        -->
        <div class="frame" [class.stale]="stale()">
          <img [src]="loaded.objectUrl" [alt]="label() + ' image: ' + loaded.name" />
          <app-box-overlay [boxes]="boxes()" [width]="loaded.width" [height]="loaded.height" />
        </div>
      } @else {
        <p class="empty">Choose {{ article() }} {{ label() }} image to compare.</p>
      }
    </figure>
  `,
  styles: `
    :host {
      display: block;
      /* Sizing as a flex item is the parent's business; see the compare page. */
      min-width: 0;
    }

    .panel {
      margin: 0;
    }

    figcaption {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
      font-size: 0.8rem;
    }

    .meta {
      /* Fallbacks: the app must not depend on a PrimeNG token name resolving. */
      color: var(--p-text-muted-color, #64748b);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .frame {
      position: relative;
      display: block;
      /* Shrink to the picture's used size, whether that is its natural size, the panel
         width, or the height cap below — the overlay is inset to this element's edges. */
      width: fit-content;
      max-width: 100%;
      /* The border belongs here, not on the image: an absolutely positioned overlay
         inset to zero resolves against this element's padding box, so a border on the
         image itself would leave the overlay 2px wider than the pixels it describes. */
      border: 1px solid var(--p-content-border-color, #e2e8f0);
    }

    .frame img {
      display: block;
      max-width: 100%;
      /* A 400x4000 screenshot would otherwise render three thousand pixels tall and push
         everything else off the page. Capping the height shrinks the used width to match,
         and the frame follows it, so the overlay stays aligned. */
      max-height: 70vh;
      width: auto;
      height: auto;
    }

    /*
     * Stale dims the boxes, not the picture.
     *
     * The images are exactly what the user loaded and are not out of date. The boxes are:
     * they describe a comparison run at settings that have since changed. Fading the
     * photograph would say the wrong thing about which half of the panel to distrust.
     */
    .frame.stale app-box-overlay {
      opacity: 0.3;
    }

    .empty {
      margin: 0;
      padding: 2rem 1rem;
      text-align: center;
      color: var(--p-text-muted-color, #64748b);
      border: 1px dashed var(--p-content-border-color, #e2e8f0);
    }
  `,
})
export class ImagePanelComponent {
  /** Permanent text: "BEFORE" or "AFTER". Never derived from where the panel renders. */
  readonly label = input.required<string>();

  readonly image = input.required<LoadedImage | null>();

  /** The same list on both panels — a difference is a statement about the pair. */
  readonly boxes = input.required<Box[]>();

  /** The settings changed since these boxes were produced. */
  readonly stale = input(false);

  /** "an AFTER image" rather than "a AFTER image". */
  protected article(): string {
    return /^[AEIOU]/i.test(this.label()) ? 'an' : 'a';
  }
}
