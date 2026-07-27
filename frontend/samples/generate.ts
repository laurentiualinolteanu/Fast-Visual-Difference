/**
 * Generates the sample image pair, then checks it with the real diff engine.
 *
 *     npm run samples
 *
 * Bundled through esbuild before running because it imports the engine directly, and the
 * engine's imports are extensionless the way TypeScript writes them — which Node's own
 * resolver will not follow. esbuild is already here as part of the Angular build.
 *
 * The scene itself lives in `scene.ts`, shared with the measurement harness. There is no
 * image library: PNG is a container around zlib, and `node:zlib` is in the standard
 * library, so the committed PNGs are original work with no licensing question attached.
 *
 * The script ends by running `runDiff` over the two images it just drew and checking the
 * claims in README.md, so they are verified at the moment the samples are produced rather
 * than asserted afterwards.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runDiff } from '../src/app/core/diff/diff-engine';
import { DEFAULT_SETTINGS } from '../src/app/core/diff/sensitivity';
import type { Box } from '../src/app/core/diff/diff-types';
import { AFTER, BEFORE, type Canvas, drawScene } from './scene';

/** One recolour, one deletion, one character edit, one 3px dot. See README.md. */
const EXPECTED_DIFFERENCES = 4;

const before = drawScene(BEFORE);
const after = drawScene(AFTER);

// --- PNG encoding -----------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
}

function encodePng(image: Canvas): Buffer {
  const stride = image.width * 4;

  // Each scanline is prefixed with its filter type. Zero — "none" — keeps this readable;
  // the flat colours in this scene compress well without per-row prediction.
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let row = 0; row < image.height; row++) {
    raw[row * (stride + 1)] = 0;
    Buffer.from(image.data.buffer, row * stride, stride).copy(raw, row * (stride + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Write, then check ------------------------------------------------------------

const here = join(process.cwd(), 'samples');

for (const [name, image] of [
  ['before.png', before],
  ['after.png', after],
] as const) {
  const png = encodePng(image);
  writeFileSync(join(here, name), png);
  console.log(`${name}: ${image.width}x${image.height}, ${(png.length / 1024).toFixed(1)} KB`);
}

const result = runDiff(before, after, DEFAULT_SETTINGS);

console.log(`\nAt the default sensitivity the engine finds ${result.boxes.length} differences:`);
for (const box of result.boxes) {
  console.log(
    `  ${box.kind} ${box.width}x${box.height} at (${box.x},${box.y}) — ${box.changedPixels} px`,
  );
}
console.log(`warnings: ${result.warnings.length ? result.warnings.join(' | ') : 'none'}`);

/*
 * The claims in README.md, checked rather than asserted.
 *
 * The table beside these images is written by hand, so nothing stops it drifting from
 * them — except this. Editing the scene until the pair no longer demonstrates what it is
 * supposed to demonstrate now fails the command that produces it, loudly, instead of
 * quietly leaving a document that describes images that no longer exist.
 */
const failures: string[] = [];

if (result.boxes.length !== EXPECTED_DIFFERENCES) {
  failures.push(`expected ${EXPECTED_DIFFERENCES} differences, found ${result.boxes.length}`);
}

if (result.warnings.length > 0) {
  failures.push(`expected no warnings, got: ${result.warnings.join(' | ')}`);
}

if (!result.boxes.some((box) => box.width < 10 && box.height < 10)) {
  failures.push('expected at least one difference under 10px — the hardest case to detect');
}

for (const [a, b] of pairs(result.boxes)) {
  if (overlaps(a, b)) {
    failures.push(`boxes overlap: ${describe(a)} and ${describe(b)}`);
  }
}

if (failures.length > 0) {
  console.error(`\nThe sample pair no longer matches samples/README.md:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('\nAll of samples/README.md still holds.');
}

function pairs<T>(items: T[]): [T, T][] {
  return items.flatMap((item, index) =>
    items.slice(index + 1).map((other): [T, T] => [item, other]),
  );
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function describe(box: Box): string {
  return `${box.width}x${box.height} at (${box.x},${box.y})`;
}
