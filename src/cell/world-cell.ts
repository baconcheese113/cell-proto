// world-cell.ts — the DURABLE identity + state of one cell, independent of which LOD
// tier currently represents it. This record persists for the cell's whole life: it is
// authoritative while the cell is a cheap off-lattice AGENT, and is mirrored from /
// baked back into the CPM cell while the cell is PROMOTED into a player's bubble.
//
// "A cell IS its composition" (cell-composition.ts) — so the rule-set (capabilities,
// metabolism, behavior, life) reads `comp`, never a type label. `bodyKind` only picks
// the CPM physics profile + render colour when promoted.
//
// Type-only import (erased) so this stays free of CPM/Phaser.

import type { CellComposition } from "./cell-composition";
import type { BodyKey } from "./cell-presets";

export type CellTier = "agent" | "cpm";

export interface WorldCell {
  readonly id: number;
  /** World position (authoritative while `tier === "agent"`; mirrored from the CPM
   *  centroid while promoted). */
  x: number;
  y: number;
  /** World velocity (agent-tier integration; seeded from CPM drift on demotion). */
  vx: number;
  vy: number;
  /** The single source of truth for what the cell can do / its metabolism. */
  comp: CellComposition;
  /** Life energy (carried across promotion/demotion so the cell never resets). */
  energy: number;
  /** Nominal area (lattice px when promoted) — drives size relations + render radius. */
  vol: number;
  /** Which CPM body profile / colour to use when promoted + in the overview. */
  bodyKind: BodyKey;
  tier: CellTier;
  /** While `tier === "cpm"`, the id of the CPM cell shadowing this agent (the agent
   *  stays in the world; its position is mirrored from the shadow and it renders as the
   *  CPM cell, not a disc). Undefined while `tier === "agent"`. */
  cpmId?: number;
}
