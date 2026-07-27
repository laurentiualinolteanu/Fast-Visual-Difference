import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { BoxOverlayComponent } from './box-overlay.component';
import { DiffService, ImageSlot, LoadedImage } from '../../core/diff.service';
import { DiffResult, DiffSettings } from '../../core/diff/diff-types';
import { DEFAULT_SETTINGS } from '../../core/diff/sensitivity';

/**
 * Orchestration for the whole page: what is loaded, what the settings are, and what the
 * last comparison produced. Everything else is presentation.
 *
 * The layout here is deliberately plain HTML. T13–T16 replace it with the overlay, the
 * image panels, the controls bar and the results summary; the state and the methods below
 * are already the contract those components will bind to, so they drop in without
 * changing this logic.
 */
@Component({
  selector: 'app-compare-page',
  imports: [BoxOverlayComponent, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="controls">
      <label class="control">
        <span>Before</span>
        <input
          type="file"
          accept="image/*"
          [disabled]="loading()"
          (change)="onFileInput('before', $event)"
        />
      </label>

      <label class="control">
        <span>After</span>
        <input
          type="file"
          accept="image/*"
          [disabled]="loading()"
          (change)="onFileInput('after', $event)"
        />
      </label>

      <label class="control">
        <span>Sensitivity {{ settings().sensitivity }}</span>
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          [value]="settings().sensitivity"
          (input)="onSensitivityInput($event)"
        />
      </label>

      <label class="control control--inline">
        <input
          type="checkbox"
          [checked]="settings().suppressAntiAliasing"
          (change)="onSuppressionInput($event)"
        />
        <span>Ignore anti-aliasing &amp; 1px shifts</span>
      </label>

      <p-button
        label="Compare"
        [disabled]="!canCompare()"
        [loading]="busy()"
        (onClick)="onCompare()"
      />
    </section>

    @if (errorMessage(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    <div class="panels">
      @for (panel of panels(); track panel.label) {
        <figure class="panel">
          <figcaption>
            <strong>{{ panel.label }}</strong>
            @if (panel.image; as image) {
              <span>{{ image.width }}&times;{{ image.height }} &middot; {{ image.name }}</span>
            }
          </figcaption>

          @if (panel.image; as image) {
            <!--
              The frame hugs the image exactly so the overlay, which is inset to all four
              of its edges, lines up with it. A plain block wrapper would be the full
              width of the panel while an image narrower than the panel would not, and
              every box would sit that difference to the left of where it belongs.
            -->
            <div class="frame">
              <img [src]="image.objectUrl" [alt]="panel.label" />
              <app-box-overlay
                [boxes]="boxes()"
                [width]="image.width"
                [height]="image.height"
              />
            </div>
          } @else {
            <p class="empty">Choose an image above.</p>
          }
        </figure>
      }
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

    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .control {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.85rem;
    }

    .control--inline {
      flex-direction: row;
      align-items: center;
    }

    .panels {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .panel {
      flex: 1 1 20rem;
      min-width: 0;
      margin: 0;
    }

    .panel figcaption {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.8rem;
      margin-bottom: 0.25rem;
    }

    .frame {
      position: relative;
      display: block;
      /* Shrink to the image's used width, whether that is its natural size or the
         panel width — the overlay is inset to this element's edges. */
      width: fit-content;
      max-width: 100%;
      /* The border belongs here, not on the image: an absolutely positioned overlay
         inset to zero resolves against this element's padding box, so a border on the
         image itself would leave the overlay 2px wider than the pixels it describes.
         Fallback colour — the app must not depend on a PrimeNG token name resolving. */
      border: 1px solid var(--p-content-border-color, #e2e8f0);
    }

    .panel img {
      display: block;
      max-width: 100%;
      height: auto;
    }

    .empty {
      margin: 0;
      padding: 2rem 1rem;
      text-align: center;
      color: var(--p-text-muted-color, #64748b);
      border: 1px dashed var(--p-content-border-color, #e2e8f0);
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

  readonly canCompare = computed(
    () => !!this.before() && !!this.after() && !this.busy() && !this.loading(),
  );

  readonly panels = computed(() => [
    { label: 'BEFORE', image: this.before() },
    { label: 'AFTER', image: this.after() },
  ]);

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

  /* --- Temporary template adapters. T15's controls bar calls the methods above. --- */

  onFileInput(slot: ImageSlot, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Clearing the input means picking the same file twice in a row still fires `change`.
    input.value = '';

    if (file) {
      void this.onFile(slot, file);
    }
  }

  onSensitivityInput(event: Event): void {
    const sensitivity = Number((event.target as HTMLInputElement).value);
    this.onSettingsChange({ ...this.settings(), sensitivity });
  }

  onSuppressionInput(event: Event): void {
    const suppressAntiAliasing = (event.target as HTMLInputElement).checked;
    this.onSettingsChange({ ...this.settings(), suppressAntiAliasing });
  }

  protected round(value: number): number {
    return Math.round(value);
  }
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
