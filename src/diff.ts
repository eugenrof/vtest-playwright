import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface Size {
  width: number;
  height: number;
}

export interface DiffResult {
  changedPixels: number;
  totalPixels: number;
  /** changedPixels / totalPixels (0..1) */
  ratio: number;
  sizeMismatch: boolean;
  baselineSize: Size;
  currentSize: Size;
  diffPng: Buffer;
}

/** Pad an image to width x height with magenta so size changes are visible in the diff. */
function pad(src: PNG, width: number, height: number): PNG {
  if (src.width === width && src.height === height) return src;
  const out = new PNG({ width, height });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255;
    out.data[i + 1] = 0;
    out.data[i + 2] = 255;
    out.data[i + 3] = 255;
  }
  PNG.bitblt(src, out, 0, 0, src.width, src.height, 0, 0);
  return out;
}

/**
 * Compare two PNG buffers.
 * @param threshold per-pixel colour tolerance, 0 (exact) .. 1 (anything)
 */
export function diffImages(baseline: Buffer, current: Buffer, threshold = 0.1): DiffResult {
  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(current);

  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const sizeMismatch = a.width !== b.width || a.height !== b.height;

  const pa = pad(a, width, height);
  const pb = pad(b, width, height);
  const out = new PNG({ width, height });

  const changedPixels = pixelmatch(pa.data, pb.data, out.data, width, height, { threshold });
  const totalPixels = width * height;

  return {
    changedPixels,
    totalPixels,
    ratio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
    sizeMismatch,
    baselineSize: { width: a.width, height: a.height },
    currentSize: { width: b.width, height: b.height },
    diffPng: PNG.sync.write(out),
  };
}
