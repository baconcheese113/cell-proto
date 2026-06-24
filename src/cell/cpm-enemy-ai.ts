// CpmEnemyAi — lightweight per-enemy behaviour driving the per-cell attraction.
//
// Each enemy roams to randomly chosen nearby points and flees when the player
// gets close. This exercises the per-cell directed-motion primitive and makes
// the world feel alive (cells wandering on/off screen). Real combat AI (hunt,
// pack behaviour) builds on this later.

import type { CpmSimulation } from "./cpm-simulation";

const FLEE_DIST = 36; // lattice px: closer than this, flee the player
const FLEE_STEP = 70; // how far ahead to aim when fleeing
const WANDER_RADIUS = 45;
const RETARGET_MIN = 1.2;
const RETARGET_MAX = 2.8;
// Keep enemies loitering near the bubble centre (the player's vicinity) instead
// of drifting off into dormancy. Within the keep-region so they stay active.
const LEASH = 78;

interface AiState {
  retargetIn: number;
}

export interface CpmEnemyAiOptions {
  enemyKind: number;
  getPlayerId: () => number;
}

export class CpmEnemyAi {
  private readonly state = new Map<number, AiState>();

  constructor(
    private readonly sim: CpmSimulation,
    private readonly opts: CpmEnemyAiOptions
  ) {}

  update(dt: number): void {
    const player = this.sim.centroidLattice(this.opts.getPlayerId());
    const live = new Set<number>();

    for (const rec of this.sim.getCells()) {
      if (rec.kind !== this.opts.enemyKind) continue;
      live.add(rec.id);
      let st = this.state.get(rec.id);
      if (!st) {
        st = { retargetIn: 0 };
        this.state.set(rec.id, st);
      }
      st.retargetIn -= dt;
      if (st.retargetIn > 0) continue;

      const ec = this.sim.centroidLattice(rec.id);
      if (!ec) continue;

      let tx: number,
        ty: number;
      if (player && dist(ec, player) < FLEE_DIST) {
        // Flee directly away from the player.
        const dx = ec.x - player.x;
        const dy = ec.y - player.y;
        const len = Math.hypot(dx, dy) || 1;
        tx = ec.x + (dx / len) * FLEE_STEP;
        ty = ec.y + (dy / len) * FLEE_STEP;
        st.retargetIn = 0.4; // re-evaluate fleeing quickly
      } else {
        // Wander to a random nearby point.
        const ang = Math.random() * Math.PI * 2;
        const r = WANDER_RADIUS * (0.4 + Math.random() * 0.6);
        tx = ec.x + Math.cos(ang) * r;
        ty = ec.y + Math.sin(ang) * r;
        st.retargetIn = RETARGET_MIN + Math.random() * (RETARGET_MAX - RETARGET_MIN);
      }
      // Leash the target to within LEASH of the bubble centre so enemies loiter
      // in the player's vicinity instead of drifting into dormancy.
      const c = this.sim.field / 2;
      const lx = tx - c,
        ly = ty - c;
      const d = Math.hypot(lx, ly);
      if (d > LEASH) {
        tx = c + (lx / d) * LEASH;
        ty = c + (ly / d) * LEASH;
      }
      this.sim.steerCell(rec.id, tx, ty);
    }

    // Drop state for enemies that are gone (died/dormant).
    for (const id of [...this.state.keys()]) {
      if (!live.has(id)) this.state.delete(id);
    }
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
