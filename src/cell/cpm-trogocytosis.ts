// CpmTrogocytosis — the membrane-ripping combat verb (the foil to engulf). Holding the
// grab button extends a pseudopod toward the cursor (a strong directional reach); while
// extended it ADHERES to a hostile cell it touches; a quick mouse FLICK then tears a
// chunk of that cell's membrane off (CpmSimulation.tearChunkToward, surfaced here via the
// `rip` callback so this stays Phaser-free + sim-agnostic). The reach auto-retracts after
// MAX_EXTEND_MS or on release — the skill is landing a flick inside the window.
//
// This owns NO pixel surgery or debris bookkeeping (that's world-sim's `ripFragment`); it
// only decides WHEN/WHAT to rip and drives the pseudopod + adhesion on the sim.

import type { CpmSimulation } from "./cpm-simulation";

export interface TrogOptions {
  /** Kind of the attacking (controlled) cell — its adhesion to the target is lowered
   *  while latched so the reaching membrane sticks. */
  playerKind: number;
  /** The cell currently doing the ripping (the controlled cell). */
  getAttackerId: () => number;
  /** Whether a cell is a valid rip target (T3 backs this with team-hostility; the spike
   *  uses "is a microbe"). Excludes self/debris/neutral. */
  isHostile: (cellId: number) => boolean;
  /** Perform the actual tear (world-sim's ripFragment): move a chunk of `targetId`'s
   *  membrane nearest (towardLX,towardLY) into conserved, fading debris. */
  rip: (targetId: number, towardLX: number, towardLY: number, count: number) => void;
}

const REACH = 40; // lattice px from the attacker centroid the pseudopod can grab within
const ADHERE_J = 5; // very sticky attacker<->target while latched (mirrors engulf)
const DEFAULT_J = 22; // restored when not latched
const FLICK_SPEED = 850; // cursor world px/sec that counts as a rip flick
const RIP_COUNT = 30; // membrane pixels torn per flick (lethal to a small cell)
const MAX_EXTEND_MS = 1500; // pseudopod stays out at most this long per hold
const FLICK_COOLDOWN_MS = 220; // min gap between rips so one flick = one tear

export class CpmTrogocytosis {
  private adheredId: number | null = null;
  private adheredKind = 0;
  private extendMsLeft = 0;
  private cooldownMs = 0;
  private wasHolding = false;
  /** Coarse state for the HUD/debug. */
  status: "idle" | "reaching" | "latched" | "ripped" | "spent" = "idle";

  constructor(
    private readonly sim: CpmSimulation,
    private readonly opts: TrogOptions
  ) {}

  get latched(): boolean {
    return this.adheredId !== null;
  }

  /** Drive one tick. `holding` = grab button; (cursorLX,cursorLY) = lattice cursor;
   *  `cursorSpeed` = pointer speed in world px/sec (for flick detection); `dtMs` = tick. */
  update(
    holding: boolean,
    cursorLX: number,
    cursorLY: number,
    cursorSpeed: number,
    dtMs: number
  ): void {
    if (this.cooldownMs > 0) this.cooldownMs -= dtMs;

    const id = this.opts.getAttackerId();
    const pc = this.sim.centroidLattice(id);
    if (!holding || !pc) {
      if (this.wasHolding) this.release();
      this.wasHolding = false;
      this.status = "idle";
      return;
    }

    if (!this.wasHolding) this.extendMsLeft = MAX_EXTEND_MS; // rising edge: open the window
    this.wasHolding = true;
    this.extendMsLeft -= dtMs;

    if (this.extendMsLeft <= 0) {
      // Window spent: retract the pseudopod + drop adhesion until the button is re-pressed.
      this.release();
      this.status = "spent";
      return;
    }

    // EXTEND: throw a protrusion toward the cursor (active membrane + strong attraction).
    this.sim.setKindActive(this.opts.playerKind, true);
    this.sim.steerCell(id, cursorLX, cursorLY, 1.6);
    this.status = "reaching";

    // ADHERE: grip the hostile cell nearest the cursor that's within the pseudopod's reach.
    if (this.adheredId === null || !this.sim.getCell(this.adheredId)) {
      this.adheredId = this.findTarget(pc.x, pc.y, cursorLX, cursorLY);
      if (this.adheredId !== null) {
        this.adheredKind = this.sim.getCell(this.adheredId)?.kind ?? 0;
        if (this.adheredKind) {
          this.sim.setKindAdhesion(this.opts.playerKind, this.adheredKind, ADHERE_J);
        }
      }
    }
    if (this.adheredId !== null) this.status = "latched";

    // RIP: a fast flick while latched tears a chunk off the gripped side (nearest the
    // attacker — that's the membrane the pseudopod is pulling).
    if (this.adheredId !== null && cursorSpeed >= FLICK_SPEED && this.cooldownMs <= 0) {
      this.opts.rip(this.adheredId, pc.x, pc.y, RIP_COUNT);
      this.cooldownMs = FLICK_COOLDOWN_MS;
      this.status = "ripped";
      // The target may have lysed; drop the grip so the next contact re-latches.
      this.dropAdhesion();
      this.adheredId = null;
    }
  }

  private findTarget(px: number, py: number, cx: number, cy: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (const rec of this.sim.getCells()) {
      if (!this.opts.isHostile(rec.id)) continue;
      const c = this.sim.centroidLattice(rec.id);
      if (!c) continue;
      if (Math.hypot(c.x - px, c.y - py) > REACH) continue; // out of the pseudopod's reach
      const dCursor = Math.hypot(c.x - cx, c.y - cy); // pick the one we're reaching toward
      if (dCursor < bestD) {
        bestD = dCursor;
        best = rec.id;
      }
    }
    return best;
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
    this.extendMsLeft = 0;
  }
}
