// agent-world.ts — the always-on, off-lattice AGENT TIER: the cheap LOD that
// simulates EVERY cell in the world (thousands) every tick. It runs the SAME rule-set
// as the CPM bubble — `chooseSteer` (behavior) and `energyStep` (life) — over cheap
// `WorldCell` records, plus the pure agent-tier physics from agent-world-core
// (spatial-hash separation, velocity integration, feeding). No CPM/Phaser, so it can
// run standalone (and be benched via dynamic import); it is NOT node-tested because it
// value-imports peers (the pure cores it composes are node-tested in isolation).
//
// This is the durable source of truth: cells live here for their whole life and are
// promoted into a player's CPM bubble only transiently (bubble-manager.ts, LW2).

import { CellComposition, type Rng } from "./cell-composition";
import { chooseSteer, type Agent } from "./cpm-cell-behavior";
import {
  energyStep,
  DIVIDE_THRESHOLD,
  DIVIDE_RETAIN,
  FEED_GAIN,
  FEED_DAMAGE,
  START_ENERGY,
  MAX_ENERGY,
} from "./cpm-life";
import {
  SpatialHash,
  separation,
  stepVelocity,
  feedingEvents,
  type FeedAgent,
} from "./agent-world-core";
import { PRESETS, rollComponents, type BodyKey } from "./cell-presets";
import type { WorldCell } from "./world-cell";

/** Nominal area per body (matches the CPM profiles' target volumes) — drives
 *  predator/prey size relations + the overview render radius. */
const BODY_VOL: Record<BodyKey, number> = {
  macrophage: 560,
  epithelial: 500,
  microbe: 140,
  endothelial: 900,
  fibroblast: 460,
};

const SEP_RADIUS = 18; // crowding distance (world units)
const SEP_ACCEL = 0.6;
const STEER_ACCEL = 0.5;
const DAMPING = 0.86;
const SPEED_SCALE = 1.1; // max speed per unit motility
const WANDER_ACCEL = 0.25;
const CHILD_OFFSET = 6;

export class AgentWorld {
  private readonly cells = new Map<number, WorldCell>();
  private readonly hash = new SpatialHash(SEP_RADIUS * 2);
  private readonly rng: Rng;
  private readonly maxCells: number;
  private nextId = 1;

  constructor(maxCells = 6000, rng: Rng = Math.random) {
    this.maxCells = maxCells;
    this.rng = rng;
  }

  get count(): number {
    return this.cells.size;
  }

  all(): IterableIterator<WorldCell> {
    return this.cells.values();
  }

  /** Spawn a cell from a preset (randomized composition) at a world position. */
  spawnPreset(name: string, x: number, y: number): WorldCell | null {
    const preset = PRESETS[name];
    if (!preset) return null;
    const comp = new CellComposition(rollComponents(preset, this.rng));
    return this.add(comp, preset.body, x, y, START_ENERGY);
  }

  private add(
    comp: CellComposition,
    bodyKind: BodyKey,
    x: number,
    y: number,
    energy: number
  ): WorldCell {
    const id = this.nextId++;
    const c: WorldCell = {
      id,
      x,
      y,
      vx: 0,
      vy: 0,
      comp,
      energy,
      vol: BODY_VOL[bodyKind],
      bodyKind,
      tier: "agent",
    };
    this.cells.set(id, c);
    return c;
  }

  /** Census by a label derived from capabilities (for the gate / HUD). */
  census(): { predators: number; motile: number; sessile: number } {
    let predators = 0,
      motile = 0,
      sessile = 0;
    for (const c of this.cells.values()) {
      const caps = c.comp.capabilities;
      if (caps.phagocytic > 0.2) predators++;
      if (caps.motility > 0.05) motile++;
      else sessile++;
    }
    return { predators, motile, sessile };
  }

  /** One tick: behavior+separation→move, metabolize, feed, divide, starve. */
  step(dt: number): void {
    const list = [...this.cells.values()];
    const n = list.length;

    // Shared behavior/feeding snapshots (capabilities are cached on the composition).
    const agents: Agent[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      const caps = c.comp.capabilities;
      agents[i] = {
        id: c.id,
        x: c.x,
        y: c.y,
        vol: c.vol,
        phagocytic: caps.phagocytic,
        motility: caps.motility,
      };
    }
    this.hash.rebuild(list);

    // --- movement: separation + behavior steer, integrated & speed-clamped --------
    for (let i = 0; i < n; i++) {
      const c = list[i];
      const caps = c.comp.capabilities;
      const maxSpeed = caps.motility * SPEED_SCALE;
      if (maxSpeed <= 0) continue; // sessile: stays put

      const cand = this.hash.queryNeighborhood(c.x, c.y);
      const neighbors: WorldCell[] = new Array(cand.length);
      const neighborAgents: Agent[] = new Array(cand.length);
      for (let k = 0; k < cand.length; k++) {
        neighbors[k] = list[cand[k]];
        neighborAgents[k] = agents[cand[k]];
      }

      const sep = separation(c, neighbors, SEP_RADIUS);
      let ax = sep.sx * SEP_ACCEL;
      let ay = sep.sy * SEP_ACCEL;

      const sense = 60 + caps.chemotaxis * 34;
      const fleeDist = 40 + caps.motility * 14;
      const choice = chooseSteer(agents[i], neighborAgents, sense, fleeDist);
      if (choice) {
        const dx = choice.x - c.x;
        const dy = choice.y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        ax += (dx / d) * STEER_ACCEL;
        ay += (dy / d) * STEER_ACCEL;
      } else {
        ax += (this.rng() * 2 - 1) * WANDER_ACCEL;
        ay += (this.rng() * 2 - 1) * WANDER_ACCEL;
      }

      const v = stepVelocity(c, ax, ay, DAMPING, maxSpeed);
      c.vx = v.vx;
      c.vy = v.vy;
      c.x += v.vx * dt * 60;
      c.y += v.vy * dt * 60;
    }

    // --- metabolism ---------------------------------------------------------------
    for (const c of list) {
      const m = c.comp.metabolism;
      c.energy = energyStep(c.energy, m.gain, m.drain);
    }

    // --- feeding: predators drain touching edible prey ----------------------------
    const feeders: FeedAgent[] = new Array(n);
    for (let i = 0; i < n; i++) {
      feeders[i] = { ...agents[i], r: Math.sqrt(list[i].vol / Math.PI) };
    }
    for (const ev of feedingEvents(feeders)) {
      const prey = this.cells.get(ev.prey);
      const pred = this.cells.get(ev.predator);
      if (!prey || !pred) continue;
      prey.energy -= FEED_DAMAGE;
      pred.energy = Math.min(MAX_ENERGY, pred.energy + FEED_GAIN);
    }

    // --- division + starvation ----------------------------------------------------
    for (const c of list) {
      if (c.energy <= 0) {
        this.cells.delete(c.id);
        continue;
      }
      if (c.energy >= DIVIDE_THRESHOLD && this.cells.size < this.maxCells) {
        const ang = this.rng() * Math.PI * 2;
        this.add(
          c.comp.childComposition(this.rng),
          c.bodyKind,
          c.x + Math.cos(ang) * CHILD_OFFSET,
          c.y + Math.sin(ang) * CHILD_OFFSET,
          c.energy * DIVIDE_RETAIN
        );
        c.energy *= DIVIDE_RETAIN;
      }
    }
  }
}
