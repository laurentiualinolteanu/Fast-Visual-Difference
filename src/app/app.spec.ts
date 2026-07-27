import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService } from 'primeng/api';

import { App } from './app';
import { DiffService } from './core/diff.service';

/**
 * Smoke test only: the shell boots, and the one feature it hosts is mounted.
 *
 * Component *rendering* is deliberately not unit-tested in this project — the budget goes
 * to `core/diff`, where the claims that need defending live, and to the compare page's
 * state machine, which decides when a comparison may run.
 *
 * The service is stubbed so the shell test never reaches the worker factory.
 */
describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideNoopAnimations(),
        { provide: DiffService, useValue: {} },
        // Real, because `p-toast` inside the compare page subscribes to its observables.
        MessageService,
      ],
    }).compileComponents();
  });

  it('renders the title and mounts the compare page', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Fast Visual Difference Detector',
    );
    expect(fixture.nativeElement.querySelector('app-compare-page')).toBeTruthy();
    // PrimeNG is wired: the Compare button emitted its own class names.
    expect(fixture.nativeElement.querySelector('button.p-button')).toBeTruthy();
  });
});
