// CpmLife — the per-cell life cycle every cell runs: metabolize (energy balance
// from its composition) -> feed (predators drain adjacent edible prey) -> divide
// (when well-fed and there's room; the child inherits a MUTATED composition, the
// seed of emergent differentiation) -> die (starvation). This is what makes the
// world self-sustaining: microbes multiply, macrophages eat them, populations
// ebb and flow — all from the same code, the player's cell included.
//
// Type-only imports so the pure energy/division helpers are node-testable.

import type { CpmSimulation } from "./cpm-simulation";
import type { CellComposition, Rng } from "./cell-composition";

export const START_ENERGY = 50;
export const MAX_ENERGY = 100;
export const DIVIDE_THRESHOLD = 90;
/** Energy units per metabolic-balance unit per frame. */
export const METAB_RATE = 1;
/** Predation: per-frame energy a predator drains from / damage it deals to prey.
 *  Kept modest so predators reproduce slowly relative to prey (a stable food web,
 *  not a predator explosion). */
export const FEED_GAIN = 0.35;
export const FEED_DAMAGE = 1.4;
/** Energy each of parent + child keep after a division (fraction of pre-split).
 *  Below half so a freshly-divided cell can't immediately divide again. */
export const DIVIDE_RETAIN = 0.4;

/** One frame of passive metabolism: energy moves by (gain - drain) and is clamped
 *  to [0, max]. Pure. */
export function energyStep(
  energy: number,
  gain: number,
  drain: number,
  max = MAX_ENERGY
): number {
  const e = energy + (gain - drain) * METAB_RATE;
  return e < 0 ? 0 : e > max ? max : e;
}

/** Divide only when well-fed AND there's somewhere to put the child. Pure. */
export function shouldDivide(energy: number, hasSpace: boolean): boolean {
  return energy >= DIVIDE_THRESHOLD && hasSpace;
}

export interface CpmLifeOptions {
  getComposition: (id: number) => CellComposition | undefined;
  /** Register a freshly-born child's composition with the scene's registry. */
  registerChild: (childId: number, comp: CellComposition) => void;
  /** Apply damage to a cell (routed to the rules layer). */
  damage: (id: number, amount: number) => void;
  /** A cell starved to death. */
  onStarve: (id: number) => void;
  /** Optional veto on division (e.g. the player's controlled cell shouldn't split
   *  into uncontrolled copies). Default: everything may divide. */
  canDivide?: (id: number) => boolean;
  rng?: Rng;
}

export class CpmLife {
  private readonly energy = new Map<number, number>();
  private readonly sim: CpmSimulation;
  private readonly opts: CpmLifeOptions;
  private readonly rng: Rng;

  constructor(sim: CpmSimulation, opts: CpmLifeOptions) {
    this.sim = sim;
    this.opts = opts;
    this.rng = opts.rng ?? Math.random;
  }

  energyOf(id: number): number {
    return this.energy.get(id) ?? START_ENERGY;
  }

  /** Seed a cell's starting energy (e.g. on spawn). */
  seed(id: number, energy = START_ENERGY): void {
    this.energy.set(id, energy);
  }

  /** `centroids` is the shared per-frame snapshot (sim.centroidsAll). */
  update(centroids: Map<number, { x: number; y: number; pixels: number }>): void {
    // Snapshot agents from the shared centroid map for metabolism + feeding.
    interface A {
      id: number;
      x: number;
      y: number;
      r: number;
      phago: number;
      motility: number;
      vol: number;
    }
    const agents: A[] = [];
    const live = new Set<number>();
    for (const rec of this.sim.getCells()) {
      const comp = this.opts.getComposition(rec.id);
      if (!comp) continue;
      const c = centroids.get(rec.id);
      if (!c) continue;
      live.add(rec.id);
      // Passive metabolism.
      const m = comp.metabolism;
      this.energy.set(rec.id, energyStep(this.energyOf(rec.id), m.gain, m.drain));
      agents.push({
        id: rec.id,
        x: c.x,
        y: c.y,
        r: Math.sqrt(c.pixels / Math.PI),
        phago: comp.capabilities.phagocytic,
        motility: comp.capabilities.motility,
        vol: c.pixels,
      });
    }

    // Feeding: a predator adjacent to an edible cell drains it.
    for (const p of agents) {
      if (p.phago <= 0.2) continue;
      for (const q of agents) {
        if (q.id === p.id) continue;
        // Only motile free cells are prey — predators don't digest the vessel wall.
        const edible = q.motility > 0.1 && q.phago < p.phago * 0.4 && q.vol < p.vol * 0.95;
        if (!edible) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d > (p.r + q.r) * 0.95) continue; // must be touching
        this.opts.damage(q.id, FEED_DAMAGE);
        this.energy.set(p.id, Math.min(MAX_ENERGY, this.energyOf(p.id) + FEED_GAIN));
        break; // one bite per frame
      }
    }

    // Division + starvation.
    for (const a of agents) {
      const e = this.energyOf(a.id);
      if (e <= 0) {
        this.opts.onStarve(a.id);
        continue;
      }
      if (e >= DIVIDE_THRESHOLD && (this.opts.canDivide?.(a.id) ?? true)) {
        this.tryDivide(a.id, a.x, a.y);
      }
    }

    // Forget energy for cells that are gone.
    for (const id of [...this.energy.keys()]) {
      if (!live.has(id)) this.energy.delete(id);
    }
  }

  /** Spawn a child of the same body kind at a free spot near the parent; the child
   *  inherits a mutated composition; parent + child split the energy. */
  private tryDivide(id: number, cx: number, cy: number): void {
    const rec = this.sim.getCell(id);
    const parentComp = this.opts.getComposition(id);
    if (!rec || !parentComp) return;
    const spot = this.findFreeSpot(cx, cy);
    if (!spot) return; // no room -> stay full, try again later
    const child = this.sim.spawnCellAtLattice(rec.kind, spot.x, spot.y);
    const childComp = parentComp.childComposition(this.rng);
    this.opts.registerChild(child.id, childComp);
    const keep = this.energyOf(id) * DIVIDE_RETAIN;
    this.energy.set(id, keep);
    this.energy.set(child.id, keep);
  }

  /** Find a background lattice pixel a short ring out from (cx,cy), away from the
   *  hard border. Returns null if crowded. */
  private findFreeSpot(cx: number, cy: number): { x: number; y: number } | null {
    const f = this.sim.field;
    const margin = 12;
    for (let r = 10; r <= 26; r += 4) {
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + this.rng() * 0.4;
        const x = Math.round(cx + Math.cos(ang) * r);
        const y = Math.round(cy + Math.sin(ang) * r);
        if (x < margin || x >= f - margin || y < margin || y >= f - margin) continue;
        if (this.sim.ownerAtLattice(x, y) === 0) return { x, y };
      }
    }
    return null;
  }
}
