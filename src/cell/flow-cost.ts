// flow-cost.ts — pure deltaH math for the vessel CURRENT (the heart pump). A copy
// attempt that extends a cell DOWNSTREAM (its displacement aligned with the flow
// direction) is rewarded (negative deltaH), so cells drift along the flow. Mirrors
// the attraction-constraint math but with a single global flow vector instead of a
// per-cell target. Magnitude is pulsed (heartbeat) by the caller via `lambda`.

export function flowDeltaH(
  dx: number, // tgt - src displacement, x (lattice px)
  dy: number, // tgt - src displacement, y
  flowX: number, // unit flow direction
  flowY: number,
  lambda: number // pulse-scaled strength
): number {
  // Aligned with flow -> negative (favored); against -> positive; perpendicular 0.
  return -lambda * (dx * flowX + dy * flowY);
}
