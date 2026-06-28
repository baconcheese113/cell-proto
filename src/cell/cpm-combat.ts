// CpmCombat — phagocytosis: grab a nearby enemy, wrap it (the host flows around
// it via lowered adhesion + protrusion), and once it is internalized (a closed
// interior compartment — the topology change CPM gives for free and XPBD could
// not), digest it for nutrients.
//
// This is the project's headline mechanic. Rupture/leakage hooks live here too:
// digestion frees interior space the host reclaims.

import type { CpmSimulation } from "./cpm-simulation";

const GRAB_RANGE = 34; // lattice px between centroids to start engulfing
const GRAB_LAMBDA_SCALE = 2.8; // how hard the prey is pulled inward
const ENGULF_J = 5; // very sticky host<->prey while wrapping
const DEFAULT_J = 22; // restored when not engulfing
// Once the host has wrapped this fraction of the prey's boundary, it overpowers
// it and consumes it in place (true full closure needs Step-3 compartments).
const CONSUME_FRACTION = 0.34; // wrap this much of the prey -> commit to digest
const DIGEST_RATE = 14; // prey pixels removed per frame while digesting

export interface CpmCombatOptions {
  /** Kind of the attacking cell (its adhesion to prey is modulated while wrapping).
   *  In M1 the controlled cell is always this kind; autonomous multi-attacker
   *  engulfing is a later milestone. */
  playerKind: number;
  enemyKind: number;
  digestKind: number;
  /** The cell currently doing the engulfing — the controlled cell, not a special
   *  "player". */
  getAttackerId: () => number;
  /** A prey just became internalized and was converted to the digest kind. */
  onConsumeStart?: (id: number) => void;
  /** A prey finished digesting, at its last world position. */
  onDigested?: (wx: number, wy: number) => void;
}

export class CpmCombat {
  private grabbedId: number | null = null;
  private readonly digesting = new Set<number>();
  nutrients = 0;

  constructor(
    private readonly sim: CpmSimulation,
    private readonly opts: CpmCombatOptions
  ) {}

  get engulfing(): boolean {
    return this.grabbedId !== null;
  }
  get digestingCount(): number {
    return this.digesting.size;
  }

  /** True for prey combat owns (being wrapped or digested) — the rules layer
   *  must not also judge/kill them. */
  isConsuming(id: number): boolean {
    return id === this.grabbedId || this.digesting.has(id);
  }

  update(attacking: boolean): void {
    // Digestion proceeds independently of holding the button: once internalized
    // the prey is committed (its kind has volume target 0, so it can't regrow).
    this.processDigesting();

    const attackerId = this.opts.getAttackerId();
    const pc = this.sim.centroidLattice(attackerId);
    if (!attacking || !pc) {
      this.release();
      return;
    }

    // Wrapping needs active protrusion + sticky host<->prey adhesion.
    this.sim.setKindActive(this.opts.playerKind, true);

    if (this.grabbedId === null || !this.sim.getCell(this.grabbedId)) {
      this.grabbedId = this.findPrey(pc);
      if (this.grabbedId !== null) {
        this.sim.setKindAdhesion(this.opts.playerKind, this.opts.enemyKind, ENGULF_J);
      }
    }

    if (this.grabbedId !== null) {
      const ec = this.sim.centroidLattice(this.grabbedId);
      if (!ec) {
        this.release();
        return;
      }
      this.sim.steerCell(this.grabbedId, pc.x, pc.y, GRAB_LAMBDA_SCALE);
      // Once substantially wrapped, internalize: convert to the inert digest
      // kind (volume target 0 -> no regrowth) and hand off to digestion.
      if (this.sim.engulfedFraction(this.grabbedId, attackerId) >= CONSUME_FRACTION) {
        const id = this.grabbedId;
        this.sim.setCellKind(id, this.opts.digestKind);
        this.digesting.add(id);
        this.opts.onConsumeStart?.(id);
        this.grabbedId = null;
        this.sim.setKindAdhesion(this.opts.playerKind, this.opts.enemyKind, DEFAULT_J);
      }
    }
  }

  private processDigesting(): void {
    for (const id of [...this.digesting]) {
      const c = this.sim.centroidLattice(id);
      const remaining = this.sim.shrinkCell(id, DIGEST_RATE);
      if (remaining <= 0) {
        this.digesting.delete(id);
        this.nutrients++;
        if (c) {
          const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
          this.opts.onDigested?.(wx, wy);
        }
      }
    }
  }

  private findPrey(pc: { x: number; y: number }): number | null {
    let best: number | null = null;
    let bestD = GRAB_RANGE;
    for (const rec of this.sim.getCells()) {
      if (rec.kind !== this.opts.enemyKind) continue;
      const c = this.sim.centroidLattice(rec.id);
      if (!c) continue;
      const d = Math.hypot(c.x - pc.x, c.y - pc.y);
      if (d < bestD) {
        bestD = d;
        best = rec.id;
      }
    }
    return best;
  }

  private release(): void {
    if (this.grabbedId !== null) {
      this.grabbedId = null;
      this.sim.setKindAdhesion(this.opts.playerKind, this.opts.enemyKind, DEFAULT_J);
    }
  }
}
