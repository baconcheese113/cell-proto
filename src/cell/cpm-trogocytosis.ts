// CpmTrogocytosis — the membrane-ripping combat verb (the foil to engulf). Holding the
// grab button EXTENDS the player's own membrane toward the cursor (a real, mass-conserving
// CPM protrusion — a short pseudopod, not a drawn line); when that membrane actually
// TOUCHES a hostile cell it ADHERES to it; then a mouse FLICK tears a big chunk of that
// cell's membrane off (CpmSimulation.tearChunkToward, via the `rip` callback), which is
// normally fatal. You must be in CONTACT to rip, so a mere click never tears anything.
//
// Owns no pixel surgery/debris bookkeeping (that's world-sim's `ripFragment`); it only
// drives the protrusion + adhesion and decides WHEN/WHAT to rip.

import type { CpmSimulation } from "./cpm-simulation";

export interface TrogOptions {
  /** Kind of the attacking (controlled) cell — its adhesion to the target is lowered while
   *  latched so the reaching membrane sticks, and its protrusion (Act) is switched on. */
  playerKind: number;
  /** The cell currently doing the ripping (the controlled cell). */
  getAttackerId: () => number;
  /** Whether a cell is a valid rip target (team-hostility). Excludes self/ally/neutral/debris. */
  isHostile: (cellId: number) => boolean;
  /** Perform the actual tear (world-sim's ripFragment): move a chunk of `targetId`'s
   *  membrane nearest (towardLX,towardLY) into conserved, fading debris. */
  rip: (targetId: number, towardLX: number, towardLY: number, count: number) => void;
}

const REACH = 48; // lattice px the protrusion reaches toward the cursor (a short pseudopod)
const TOUCH_MARGIN = 4; // lattice px slack on the membrane-contact test for latching
const EXTEND_LAMBDA = 1.7; // how hard the membrane is driven toward the cursor while held
const ADHERE_J = 5; // very sticky attacker<->target while latched (mirrors engulf)
const DEFAULT_J = 22; // restored when not latched
const FLICK_SPEED = 850; // cursor world px/sec that counts as a rip flick ("not that fast")
const RIP_COUNT = 42; // membrane px torn per flick — a BIG chunk, so the first rip usually kills
const FLICK_COOLDOWN_MS = 220; // min gap between rips so one flick = one tear

export class CpmTrogocytosis {
  private adheredId: number | null = null;
  private adheredKind = 0;
  private cooldownMs = 0;
  private wasHolding = false;
  status: "idle" | "reaching" | "latched" | "ripped" = "idle";

  constructor(
    private readonly sim: CpmSimulation,
    private readonly opts: TrogOptions
  ) {}

  get latched(): boolean {
    return this.adheredId !== null;
  }

  /** Drive one tick. `holding` = grab button; (cursorLX,cursorLY) = lattice cursor;
   *  `cursorSpeed` = pointer speed in world px/sec (flick detection); `dtMs` = tick. */
  update(holding: boolean, cursorLX: number, cursorLY: number, cursorSpeed: number, dtMs: number): void {
    if (this.cooldownMs > 0) this.cooldownMs -= dtMs;

    const id = this.opts.getAttackerId();
    const pc = this.sim.centroidLattice(id);
    if (!holding || !pc) {
      if (this.wasHolding) this.release();
      this.wasHolding = false;
      this.status = "idle";
      return;
    }
    this.wasHolding = true;

    // EXTEND: drive the player's membrane toward the cursor (clamped to a short reach) — a
    // real CPM protrusion, mass-conserving by construction (the cell flows, it doesn't grow).
    const tip = this.clampReach(pc.x, pc.y, cursorLX, cursorLY);
    this.sim.setKindActive(this.opts.playerKind, true);
    this.sim.steerCell(id, tip.x, tip.y, EXTEND_LAMBDA);
    this.status = "reaching";

    // ADHERE: latch onto a hostile cell the protrusion is actually TOUCHING (membranes in
    // contact), not merely one that's near the cursor — so you can only rip what you reach.
    if (this.adheredId === null || !this.sim.getCell(this.adheredId) || !this.opts.isHostile(this.adheredId)) {
      this.adheredId = this.findTouching(pc.x, pc.y, this.radiusOf(pc.pixels));
    }
    if (this.adheredId === null) return;

    if (this.adheredKind === 0) {
      this.adheredKind = this.sim.getCell(this.adheredId)?.kind ?? 0;
      if (this.adheredKind) this.sim.setKindAdhesion(this.opts.playerKind, this.adheredKind, ADHERE_J);
    }
    this.status = "latched";

    // RIP: a flick while latched tears a big chunk off the gripped (near) side — toward the
    // attacker. A big chunk normally drops the cell below its lysis threshold -> it dies.
    if (cursorSpeed >= FLICK_SPEED && this.cooldownMs <= 0) {
      this.opts.rip(this.adheredId, pc.x, pc.y, RIP_COUNT);
      this.cooldownMs = FLICK_COOLDOWN_MS;
      this.status = "ripped";
      this.dropAdhesion();
      this.adheredId = null;
    }
  }

  /** The nearest hostile cell whose membrane is in CONTACT with the attacker (centroids
   *  within the sum of radii + a small margin). */
  private findTouching(px: number, py: number, rSelf: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (const rec of this.sim.getCells()) {
      if (!this.opts.isHostile(rec.id)) continue;
      const c = this.sim.centroidLattice(rec.id);
      if (!c) continue;
      const d = Math.hypot(c.x - px, c.y - py);
      if (d > rSelf + this.radiusOf(c.pixels) + TOUCH_MARGIN) continue; // not touching
      if (d < bestD) {
        bestD = d;
        best = rec.id;
      }
    }
    return best;
  }

  private radiusOf(pixels: number): number {
    return Math.sqrt(pixels / Math.PI);
  }

  /** Clamp the cursor to the protrusion's reach from the player. */
  private clampReach(px: number, py: number, cx: number, cy: number): { x: number; y: number } {
    const dx = cx - px, dy = cy - py;
    const d = Math.hypot(dx, dy);
    if (d <= REACH || d === 0) return { x: cx, y: cy };
    const k = REACH / d;
    return { x: px + dx * k, y: py + dy * k };
  }

  private dropAdhesion(): void {
    if (this.adheredKind) {
      this.sim.setKindAdhesion(this.opts.playerKind, this.adheredKind, DEFAULT_J);
      this.adheredKind = 0;
    }
  }

  private release(): void {
    this.dropAdhesion();
    this.adheredId = null;
  }
}
