// CpmBuildGrid — the cell's internal, shape-conforming build grid.
//
// The player's cytoplasm is divided into a coarse grid of slots laid out in the
// cell's LOCAL frame (centroid-relative), so the grid rides with the cell. A slot
// is "buildable" only where the cell actually has cytoplasm right now, so the set
// of usable slots conforms to the cell's CURRENT shape and size: grow the cell and
// more slots open; squeeze it and slots near the pinched edge disappear.
//
// Organelles (and, later, factory machines) are STRUCTURES that occupy a slot.
// They don't bounce or overlap — one occupant per slot — and they hold position in
// the cell frame like real structures. When the cell deforms enough that an
// occupant's slot is no longer cytoplasm, it RELOCATES to the nearest free slot:
// that's the cell's size/stress directly reshaping its interior, which is exactly
// the coupling the design wants (and the substrate the factory + cargo routing sit
// on).

import type { CpmSimulation } from "./cpm-simulation";
import type { CellId } from "../vendor/artistoo";

export interface Occupant {
  readonly type: string;
  readonly color: number;
  /** Render radius in lattice px (visual size; not the slot size). */
  readonly radius: number;
  /** Current slot coordinate in the cell's local grid. */
  gx: number;
  gy: number;
  /** Home slot (where it was built). It returns here when the cell recovers. */
  homeGx: number;
  homeGy: number;
  /** Smoothly-interpolated render offset from the centroid (lattice px), so
   *  relocations glide instead of snapping. */
  rx: number;
  ry: number;
  /** True when it can't be at its home slot right now (squeezed out — stressed). */
  displaced: boolean;
}

export class CpmBuildGrid {
  readonly occupants: Occupant[] = [];

  constructor(
    private readonly sim: CpmSimulation,
    private readonly getHostId: () => CellId,
    /** Lattice px per slot — the grid resolution. */
    readonly slotSize = 5
  ) {}

  /** Lattice position of a slot's centre (centroid-relative). */
  slotToLattice(cx: number, cy: number, gx: number, gy: number): [number, number] {
    return [cx + gx * this.slotSize, cy + gy * this.slotSize];
  }

  /** A slot is buildable when its centre sits on the host's cytoplasm. */
  slotValid(cx: number, cy: number, gx: number, gy: number): boolean {
    const [lx, ly] = this.slotToLattice(cx, cy, gx, gy);
    return this.sim.ownerAtLattice(Math.round(lx), Math.round(ly)) === this.getHostId();
  }

  private occupied(gx: number, gy: number, except?: Occupant): boolean {
    for (const o of this.occupants) {
      if (o !== except && o.gx === gx && o.gy === gy) return true;
    }
    return false;
  }

  /** All currently-buildable slots (conforms to the cell's shape/size). */
  validSlots(): { gx: number; gy: number }[] {
    const f = this.sim.cellFrame(this.getHostId());
    if (!f) return [];
    const ext = Math.ceil(Math.max(f.halfW, f.halfH) / this.slotSize) + 1;
    const out: { gx: number; gy: number }[] = [];
    for (let gy = -ext; gy <= ext; gy++) {
      for (let gx = -ext; gx <= ext; gx++) {
        if (this.slotValid(f.cx, f.cy, gx, gy)) out.push({ gx, gy });
      }
    }
    return out;
  }

  /** Nearest free, valid slot to a starting grid coord (ring search). */
  private nearestFreeSlot(
    cx: number,
    cy: number,
    gx: number,
    gy: number,
    except?: Occupant
  ): { gx: number; gy: number } | null {
    for (let r = 0; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
          const sx = gx + dx;
          const sy = gy + dy;
          if (this.slotValid(cx, cy, sx, sy) && !this.occupied(sx, sy, except)) {
            return { gx: sx, gy: sy };
          }
        }
      }
    }
    return null;
  }

  /** Place a structure at the slot nearest a lattice point. Returns it, or null if
   *  there's no free cytoplasm slot (cell too small / too crowded). */
  place(type: string, color: number, radius: number, lx: number, ly: number): Occupant | null {
    const c = this.sim.centroidLattice(this.getHostId());
    if (!c) return null;
    const gx = Math.round((lx - c.x) / this.slotSize);
    const gy = Math.round((ly - c.y) / this.slotSize);
    const slot = this.nearestFreeSlot(c.x, c.y, gx, gy);
    if (!slot) return null;
    const o: Occupant = {
      type,
      color,
      radius,
      gx: slot.gx,
      gy: slot.gy,
      homeGx: slot.gx,
      homeGy: slot.gy,
      rx: slot.gx * this.slotSize,
      ry: slot.gy * this.slotSize,
      displaced: false,
    };
    this.occupants.push(o);
    return o;
  }

  clear(): void {
    this.occupants.length = 0;
  }

  /** Smoothly-interpolated lattice position of an occupant this frame (centroid +
   *  its eased render offset, so it rides with the cell and glides on relocation). */
  occupantLattice(o: Occupant): [number, number] {
    const c = this.sim.centroidLattice(this.getHostId());
    if (!c) return [o.rx, o.ry];
    return [c.x + o.rx, c.y + o.ry];
  }

  /** Each frame: every occupant wants to be at its HOME slot. If home is currently
   *  cytoplasm and free it returns there; if the cell got squeezed so home isn't
   *  usable, it relocates to the nearest free slot and is marked displaced (under
   *  stress) — then glides home again once the cell recovers. The render offset
   *  eases toward the target slot so motion is smooth, never snapping. */
  update(): void {
    const c = this.sim.centroidLattice(this.getHostId());
    if (!c) return;
    for (const o of this.occupants) {
      const homeUsable =
        this.slotValid(c.x, c.y, o.homeGx, o.homeGy) &&
        !this.occupied(o.homeGx, o.homeGy, o);
      if (homeUsable) {
        o.gx = o.homeGx;
        o.gy = o.homeGy;
        o.displaced = false;
      } else {
        const slot = this.nearestFreeSlot(c.x, c.y, o.homeGx, o.homeGy, o);
        if (slot) {
          o.gx = slot.gx;
          o.gy = slot.gy;
        }
        o.displaced = true;
      }
      // Ease the render offset toward the (local) slot position.
      o.rx += (o.gx * this.slotSize - o.rx) * 0.15;
      o.ry += (o.gy * this.slotSize - o.ry) * 0.15;
    }
  }

  get displacedCount(): number {
    let n = 0;
    for (const o of this.occupants) if (o.displaced) n++;
    return n;
  }
}
