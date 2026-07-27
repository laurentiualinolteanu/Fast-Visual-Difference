/// <reference lib="webworker" />

/**
 * The diff engine's worker adapter.
 *
 * Its only jobs are to hold the pixel data, dispatch two kinds of request, and make sure
 * a failure comes back as a message rather than a dead worker. There is no
 * image processing here — that all lives in `core/diff`, which knows nothing about
 * workers and is unit-tested without one.
 *
 * The worker *owns* the pixels. They are transferred in once, when the user picks a
 * file, and held until replaced. A comparison therefore sends only a settings object:
 * no 48 MB structured clone inside the window the assignment measures, and re-running at
 * a different sensitivity costs nothing extra.
 *
 * IMPORTANT: the main thread must pull the types below in with `import type`. A value
 * import would evaluate this module on the main thread and register a second `message`
 * listener on the window.
 */

import { runDiff } from './diff/diff-engine';
import { DiffResult, DiffSettings, ImageDataLike } from './diff/diff-types';

export type ImageSlot = 'before' | 'after';

/** What the main thread sends. */
export type DiffWorkerRequest =
  | {
      kind: 'set';
      slot: ImageSlot;
      width: number;
      height: number;
      /** Transferred, not copied — the sender loses access to it. */
      buffer: ArrayBuffer;
    }
  | { kind: 'compare'; settings: DiffSettings };

/**
 * What comes back.
 *
 * Failures name the request that failed. Without that, a `set` that fails is
 * indistinguishable from a `compare` that fails, and the service — which only has a
 * pending promise for a comparison — would have nowhere to report a load error.
 */
export type DiffWorkerResponse =
  | { ok: true; kind: 'set'; slot: ImageSlot }
  | { ok: true; kind: 'result'; result: DiffResult }
  | { ok: false; kind: 'set' | 'compare'; message: string };

/** Held between requests; this is the whole reason `compare` is cheap to repeat. */
const images: Partial<Record<ImageSlot, ImageDataLike>> = {};

addEventListener('message', ({ data }: MessageEvent<DiffWorkerRequest>) => {
  // Captured before the work starts, so the failure path can still name the request
  // even if `data` turns out to be something unexpected.
  const requestKind = data?.kind === 'set' ? 'set' : 'compare';

  try {
    respond(handle(data));
  } catch (failure) {
    respond({ ok: false, kind: requestKind, message: describe(failure) });
  }
});

function handle(request: DiffWorkerRequest): DiffWorkerResponse {
  if (request.kind === 'set') {
    images[request.slot] = {
      width: request.width,
      height: request.height,
      // Adopts the transferred memory rather than copying it.
      data: new Uint8ClampedArray(request.buffer),
    };

    return { ok: true, kind: 'set', slot: request.slot };
  }

  if (request.kind === 'compare') {
    const { before, after } = images;

    if (!before || !after) {
      throw new Error('Both images must be loaded before comparing.');
    }

    return { ok: true, kind: 'result', result: runDiff(before, after, request.settings) };
  }

  /*
   * Unreachable from a typed caller, and deliberately not a silent fall-through to the
   * comparison path: an unrecognised request would arrive there with no settings, which
   * yields a NaN threshold — and since every `delta <= NaN` is false, the engine would
   * report the entire image as changed. A loud failure beats a plausible wrong answer.
   */
  throw new Error(`Unrecognised request: ${JSON.stringify(request)}`);
}

function respond(response: DiffWorkerResponse): void {
  postMessage(response);
}

function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
