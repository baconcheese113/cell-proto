// cpm-vessel.ts — the blood-vessel WORLD geometry: a closed-loop centerline in
// world space that the player and cells flow around (and return to start). Pure
// geometry, no CPM/Phaser — the scene uses it to (1) classify world points as
// LUMEN (open fluid where cells flow) / LINING (endothelial cells) / TISSUE (the
// space beyond), (2) get the CURRENT direction (the path tangent) for the pump,
// and (3) generate the world-space SLOTS where lining + tissue cells are placed
// and maintained as the simulation bubble streams along the loop.
//
// The loop is a wobbly circle: closed (so you come back to where you began),
// winding (harmonic wobble = gentle turns). Node-testable.

export interface VesselConfig {
  /** Loop base radius (world px). Large -> a long journey around. */
  radius: number;
  /** Wobble amplitude (world px) + integer harmonic (keeps the loop closed). */
  wobbleAmp: number;
  wobbleK: number;
  /** Half-width of the open lumen (world px). */
  lumenR: number;
  /** Width of the endothelial lining band (world px). */
  liningW: number;
  /** Width of the tissue band beyond the lining (world px). */
  tissueW: number;
  /** Approx wall-cell radius (world px). Lining cells are seeded at least this far
   *  outside the lumen so when they grow their inner edge sits AT the lumen wall,
   *  not inside it (otherwise the growing wall seals the passage). */
  liningInset: number;
}

// Dimensions are WORLD px. With worldPerPixel ~5 a cell of radius ~20 lattice px
// is ~100 world px, so lumenR ~260 leaves room for the player + a few cells
// abreast. radius is large (a long loop = a real journey before you return).
export const DEFAULT_VESSEL: VesselConfig = {
  radius: 2200,
  wobbleAmp: 300,
  wobbleK: 3,
  // A WIDE open channel (~680 world px lumen): the player (~200 across) plus a few
  // cells abreast with real room to maneuver, not a jam. (Was 200 — too narrow.)
  lumenR: 340,
  liningW: 200,
  tissueW: 120,
  // Larger -> fewer, bigger wall cells (each is a full CPM cell when promoted, so
  // fewer = cheaper + still a continuous seal). ~ endothelial cell radius in world px.
  liningInset: 110,
};

export type Region = "lumen" | "lining" | "tissue" | "outside";

export class CpmVessel {
  readonly cfg: VesselConfig;
  /** Loop centre, chosen so the start point P(0) sits at world (0,0). */
  private readonly cx: number;
  private readonly cy: number;

  constructor(cfg: VesselConfig = DEFAULT_VESSEL) {
    this.cfg = cfg;
    // P(0) = centre + (radius + wobble(0)) * (1, 0); wobble(0)=0 -> centre.x = -radius.
    this.cx = -cfg.radius;
    this.cy = 0;
  }

  private wobble(t: number): number {
    return this.cfg.wobbleAmp * Math.sin(this.cfg.wobbleK * t);
  }

  /** Centerline point at parameter t in [0, 2*PI). */
  pathPoint(t: number): { x: number; y: number } {
    const r = this.cfg.radius + this.wobble(t);
    return { x: this.cx + r * Math.cos(t), y: this.cy + r * Math.sin(t) };
  }

  /** Unit tangent (direction of flow) at t, in the +t (downstream) direction. */
  tangent(t: number): { x: number; y: number } {
    // d/dt of (cx + r(t)cos t, cy + r(t)sin t), r(t)=R+wobble.
    const r = this.cfg.radius + this.wobble(t);
    const dr = this.cfg.wobbleAmp * this.cfg.wobbleK * Math.cos(this.cfg.wobbleK * t);
    const dx = dr * Math.cos(t) - r * Math.sin(t);
    const dy = dr * Math.sin(t) + r * Math.cos(t);
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  }

  /** Nearest parameter t to a world point, searched over the whole loop (coarse)
   *  or, if `aroundT`/`window` given, only a local arc (cheap — all active cells
   *  sit near the player's arc). Returns t and the distance to the centerline. */
  nearestT(
    wx: number,
    wy: number,
    aroundT?: number,
    window = Math.PI / 6
  ): { t: number; dist: number } {
    const TWO_PI = Math.PI * 2;
    let lo = 0;
    let hi = TWO_PI;
    let steps = 240;
    if (aroundT !== undefined) {
      lo = aroundT - window;
      hi = aroundT + window;
      steps = 60;
    }
    let bestT = lo;
    let bestD = Infinity;
    for (let i = 0; i <= steps; i++) {
      const t = lo + ((hi - lo) * i) / steps;
      const p = this.pathPoint(t);
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
    // Normalize t into [0, 2*PI).
    let nt = bestT % TWO_PI;
    if (nt < 0) nt += TWO_PI;
    return { t: nt, dist: bestD };
  }

  /** Flow (current) direction at a world point — the tangent at the nearest t. */
  flowDirAt(wx: number, wy: number, aroundT?: number): { x: number; y: number } {
    return this.tangent(this.nearestT(wx, wy, aroundT).t);
  }

  /** Classify a world point by its distance to the centerline. */
  classify(wx: number, wy: number, aroundT?: number): { region: Region; dist: number } {
    const { dist } = this.nearestT(wx, wy, aroundT);
    const { lumenR, liningW, tissueW } = this.cfg;
    let region: Region;
    if (dist <= lumenR) region = "lumen";
    else if (dist <= lumenR + liningW) region = "lining";
    else if (dist <= lumenR + liningW + tissueW) region = "tissue";
    else region = "outside";
    return { region, dist };
  }

  /** Generate the world-space cell SLOTS (lining + tissue) for the arc spanning
   *  [centerT - span, centerT + span], at roughly `spacing`-world-px intervals
   *  along the path, offset perpendicular to the path on both walls. The scene
   *  fills any empty slot with the appropriate cell and lets streaming demote
   *  ones that fall behind. */
  slots(
    centerT: number,
    span: number,
    spacing: number
  ): Array<{ x: number; y: number; role: "lining" | "tissue" }> {
    const out: Array<{ x: number; y: number; role: "lining" | "tissue" }> = [];
    const { lumenR, liningW, tissueW, liningInset, radius } = this.cfg;

    // The rows to lay on each wall (perpendicular offsets from the centerline).
    const rows: Array<{ off: number; role: "lining" | "tissue" }> = [];
    for (let off = lumenR + liningInset; off < lumenR + liningW; off += liningInset * 1.25) {
      rows.push({ off, role: "lining" });
    }
    rows.push({ off: lumenR + liningW + tissueW * 0.5, role: "tissue" });

    // Walk t finely (fine enough for the OUTERMOST row's larger radius) and place a
    // cell in each (side,row) only when it's >= `spacing` world px from the last cell
    // placed in THAT row. This spaces every row evenly regardless of its radius —
    // outer rows (longer arc) get proportionally more cells, so no gaps on the outer
    // edge of curves (and no clumping on the inner edge).
    const outerR = radius + lumenR + liningW + tissueW;
    const dtFine = (spacing * 0.5) / Math.max(1, outerR);
    const sp2 = spacing * spacing;
    const last = new Map<number, { x: number; y: number }>();
    for (let t = centerT - span; t <= centerT + span; t += dtFine) {
      const p = this.pathPoint(t);
      const tan = this.tangent(t);
      const nx = -tan.y;
      const ny = tan.x;
      for (const side of [1, -1]) {
        for (let ri = 0; ri < rows.length; ri++) {
          const off = rows[ri].off;
          const x = p.x + nx * side * off;
          const y = p.y + ny * side * off;
          const key = (side + 1) * 100 + ri;
          const l = last.get(key);
          if (!l || (x - l.x) * (x - l.x) + (y - l.y) * (y - l.y) >= sp2) {
            out.push({ x, y, role: rows[ri].role });
            last.set(key, { x, y });
          }
        }
      }
    }
    return out;
  }

  /** Cheap radial confinement toward the lumen, for keeping wandering AGENT-tier
   *  traffic inside the vessel without a per-agent nearestT search. The path point at
   *  polar angle `t` from the loop centre sits at radius `radius + wobble(t)`, and the
   *  parametrization's t IS that polar angle — so a point's polar distance from the
   *  centre maps directly onto the lumen band. Returns a unit-ish inward/outward
   *  correction and how far (world px) the point lies outside the lumen (0 if inside). */
  confinement(x: number, y: number): { nx: number; ny: number; over: number } {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const dist = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const rLocal = this.cfg.radius + this.wobble(ang);
    const inner = rLocal - this.cfg.lumenR;
    const outer = rLocal + this.cfg.lumenR;
    if (dist > outer) {
      // too far out -> push inward (toward centre)
      return { nx: -dx / dist, ny: -dy / dist, over: dist - outer };
    }
    if (dist < inner) {
      // too far in -> push outward (away from centre)
      return { nx: dx / dist, ny: dy / dist, over: inner - dist };
    }
    return { nx: 0, ny: 0, over: 0 };
  }
}
