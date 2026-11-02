import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { diffImages } from "./diff.js";

function solid(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

describe("diffImages", () => {
  it("reports no change for identical images", () => {
    const img = solid(20, 20, [255, 255, 255, 255]);
    const r = diffImages(img, img);
    expect(r.changedPixels).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.sizeMismatch).toBe(false);
  });

  it("detects fully different images", () => {
    const r = diffImages(solid(10, 10, [255, 255, 255, 255]), solid(10, 10, [0, 0, 0, 255]));
    expect(r.changedPixels).toBe(100);
    expect(r.ratio).toBe(1);
  });

  it("flags size mismatches and still produces a diff", () => {
    const r = diffImages(solid(10, 10, [255, 255, 255, 255]), solid(10, 20, [255, 255, 255, 255]));
    expect(r.sizeMismatch).toBe(true);
    expect(r.changedPixels).toBeGreaterThan(0);
    expect(r.diffPng.length).toBeGreaterThan(0);
  });
});
