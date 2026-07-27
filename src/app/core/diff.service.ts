import { Injectable, InjectionToken, OnDestroy, inject } from '@angular/core';

import type { DiffResult, DiffSettings } from './diff/diff-types';
import type {
  DiffWorkerRequest,
  DiffWorkerResponse,
  ImageSlot,
} from './diff-worker-protocol';

/**
 * The only module in the app that knows a worker exists.
 *
 * Two responsibilities, both of them lifecycle rather than logic: decode a picked file
 * into pixels and hand them to the worker at **load** time, and turn the worker's
 * `postMessage` traffic into promises. No image processing happens here — that all lives
 * in `core/diff`, behind the worker.
 *
 * The types below come from `diff-worker-protocol` via `import type`, so nothing from the
 * engine is linked into the main bundle. The worker is reached only through the URL in
 * `DIFF_WORKER_FACTORY`.
 */

export type { ImageSlot };

/** Human-readable list of what a user may pick. Used in the rejection message. */
export const ACCEPTED_IMAGE_FORMATS = 'PNG, JPEG, WebP, BMP or GIF';

/** What a component needs to display a loaded slot. */
export interface LoadedImage {
  /** The name of the file the user picked. Shown in the panel header. */
  name: string;
  /**
   * For `<img [src]>`. Owned by the service: revoked when the slot is replaced or the
   * service is destroyed. The browser decodes it again for display, independently and off
   * the critical path, which keeps pixel buffers off the main thread entirely.
   */
  objectUrl: string;
  width: number;
  height: number;
  /**
   * Decode plus pixel extraction, in milliseconds.
   *
   * Captured because it is deliberately *not* inside the measured comparison window, and
   * the honest answer to "you moved the expensive part outside the timer" is to show the
   * number rather than hide it. T16 puts it on screen.
   */
  decodeMs: number;
}

/** How the service obtains its worker. Replaced in tests; never replaced in the app. */
export type DiffWorkerFactory = () => Worker;

export const DIFF_WORKER_FACTORY = new InjectionToken<DiffWorkerFactory>(
  'DIFF_WORKER_FACTORY',
  {
    providedIn: 'root',
    /*
     * The `new Worker(new URL(...), { type: 'module' })` literal is what the bundler
     * pattern-matches to emit the worker as its own chunk. Building the URL any other way
     * — a variable, a string concatenation — silently produces a 404 at runtime.
     */
    factory: () => () => new Worker(new URL('./diff.worker', import.meta.url), { type: 'module' }),
  },
);

/** Only the successful half of the response union; failures become rejections. */
type SuccessResponse = Extract<DiffWorkerResponse, { ok: true }>;

interface PendingRequest {
  resolve: (response: SuccessResponse) => void;
  reject: (error: Error) => void;
}

@Injectable({ providedIn: 'root' })
export class DiffService implements OnDestroy {
  private readonly createWorker = inject(DIFF_WORKER_FACTORY);

  private worker?: Worker;

  /**
   * Requests awaiting a reply, oldest first.
   *
   * A worker processes its message queue in order and this protocol posts exactly one
   * reply per request, so the head of this queue is always the request the next reply
   * belongs to. That is why no correlation IDs are needed — and why a single `pending`
   * field would be wrong: `loadImage` awaits its own acknowledgement, so a load and a
   * comparison can legitimately be in flight together.
   */
  private readonly pending: PendingRequest[] = [];

  /** The object URL currently held for each slot, so it can be revoked on replacement. */
  private readonly objectUrls: Partial<Record<ImageSlot, string>> = {};

  /**
   * Decode a file and give the worker its pixels.
   *
   * Runs when the user picks a file — long before the Compare button is clicked, and so
   * outside the window the assignment measures. The buffer is *transferred*, not copied:
   * the worker keeps it until the slot is replaced, so re-running at a different
   * sensitivity costs one settings object rather than another 48 MB clone.
   */
  async loadImage(slot: ImageSlot, file: File): Promise<LoadedImage> {
    if (!file.type.startsWith('image/')) {
      throw new Error(
        `"${file.name}" is not an image. Accepted formats: ${ACCEPTED_IMAGE_FORMATS}.`,
      );
    }

    // Nothing below this line mutates a slot until the worker has acknowledged the
    // handover, so a file that fails to decode leaves both slots exactly as they were.
    const { imageData, decodeMs } = await this.decode(file);
    const objectUrl = URL.createObjectURL(file);

    try {
      await this.send(
        {
          kind: 'set',
          slot,
          width: imageData.width,
          height: imageData.height,
          buffer: imageData.data.buffer as ArrayBuffer,
        },
        [imageData.data.buffer as ArrayBuffer],
      );
    } catch (failure) {
      // The slot keeps whatever it had; this URL never reached anyone, so drop it here.
      URL.revokeObjectURL(objectUrl);
      throw failure;
    }

    this.revoke(slot);
    this.objectUrls[slot] = objectUrl;

    return { name: file.name, objectUrl, width: imageData.width, height: imageData.height, decodeMs };
  }

  /**
   * Compare the two loaded images.
   *
   * Repeatable without reloading: the pixels stay in the worker, so this sends only the
   * settings. Rejects if either slot is empty — the message comes from the engine.
   */
  async compare(settings: DiffSettings): Promise<DiffResult> {
    const response = await this.send({ kind: 'compare', settings });

    if (response.kind !== 'result') {
      // Unreachable with the current protocol, but silently returning a wrong shape here
      // would surface as an empty overlay with no explanation.
      throw new Error(`Expected a comparison result but the engine replied "${response.kind}".`);
    }

    return response.result;
  }

  ngOnDestroy(): void {
    this.failAll(new Error('The comparison engine was shut down.'));
    this.worker?.terminate();
    this.worker = undefined;
    this.revoke('before');
    this.revoke('after');
  }

  /**
   * Decode a file to raw pixels.
   *
   * A plain `<canvas>` rather than `OffscreenCanvas`: the offscreen 2D context is missing
   * in older Safari, and nothing here benefits from it — the pixels are handed to the
   * worker on the next line.
   */
  private async decode(file: File): Promise<{ imageData: ImageData; decodeMs: number }> {
    const start = performance.now();

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      // The browser's own message here is typically "The source image could not be
      // decoded", which does not say which file the user should replace.
      throw new Error(`"${file.name}" could not be decoded. The file may be corrupt or truncated.`);
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const context = canvas.getContext('2d', { willReadFrequently: false });
      if (!context) {
        throw new Error('This browser did not provide a 2D canvas context.');
      }

      context.drawImage(bitmap, 0, 0);
      const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);

      return { imageData, decodeMs: performance.now() - start };
    } finally {
      bitmap.close();
    }
  }

  /** Post one request and resolve when its reply arrives. Failures become rejections. */
  private send(request: DiffWorkerRequest, transfer: Transferable[] = []): Promise<SuccessResponse> {
    return new Promise<SuccessResponse>((resolve, reject) => {
      // Before enqueuing: if the worker cannot start, this rejects without leaving an
      // entry that would consume some later request's reply.
      const worker = this.ensureWorker();

      this.pending.push({ resolve, reject });

      try {
        worker.postMessage(request, transfer);
      } catch (failure) {
        // A detached buffer in the transfer list throws here. Without this the promise
        // would never settle, which is the hardest of all failures to diagnose.
        this.pending.pop();
        throw failure;
      }
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    let worker: Worker;
    try {
      worker = this.createWorker();
    } catch (cause) {
      throw new Error(
        `The comparison engine could not be started: ${describe(cause)}. ` +
          'This browser may not support module workers.',
      );
    }

    worker.onmessage = ({ data }: MessageEvent<DiffWorkerResponse>) => this.settle(data);

    // Fires for an uncaught error inside the worker and for a failure to load its script
    // at all. Either way every promise waiting on it is now waiting forever.
    worker.onerror = (event) =>
      this.failAll(
        new Error(`The comparison engine stopped: ${event.message || 'unknown error'}.`),
      );

    // The reply could not be deserialised. Rare, but it consumes no queue entry, so
    // without this the request it belonged to would hang.
    worker.onmessageerror = () =>
      this.failAll(new Error('The comparison engine sent a reply that could not be read.'));

    this.worker = worker;
    return worker;
  }

  private settle(response: DiffWorkerResponse): void {
    const request = this.pending.shift();

    if (!request) {
      // Nothing is waiting: either a reply arrived after `failAll`, or the protocol has
      // drifted out of one-reply-per-request. Neither is worth throwing over.
      console.warn('Diff worker sent an unexpected reply', response);
      return;
    }

    if (response.ok) {
      request.resolve(response);
    } else {
      request.reject(new Error(response.message));
    }
  }

  private failAll(error: Error): void {
    for (const request of this.pending.splice(0)) {
      request.reject(error);
    }
  }

  private revoke(slot: ImageSlot): void {
    const objectUrl = this.objectUrls[slot];
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      delete this.objectUrls[slot];
    }
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
