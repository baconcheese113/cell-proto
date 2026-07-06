import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKindColorLut, packRGBA } from "./cpm-gpu-palette.ts";

test("packRGBA packs little-endian AABBGGRR", () => {
  // r=0x11 g=0x22 b=0x33 a=0xFF  -> 0xFF332211
  assert.equal(packRGBA(0x11, 0x22, 0x33, 0xff) >>> 0, 0xff332211);
});

test("buildKindColorLut: background transparent, kinds opaque with swapped R/B order", () => {
  const lut = buildKindColorLut([0x000000, 0xff8000]); // kind0 bg, kind1 = R255 G128 B0
  assert.equal(lut[0] >>> 0, 0x00000000); // background transparent
  // kind1: r=0xff g=0x80 b=0x00 a=0xff -> 0xff0080ff
  assert.equal(lut[1] >>> 0, 0xff0080ff);
});
