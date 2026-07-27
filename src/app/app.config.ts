import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          // PrimeNG defaults to following the OS colour scheme. Pinning the dark-mode
          // selector to a class we never apply keeps the app in light mode, so the
          // difference boxes are reviewed against the same background every time.
          darkModeSelector: '.app-dark',
        },
      },
    }),
    // Used by the toast/error paths introduced in T17; registered once at the root.
    MessageService,
  ],
};
