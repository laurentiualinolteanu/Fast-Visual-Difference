import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { ControlsBarComponent } from './controls-bar.component';
import { ImagePanelComponent } from './image-panel.component';
import { DiffService, ImageSlot, LoadedImage } from '../../core/diff.service';
import { DiffResult, DiffSettings } from '../../core/diff/diff-types';
import { DEFAULT_SETTINGS } from '../../core/diff/sensitivity';

/**
 * Orchestration for the whole page: what is loaded, what the settings are, and what the
 * last comparison produced. Everything else is presentation.
 *
 * The child components hold no state of their own: they render what they are given and
 * emit what the user asked for. Everything about "what the app currently is" lives here.
 *
 * The results section is still temporary plain HTML — T16 replaces it.
 */
@Component({
  selector: 'app-compare-page',
  imports: [ControlsBarComponent, ImagePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-controls-bar
      [settings]="settings()"
      [busy]="busy()"
      [loading]="loading()"
      [blockedReason]="compareBlockedReason()"
      (fileSelected)="onFile($event.slot, $event.file)"
      (settingsChange)="onSettingsChange($event)"
      (compare)="onCompare()"
    />

    @if (errorMessage(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    <!--
      Written out twice rather than looped. The labels are the point: they must be fixed
      text attached to a slot, never something the panel could infer from where it landed.
    -->
    <div class="panels">
      <app-image-panel
        label="BEFORE"
        [image]="before()"
        [boxes]="boxes()"
        [stale]="stale()"
      />
      <app-image-panel
        label="AFTER"
        [image]="after()"
        [boxes]="boxes()"
        [stale]="stale()"
      />
    </div>

    @if (result(); as diff) {
      <section class="results">
        <p>
          {{ diff.boxes.length }} difference{{ diff.boxes.length === 1 ? '' : 's' }} &middot;
          engine {{ round(diff.timings.totalMs) }} ms &middot;
          click to paint {{ round(elapsedMs()) }} ms
          @if (stale()) {
            <em>(settings changed — re-run to update)</em>
          }
        </p>

        @for (warning of diff.warnings; track warning) {
          <p class="warning">{{ warning }}</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .panels {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }

    /* The page places its children; each panel styles its own inside. */
    app-image-panel {
      flex: 1 1 20rem;
      min-width: 0;
    }

    .results {
      margin-top: 1rem;
      font-size: 0.9rem;
    }

    .results p {
      margin: 0.25rem 0;
    }

    .warning {
      color: var(--p-amber-700, #b45309);
    }

    .error {
      color: var(--p-red-600, #dc2626);
    }
  `,
})
export class ComparePageComponent {
  private readonly diff = inject(DiffService);

  readonly before = signal<LoadedImage | null>(null);
  readonly after = signal<LoadedImage | null>(null);
  readonly settings = signal<DiffSettings>(DEFAULT_SETTINGS);
  readonly result = signal<DiffResult | null>(null);

  /**
   * What the overlay draws: always the current result's boxes.
   *
   * Derived rather than stored. Two writable copies of one fact can only ever disagree,
   * and there is no case where they should — a stale result keeps its boxes on screen and
   * T14 dims them, rather than clearing them.
   */
  readonly boxes = computed<DiffResult['boxes']>(() => this.result()?.boxes ?? []);

  /** A comparison is running. */
  readonly busy = signal(false);

  /**
   * A file is decoding.
   *
   * Distinct from `busy`, and it gates both file inputs: two fast picks on one slot post
   * their `set` messages in start order but resolve in finish order, which can leave the
   * worker holding one image while the panel displays the other — the picture on screen
   * would not be the picture being compared.
   */
  readonly loading = signal(false);

  /** The settings changed since the displayed result was produced. */
  readonly stale = signal(false);

  /** Click to painted boxes, in milliseconds. See `onCompare`. */
  readonly elapsedMs = signal(0);

  /** Replaced by a toast in T17. */
  readonly errorMessage = signal<string | null>(null);

  /**
   * Why a comparison cannot run right now, or `null` if it can.
   *
   * Phrased for a user rather than for a log, because it is what the Compare button's
   * tooltip says while the button is greyed out. `canCompare` is derived from it rather
   * than computed alongside it: two independent expressions for "may we run" would
   * eventually disagree, and the disagreement would show as a button that is enabled
   * while claiming to be blocked.
   */
  readonly compareBlockedReason = computed<string | null>(() => {
    if (this.loading()) {
      return 'Waiting for an image to finish loading.';
    }
    if (!this.before() || !this.after()) {
      return 'Load a before and an after image first.';
    }
    if (this.busy()) {
      return 'A comparison is already running.';
    }
    return null;
  });

  readonly canCompare = computed(() => this.compareBlockedReason() === null);

  /**
   * Run a comparison and stop the clock once the boxes are actually on screen.
   *
   * The two marker comments below are the ones the brief asks for. Everything between
   * them is the call chain and nothing else — a reviewer can replace them with their own
   * timer without reading another file.
   *
   * The elapsed time this component reports is taken *outside* both markers: the clock
   * starts one statement before START and is read one statement after END. So the number
   * shown to the user can never be smaller than the interval the markers bracket. If
   * anything it is a shade larger, which is the safe direction for a claim about speed.
   */
  async onCompare(): Promise<void> {
    if (!this.canCompare()) {
      return;
    }

    this.errorMessage.set(null);
    const startedAt = performance.now();

    // PERFORMANCE_TIMER_START
    this.busy.set(true);
    try {
      const result = await this.diff.compare(this.settings());
      this.result.set(result);
      this.stale.set(false);
      await this.nextPaint();
      // PERFORMANCE_TIMER_END

      this.elapsedMs.set(performance.now() - startedAt);

      // T16 replaces this with one structured line from `core/log-diff-run.ts`.
      console.log('Diff result', result);
    } catch (failure) {
      this.errorMessage.set(messageOf(failure));
    } finally {
      this.busy.set(false);
    }
  }

  /** Decode a picked file and hand its pixels to the worker. Runs before the click. */
  async onFile(slot: ImageSlot, file: File): Promise<void> {
    this.errorMessage.set(null);
    this.loading.set(true);

    try {
      const loaded = await this.diff.loadImage(slot, file);
      (slot === 'before' ? this.before : this.after).set(loaded);

      // The previous result described images that are no longer loaded.
      this.result.set(null);
      this.stale.set(false);
    } catch (failure) {
      // The service guarantees a failed load leaves both slots as they were, so there is
      // nothing to roll back here.
      this.errorMessage.set(messageOf(failure));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Mark the displayed result as out of date rather than recomputing.
   *
   * Dragging the sensitivity slider would otherwise queue a comparison per step. The user
   * decides when to spend the time.
   */
  onSettingsChange(settings: DiffSettings): void {
    this.settings.set(settings);

    if (this.result()) {
      this.stale.set(true);
    }
  }

  /**
   * Resolve after the frame containing the boxes has been composited.
   *
   * Two frames, not one: the first callback runs *before* the style, layout and paint of
   * the next frame, so stopping the clock there would report a time at which the boxes
   * had been assigned but not yet drawn. The second callback runs on the frame after, by
   * which point the first has been presented.
   */
  private nextPaint(): Promise<void> {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  protected round(value: number): number {
    return Math.round(value);
  }
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
