// CpmBigOrganelles — owns the cell's BIG organelles (the nucleus first; the same
// machinery takes a second type). Each is a CpmSoftBody positioned by a
// cytoskeletal-force target (the host's deep center, biased slightly to the rear
// while steering — actin cap / dynein), contained + deformed by the membrane, and
// coupled to CPM by feeding the union of their footprints to the sim's footprint
// constraint. It accumulates CONFINEMENT STRESS from sustained footprint exposure
// / extreme ovalness and reports a RUPTURE when a body's stress saturates — the
// "you squeezed too hard" death payoff. Soft bodies are pure; this is the glue.

import {
  CpmSoftBody,
  DEFAULT_NUCLEUS_SOFT_BODY,
  type SoftBodyConfig,
} from "./cpm-soft-body";
import type { CpmSimulation } from "./cpm-simulation";
import type { CellId } from "../vendor/artistoo";

export interface BigOrganelle {
  body: CpmSoftBody;
  type: string;
  color: number;
  /** Accumulated confinement stress 0..1; 1 = ruptured. */
  stress: number;
}

/** Footprint exposure above this (sustained) raises stress. */
const EXPOSE_THRESHOLD = 0.12;
/** Ovalness above this also raises stress (over-squeezed even if still covered). */
const OVAL_THRESHOLD = 2.2;
/** Stress per frame while over-confined / recovering otherwise. */
const STRESS_RAMP = 0.04;
const STRESS_RECOVER = 0.02;
/** How far behind the heading the target is nudged while steering (px). */
const REAR_BIAS = 3;

export class CpmBigOrganelles {
  readonly organelles: BigOrganelle[] = [];
  private ruptured: BigOrganelle | null = null;

  constructor(
    private readonly sim: CpmSimulation,
    private readonly getHostId: () => CellId,
    private readonly footprintLambda = 30
  ) {}

  add(
    type: string,
    color: number,
    cx: number,
    cy: number,
    cfg: SoftBodyConfig = DEFAULT_NUCLEUS_SOFT_BODY
  ): BigOrganelle {
    const o: BigOrganelle = { body: new CpmSoftBody(cx, cy, cfg), type, color, stress: 0 };
    this.organelles.push(o);
    return o;
  }

  clear(): void {
    this.organelles.length = 0;
    this.ruptured = null;
    this.sim.clearBigOrganelleFootprint();
  }

  /** Step every body, refresh the footprint coupling, accumulate stress.
   *  `steerDir` is the direction the player is steering (for the rear bias), or
   *  null at rest. `shiftX/shiftY` come from streamAround so the bodies ride
   *  lattice recentering. */
  update(steerDir: { x: number; y: number } | null, shiftX: number, shiftY: number): void {
    const host = this.getHostId();
    const c = this.sim.centroidLattice(host);
    if (!c) {
      this.sim.clearBigOrganelleFootprint();
      return;
    }
    const inside = (x: number, y: number) => this.sim.ownerAtLattice(x, y) === host;

    // Target = deep center, nudged to the rear while steering (organic trailing).
    let tx = c.x;
    let ty = c.y;
    if (steerDir) {
      const d = Math.hypot(steerDir.x, steerDir.y) || 1;
      tx -= (steerDir.x / d) * REAR_BIAS;
      ty -= (steerDir.y / d) * REAR_BIAS;
    }
    const target = { x: tx, y: ty };

    const footprintCells: Array<[number, number]> = [];
    for (const o of this.organelles) {
      o.body.shift(shiftX, shiftY);
      o.body.step(target, inside);
      for (const cell of o.body.footprint()) footprintCells.push(cell);

      const exposed = o.body.exposedFraction(inside);
      const oval = o.body.ovalness();
      if (exposed > EXPOSE_THRESHOLD || oval > OVAL_THRESHOLD) {
        o.stress = Math.min(1, o.stress + STRESS_RAMP);
      } else {
        o.stress = Math.max(0, o.stress - STRESS_RECOVER);
      }
      if (o.stress >= 1 && !this.ruptured) this.ruptured = o;
    }

    if (footprintCells.length > 0) {
      this.sim.setBigOrganelleFootprint(host, footprintCells, this.footprintLambda);
    } else {
      this.sim.clearBigOrganelleFootprint();
    }
  }

  /** Highest stress across all big organelles (for the HUD warning ramp). */
  maxStress(): number {
    let m = 0;
    for (const o of this.organelles) if (o.stress > m) m = o.stress;
    return m;
  }

  /** If a body ruptured this frame, return + remove it (one-shot); else null. */
  consumeRupture(): BigOrganelle | null {
    const r = this.ruptured;
    if (!r) return null;
    this.ruptured = null;
    const i = this.organelles.indexOf(r);
    if (i >= 0) this.organelles.splice(i, 1);
    return r;
  }
}
