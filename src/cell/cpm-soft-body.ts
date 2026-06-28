// CpmSoftBody — a controlled, area-preserving deformable body for a BIG organelle
// (e.g. the nucleus). It is NOT a CPM cell. It is a ring of mass-spring nodes
// that (1) is rigidly pulled toward a cytoskeletal-force TARGET so it recenters on
// its own, (2) holds a smooth round rest shape and its enclosed area, and (3) is
// squished by the surrounding membrane via a CONTAINMENT predicate — so it oozes
// oval through a tight gap. It reports its footprint and how much of that
// footprint is currently exposed (outside the host), which drives the squeeze
// bottleneck and the confinement-rupture death mechanic.
//
// Pure: it knows nothing about CPM. The host passes `inside(x,y)` (true where its
// cytoplasm currently is). Node-testable.

export interface SoftBodyConfig {
  /** Ring resolution (boundary node count). */
  nodeCount: number;
  /** Rest radius in lattice px (sets target area = pi*r^2). */
  restRadius: number;
  /** Cytoskeletal positioning spring: how hard the whole ring is pulled toward
   *  its target each step (the "recenter" force / baseline cytoskeleton). */
  posStiffness: number;
  /** Restoring force toward a smooth circle of restRadius (shape memory). */
  shapeStiffness: number;
  /** Area-preservation strength (incompressible-ish nucleus). */
  areaStiffness: number;
  /** Velocity damping per step (0..1; lower = more viscous/suspended). */
  damping: number;
  /** Per-step speed cap (lattice px) so it never flies. */
  maxSpeed: number;
  /** Inward push on a node that's outside the host cytoplasm. SOFT (a force, not
   *  a teleport) so the body RESISTS being squished: area preservation balances
   *  it, keeping a substantial footprint (the squeeze BOTTLENECK) and letting the
   *  footprint poke out when over-compressed (the rupture EXPOSURE signal). */
  containmentStiffness: number;
}

export const DEFAULT_NUCLEUS_SOFT_BODY: SoftBodyConfig = {
  nodeCount: 16,
  // ~5 lattice px (area ~78) keeps the nucleus ~14% of the smaller 560px player —
  // a coverable footprint (bottleneck/rupture still works), not a body-filling blob.
  restRadius: 5,
  posStiffness: 0.08,
  shapeStiffness: 0.25,
  areaStiffness: 0.2,
  damping: 0.6,
  maxSpeed: 1.5,
  containmentStiffness: 0.6,
};

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class CpmSoftBody {
  readonly nodes: Node[] = [];
  readonly area0: number;
  readonly cfg: SoftBodyConfig;

  constructor(cx: number, cy: number, cfg: SoftBodyConfig) {
    this.cfg = cfg;
    const n = cfg.nodeCount;
    const r = cfg.restRadius;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.nodes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0 });
    }
    this.area0 = Math.PI * r * r;
  }

  center(): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const nd of this.nodes) {
      sx += nd.x;
      sy += nd.y;
    }
    const n = this.nodes.length;
    return { x: sx / n, y: sy / n };
  }

  /** Enclosed polygon area (shoelace). */
  area(): number {
    const nd = this.nodes;
    const n = nd.length;
    let a = 0;
    for (let i = 0; i < n; i++) {
      const p = nd[i];
      const q = nd[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  step(target: { x: number; y: number }, inside: (x: number, y: number) => boolean): void {
    const cfg = this.cfg;
    const n = this.nodes.length;
    const c = this.center();

    // Position drive: rigid translation of the whole ring toward the target.
    const tdx = (target.x - c.x) * cfg.posStiffness;
    const tdy = (target.y - c.y) * cfg.posStiffness;

    // Area preservation: radial scale factor about the center toward area0.
    const area = this.area() || 1;
    const scale = Math.sqrt(this.area0 / area);

    for (let i = 0; i < n; i++) {
      const nd = this.nodes[i];
      const rx = nd.x - c.x;
      const ry = nd.y - c.y;
      const rl = Math.hypot(rx, ry) || 1;
      const ux = rx / rl;
      const uy = ry / rl;

      // Shape memory: pull toward a circle of restRadius along its radial.
      nd.vx += (c.x + ux * cfg.restRadius - nd.x) * cfg.shapeStiffness;
      nd.vy += (c.y + uy * cfg.restRadius - nd.y) * cfg.shapeStiffness;

      // Neighbor smoothing: pull toward the midpoint of its two ring neighbors.
      const prev = this.nodes[(i - 1 + n) % n];
      const next = this.nodes[(i + 1) % n];
      nd.vx += ((prev.x + next.x) / 2 - nd.x) * cfg.shapeStiffness * 0.3;
      nd.vy += ((prev.y + next.y) / 2 - nd.y) * cfg.shapeStiffness * 0.3;

      // Area preservation along the radial.
      nd.vx += (c.x + rx * scale - nd.x) * cfg.areaStiffness;
      nd.vy += (c.y + ry * scale - nd.y) * cfg.areaStiffness;

      // Position drive.
      nd.vx += tdx;
      nd.vy += tdy;

      // Soft containment: if this node is currently outside the host, push it
      // back toward the center. A FORCE (not a teleport), so area preservation
      // resists it — the body stays fat (bottleneck) and only over-compression
      // leaves nodes outside (exposure -> rupture).
      if (!inside(Math.round(nd.x), Math.round(nd.y))) {
        const inx = c.x - nd.x;
        const iny = c.y - nd.y;
        const il = Math.hypot(inx, iny) || 1;
        nd.vx += (inx / il) * cfg.containmentStiffness * cfg.maxSpeed;
        nd.vy += (iny / il) * cfg.containmentStiffness * cfg.maxSpeed;
      }
    }

    // Integrate with damping + speed cap.
    for (const nd of this.nodes) {
      nd.vx *= cfg.damping;
      nd.vy *= cfg.damping;
      const sp = Math.hypot(nd.vx, nd.vy);
      if (sp > cfg.maxSpeed) {
        nd.vx = (nd.vx / sp) * cfg.maxSpeed;
        nd.vy = (nd.vy / sp) * cfg.maxSpeed;
      }
      nd.x += nd.vx;
      nd.y += nd.vy;
    }
  }

  /** Rasterize the body polygon into footprint lattice cells (even-odd scanline). */
  footprint(): Array<[number, number]> {
    const nd = this.nodes;
    const n = nd.length;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of nd) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const out: Array<[number, number]> = [];
    const y0 = Math.floor(minY);
    const y1 = Math.ceil(maxY);
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = nd[i];
        const b = nd[(i + 1) % n];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const t = (y - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xl = Math.round(xs[k]);
        const xr = Math.round(xs[k + 1]);
        for (let x = xl; x <= xr; x++) out.push([x, y]);
      }
    }
    return out;
  }

  /** Fraction of the footprint NOT covered by host cytoplasm (0..1). */
  exposedFraction(inside: (x: number, y: number) => boolean): number {
    const fp = this.footprint();
    if (fp.length === 0) return 0;
    let exposed = 0;
    for (const [x, y] of fp) if (!inside(x, y)) exposed++;
    return exposed / fp.length;
  }

  /** Long-axis / short-axis bbox ratio (>= 1). The visible "ooze" stress cue. */
  ovalness(): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const nd of this.nodes) {
      if (nd.x < minX) minX = nd.x;
      if (nd.x > maxX) maxX = nd.x;
      if (nd.y < minY) minY = nd.y;
      if (nd.y > maxY) maxY = nd.y;
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    return Math.max(w, h) / Math.min(w, h);
  }

  /** Translate every node (call on lattice recentering so the body rides along). */
  shift(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    for (const nd of this.nodes) {
      nd.x += dx;
      nd.y += dy;
    }
  }
}
