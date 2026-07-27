import { TestBed } from '@angular/core/testing';

import {
  DIFF_WORKER_FACTORY,
  DiffService,
  DiffWorkerFactory,
  LoadedImage,
} from './diff.service';
import {
  DiffWorkerRequest,
  DiffWorkerResponse,
  ImageStore,
  handleRequest,
  toFailure,
} from './diff-worker-protocol';
import { DEFAULT_SETTINGS } from './diff/sensitivity';

/**
 * A stand-in for the real worker that runs the real protocol.
 *
 * Using `handleRequest` rather than a canned reply means these specs exercise the whole
 * round trip — transfer, storage, comparison — without needing a worker host. What it
 * cannot reproduce is the buffer detaching on transfer, so the transfer list is asserted
 * directly instead.
 */
class ProtocolWorker {
  onmessage: ((event: MessageEvent<DiffWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  readonly images: ImageStore = {};
  readonly sent: { request: DiffWorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  postMessage(request: DiffWorkerRequest, transfer: Transferable[] = []): void {
    this.sent.push({ request, transfer });

    let response: DiffWorkerResponse;
    try {
      response = handleRequest(request, this.images);
    } catch (failure) {
      response = toFailure(request, failure);
    }

    // A real worker never replies synchronously.
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<DiffWorkerResponse>));
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A worker that accepts messages and never answers — for the failure paths. */
class SilentWorker {
  onmessage: ((event: MessageEvent<DiffWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  postMessage(): void {}
  terminate(): void {}
}

/** Build a real PNG so the specs go through the browser's actual decoder. */
async function pngFile(
  name: string,
  width: number,
  height: number,
  paint?: (context: CanvasRenderingContext2D) => void,
): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  paint?.(context);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob failed'))), 'image/png'),
  );

  return new File([blob], name, { type: 'image/png' });
}

function textFile(name = 'notes.txt'): File {
  return new File(['not an image'], name, { type: 'text/plain' });
}

/** Correct MIME type, bytes that are not a PNG — the truncated-download case. */
function corruptPng(name = 'broken.png'): File {
  return new File([new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0])], name, { type: 'image/png' });
}

function serviceWithFactory(factory: DiffWorkerFactory): DiffService {
  TestBed.configureTestingModule({
    providers: [{ provide: DIFF_WORKER_FACTORY, useValue: factory }],
  });
  return TestBed.inject(DiffService);
}

function serviceWith(worker: unknown): DiffService {
  return serviceWithFactory(() => worker as Worker);
}

describe('DiffService', () => {
  describe('loadImage', () => {
    let worker: ProtocolWorker;
    let service: DiffService;

    beforeEach(() => {
      worker = new ProtocolWorker();
      service = serviceWith(worker);
    });

    it('returns the dimensions and a usable object URL, and leaves the pixels with the worker', async () => {
      const loaded = await service.loadImage('before', await pngFile('shot.png', 40, 24));

      expect(loaded.name).toBe('shot.png');
      expect(loaded.width).toBe(40);
      expect(loaded.height).toBe(24);
      expect(loaded.objectUrl).toMatch(/^blob:/);
      expect(loaded.decodeMs).toBeGreaterThanOrEqual(0);

      // The point of the whole arrangement: the main thread kept no pixel buffer.
      expect(worker.images.before?.width).toBe(40);
      expect(worker.images.before?.data.length).toBe(40 * 24 * 4);
    });

    it('transfers the buffer rather than sending it as a copy', async () => {
      await service.loadImage('before', await pngFile('shot.png', 8, 8));

      const [{ request, transfer }] = worker.sent;
      expect(request.kind).toBe('set');
      expect(transfer.length).toBe(1);
      // The transferred object must be the very buffer the request carries, or the
      // structured clone copies it and the transfer achieves nothing.
      expect(transfer[0]).toBe((request as { buffer: ArrayBuffer }).buffer);
    });

    it('revokes the previous object URL when a slot is replaced', async () => {
      const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();

      const first = await service.loadImage('before', await pngFile('one.png', 8, 8));
      expect(revoke).not.toHaveBeenCalled();

      const second = await service.loadImage('before', await pngFile('two.png', 8, 8));

      expect(revoke).toHaveBeenCalledOnceWith(first.objectUrl);
      expect(second.objectUrl).not.toBe(first.objectUrl);
    });

    it('rejects a non-image file by name, saying what is accepted, without touching the worker', async () => {
      await expectAsync(service.loadImage('before', textFile())).toBeRejectedWithError(
        /"notes\.txt" is not an image.*PNG, JPEG, WebP, BMP or GIF/,
      );

      expect(worker.sent.length).toBe(0);
    });

    it('rejects a corrupt image without disturbing either slot', async () => {
      const before = await service.loadImage('before', await pngFile('a.png', 16, 16));
      await service.loadImage('after', await pngFile('b.png', 16, 16));

      const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();

      await expectAsync(service.loadImage('after', corruptPng())).toBeRejectedWithError(
        /"broken\.png" could not be decoded/,
      );

      // Nothing was revoked, both slots still hold their images, and comparing still works.
      expect(revoke).not.toHaveBeenCalled();
      expect(before.objectUrl).toMatch(/^blob:/);
      expect(worker.images.before).toBeDefined();
      expect(worker.images.after).toBeDefined();
      await expectAsync(service.compare(DEFAULT_SETTINGS)).toBeResolved();
    });
  });

  describe('compare', () => {
    let worker: ProtocolWorker;
    let service: DiffService;

    beforeEach(() => {
      worker = new ProtocolWorker();
      service = serviceWith(worker);
    });

    /** A white pair with one black square painted into the "after". */
    async function loadPair(): Promise<LoadedImage[]> {
      return [
        await service.loadImage('before', await pngFile('before.png', 64, 64)),
        await service.loadImage(
          'after',
          await pngFile('after.png', 64, 64, (context) => {
            context.fillStyle = '#000000';
            context.fillRect(20, 20, 6, 6);
          }),
        ),
      ];
    }

    it('resolves with a result describing the change', async () => {
      await loadPair();

      const result = await service.compare(DEFAULT_SETTINGS);

      expect(result.boxes.length).toBe(1);
      expect(result.stats.width).toBe(64);
      expect(result.stats.changedPixels).toBeGreaterThan(0);
      expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
    });

    it('can be re-run at a new sensitivity without reloading the images', async () => {
      await loadPair();
      const sentAfterLoading = worker.sent.length;

      await service.compare(DEFAULT_SETTINGS);
      await service.compare({ ...DEFAULT_SETTINGS, sensitivity: 9 });

      // Two more messages, both of them comparisons: no second transfer of the pixels.
      const extra = worker.sent.slice(sentAfterLoading);
      expect(extra.map((message) => message.request.kind)).toEqual(['compare', 'compare']);
    });

    it('rejects with the engine message when a slot is empty', async () => {
      await service.loadImage('before', await pngFile('before.png', 16, 16));

      await expectAsync(service.compare(DEFAULT_SETTINGS)).toBeRejectedWithError(
        /Both images must be loaded/,
      );
    });

    it('keeps working after a rejected comparison', async () => {
      // A failure must consume exactly its own queue entry. If it consumed none, or two,
      // every later reply would settle the wrong promise.
      await expectAsync(service.compare(DEFAULT_SETTINGS)).toBeRejected();

      await service.loadImage('before', await pngFile('before.png', 16, 16));
      await service.loadImage('after', await pngFile('after.png', 16, 16));

      await expectAsync(service.compare(DEFAULT_SETTINGS)).toBeResolved();
    });
  });

  describe('worker failures', () => {
    it('rejects with a readable message when the worker cannot be constructed', async () => {
      const service = serviceWithFactory(() => {
        throw new Error('module workers unsupported');
      });

      await expectAsync(service.compare(DEFAULT_SETTINGS)).toBeRejectedWithError(
        /could not be started: module workers unsupported/,
      );
    });

    it('rejects everything in flight when the worker reports an error', async () => {
      const worker = new SilentWorker();
      const service = serviceWith(worker);

      const pending = service.compare(DEFAULT_SETTINGS);
      worker.onerror?.({ message: 'script load failed' } as ErrorEvent);

      await expectAsync(pending).toBeRejectedWithError(/engine stopped: script load failed/);
    });

    it('rejects rather than hanging when a reply cannot be deserialised', async () => {
      const worker = new SilentWorker();
      const service = serviceWith(worker);

      const pending = service.compare(DEFAULT_SETTINGS);
      worker.onmessageerror?.({} as MessageEvent);

      await expectAsync(pending).toBeRejectedWithError(/could not be read/);
    });
  });

  describe('ngOnDestroy', () => {
    it('terminates the worker, revokes both URLs and rejects anything waiting', async () => {
      const worker = new ProtocolWorker();
      const service = serviceWith(worker);

      const before = await service.loadImage('before', await pngFile('a.png', 8, 8));
      const after = await service.loadImage('after', await pngFile('b.png', 8, 8));

      const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
      service.ngOnDestroy();

      expect(worker.terminated).toBeTrue();
      expect(revoke).toHaveBeenCalledWith(before.objectUrl);
      expect(revoke).toHaveBeenCalledWith(after.objectUrl);
    });

    it('does not leave a pending promise unsettled', async () => {
      const worker = new SilentWorker();
      const service = serviceWith(worker);

      const pending = service.compare(DEFAULT_SETTINGS);
      service.ngOnDestroy();

      await expectAsync(pending).toBeRejectedWithError(/shut down/);
    });
  });
});
