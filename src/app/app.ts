import { Component } from '@angular/core';
import { ButtonModule } from 'primeng/button';

/**
 * Application shell.
 *
 * For now this only proves the scaffold is wired (Angular + PrimeNG theme + styles).
 * T12 replaces the placeholder in `app.html` with `<app-compare-page />`.
 */
@Component({
  selector: 'app-root',
  imports: [ButtonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
