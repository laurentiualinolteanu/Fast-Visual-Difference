import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ControlsBarComponent, FileSelection } from './controls-bar.component';
import { DiffSettings } from '../../core/diff/diff-types';
import { DEFAULT_SETTINGS, deriveParams } from '../../core/diff/sensitivity';

describe('ControlsBarComponent', () => {
  let fixture: ComponentFixture<ControlsBarComponent>;
  let bar: ControlsBarComponent;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ControlsBarComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(ControlsBarComponent);
    bar = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;

    fixture.componentRef.setInput('settings', DEFAULT_SETTINGS);
    fixture.detectChanges();
  });

  function setInputs(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  describe('the derived line', () => {
    it('states the threshold in units a reader can picture, not as a percentage', () => {
      const text = host.querySelector('.derived')?.textContent ?? '';

      expect(text).toContain('brightness/colour steps of about');
      expect(text).toContain('/255');
      expect(text).toContain('min cluster');
      expect(text).toContain('px');
      // The abstract maximum is exactly what this line exists not to say.
      expect(text).not.toContain('%');
    });

    it('agrees with the function the engine actually applies', () => {
      // Not a hard-coded string: if `deriveParams` changes, the line follows it, and the
      // number on screen can never describe different settings from the ones in effect.
      for (const sensitivity of [1, 3, 6, 10]) {
        setInputs({ settings: { ...DEFAULT_SETTINGS, sensitivity } });

        const expected = deriveParams(sensitivity);
        const text = host.querySelector('.derived')?.textContent ?? '';

        expect(text).toContain(`${expected.equivalentLumaStep}/255`);
        expect(text).toContain(`min cluster ${expected.minChangedPixels} px`);
      }
    });

    it('reads "18/255" and "1 px" at the default, which is the claim reviewers check', () => {
      // The D1 fix made the minimum cluster 1 at the default. A reviewer can read the
      // single-pixel claim off the slider before running a single comparison.
      const text = host.querySelector('.derived')?.textContent ?? '';

      expect(text).toContain('18/255');
      expect(text).toContain('min cluster 1 px');
    });

    it('updates live as the slider moves', () => {
      const before = host.querySelector('.derived')?.textContent;

      bar.onSensitivityChange(1);
      setInputs({ settings: { ...DEFAULT_SETTINGS, sensitivity: 1 } });

      expect(host.querySelector('.derived')?.textContent).not.toBe(before);
    });
  });

  describe('the anti-aliasing checkbox', () => {
    it('is labelled for what it does and starts on', () => {
      const label = host.querySelector('.checkbox-label')?.textContent ?? '';

      expect(label).toContain('Ignore anti-aliasing');
      expect(label).toContain('1px shifts');
      expect(DEFAULT_SETTINGS.suppressAntiAliasing).toBeTrue();
    });

    it('emits the whole settings object, leaving the sensitivity alone', () => {
      let emitted: DiffSettings | undefined;
      bar.settingsChange.subscribe((settings) => (emitted = settings));

      setInputs({ settings: { sensitivity: 4, suppressAntiAliasing: true } });
      bar.onSuppressionChange(false);

      expect(emitted).toEqual({ sensitivity: 4, suppressAntiAliasing: false });
    });
  });

  describe('the sensitivity slider', () => {
    it('emits the whole settings object, leaving the suppression flag alone', () => {
      let emitted: DiffSettings | undefined;
      bar.settingsChange.subscribe((settings) => (emitted = settings));

      setInputs({ settings: { sensitivity: 6, suppressAntiAliasing: false } });
      bar.onSensitivityChange(9);

      expect(emitted).toEqual({ sensitivity: 9, suppressAntiAliasing: false });
    });
  });

  describe('the Compare button', () => {
    /** The picker buttons come first in the DOM, so this must be specific. */
    function compareButton(): HTMLButtonElement {
      return host.querySelector('.compare button') as HTMLButtonElement;
    }

    it('is disabled and explains why, where the user will actually see it', () => {
      setInputs({ blockedReason: 'Load a before and an after image first.' });
      expect(compareButton().disabled).toBeTrue();

      // A disabled button fires no pointer events, so a tooltip bound to it would never
      // appear — at exactly the moment the explanation is worth having. It lives on the
      // wrapper instead, and this asserts the rendered tooltip rather than a binding.
      host.querySelector('.compare')!.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();

      expect(document.body.textContent).toContain('Load a before and an after image first.');
    });

    it('is enabled and silent when nothing blocks it', () => {
      setInputs({ blockedReason: null });
      expect(compareButton().disabled).toBeFalse();

      host.querySelector('.compare')!.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();

      expect(document.querySelector('.p-tooltip')).toBeNull();
    });

    it('shows a loading state while a run is in flight', () => {
      setInputs({ blockedReason: 'A comparison is already running.', busy: true });

      expect(compareButton().querySelector('.p-button-loading-icon, .pi-spinner')).toBeTruthy();
    });

    it('emits when clicked', () => {
      let clicked = 0;
      bar.compare.subscribe(() => clicked++);
      setInputs({ blockedReason: null });

      compareButton().click();

      expect(clicked).toBe(1);
    });
  });

  describe('the file pickers', () => {
    /** A change event carrying one file, the way a real picker delivers it. */
    function selectionEvent(file: File | null): Event {
      const input = document.createElement('input');
      input.type = 'file';

      const transfer = new DataTransfer();
      if (file) {
        transfer.items.add(file);
      }
      input.files = transfer.files;

      return { target: input } as unknown as Event;
    }

    it('emits the picked file with the slot it belongs to', () => {
      const selections: FileSelection[] = [];
      bar.fileSelected.subscribe((selection) => selections.push(selection));

      const file = new File([], 'shot.png', { type: 'image/png' });
      bar.onFileInput('after', selectionEvent(file));

      expect(selections).toEqual([{ slot: 'after', file }]);
    });

    it('resets the input so the same file can be picked again after a failure', () => {
      // Without this, a user whose load failed and who re-picks the same file gets no
      // `change` event at all, and the app looks frozen.
      const event = selectionEvent(new File([], 'a.png', { type: 'image/png' }));
      bar.onFileInput('before', event);

      expect((event.target as HTMLInputElement).value).toBe('');
    });

    it('stays quiet when the dialog is dismissed without a selection', () => {
      let emitted = 0;
      bar.fileSelected.subscribe(() => emitted++);

      bar.onFileInput('before', selectionEvent(null));

      expect(emitted).toBe(0);
    });

    it('is driven by a button, not by a bare input the user has to find', () => {
      const labels = Array.from(host.querySelectorAll('button')).map((b) => b.textContent ?? '');

      expect(labels.some((text) => text.includes('Before image'))).toBeTrue();
      expect(labels.some((text) => text.includes('After image'))).toBeTrue();
    });

    it('closes both pickers while a file is decoding', () => {
      setInputs({ loading: true });

      const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      expect(inputs.length).toBe(2);
      for (const input of inputs) {
        expect(input.disabled).toBeTrue();
      }

      // And the buttons that open them.
      const pickerButtons = Array.from(host.querySelectorAll('.pickers button'));
      expect(pickerButtons.length).toBe(2);
      for (const button of pickerButtons) {
        expect((button as HTMLButtonElement).disabled).toBeTrue();
      }
    });
  });
});
