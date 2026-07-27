import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { App } from './app';

/**
 * Smoke test only: proves the test harness and the PrimeNG wiring compile and boot.
 * Component behaviour is deliberately not unit-tested in this project — the test
 * budget goes to `core/diff`, where the claims that need defending live.
 */
describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideNoopAnimations()],
    }).compileComponents();
  });

  it('creates the application shell', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Fast Visual Difference Detector',
    );
    // PrimeNG is wired: the component compiled and emitted its own class names.
    expect(fixture.nativeElement.querySelector('button.p-button')).toBeTruthy();
  });
});
