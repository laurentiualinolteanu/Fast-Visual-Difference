/**
 * The contract between the main thread and the diff worker, and the logic that answers a
 * request.
 *
 * Deliberately free of side effects and of worker globals, for two reasons. The main
 * thread needs these types, and importing the worker module to get them would register a
 * `message` listener on the window — one whose handler replies with `postMessage`, which
 * the same listener then receives, and around it goes. And keeping the dispatch here
 * rather than inside the listener means it can be tested without a worker at all.
 *
 * `diff.worker.ts` is the wiring: a listener in, `postMessage` out, nothing else.
 */

import { runDiff } from './diff/diff-engine';
import { DiffResult, DiffSettings, ImageDataLike } from './diff/diff-types';

export type ImageSlot = 'before' | 'after';

/** The images the worker is holding. Owned by the worker, passed in so it can be tested. */
export type ImageStore = Partial<Record<ImageSlot, ImageDataLike>>;

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
 * Failures name the request that failed. Without that a `set` that fails is
 * indistinguishable from a `compare` that fails, and the service — which only holds a
 * pending promise for a comparison — would have nowhere to report a load error.
 */
export interface DiffWorkerFailure {
  ok: false;
  /** Which request failed. `unknown` when the request itself was not recognisable. */
  kind: 'set' | 'compare' | 'unknown';
  message: string;
}

export type DiffWorkerResponse =
  | { ok: true; kind: 'set'; slot: ImageSlot }
  | { ok: true; kind: 'result'; result: DiffResult }
  | DiffWorkerFailure;

/**
 * Answer one request, or throw.
 *
 * Throwing rather than returning a failure keeps the happy path readable; the worker
 * turns anything thrown into a failure response via `toFailure`.
 */
export function handleRequest(request: DiffWorkerRequest, images: ImageStore): DiffWorkerResponse {
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

/** Shape anything thrown into a response that says which request it came from. */
export function toFailure(
  request: DiffWorkerRequest | undefined,
  failure: unknown,
): DiffWorkerFailure {
  return {
    ok: false,
    kind: kindOf(request),
    message: failure instanceof Error ? failure.message : String(failure),
  };
}

function kindOf(request: DiffWorkerRequest | undefined): 'set' | 'compare' | 'unknown' {
  if (request?.kind === 'set') {
    return 'set';
  }
  if (request?.kind === 'compare') {
    return 'compare';
  }
  return 'unknown';
}
