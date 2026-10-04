import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface Diff {
  width: number;
  height: number;
  sizeMatches: boolean;
  /** pixels that differ, not counting tolerated text-edge shading */
  diffPixels: number;
  ratio: number;
  /** differing pixels that are only text-edge shading (see textEdge) */
  textEdgePixels: number;
}

/**
 * Text-edge tolerance (owner's decision, Phase 3): Chrome sometimes shades the edges of
 * the same letters slightly differently from run to run. A differing pixel is forgiven
 * only when each image's colour lies within the colour range of the 5×5 pixels around
 * the same spot in the other image: a letter edge shaded differently, or a line of text
 * that Chrome rounded to the pixel above or below (text at a half-pixel position).
 * A colour change on a flat area is still a difference. At most 0.5% of the area and
 * never more than 1,500 pixels (a few short lines of text) may be forgiven; above that
 * every differing pixel counts, so a moved block or screen fails. Sizes must always match exactly.
 */
export const TEXT_EDGE_MAX = 0.005;
/** and never more than this many pixels, however large the picture */
export const TEXT_EDGE_CAP = 1500;
const SLACK = 16;
/** how far from the spot a letter edge may have moved: 2 pixels (a 5×5 square) */
const R = 2;
function inRange(src: Uint8Array, other: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  const i = (y * w + x) * 4;
  for (let c = 0; c < 3; c++) {
    let lo = 255, hi = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = other[(yy * w + xx) * 4 + c]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const v = src[i + c]!;
    if (hi - lo < 24 || v < lo - SLACK || v > hi + SLACK) return false; // flat area, or a colour not there
  }
  return true;
}

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/visual');

/**
 * Pixel comparison of two screenshots. Writes expected / actual / diff images
 * to test-results/visual/<name>-*.png so a person can look at any difference.
 */
export function compare(name: string, expected: Buffer, actual: Buffer): Diff {
  fs.mkdirSync(OUT, { recursive: true });
  const a = PNG.sync.read(expected);
  const b = PNG.sync.read(actual);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (img: PNG) => {
    if (img.width === width && img.height === height) return img;
    const out = new PNG({ width, height });
    out.data.fill(255);
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out;
  };
  const A = pad(a);
  const B = pad(b);
  const diff = new PNG({ width, height });
  const raw = pixelmatch(A.data, B.data, diff.data, width, height, { threshold: 0.1 });
  // sort the differing pixels (pixelmatch paints them red) into text-edge shading and real differences
  let textEdgePixels = 0;
  let real = raw;
  if (raw > 0) {
    const cand: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0 && inRange(A.data, B.data, width, height, x, y) && inRange(B.data, A.data, width, height, x, y)) cand.push(y * width + x);
    }
    const ok = cand;
    if (ok.length <= Math.min(TEXT_EDGE_MAX * width * height, TEXT_EDGE_CAP)) {
      textEdgePixels = ok.length;
      real = raw - ok.length;
      for (const p of ok) { diff.data[p * 4] = 0; diff.data[p * 4 + 1] = 140; diff.data[p * 4 + 2] = 255; } // forgiven: blue in the diff image
    }
  }
  const diffPixels = real;
  fs.writeFileSync(path.join(OUT, `${name}-expected.png`), expected);
  fs.writeFileSync(path.join(OUT, `${name}-actual.png`), actual);
  fs.writeFileSync(path.join(OUT, `${name}-diff.png`), PNG.sync.write(diff));
  return { width, height, sizeMatches: a.width === b.width && a.height === b.height, diffPixels, ratio: diffPixels / (width * height), textEdgePixels };
}
