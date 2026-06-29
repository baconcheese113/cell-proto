// bubble-manager-core.ts — PURE selection logic for the CPM "bubble": which agents
// to PROMOTE to full CPM cells (they're near the player, so they need real physics —
// collision, engulfment, squeezing) and which promoted CPM cells to DEMOTE back to
// cheap agents (they've drifted too far to matter). Hysteresis (rPromote < rDemote)
// stops a cell on the boundary thrashing between tiers every frame.
//
// Self-contained + node-tested; the scene does the actual CPM<->agent state handoff.

export interface Positioned {
  id: number;
  x: number;
  y: number;
}

export interface PromotionPlan {
  promote: number[];
  demote: number[];
}

/** Decide tier transitions for this frame:
 *  - promote agents whose distance to the player is <= rPromote
 *  - demote promoted cells whose distance to the player is > rDemote
 *  rPromote must be < rDemote; the band between is the hysteresis zone. */
export function planPromotions(
  player: { x: number; y: number },
  agents: readonly Positioned[],
  promoted: readonly Positioned[],
  rPromote: number,
  rDemote: number
): PromotionPlan {
  const rp2 = rPromote * rPromote;
  const rd2 = rDemote * rDemote;
  const promote: number[] = [];
  for (const a of agents) {
    const dx = a.x - player.x;
    const dy = a.y - player.y;
    if (dx * dx + dy * dy <= rp2) promote.push(a.id);
  }
  const demote: number[] = [];
  for (const c of promoted) {
    const dx = c.x - player.x;
    const dy = c.y - player.y;
    if (dx * dx + dy * dy > rd2) demote.push(c.id);
  }
  return { promote, demote };
}
