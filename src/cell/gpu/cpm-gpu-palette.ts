// cpm-gpu-palette.ts — pure colour packing for the GPU framebuffer pass.
// Byte order is little-endian RGBA (0xAABBGGRR) so a Uint32 store lands as R,G,B,A bytes,
// which is exactly what ImageData / putImageData consumes in CpmRenderer.

/** Pack 0–255 channels into a little-endian 0xAABBGGRR u32. */
export function packRGBA(r: number, g: number, b: number, a: number): number {
  return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

/** kind index → packed RGBA. Index 0 (background) is transparent. `kindColors[k]` is 0xRRGGBB. */
export function buildKindColorLut(kindColors: number[]): Uint32Array {
  const lut = new Uint32Array(kindColors.length);
  lut[0] = 0x00000000;
  for (let k = 1; k < kindColors.length; k++) {
    const c = kindColors[k];
    lut[k] = packRGBA((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 0xff);
  }
  return lut;
}
