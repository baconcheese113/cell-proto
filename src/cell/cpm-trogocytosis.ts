// CpmTrogocytosis — the membrane-ripping combat verb (the foil to engulf). Carrion-style
// GRAB then REND: holding the grab button extends the player's own membrane toward the
// cursor (a real, mass-conserving CPM protrusion). When it TOUCHES a hostile cell it GRABS
// it — sticky adhesion + reeling the cell onto the membrane so it's held and dragged (it
// does NOT die on contact). Then THRASHING the cursor while gripping tears chunks off it
// (CpmSimulation.tearChunkToward via the `rip` callback), rending it apart over a few
// motions until it lyses. Holding still just holds the prey; you must actively rip.
//
// Owns no pixel surgery/debris bookkeeping (that's world-sim's `ripFragment`); it drives the
// protrusion + adhesion + hold, and decides WHEN/WHAT to tear.

import type { CpmSimulation } from "./cpm-simulation";

export interface TrogOptions {
  /** Kind of the attacking (controlled) cell — its adhesion to the target is lowered while
   *  gripping so the reaching membrane sticks, and its protrusion (Act) is switched on. */
  playerKind: number;
  /** The cell currently doing the ripping (the controlled cell). */
  getAttackerId: () => number;
  /** Whether a cell is a valid rip target (team-hostility). Excludes self/ally/neutral/debris. */
  isHostile: (cellId: number) => boolean;
  /** Perform one tear (world-sim's ripFragment): move a chunk of `targetId`'s membrane
   *  nearest (towardLX,towardLY) into conserved, fading debris. */
  rip: (targetId: number, towardLX: number, towardLY: number, count: number) => void;
  /** Called when a prey is first GRABBED — world-sim converts it to the immobile,
   *  non-healing GRIPPED kind so it's held and can actually be rent apart. */
  onGrab: (targetId: number) => void;
  /** Called when a still-living prey is RELEASED (grip let go) — world-sim restores it. */
  onRelease: (targetId: number) => void;
}

const REACH = 48; // lattice px the protrusion reaches toward the cursor (a short pseudopod)
const TOUCH_MARGIN = 4; // lattice px slack on the membrane-contact test for grabbing
const EXTEND_LAMBDA = 1.7; // how hard the membrane is driven toward the cursor while held
const ADHERE_J = 12; // sticky attacker<->prey while gripping — holds it, but NOT so low the
                     // player wraps/absorbs it (engulf uses ~5); the prey stays a distinct blob
const DEFAULT_J = 22; // restored when not gripping
const GRAB_PULL = 0.3; // reel the gripped cell onto the tentacle (too hard crushes it, too soft loses it)
const GRAB_SETTLE_MS = 160; // GRAB first: no tearing for this long after latching (so a mere
                            // touch doesn't insta-rip — you feel the grab land before you rend)
const TEAR_SPEED = 360; // cursor world px/sec while gripping that counts as THRASHING (tearing)
const TEAR_INTERVAL_MS = 150; // one chunk torn per this interval while thrashing
const RIP_COUNT = 14; // chunk per tear — several thrashes rend a small cell apart (dynamic)

export class CpmTrogocytosis {
  private grabbedId: number | null = null;
  private grabbedKind = 0;
  private holdTarget = 0; // the size the grip HOLDS the prey at — set at grab, lowered ONLY
                          // by tears (never follows a momentary squeeze down), so the turgor
                          // resists crushing yet the prey can't heal back up between tears
  private settleMs = 0; // grab-settle countdown (no tearing until <= 0)
  private tearCdMs = 0; // inter-tear interval countdown
  private wasHolding = false;
  status: "idle" | "reaching" | "gripping" | "tearing" = "idle";

  constructor(
    private readonly sim: CpmSimulation,
    private readonly opts: TrogOptions
  ) {}

  get latched(): boolean {
    return this.grabbedId !== null;
  }

  /** Drive one tick. `holding` = grab button; (cursorLX,cursorLY) = lattice cursor;
   *  `cursorSpeed` = pointer speed in world px/sec (thrash detection); `dtMs` = tick. */
  update(holding: boolean, cursorLX: number, cursorLY: number, cursorSpeed: number, dtMs: number): void {
    if (this.tearCdMs > 0) this.tearCdMs -= dtMs;

    const id = this.opts.getAttackerId();
    const pc = this.sim.centroidLattice(id);
    if (!holding || !pc) {
      if (this.wasHolding) this.release();
      this.wasHolding = false;
      this.status = "idle";
      return;
    }
    this.wasHolding = true;

    // EXTEND: drive the player's membrane toward the cursor (short reach). Real CPM
    // protrusion — mass-conserving (the cell flows toward the cursor, it doesn't grow).
    const tip = this.clampReach(pc.x, pc.y, cursorLX, cursorLY);
    this.sim.setKindActive(this.opts.playerKind, true);
    this.sim.steerCell(id, tip.x, tip.y, EXTEND_LAMBDA);
    this.status = "reaching";

    // GRAB: latch onto a hostile cell the membrane is actually TOUCHING (not merely near),
    // starting a grab-settle so the touch itself doesn't tear.
    if (this.grabbedId === null || !this.sim.getCell(this.grabbedId) || !this.opts.isHostile(this.grabbedId)) {
      if (this.grabbedId !== null && this.sim.getCell(this.grabbedId)) this.opts.onRelease(this.grabbedId);
      this.dropAdhesion();
      this.grabbedId = this.findTouching(pc.x, pc.y, this.radiusOf(pc.pixels));
      if (this.grabbedId !== null) {
        this.opts.onGrab(this.grabbedId); // -> GRIPPED kind (immobile, non-healing)
        this.grabbedKind = this.sim.getCell(this.grabbedId)?.kind ?? 0;
        if (this.grabbedKind) this.sim.setKindAdhesion(this.opts.playerKind, this.grabbedKind, ADHERE_J);
        this.settleMs = GRAB_SETTLE_MS;
        const gc = this.sim.centroidLattice(this.grabbedId);
        this.holdTarget = gc ? gc.pixels : 69; // hold it at its grab-time size
      }
    }
    if (this.grabbedId === null) return;
    this.status = "gripping";

    // HOLD its size: keep the gripped kind's volume target at holdTarget (grab-time size,
    // lowered only by tears) so the turgor RESISTS being crushed but never heals back up.
    this.sim.setKindVolumeTarget(this.grabbedKind, this.holdTarget);

    // HOLD in place: reel the gripped cell onto the tentacle (runs AFTER behavior, so it
    // overrides the prey's flee — it's caught and dragged with you).
    this.sim.steerCell(this.grabbedId, pc.x, pc.y, GRAB_PULL);
    if (this.settleMs > 0) this.settleMs -= dtMs;

    // REND: once the grab has landed, THRASHING (moving the cursor) tears a chunk off the
    // gripped side toward the attacker, on an interval — rip it apart over a few motions.
    if (this.settleMs <= 0 && cursorSpeed >= TEAR_SPEED && this.tearCdMs <= 0) {
      this.opts.rip(this.grabbedId, pc.x, pc.y, RIP_COUNT);
      this.tearCdMs = TEAR_INTERVAL_MS;
      this.status = "tearing";
      // Keep gripping while it lives (tear again); release only once it's dead.
      if (!this.sim.getCell(this.grabbedId)) {
        this.dropAdhesion();
        this.grabbedId = null;
      } else {
        // Lower the hold target to the POST-tear size so the tear STICKS (no regrow).
        const after = this.sim.centroidLattice(this.grabbedId);
        if (after) this.holdTarget = Math.min(this.holdTarget, after.pixels);
      }
    }
  }

  /** The nearest hostile cell whose membrane is in CONTACT with the attacker. */
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
    if (this.grabbedKind) {
      this.sim.setKindAdhesion(this.opts.playerKind, this.grabbedKind, DEFAULT_J);
      this.grabbedKind = 0;
    }
  }

  private release(): void {
    if (this.grabbedId !== null && this.sim.getCell(this.grabbedId)) {
      this.opts.onRelease(this.grabbedId); // a living prey recovers when you let go
    }
    this.dropAdhesion();
    this.grabbedId = null;
    this.settleMs = 0;
  }
}
