import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MessageModule } from 'primeng/message';

import { LoadedImage } from '../../core/diff.service';
import { DiffResult } from '../../core/diff/diff-types';
import { screenedInPercent } from '../../core/log-diff-run';

/**
 * What the last comparison cost, and what it cost to get ready for it.
 *
 * The second half is the reason this component exists. Decoding the images is the single
 * most expensive operation in the problem, and this application does it when the user
 * picks a file — before the click the brief measures. That is a real design decision and
 * a defensible one, but stated only in prose it reads like an excuse. Stated as a number
 * on screen, next to the number it was excluded from, it reads as a disclosure.
 *
 * So the headline is click-to-painted-boxes, not engine time: it is the interval the
 * markers bracket, and it is the larger of the two.
 */
@Component({
  selector: 'app-results-summary',
  imports: [MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (before() || after()) {
      <p class="loaded">
        <span class="lead">Loaded:</span>
        @if (before(); as image) {
          before {{ image.width }}&times;{{ image.height }} ({{ format(image.decodeMs) }} ms)
        }
        @if (before() && after()) {
          &middot;
        }
        @if (after(); as image) {
          after {{ image.width }}&times;{{ image.height }} ({{ format(image.decodeMs) }} ms)
        }
        <span class="note">decode, at load — outside the measured comparison</span>
      </p>
    }

    @if (result(); as diff) {
      <p class="compared">
        <span class="lead">Compared:</span>
        {{ diff.boxes.length }} difference{{ diff.boxes.length === 1 ? '' : 's' }}
        in {{ format(elapsedMs()) }} ms
        <span class="note">click to painted boxes</span>
        @if (stale()) {
          <em class="stale">(re-run to update)</em>
        }
      </p>

      <p class="stages">
        Engine {{ format(diff.timings.totalMs) }} ms —
        screen {{ format(diff.timings.screenMs) }} &middot;
        score {{ format(diff.timings.scoreMs) }} &middot;
        group {{ format(diff.timings.groupMs) }} &middot;
        merge {{ format(diff.timings.mergeMs) }} ms
        <span class="note">
          {{ diff.stats.candidateTiles }} of {{ diff.stats.totalTiles }} tiles screened in
          ({{ screenedIn() }}%)
        </span>
      </p>

      @for (warning of diff.warnings; track warning) {
        <p-message severity="warn" [text]="warning" />
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin-top: 1.25rem;
      font-size: 0.85rem;
    }

    p {
      margin: 0 0 0.35rem;
    }

    .lead {
      font-weight: 600;
    }

    .note {
      /* Fallback: the app must not depend on a PrimeNG token name resolving. */
      color: var(--p-text-muted-color, #64748b);
      font-size: 0.78rem;
    }

    .stale {
      color: var(--p-amber-700, #b45309);
      font-style: normal;
    }

    p-message {
      display: block;
      margin-top: 0.5rem;
    }
  `,
})
export class ResultsSummaryComponent {
  readonly result = input.required<DiffResult | null>();
  readonly before = input.required<LoadedImage | null>();
  readonly after = input.required<LoadedImage | null>();

  /** Click to painted boxes, measured by the page around its own timing markers. */
  readonly elapsedMs = input.required<number>();

  readonly stale = input(false);

  /**
   * How little work the tile screen let through to the expensive per-pixel pass.
   *
   * Shared with the console line rather than recomputed: the same figure appearing in two
   * places is exactly how a UI and a log come to disagree about one run.
   */
  protected readonly screenedIn = computed(() => {
    const stats = this.result()?.stats;
    return stats ? screenedInPercent(stats) : '0.0';
  });

  /**
   * One decimal below 10 ms, whole numbers above.
   *
   * A 0.2 ms stage rounded to an integer reads as "0 ms", which looks like a broken
   * instrument rather than a fast stage.
   */
  protected format(value: number): string {
    return value < 10 ? value.toFixed(1) : Math.round(value).toString();
  }
}
