import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { SliderModule } from 'primeng/slider';
import { TooltipModule } from 'primeng/tooltip';

import { ImageSlot } from '../../core/diff.service';
import { DiffSettings } from '../../core/diff/diff-types';
import { MAX_SENSITIVITY, MIN_SENSITIVITY, deriveParams } from '../../core/diff/sensitivity';

/** A file the user picked, and which slot they picked it for. */
export interface FileSelection {
  slot: ImageSlot;
  file: File;
}

/**
 * Everything the user can do before a comparison exists: pick two images, say how picky
 * to be, and start it.
 *
 * The component holds no state. It renders the settings it is given and emits the ones
 * the user asks for — the page decides what to do with them, which keeps "what the app
 * currently is" in exactly one place.
 *
 * The file pickers are PrimeNG buttons driving hidden native inputs rather than
 * `p-fileUpload`, which the Implementation Guide specified. `p-fileUpload` injects
 * `HttpClient` — it is built to POST files at a server. Using it would put Angular's HTTP
 * stack into an application whose entire premise is that there is no server, purely to
 * open a file dialog. `p-button` plus `<input type="file">` is the same three lines,
 * looks identical, and keeps the dependency out.
 */
@Component({
  selector: 'app-controls-bar',
  imports: [ButtonModule, CheckboxModule, FormsModule, SliderModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="controls">
      <!--
        A PrimeNG button driving a hidden native input, rather than p-fileUpload.
        See the class comment: p-fileUpload injects HttpClient, and this application has
        no server to talk to.
      -->
      <div class="pickers">
        <p-button
          label="Before image…"
          icon="pi pi-image"
          severity="secondary"
          [disabled]="loading()"
          (onClick)="beforeInput.click()"
        />
        <input
          #beforeInput
          type="file"
          accept="image/*"
          class="file-input"
          [disabled]="loading()"
          (change)="onFileInput('before', $event)"
        />

        <p-button
          label="After image…"
          icon="pi pi-image"
          severity="secondary"
          [disabled]="loading()"
          (onClick)="afterInput.click()"
        />
        <input
          #afterInput
          type="file"
          accept="image/*"
          class="file-input"
          [disabled]="loading()"
          (change)="onFileInput('after', $event)"
        />
      </div>

      <div class="sensitivity">
        <!--
          Labelled by id rather than by "for". p-slider accepts an inputId and discards
          it: the control it renders is a span[role=slider], so a "for" attribute would
          point at nothing and leave the slider with no accessible name at all.
        -->
        <label id="sensitivity-label">
          Sensitivity {{ settings().sensitivity }}/{{ maxSensitivity }}
        </label>

        <p-slider
          ariaLabelledBy="sensitivity-label"
          [min]="minSensitivity"
          [max]="maxSensitivity"
          [step]="1"
          [ngModel]="settings().sensitivity"
          (ngModelChange)="onSensitivityChange($event)"
        />

        <!--
          The slider's position stated in units a reader can picture, straight from the
          same pure function the engine uses — so what is shown cannot drift from what is
          applied. "0.46% of the maximum weighted-YIQ distance" would be precise and
          useless.
        -->
        <p class="derived">
          detects brightness/colour steps of about {{ derived().equivalentLumaStep }}/255 &middot;
          min cluster {{ derived().minChangedPixels }} px
        </p>
      </div>

      <!-- Grouped so the pair wraps together; .controls is a wrapping flex row. -->
      <div class="suppression">
        <p-checkbox
          inputId="suppress-aa"
          [binary]="true"
          [ngModel]="settings().suppressAntiAliasing"
          (ngModelChange)="onSuppressionChange($event)"
        />
        <label class="checkbox-label" for="suppress-aa">
          Ignore anti-aliasing &amp; 1px shifts
        </label>
      </div>

      <span
        class="compare"
        [pTooltip]="blockedReason() ?? ''"
        [tooltipDisabled]="!blockedReason()"
        tooltipPosition="top"
      >
        <p-button
          label="Compare"
          icon="pi pi-play"
          [disabled]="!!blockedReason()"
          [loading]="busy()"
          (onClick)="compare.emit()"
        />
      </span>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem 1.25rem;
      margin-bottom: 1.25rem;
    }

    .pickers {
      display: flex;
      gap: 0.5rem;
    }

    /* Driven by the buttons beside it. A programmatic click works on a hidden input. */
    .file-input {
      display: none;
    }

    .sensitivity {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-width: 18rem;
      font-size: 0.85rem;
    }

    .sensitivity label {
      font-weight: 600;
    }

    .derived {
      margin: 0;
      font-size: 0.78rem;
      /* Fallback: the app must not depend on a PrimeNG token name resolving. */
      color: var(--p-text-muted-color, #64748b);
    }

    .suppression {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .checkbox-label {
      font-size: 0.85rem;
    }

    /*
     * A disabled button does not fire pointer events, so a tooltip bound to it would
     * never show — which is the one moment the explanation is worth having. The wrapper
     * carries the tooltip instead.
     */
    .compare {
      display: inline-block;
      margin-left: auto;
    }
  `,
})
export class ControlsBarComponent {
  readonly settings = input.required<DiffSettings>();

  /** A comparison is running. */
  readonly busy = input(false);

  /** A file is decoding: the pickers are closed until it finishes. */
  readonly loading = input(false);

  /**
   * Why Compare cannot run, or `null` if it can.
   *
   * A boolean cannot explain itself, and the explanation is exactly what a user needs at
   * the moment the button is greyed out. The page owns the answer because the page owns
   * the state that produces it.
   */
  readonly blockedReason = input<string | null>(null);

  readonly fileSelected = output<FileSelection>();
  readonly settingsChange = output<DiffSettings>();
  readonly compare = output<void>();

  protected readonly minSensitivity = MIN_SENSITIVITY;
  protected readonly maxSensitivity = MAX_SENSITIVITY;

  /** What the current slider position actually means. Recomputed as it moves. */
  protected readonly derived = computed(() => deriveParams(this.settings().sensitivity));

  onFileInput(slot: ImageSlot, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Clearing the input means picking the same file twice in a row still fires `change`
    // — which matters after a load failed and the user is retrying the same file.
    input.value = '';

    if (file) {
      this.fileSelected.emit({ slot, file });
    }
  }

  onSensitivityChange(sensitivity: number): void {
    this.settingsChange.emit({ ...this.settings(), sensitivity });
  }

  onSuppressionChange(suppressAntiAliasing: boolean): void {
    this.settingsChange.emit({ ...this.settings(), suppressAntiAliasing });
  }
}
