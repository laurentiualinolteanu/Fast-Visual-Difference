/**
 * The mock interface the sample images depict, drawn from primitives.
 *
 * Shared by `generate.ts`, which encodes it to PNG, and `measure.ts`, which times the
 * engine against it. Everything here is deliberate about being ordinary: flat panels,
 * text, a bar chart. A synthetic scene of random noise would make the tile screen look
 * far worse than it is on real screenshots, and one of pure flat colour would make it
 * look far better.
 *
 * `unit` scales the whole scene, so the same layout can be produced at 1280x840 for the
 * committed samples and at several times that for a large-screenshot measurement.
 */

export type Rgb = [number, number, number];

export interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export const BASE_WIDTH = 1280;
export const BASE_HEIGHT = 840;

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
 * relative luma 96.0 against 96.5 out of 255.
 *
 * That is deliberate. A comparison that looked only at brightness — as a greyscale diff
 * does — would see nothing here at all. It is the chroma terms in the weighted-YIQ metric
 * that catch it, so this one difference is the sample pair's evidence for a design
 * decision a reviewer would otherwise have to take on trust.
 */
export const BUTTON_BEFORE: Rgb = [37, 99, 235];
export const BUTTON_AFTER: Rgb = [13, 145, 66];

/** Three pixels across at unit 1. The smallest thing the app claims to find. */
const NOTIFICATION: Rgb = [244, 63, 94];

export function canvas(width: number, height: number, fill: Rgb): Canvas {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(
  target: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: Rgb,
): void {
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(target.width, Math.round(x + w));
  const bottom = Math.min(target.height, Math.round(y + h));

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
function panel(target: Canvas, x: number, y: number, w: number, h: number, unit: number): void {
  fillRect(target, x, y, w, h, BORDER);
  fillRect(target, x + unit, y + unit, w - unit * 2, h - unit * 2, PANEL);
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

export interface Differences {
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

export function drawScene(differences: Differences, unit = 1): Canvas {
  const u = (value: number) => value * unit;
  const image = canvas(BASE_WIDTH * unit, BASE_HEIGHT * unit, PAGE);

  // Header.
  fillRect(image, 0, 0, image.width, u(72), HEADER);
  fillRect(image, u(28), u(22), u(28), u(28), ACCENT);
  text(image, 'DASHBOARD', u(72), u(26), u(3), PANEL);
  text(image, 'BUILD 214', image.width - u(260), u(30), u(2), MUTED);

  // The 3px indicator, present in only one of the two images.
  if (differences.notification) {
    fillRect(image, u(1180), u(38), u(3), u(3), NOTIFICATION);
  }

  // Sidebar.
  fillRect(image, 0, u(72), u(248), image.height - u(72), PANEL);
  fillRect(image, u(247), u(72), u(1), image.height - u(72), BORDER);

  NAV.forEach((item, index) => {
    const y = u(112 + index * 48);
    if (index === 0) {
      fillRect(image, u(16), y - u(10), u(216), u(34), HIGHLIGHT);
    }
    if (item !== differences.hiddenNav) {
      text(image, item, u(36), y, u(2), index === 0 ? INK : MUTED);
    }
  });

  // Metric cards.
  CARDS.forEach((card, index) => {
    const x = u(288 + index * 332);
    panel(image, x, u(104), u(300), u(168), unit);
    text(image, card.label, x + u(24), u(128), u(2), MUTED);
    text(image, card.value ?? differences.sessions, x + u(24), u(168), u(5), INK);
    fillRect(image, x + u(24), u(240), u(120), u(6), BAR);
  });

  // Chart.
  panel(image, u(288), u(304), u(964), u(296), unit);
  text(image, 'WEEKLY ACTIVITY', u(312), u(328), u(2), MUTED);
  CHART.forEach((height, index) => {
    fillRect(image, u(316 + index * 78), u(568 - height), u(48), u(height), BAR);
  });

  // Primary action.
  fillRect(image, u(288), u(640), u(200), u(56), differences.button);
  text(image, 'EXPORT', u(330), u(658), u(3), PANEL);
  text(image, 'LAST SYNC 4 MIN AGO', u(520), u(668), u(2), MUTED);

  return image;
}

/** The state the committed `before.png` depicts. */
export const BEFORE: Differences = {
  sessions: '1284',
  button: BUTTON_BEFORE,
  notification: false,
};

/** The state the committed `after.png` depicts: four differences from `BEFORE`. */
export const AFTER: Differences = {
  sessions: '1384',
  hiddenNav: 'BILLING',
  button: BUTTON_AFTER,
  notification: true,
};
