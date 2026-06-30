// agent-world-core.ts — self-contained PURE physics/decisions for the agent tier
// (the cheap, off-lattice LOD that runs EVERYWHERE). No CPM/Phaser/composition-class
// imports, only `import type` peers (erased), so it runs under `node --test`.
//
// The stateful orchestrator (agent-world.ts) wires these together with the shared
// behavior/life decision cores (chooseSteer / energyStep). Keeping the new physics
// here, pure and tested, is the same split that makes chooseSteer node-testable.

import type { Agent } from "./cpm-cell-behavior";

/** Neutral allegiance — never attacks and is never attacked (vessel lining, tissue,
 *  debris). Other team ids are mutually hostile. */
export const NEUTRAL_TEAM = 0;

/** ALLEGIANCE predicate: two cells are hostile iff they're on DIFFERENT, non-neutral
 *  teams. Orthogonal to composition (abilities) — a team can field mixed ability-cells.
 *  Shared by combat target selection (engulf/trog) and agent behavior (who to chase). */
export function hostile(teamA: number, teamB: number): boolean {
  return teamA !== teamB && teamA !== NEUTRAL_TEAM && teamB !== NEUTRAL_TEAM;
}

/** Below this motility a cell is sessile (vessel wall / tissue) — never prey. */
export const MOTILE_PREY_MIN = 0.1;
/** Prey must be meaningfully less predatory than its hunter. */
export const PREY_PHAGO_RATIO = 0.4;
/** Prey must be smaller than its hunter. */
export const PREY_VOL_RATIO = 0.95;
/** Phagocytic power above which a cell counts as a predator. */
export const PREDATOR_MIN = 0.2;

/** The single predator/prey predicate, shared by behavior (who to chase) and life
 *  (who to bite). A motile free cell, less predatory and smaller than `self`. */
export function isEdible(self: Agent, other: Agent): boolean {
  return (
    other.motility > MOTILE_PREY_MIN &&
    other.phagocytic < self.phagocytic * PREY_PHAGO_RATIO &&
    other.vol < self.vol * PREY_VOL_RATIO
  );
}

/** A uniform-grid spatial hash over agent positions so neighbour queries (the only
 *  O(n) hazard in the agent tier) stay near-linear. Rebuilt each tick from the live
 *  positions; `queryNeighborhood` returns the agent indices in the 3x3 cells around
 *  a point (a superset to filter by exact distance — cheap and correct). */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly buckets = new Map<number, number[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  /** Pack a signed cell coord pair into one number key (handles negatives). */
  private key(cx: number, cy: number): number {
    return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
  }

  rebuild(pts: ReadonlyArray<{ x: number; y: number }>): void {
    this.buckets.clear();
    for (let i = 0; i < pts.length; i++) {
      const cx = Math.floor(pts[i].x / this.cellSize);
      const cy = Math.floor(pts[i].y / this.cellSize);
      const k = this.key(cx, cy);
      let b = this.buckets.get(k);
      if (!b) {
        b = [];
        this.buckets.set(k, b);
      }
      b.push(i);
    }
  }

  queryNeighborhood(x: number, y: number): number[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const out: number[] = [];
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const b = this.buckets.get(this.key(cx + ox, cy + oy));
        if (b) for (const i of b) out.push(i);
      }
    }
    return out;
  }
}

/** Sum of unit away-vectors from each neighbour within `radius` — the off-lattice
 *  collision/crowding force (volume exclusion's cheap stand-in). Coincident points
 *  (d=0, i.e. self) are skipped. */
export function separation(
  self: { x: number; y: number },
  neighbors: ReadonlyArray<{ x: number; y: number }>,
  radius: number
): { sx: number; sy: number } {
  const r2 = radius * radius;
  let sx = 0,
    sy = 0;
  for (const o of neighbors) {
    const dx = self.x - o.x;
    const dy = self.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 0 || d2 > r2) continue;
    const inv = 1 / Math.sqrt(d2);
    sx += dx * inv;
    sy += dy * inv;
  }
  return { sx, sy };
}

/** Integrate one tick of velocity: apply acceleration (steer + separation), damp,
 *  then clamp to `maxSpeed` (derived from the cell's motility capability). A sessile
 *  cell (maxSpeed 0) is pinned — it never accumulates velocity. */
export function stepVelocity(
  vel: { vx: number; vy: number },
  ax: number,
  ay: number,
  damping: number,
  maxSpeed: number
): { vx: number; vy: number } {
  if (maxSpeed <= 0) return { vx: 0, vy: 0 };
  let vx = (vel.vx + ax) * damping;
  let vy = (vel.vy + ay) * damping;
  const sp = Math.hypot(vx, vy);
  if (sp > maxSpeed) {
    const k = maxSpeed / sp;
    vx *= k;
    vy *= k;
  }
  return { vx, vy };
}

/** A cell as feeding needs it: an `Agent` (id/pos/vol/phago/motility) plus a radius
 *  (derived from area) for the touch test. */
export type FeedAgent = Agent & { r: number };

/** Predator→prey bites this tick: each predator bites at most one touching edible
 *  prey. Uses a spatial hash internally so it stays ~O(n) at thousands of agents
 *  (`cellSize` must exceed the largest touch distance). The orchestrator applies the
 *  energy gain / damage. Pure. */
export function feedingEvents(
  agents: readonly FeedAgent[],
  touchFactor = 0.95,
  cellSize = 64
): Array<{ predator: number; prey: number }> {
  const out: Array<{ predator: number; prey: number }> = [];
  const hash = new SpatialHash(cellSize);
  hash.rebuild(agents);
  for (const p of agents) {
    if (p.phagocytic <= PREDATOR_MIN) continue;
    for (const qi of hash.queryNeighborhood(p.x, p.y)) {
      const q = agents[qi];
      if (q.id === p.id) continue;
      if (!isEdible(p, q)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > (p.r + q.r) * touchFactor) continue;
      out.push({ predator: p.id, prey: q.id });
      break; // one bite per predator per tick
    }
  }
  return out;
}
