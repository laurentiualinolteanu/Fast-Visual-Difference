/// <reference lib="webworker" />

/**
 * The diff engine's worker entry point — wiring only.
 *
 * A `message` listener in, a `postMessage` out. Everything it does lives in
 * `diff-worker-protocol.ts`, which has no side effects and no worker globals, so the
 * main thread can import the message types without ever evaluating this file.
 *
 * That separation is not tidiness. Evaluating this module on the main thread would
 * register a window `message` listener whose reply is itself a window message, which the
 * same listener then receives: an endless loop with no obvious cause.
 */

import { DiffWorkerRequest, ImageStore, handleRequest, toFailure } from './diff-worker-protocol';

/**
 * The worker owns the pixel data. Buffers are transferred in once, when the user picks a
 * file, and held until replaced — so a comparison sends only a settings object. No 48 MB
 * structured clone inside the window the assignment measures, and re-running at a
 * different sensitivity costs nothing extra.
 */
const images: ImageStore = {};

addEventListener('message', ({ data }: MessageEvent<DiffWorkerRequest>) => {
  try {
    postMessage(handleRequest(data, images));
  } catch (failure) {
    postMessage(toFailure(data, failure));
  }
});
