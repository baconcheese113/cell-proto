// CpmRules — the biology/behaviour layer that sits on top of the CPM physics.
//
// For M-C it watches each cell's physical state and fires a death event on
// "structural failure": when a cell fragments into two substantial pieces (a
// real tear, not the harmless single-pixel boundary flicker the Monte-Carlo
// produces), or when it has lost most of its body. Cohesion (the soft
// connectivity constraint) means cells never split spontaneously, so a detected
// split is always the result of adverse force/chemistry — exactly the
// condition-gated tearing the design calls for. Later steps grow this into the
// full per-cell state machine (damage accumulation, apoptosis, environment).

import type { CpmSimulation } from "./cpm-simulation";

export type DeathReason = "fragmented" | "dissolved" | "apoptosis";

export interface CpmRulesCallbacks {
  /** Fired once when a cell crosses a fatal threshold. The handler is expected
   *  to remove the cell from the simulation and play any death effect. */
  onDeath(id: number, reason: DeathReason): void;
  /** Optional: cells the rules layer should not judge (e.g. being consumed by
   *  combat, which owns their removal). */
  ignore?(id: number): boolean;
  /** Optional: component sizes of a cell's whole STRUCTURE (it plus its enclosed
   *  compartments), used instead of the bare per-cell components for tear/volume
   *  checks. Lets a compartmentalized host avoid false "fragmented" deaths from
   *  organelles dividing its cytoplasm. Return undefined to use per-cell sizes. */
  structureSizes?(id: number): number[] | undefined;
}

/** A real tear leaves two parts each at least this many lattice px; the
 *  Monte-Carlo flicker is 1-2 px, far below this. */
const FRAG_MIN_PX = 18;
/** ...and it must persist this many checks. A cell wrapping organelles can
 *  momentarily pinch a cytoplasm bridge during a hard maneuver and recover; only
 *  a SUSTAINED split is a real, fatal tear. */
const FRAG_PERSIST = 3;
/** Below this fraction of target volume (sustained) a cell is mortally damaged. */
const LOW_VOLUME_FRAC = 0.4;
const LOW_VOLUME_PERSIST = 3;
/** Run the (stat-heavy) check every N frames. */
const CHECK_INTERVAL = 5;

// Health / apoptosis (accumulating damage, not just instant thresholds).
const MAX_HEALTH = 100;
/** Squeezed below this fraction of target volume = under stress, taking damage. */
const STRESS_FRAC = 0.7;
const DAMAGE_PER_CHECK = 9; // while stressed
const HEAL_PER_CHECK = 4; // while healthy

export class CpmRules {
  private frame = 0;
  private lowVolTicks = new Map<number, number>();
  private fragTicks = new Map<number, number>();
  private dead = new Set<number>();
  private health = new Map<number, number>();

  constructor(
    private readonly sim: CpmSimulation,
    private readonly cb: CpmRulesCallbacks
  ) {}

  /** Current health fraction (0..1) of a cell, for HUD/feedback. */
  healthFraction(id: number): number {
    return (this.health.get(id) ?? MAX_HEALTH) / MAX_HEALTH;
  }

  /** External damage (combat bites, adverse chemistry). Lethal -> apoptosis. */
  applyDamage(id: number, amount: number): void {
    if (this.dead.has(id)) return;
    const h = (this.health.get(id) ?? MAX_HEALTH) - amount;
    this.health.set(id, h);
    if (h <= 0) this.kill(id, "apoptosis");
  }

  update(): void {
    if (++this.frame % CHECK_INTERVAL !== 0) return;

    const sizesByCell = this.sim.componentSizesByCell();
    for (const [id, perCellSizes] of sizesByCell) {
      if (this.dead.has(id)) continue;
      if (this.cb.ignore?.(id)) continue;
      // Use whole-structure connectivity when provided (host + its compartments),
      // so organelles dividing the cytoplasm don't read as a fatal tear.
      const sizes = this.cb.structureSizes?.(id) ?? perCellSizes;

      // Structural failure: a second substantial component = a tear — but only
      // fatal if it persists (a transient maneuver pinch recovers).
      if (sizes.length >= 2 && sizes[1] >= FRAG_MIN_PX) {
        const t = (this.fragTicks.get(id) ?? 0) + 1;
        this.fragTicks.set(id, t);
        if (t >= FRAG_PERSIST) {
          this.kill(id, "fragmented");
        }
        continue;
      }
      this.fragTicks.delete(id);

      // Mortal damage: most of the body is gone.
      const largest = sizes.length > 0 ? sizes[0] : 0;
      const target = this.sim.targetVolume(id);
      if (target > 0 && largest < LOW_VOLUME_FRAC * target) {
        const t = (this.lowVolTicks.get(id) ?? 0) + 1;
        this.lowVolTicks.set(id, t);
        if (t >= LOW_VOLUME_PERSIST) this.kill(id, "dissolved");
        continue;
      }
      this.lowVolTicks.delete(id);

      // Accumulating damage: sustained compression below STRESS_FRAC erodes
      // health; otherwise it slowly recovers. Hitting zero = apoptosis.
      if (target > 0) {
        let h = this.health.get(id) ?? MAX_HEALTH;
        if (largest < STRESS_FRAC * target) h -= DAMAGE_PER_CHECK;
        else h = Math.min(MAX_HEALTH, h + HEAL_PER_CHECK);
        this.health.set(id, h);
        if (h <= 0) this.kill(id, "apoptosis");
      }
    }

    // Forget bookkeeping for cells that no longer exist.
    for (const id of [...this.lowVolTicks.keys()]) {
      if (!sizesByCell.has(id)) this.lowVolTicks.delete(id);
    }
    for (const id of [...this.fragTicks.keys()]) {
      if (!sizesByCell.has(id)) this.fragTicks.delete(id);
    }
    for (const id of [...this.health.keys()]) {
      if (!sizesByCell.has(id)) this.health.delete(id);
    }
  }

  private kill(id: number, reason: DeathReason): void {
    this.dead.add(id);
    this.lowVolTicks.delete(id);
    this.fragTicks.delete(id);
    this.health.delete(id);
    this.cb.onDeath(id, reason);
  }

  /** Drop tracking for an id (e.g. when it went dormant rather than died). */
  forget(id: number): void {
    this.dead.delete(id);
    this.lowVolTicks.delete(id);
    this.fragTicks.delete(id);
    this.health.delete(id);
  }
}
