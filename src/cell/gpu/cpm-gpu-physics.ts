// cpm-gpu-physics.ts — pure TS mirrors of the two newest constraint kernels (steering + hard
// barrier) so their LOGIC can be unit-tested headlessly. These are line-for-line equivalents of
// the WGSL in cpm-gpu-wgsl.ts (STEP_WGSL); keep them in sync. The heavy Monte-Carlo dynamics are
// validated separately by the browser benches — here we assert only the per-attempt math/logic.

/** Hard PermeableBarrierConstraint: is a copy from a source cell (kind `kSrc`, `srcFrozen`) into a
 *  target cell (kind `kTgt`, `tgtFrozen`) ALLOWED? A cross-barrier copy is rejected unless the
 *  non-barrier party's kind is the permeable (player) kind. `barrierBitmask` has bit k set when
 *  kind k is a barrier. Mirrors the `sB/tB/otherKind` block in STEP_WGSL. */
export function barrierAllows(
  kSrc: number, kTgt: number,
  srcFrozen: boolean, tgtFrozen: boolean,
  barrierBitmask: number, permeableKind: number
): boolean {
  const sB = (barrierBitmask & (1 << kSrc)) !== 0 || srcFrozen;
  const tB = (barrierBitmask & (1 << kTgt)) !== 0 || tgtFrozen;
  if (sB || tB) {
    const otherKind = sB ? kTgt : kSrc;
    if (otherKind !== permeableKind) return false;
  }
  return true;
}

/** PerCellAttraction deltaH: reward (negative) a copy from source pixel (sx,sy) into target pixel
 *  (cx,cy) when its direction aligns with the source cell's direction toward its attraction point
 *  (tx,ty). Mirrors the steering block in STEP_WGSL and Artistoo's AttractionPointConstraint. */
export function steerDeltaH(
  sx: number, sy: number, cx: number, cy: number,
  tx: number, ty: number, lambda: number
): number {
  if (lambda <= 0) return 0;
  const dirx = tx - sx, diry = ty - sy;
  const ldir = dirx * dirx + diry * diry;
  if (ldir <= 0) return 0;
  const r = (cx - sx) * dirx + (cy - sy) * diry;
  const h = (-r * lambda) / Math.sqrt(ldir);
  return h === 0 ? 0 : h; // normalise -0
}
