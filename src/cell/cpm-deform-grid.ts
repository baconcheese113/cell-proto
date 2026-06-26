// CpmDeformGrid — the cell's deforming interior grid for the MANY small
// organelles (ribosomes, vesicles, lysosomes; later factory machines). Each
// occupant holds an anchor in the cell's DEFORMING local frame (fractions of the
// bbox half-extents from sim.cellFrame), so it stretches and compresses WITH the
// cell automatically — round cell -> spread out, squeezed to a sliver -> packed
// into a thin strip. Each step it is (1) pulled toward its anchor by the baseline
// cytoskeleton, (2) softly spaced from its neighbors, and (3) kept inside the
// cytoplasm by containment — so under a squeeze they FLOW and REGROUP instead of
// clipping the wall or snapping. The grid can't break; it just re-lays.
//
// Pure: the host passes the current frame + an `inside(x,y)` predicate. The
// `compressed` field (how far an occupant sits from its ideal anchor) is the
// visible stress cue. Node-testable.

export interface Frame {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

export interface GridOccupant {
  type: string;
  color: number;
  radius: number;
  /** Anchor in frame fractions (roughly [-1.2, 1.2]). */
  fx: number;
  fy: number;
  /** Current lattice position. */
  x: number;
  y: number;
  /** 0..1 stress cue: how far it's pushed from its anchor right now. */
  compressed: number;
}

export interface DeformGridConfig {
  /** Spring toward the (deforming) anchor each step. */
  anchorStiffness: number;
  /** Desired clear gap between occupant edges (lattice px). */
  spacing: number;
  /** Mutual-spacing push strength. */
  spacingStiffness: number;
  /** Baseline cytoskeleton multiplier (0..1+; player-upgradeable later). */
  cytoskeleton: number;
}

export const DEFAULT_DEFORM_GRID: DeformGridConfig = {
  anchorStiffness: 0.15,
  spacing: 4,
  spacingStiffness: 0.1,
  cytoskeleton: 1,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class CpmDeformGrid {
  readonly occupants: GridOccupant[] = [];
  readonly cfg: DeformGridConfig;

  constructor(cfg: DeformGridConfig = DEFAULT_DEFORM_GRID) {
    this.cfg = cfg;
  }

  add(
    type: string,
    color: number,
    radius: number,
    frame: Frame,
    lx: number,
    ly: number
  ): GridOccupant {
    const fx = clamp((lx - frame.cx) / frame.halfW, -1.2, 1.2);
    const fy = clamp((ly - frame.cy) / frame.halfH, -1.2, 1.2);
    const o: GridOccupant = { type, color, radius, fx, fy, x: lx, y: ly, compressed: 0 };
    this.occupants.push(o);
    return o;
  }

  clear(): void {
    this.occupants.length = 0;
  }

  step(frame: Frame, inside: (x: number, y: number) => boolean): void {
    const cfg = this.cfg;
    const k = cfg.anchorStiffness * cfg.cytoskeleton;

    // 1) Spring each occupant toward its anchor in the current (deforming) frame.
    for (const o of this.occupants) {
      const ax = frame.cx + o.fx * frame.halfW;
      const ay = frame.cy + o.fy * frame.halfH;
      o.x += (ax - o.x) * k;
      o.y += (ay - o.y) * k;
    }

    // 2) Soft mutual spacing so they don't pile up (flow/regroup, not overlap).
    const n = this.occupants.length;
    for (let i = 0; i < n; i++) {
      const a = this.occupants[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.occupants[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + b.radius + cfg.spacing;
        if (d < min) {
          // Coincident pair has no separation direction — split along x so they
          // still spread (deterministic tie-break).
          let nx: number;
          let ny: number;
          let gap: number;
          if (d > 1e-3) {
            nx = dx / d;
            ny = dy / d;
            gap = min - d;
          } else {
            nx = 1;
            ny = 0;
            gap = min;
          }
          const f = gap * cfg.spacingStiffness;
          a.x -= nx * f;
          a.y -= ny * f;
          b.x += nx * f;
          b.y += ny * f;
        }
      }
    }

    // 3) Containment + stress cue.
    for (const o of this.occupants) {
      if (!inside(Math.round(o.x), Math.round(o.y))) {
        let dx = frame.cx - o.x;
        let dy = frame.cy - o.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d;
        dy /= d;
        let guard = 0;
        while (guard++ < 80 && !inside(Math.round(o.x), Math.round(o.y))) {
          o.x += dx;
          o.y += dy;
        }
      }
      const ax = frame.cx + o.fx * frame.halfW;
      const ay = frame.cy + o.fy * frame.halfH;
      o.compressed = clamp(Math.hypot(o.x - ax, o.y - ay) / (o.radius * 3), 0, 1);
    }
  }

  /** Translate all occupants (lattice recentering). */
  shift(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    for (const o of this.occupants) {
      o.x += dx;
      o.y += dy;
    }
  }

  /** How many occupants are visibly displaced from their anchor (HUD cue). */
  get compressedCount(): number {
    let c = 0;
    for (const o of this.occupants) if (o.compressed > 0.5) c++;
    return c;
  }
}
