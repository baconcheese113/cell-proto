// footprint-cost.ts — pure deltaH math for the footprint-coverage coupling, the
// ONLY thing the CPM membrane needs to know about a big organelle. The host
// should keep cytoplasm over each big organelle's footprint:
//   - a copy attempt that REMOVES host cytoplasm from a footprint pixel costs
//     +lambda (resists retracting off the organelle -> squeeze BOTTLENECK),
//   - one that COVERS a footprint pixel with host is rewarded -lambda
//     (membrane self-heals over the organelle),
//   - everything else is free.
// Keeping this pure lets us node-test the coupling without a live CPM.

export function footprintDeltaH(
  mark: Uint8Array,
  hostId: number,
  tgt_i: number,
  src_type: number,
  tgt_type: number,
  lambda: number
): number {
  if (mark[tgt_i] !== 1) return 0;
  if (tgt_type === hostId && src_type !== hostId) return lambda; // removing host
  if (tgt_type !== hostId && src_type === hostId) return -lambda; // covering with host
  return 0;
}
