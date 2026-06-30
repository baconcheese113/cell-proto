// CpmTrogocytosis — the membrane-ripping combat verb (the foil to engulf). Holding the
// grab button shoots a NARROW TENDRIL from the controlled cell toward the cursor; it
// reaches far and ATTACHES to the first hostile cell in range. While attached the tendril
// tip follows the cursor, so PULLING the cursor away from the grabbed cell stretches its
// membrane — pull past the stretch limit and a chunk TEARS OFF (CpmSimulation.tearChunkToward,
// surfaced via the `rip` callback). Keep pulling to peel the cell apart; let go to release.
//
// The rip fires on PULL DISTANCE (how far you've dragged the cursor past the cell), not on
// cursor speed — so you forcefully rip by reaching out and yanking, and a mere click never
// tears anything. This owns no pixel surgery (that's world-sim's `ripFragment`); it decides
// when/what to rip and exposes a `tendril` render state for the scene to draw.

import type { CpmSimulation } from "./cpm-simulation";

export interface TrogOptions {
  /** The cell currently doing the ripping (the controlled cell). */
  getAttackerId: () => number;
  /** Whether a cell is a valid rip target (team-hostility). Excludes self/ally/neutral/debris. */
  isHostile: (cellId: number) => boolean;
  /** Perform the actual tear (world-sim's ripFragment): move a chunk of `targetId`'s
   *  membrane nearest (towardLX,towardLY) into conserved, fading debris. */
  rip: (targetId: number, towardLX: number, towardLY: number, count: number) => void;
}

const MAX_REACH = 115; // lattice px the tendril can shoot/hold (≈800 world px — "pretty far")
const GRAB_RADIUS = 30; // how close (lattice px) a hostile centroid must be to the cast ray to grab
const PULL_SCALE = 0.22; // gentle reel of the grabbed cell toward the player (juice, not a drag)
const RIP_STRETCH = 26; // pull the cursor this far past the grabbed cell's centre -> a chunk tears
const RIP_COUNT = 22; // membrane pixels per tear
const RIP_COOLDOWN_MS = 170; // min gap between tears while you keep pulling

/** Render state for the tendril (lattice coords) — the scene projects + draws it. */
export interface TendrilState {
  fromLX: number; // base (player centroid)
  fromLY: number;
  toLX: number; // tip (cursor, clamped to reach)
  toLY: number;
  grabLX: number | null; // grabbed cell centre, or null while still reaching
  grabLY: number | null;
  taut: number; // 0..1 stretch toward the rip threshold (for colour/▒thickness)
}

export class CpmTrogocytosis {
  private grabbedId: number | null = null;
  private cooldownMs = 0;
  /** Current tendril to draw, or null when not grabbing. */
  tendril: TendrilState | null = null;
  status: "idle" | "reaching" | "latched" | "ripped" = "idle";

  constructor(
    private readonly sim: CpmSimulation,
    private readonly opts: TrogOptions
  ) {}

  get latched(): boolean {
    return this.grabbedId !== null;
  }

  /** Drive one tick. `holding` = grab button; (cursorLX,cursorLY) = lattice cursor; dtMs = tick. */
  update(holding: boolean, cursorLX: number, cursorLY: number, dtMs: number): void {
    if (this.cooldownMs > 0) this.cooldownMs -= dtMs;

    const id = this.opts.getAttackerId();
    const pc = this.sim.centroidLattice(id);
    if (!holding || !pc) {
      this.grabbedId = null;
      this.tendril = null;
      this.status = "idle";
      return;
    }

    const tip = this.clampReach(pc.x, pc.y, cursorLX, cursorLY);

    // (Re)acquire a target if we don't have a live hostile one.
    if (this.grabbedId === null || !this.sim.getCell(this.grabbedId) || !this.opts.isHostile(this.grabbedId)) {
      this.grabbedId = this.castForTarget(pc.x, pc.y, tip.x, tip.y);
    }

    if (this.grabbedId === null) {
      // Reaching: the tendril extends toward the cursor but hasn't found a cell yet.
      this.tendril = { fromLX: pc.x, fromLY: pc.y, toLX: tip.x, toLY: tip.y, grabLX: null, grabLY: null, taut: 0 };
      this.status = "reaching";
      return;
    }

    const ec = this.sim.centroidLattice(this.grabbedId);
    if (!ec) {
      this.grabbedId = null;
      return;
    }

    // Gently reel the grabbed cell toward the player so the grab reads as a real tug.
    this.sim.steerCell(this.grabbedId, pc.x, pc.y, PULL_SCALE);

    // Stretch = how far the cursor is pulled from the grabbed cell's body.
    const stretch = Math.hypot(tip.x - ec.x, tip.y - ec.y);
    this.tendril = {
      fromLX: pc.x, fromLY: pc.y,
      toLX: tip.x, toLY: tip.y,
      grabLX: ec.x, grabLY: ec.y,
      taut: Math.min(1, stretch / RIP_STRETCH),
    };
    this.status = "latched";

    // Forceful pull past the limit tears a chunk off the near (tendril) side, toward the player.
    if (stretch >= RIP_STRETCH && this.cooldownMs <= 0) {
      this.opts.rip(this.grabbedId, pc.x, pc.y, RIP_COUNT);
      this.cooldownMs = RIP_COOLDOWN_MS;
      this.status = "ripped";
    }
  }

  /** Clamp the cursor to the tendril's max reach from the player. */
  private clampReach(px: number, py: number, cx: number, cy: number): { x: number; y: number } {
    const dx = cx - px, dy = cy - py;
    const d = Math.hypot(dx, dy);
    if (d <= MAX_REACH || d === 0) return { x: cx, y: cy };
    const k = MAX_REACH / d;
    return { x: px + dx * k, y: py + dy * k };
  }

  /** Grab the hostile cell nearest the cast ray (player→tip): closest to the tip, within
   *  reach of the player and near the line we're pointing along. */
  private castForTarget(px: number, py: number, tx: number, ty: number): number | null {
    const dirX = tx - px, dirY = ty - py;
    const len = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / len, uy = dirY / len;
    let best: number | null = null;
    let bestProj = Infinity;
    for (const rec of this.sim.getCells()) {
      if (!this.opts.isHostile(rec.id)) continue;
      const c = this.sim.centroidLattice(rec.id);
      if (!c) continue;
      const rx = c.x - px, ry = c.y - py;
      const proj = rx * ux + ry * uy; // distance along the cast ray
      if (proj < 0 || proj > MAX_REACH) continue; // behind the player or out of reach
      const perp = Math.abs(rx * uy - ry * ux); // distance off the ray
      if (perp > GRAB_RADIUS) continue;
      // Prefer the nearest cell ALONG the cast (so the tendril grabs the first thing it hits).
      if (proj < bestProj) {
        bestProj = proj;
        best = rec.id;
      }
    }
    return best;
  }
}
