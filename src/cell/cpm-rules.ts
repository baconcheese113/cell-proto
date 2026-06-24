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

export type DeathReason = "fragmented" | "dissolved";

export interface CpmRulesCallbacks {
  /** Fired once when a cell crosses a fatal threshold. The handler is expected
   *  to remove the cell from the simulation and play any death effect. */
  onDeath(id: number, reason: DeathReason): void;
}

/** A real tear leaves two parts each at least this many lattice px; the
 *  Monte-Carlo flicker is 1-2 px, far below this. */
const FRAG_MIN_PX = 18;
/** Below this fraction of target volume (sustained) a cell is mortally damaged. */
const LOW_VOLUME_FRAC = 0.4;
const LOW_VOLUME_PERSIST = 3;
/** Run the (stat-heavy) check every N frames. */
const CHECK_INTERVAL = 5;

export class CpmRules {
  private frame = 0;
  private lowVolTicks = new Map<number, number>();
  private dead = new Set<number>();

  constructor(
    private readonly sim: CpmSimulation,
    private readonly cb: CpmRulesCallbacks
  ) {}

  update(): void {
    if (++this.frame % CHECK_INTERVAL !== 0) return;

    const sizesByCell = this.sim.componentSizesByCell();
    for (const [id, sizes] of sizesByCell) {
      if (this.dead.has(id)) continue;

      // Structural failure: a second substantial component = a real tear.
      if (sizes.length >= 2 && sizes[1] >= FRAG_MIN_PX) {
        this.kill(id, "fragmented");
        continue;
      }

      // Mortal damage: most of the body is gone.
      const largest = sizes.length > 0 ? sizes[0] : 0;
      const target = this.sim.targetVolume(id);
      if (target > 0 && largest < LOW_VOLUME_FRAC * target) {
        const t = (this.lowVolTicks.get(id) ?? 0) + 1;
        this.lowVolTicks.set(id, t);
        if (t >= LOW_VOLUME_PERSIST) this.kill(id, "dissolved");
      } else {
        this.lowVolTicks.delete(id);
      }
    }

    // Forget bookkeeping for cells that no longer exist.
    for (const id of [...this.lowVolTicks.keys()]) {
      if (!sizesByCell.has(id)) this.lowVolTicks.delete(id);
    }
  }

  private kill(id: number, reason: DeathReason): void {
    this.dead.add(id);
    this.lowVolTicks.delete(id);
    this.cb.onDeath(id, reason);
  }

  /** Drop tracking for an id (e.g. when it went dormant rather than died). */
  forget(id: number): void {
    this.dead.delete(id);
    this.lowVolTicks.delete(id);
  }
}
