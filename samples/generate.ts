/**
 * Generates the sample image pair, then checks it with the real diff engine.
 *
 *     npm run samples
 *
 * Bundled through esbuild before running because it imports the engine directly, and the
 * engine's imports are extensionless the way TypeScript writes them — which Node's own
 * resolver will not follow. esbuild is already here as part of the Angular build.
 *
 * Everything in `samples/` is drawn here from primitives — rectangles and a 5x7 bitmap
 * font — so the committed PNGs are original work with no licensing question attached.
 * There is no image library: PNG is a container around zlib, and `node:zlib` is in the
 * standard library.
 *
 * The script ends by running `runDiff` over the two images it just drew and printing what
 * the engine found, so "the app detects all four differences" is verified at the moment
 * the samples are produced rather than asserted afterwards.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runDiff } from '../src/app/core/diff/diff-engine';
import { DEFAULT_SETTINGS } from '../src/app/core/diff/sensitivity';
import type { Box } from '../src/app/core/diff/diff-types';

const WIDTH = 1280;
const HEIGHT = 840;

/** One recolour, one deletion, one character edit, one 3px dot. See README.md. */
const EXPECTED_DIFFERENCES = 4;

type Rgb = [number, number, number];

// --- The mock interface -----------------------------------------------------------

const PAGE: Rgb = [238, 241, 245];
const HEADER: Rgb = [30, 41, 59];
const PANEL: Rgb = [255, 255, 255];
const BORDER: Rgb = [226, 232, 240];
const INK: Rgb = [51, 65, 85];
const MUTED: Rgb = [148, 163, 184];
const ACCENT: Rgb = [56, 189, 248];
const HIGHLIGHT: Rgb = [224, 242, 254];
const BAR: Rgb = [125, 211, 252];

/**
 * The two button colours differ in hue while sharing almost the same brightness:
 * relative luma 95.9 against 96.5 out of 255.
 *
 * That is deliberate. A comparison that looked only at brightness — as a greyscale diff
 * does — would see nothing here at all. It is the chroma terms in the weighted-YIQ metric
 * that catch it, so this one difference is the sample pair's evidence for a design
 * decision a reviewer would otherwise have to take on trust.
 */
const BUTTON_BEFORE: Rgb = [37, 99, 235];
const BUTTON_AFTER: Rgb = [13, 145, 66];

/** Three pixels across, in the corner of the header. The smallest thing the app claims. */
const NOTIFICATION: Rgb = [244, 63, 94];

interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function canvas(fill: Rgb): Canvas {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function fillRect(target: Canvas, x: number, y: number, w: number, h: number, colour: Rgb): void {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(target.width, x + w);
  const bottom = Math.min(target.height, y + h);

  for (let row = top; row < bottom; row++) {
    let index = (row * target.width + left) * 4;
    for (let column = left; column < right; column++) {
      target.data[index] = colour[0];
      target.data[index + 1] = colour[1];
      target.data[index + 2] = colour[2];
      target.data[index + 3] = 255;
      index += 4;
    }
  }
}

/** A card: panel fill with a one-pixel border, which is what makes it read as UI. */
function panel(target: Canvas, x: number, y: number, w: number, h: number): void {
  fillRect(target, x, y, w, h, BORDER);
  fillRect(target, x + 1, y + 1, w - 2, h - 2, PANEL);
}

// --- A 5x7 bitmap font ------------------------------------------------------------

const GLYPHS: Record<string, string> = {
  A: '01110100011000111111100011000110001',
  B: '11110100011111010001100011000111110',
  C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110',
  E: '11111100001111010000100001000011111',
  F: '11111100001111010000100001000010000',
  G: '01110100011000010111100011000101111',
  H: '10001100011000111111100011000110001',
  I: '11111001000010000100001000010011111',
  J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001',
  N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011101110001',
  X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100',
  Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111',
  '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100',
  ' ': '00000000000000000000000000000000000',
  '.': '00000000000000000000000000110000110',
  '%': '11001110010001000100010001001110011',
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/** Draw text as solid blocks, `scale` device pixels per font pixel. */
function text(
  target: Canvas,
  value: string,
  x: number,
  y: number,
  scale: number,
  colour: Rgb,
): void {
  let cursor = x;

  for (const character of value.toUpperCase()) {
    const glyph = GLYPHS[character] ?? GLYPHS[' '];

    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let column = 0; column < GLYPH_WIDTH; column++) {
        if (glyph[row * GLYPH_WIDTH + column] === '1') {
          fillRect(target, cursor + column * scale, y + row * scale, scale, scale, colour);
        }
      }
    }

    cursor += (GLYPH_WIDTH + 1) * scale;
  }
}

// --- The scene --------------------------------------------------------------------

const NAV = ['OVERVIEW', 'REPORTS', 'USERS', 'BILLING', 'SETTINGS'];
/** The middle card carries no value here: it is supplied per image, and differs. */
const CARDS: { label: string; value?: string }[] = [
  { label: 'REVENUE', value: '48210' },
  { label: 'SESSIONS' },
  { label: 'ERRORS', value: '7' },
];

/** Bar heights for the chart. Fixed, so the chart is identical in both images. */
const CHART = [64, 108, 92, 146, 120, 178, 154, 196, 132, 168, 204, 186];

interface Differences {
  /** The value shown on the middle card. */
  sessions: string;
  /**
   * A nav row that is not drawn in this image.
   *
   * Its space is left blank rather than closed up. Reflowing the list would move the two
   * rows below it as well, and the app would honestly report three differences for one
   * edit — true, but it muddies a sample pair whose job is to be legible in the first
   * thirty seconds.
   */
  hiddenNav?: string;
  button: Rgb;
  notification: boolean;
}

function draw(differences: Differences): Canvas {
  const image = canvas(PAGE);

  // Header.
  fillRect(image, 0, 0, WIDTH, 72, HEADER);
  fillRect(image, 28, 22, 28, 28, ACCENT);
  text(image, 'DASHBOARD', 72, 26, 3, PANEL);
  text(image, 'BUILD 214', WIDTH - 260, 30, 2, MUTED);

  // The 3px indicator, present in only one of the two images.
  if (differences.notification) {
    fillRect(image, 1180, 38, 3, 3, NOTIFICATION);
  }

  // Sidebar.
  fillRect(image, 0, 72, 248, HEIGHT - 72, PANEL);
  fillRect(image, 247, 72, 1, HEIGHT - 72, BORDER);

  NAV.forEach((item, index) => {
    const y = 112 + index * 48;
    if (index === 0) {
      fillRect(image, 16, y - 10, 216, 34, HIGHLIGHT);
    }
    if (item !== differences.hiddenNav) {
      text(image, item, 36, y, 2, index === 0 ? INK : MUTED);
    }
  });

  // Metric cards.
  CARDS.forEach((card, index) => {
    const x = 288 + index * 332;
    panel(image, x, 104, 300, 168);
    text(image, card.label, x + 24, 128, 2, MUTED);

    text(image, card.value ?? differences.sessions, x + 24, 168, 5, INK);
    fillRect(image, x + 24, 240, 120, 6, BAR);
  });

  // Chart.
  panel(image, 288, 304, 964, 296);
  text(image, 'WEEKLY ACTIVITY', 312, 328, 2, MUTED);
  CHART.forEach((height, index) => {
    fillRect(image, 316 + index * 78, 568 - height, 48, height, BAR);
  });

  // Primary action.
  fillRect(image, 288, 640, 200, 56, differences.button);
  text(image, 'EXPORT', 330, 658, 3, PANEL);

  text(image, 'LAST SYNC 4 MIN AGO', 520, 668, 2, MUTED);

  return image;
}

const before = draw({
  sessions: '1284',
  button: BUTTON_BEFORE,
  notification: false,
});

const after = draw({
  sessions: '1384',
  hiddenNav: 'BILLING',
  button: BUTTON_AFTER,
  notification: true,
});

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
  return items.flatMap((item, index) => items.slice(index + 1).map((other): [T, T] => [item, other]));
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

function describe(box: Box): string {
  return `${box.width}x${box.height} at (${box.x},${box.y})`;
}
