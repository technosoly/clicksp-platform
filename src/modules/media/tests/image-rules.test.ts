import { describe, expect, it } from "vitest";
import { detectImageFormat, IMAGE_KEY_PATTERN, imageKey, pickRendition, precheckImage, renditionWidths, srcSet, MAX_IMAGE_BYTES } from "../domain/image-rules";

const bytes = (...values: (number | string)[]) => {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number") out.push(v);
    else out.push(...[...v].map((c) => c.charCodeAt(0)));
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe("image rules", () => {
  it("recognizes images by their bytes only", () => {
    expect(detectImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(detectImageFormat(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(detectImageFormat(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("webp");
    expect(detectImageFormat(bytes(0, 0, 0, 0x1c, "ftypavif"))).toBe("avif");
    expect(detectImageFormat(bytes("<svg xmlns="))).toBeNull();
    expect(detectImageFormat(bytes("GIF89a"))).toBeNull();
    expect(detectImageFormat(bytes("%PDF-1.7"))).toBeNull();
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("refuses empty, oversized and non-image files before decoding", () => {
    expect(precheckImage(new Uint8Array())).toBe("image_missing");
    expect(precheckImage(bytes("hello world, not an image"))).toBe("image_type");
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(precheckImage(big)).toBe("image_too_large");
    expect(precheckImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
  });

  it("generates widths up to the image's own, never enlarging", () => {
    expect(renditionWidths(250)).toEqual([250]);
    expect(renditionWidths(800)).toEqual([320, 640, 800]);
    expect(renditionWidths(1200)).toEqual([320, 640, 1200]);
    expect(renditionWidths(5000)).toEqual([320, 640, 1200, 2000]);
  });

  it("builds strict keys and picks sizes", () => {
    const key = imageKey("0193e9c2-7a4b-7c3d-8e9f-0123456789ab", 640, new Date("2026-03-05T00:00:00Z"));
    expect(key).toBe("img/2026/03/0193e9c2-7a4b-7c3d-8e9f-0123456789ab/640.webp");
    expect(IMAGE_KEY_PATTERN.test(key)).toBe(true);
    expect(IMAGE_KEY_PATTERN.test("img/2026/03/../../etc/passwd")).toBe(false);
    expect(IMAGE_KEY_PATTERN.test(`${key}.svg`)).toBe(false);
    const renditions = [
      { key: "a", width: 1200, height: 900, bytes: 1 },
      { key: "b", width: 320, height: 240, bytes: 1 },
      { key: "c", width: 640, height: 480, bytes: 1 },
    ];
    expect(pickRendition(renditions, 500)?.key).toBe("c");
    expect(pickRendition(renditions, 3000)?.key).toBe("a");
    expect(pickRendition([], 300)).toBeNull();
    expect(srcSet(renditions)).toBe("/media/b 320w, /media/c 640w, /media/a 1200w");
  });
});
