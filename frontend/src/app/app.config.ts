import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';

import { GlobalErrorHandler } from './core/global-error-handler';

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
    // The one channel for anything the user needs to be told. Registered at the root so
    // the global error handler and the compare page reach the same toast.
    MessageService,

    /*
     * The catch-all. `provideBrowserGlobalErrorListeners` above routes uncaught errors
     * and unhandled promise rejections here too, so a failure nobody anticipated becomes
     * a toast rather than a page that quietly stops responding.
     */
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
