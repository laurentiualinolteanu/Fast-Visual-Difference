import {
  DiffWorkerRequest,
  DiffWorkerResponse,
  ImageStore,
  handleRequest,
  toFailure,
} from './diff-worker-protocol';
import { DEFAULT_SETTINGS } from './diff/sensitivity';
import { BLACK, setPixel, solidImage } from './diff/test-support';

/** A `set` request carrying a freshly built image, the way the service will send one. */
function setRequest(slot: 'before' | 'after', image = solidImage(32, 32)): DiffWorkerRequest {
  return {
    kind: 'set',
    slot,
    width: image.width,
    height: image.height,
    buffer: image.data.buffer as ArrayBuffer,
  };
}

const compareRequest: DiffWorkerRequest = { kind: 'compare', settings: DEFAULT_SETTINGS };

/** Narrow a response to the successful comparison case, failing the spec otherwise. */
function expectResult(response: DiffWorkerResponse) {
  if (!response.ok || response.kind !== 'result') {
    throw new Error(`Expected a result, got ${JSON.stringify(response)}`);
  }
  return response.result;
}

describe('handleRequest', () => {
  let images: ImageStore;

  beforeEach(() => {
    images = {};
  });

  describe('set', () => {
    it('stores the image and acknowledges the slot', () => {
      const response = handleRequest(setRequest('before'), images);

      expect(response).toEqual({ ok: true, kind: 'set', slot: 'before' });
      expect(images.before?.width).toBe(32);
      expect(images.before?.height).toBe(32);
      expect(images.after).toBeUndefined();
    });

    it('adopts the transferred buffer rather than copying it', () => {
      // The whole point of transferring: the worker must take ownership of the memory,
      // not clone 48 MB of it.
      const image = solidImage(16, 16);
      const buffer = image.data.buffer as ArrayBuffer;

      handleRequest(setRequest('before', image), images);

      expect(images.before?.data.buffer).toBe(buffer);
    });

    it('replaces a slot that was already filled', () => {
      handleRequest(setRequest('before', solidImage(32, 32)), images);
      handleRequest(setRequest('before', solidImage(8, 8)), images);

      expect(images.before?.width).toBe(8);
    });
  });

  describe('compare', () => {
    it('runs the engine once both slots are filled', () => {
      const before = solidImage(64, 64);
      const after = solidImage(64, 64);
      setPixel(after, 20, 20, BLACK);

      handleRequest(setRequest('before', before), images);
      handleRequest(setRequest('after', after), images);

      const result = expectResult(handleRequest(compareRequest, images));

      expect(result.boxes.length).toBe(1);
      expect(result.stats.changedPixels).toBe(1);
    });

    it('can be repeated without re-sending the images', () => {
      // The reason the worker holds the pixels: changing the sensitivity and comparing
      // again must not cost another transfer.
      handleRequest(setRequest('before'), images);
      handleRequest(setRequest('after'), images);

      const first = expectResult(handleRequest(compareRequest, images));
      const second = expectResult(
        handleRequest({ kind: 'compare', settings: { ...DEFAULT_SETTINGS, sensitivity: 9 } }, images),
      );

      expect(first.stats.width).toBe(32);
      expect(second.stats.width).toBe(32);
    });

    it('refuses when an image is missing, saying which state it is in', () => {
      expect(() => handleRequest(compareRequest, images)).toThrowError(
        /Both images must be loaded/,
      );

      handleRequest(setRequest('before'), images);
      expect(() => handleRequest(compareRequest, images)).toThrowError(
        /Both images must be loaded/,
      );
    });
  });

  describe('anything else', () => {
    it('throws rather than falling through to a comparison', () => {
      // A silent fall-through would reach the engine with no settings, producing a NaN
      // threshold — and because every `delta <= NaN` is false, the whole image would be
      // reported as changed. A plausible wrong answer is worse than a loud failure.
      const malformed = { kind: 'nonsense' } as unknown as DiffWorkerRequest;

      expect(() => handleRequest(malformed, images)).toThrowError(/Unrecognised request/);
    });
  });
});

describe('toFailure', () => {
  it('attributes a failure to the request that caused it', () => {
    expect(toFailure(setRequest('after'), new Error('boom'))).toEqual({
      ok: false,
      kind: 'set',
      message: 'boom',
    });
    expect(toFailure(compareRequest, new Error('boom'))).toEqual({
      ok: false,
      kind: 'compare',
      message: 'boom',
    });
  });

  it('falls back to "unknown" when the request is not recognisable', () => {
    expect(toFailure(undefined, new Error('boom')).kind).toBe('unknown');
    expect(toFailure({ kind: 'nonsense' } as unknown as DiffWorkerRequest, new Error('x')).kind).toBe(
      'unknown',
    );
  });

  it('survives something that is not an Error being thrown', () => {
    expect(toFailure(compareRequest, 'a bare string').message).toBe('a bare string');
    expect(toFailure(compareRequest, undefined).message).toBe('undefined');
  });
});
