import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface Diff {
  width: number;
  height: number;
  sizeMatches: boolean;
  diffPixels: number;
  ratio: number;
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
  const diffPixels = pixelmatch(A.data, B.data, diff.data, width, height, { threshold: 0.1 });
  fs.writeFileSync(path.join(OUT, `${name}-expected.png`), expected);
  fs.writeFileSync(path.join(OUT, `${name}-actual.png`), actual);
  fs.writeFileSync(path.join(OUT, `${name}-diff.png`), PNG.sync.write(diff));
  return { width, height, sizeMatches: a.width === b.width && a.height === b.height, diffPixels, ratio: diffPixels / (width * height) };
}
