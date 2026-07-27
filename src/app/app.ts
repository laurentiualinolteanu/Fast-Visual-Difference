import { Component } from '@angular/core';

import { ComparePageComponent } from './features/compare/compare-page.component';

/**
 * Application shell: the page title and the one feature the app has.
 *
 * There is no router. A single view means a route table would be a table of one, and the
 * indirection would have to be explained rather than read.
 */
@Component({
  selector: 'app-root',
  imports: [ComparePageComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
