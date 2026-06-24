// CpmSimulation — owns the shared CPM lattice (the player-anchored bubble) and
// all cells living on it. Drives the raw Artistoo `CPM` + `GridManipulator`
// (not the Canvas-coupled `Simulation` class). Cells of different *kinds* (player,
// enemy, ...) share one grid so they collide and adhere natively.
//
// Responsibilities:
//   - build the CPM + constraints from per-kind profiles,
//   - spawn/track/kill cells,
//   - per-kind steering (attraction point) + rest<->active Act toggling,
//   - world<->lattice transform with recentering hooks (infinite world; M-B),
//   - read access for rendering and rules (pixels, centroids, activity,
//     connected-components for tear detection).

import {
  CPM,
  GridManipulator,
  ActivityConstraint,
  AttractionPointConstraint,
  SoftConnectivityConstraint,
  ConnectedComponentsByCell,
  type CellId,
} from "../vendor/artistoo";
import type { CpmCellProfile, CpmWorldConfig } from "./cpm-config";

export interface CellRecord {
  readonly id: CellId;
  readonly kind: number; // 1-based index into the kinds array
  readonly profile: CpmCellProfile;
  alive: boolean;
}

/** Mutable conf shape we read/write each frame for steering. */
interface SteerConf {
  LAMBDA_ACT: number[];
  LAMBDA_ATTRACTIONPOINT: number[];
  ATTRACTIONPOINT: number[][];
}

export class CpmSimulation {
  readonly field: number;
  readonly cpm: CPM;
  readonly profiles: readonly CpmCellProfile[]; // index 0 unused (background)
  private readonly gm: GridManipulator;
  private readonly activity: ActivityConstraint;
  private readonly conf: SteerConf;
  private readonly cells = new Map<CellId, CellRecord>();

  // World<->lattice transform. originWX/Y = world coords of lattice pixel [0,0];
  // scale = world px per lattice px. Recentering (M-B) mutates the origin so the
  // world is effectively infinite while the lattice stays a fixed-size bubble.
  originWX = 0;
  originWY = 0;
  readonly scale: number;
  private readonly stepsPerFrame: number;

  // Infinite-world streaming. Cells that leave the bubble are demoted to dormant
  // (remembered by world position + kind) and re-activated when they return.
  private readonly recenterMargin: number;
  private readonly edgeBand = 18; // lattice px from the boundary = "leaving"
  private readonly dormant: { kind: number; wx: number; wy: number }[] = [];

  constructor(
    readonly worldConfig: CpmWorldConfig,
    /** Kind profiles in order; becomes kinds 1..N. */
    kindProfiles: readonly CpmCellProfile[]
  ) {
    this.field = worldConfig.fieldSize;
    this.scale = worldConfig.worldPerPixel;
    this.stepsPerFrame = worldConfig.stepsPerFrame;
    this.recenterMargin = worldConfig.recenterMargin;
    // profiles[kind] lookup: prepend a background placeholder at index 0.
    this.profiles = [kindProfiles[0], ...kindProfiles];

    const nKinds = kindProfiles.length; // excludes background
    const center = Math.floor(this.field / 2);

    // Per-kind conf arrays (index 0 = background).
    const V = [0];
    const LAMBDA_V = [0];
    const P = [0];
    const LAMBDA_P = [0];
    const MAX_ACT = [0];
    const LAMBDA_ACT = [0];
    const LAMBDA_ATTRACTIONPOINT = [0];
    const ATTRACTIONPOINT: number[][] = [[0, 0]];
    const LAMBDA_CONNECTIVITY = [0];
    for (const p of kindProfiles) {
      V.push(p.volume);
      LAMBDA_V.push(p.lambdaV);
      P.push(p.perimeter);
      LAMBDA_P.push(p.lambdaP);
      MAX_ACT.push(p.maxAct);
      LAMBDA_ACT.push(p.lambdaActRest); // start at rest
      LAMBDA_ATTRACTIONPOINT.push(0);
      ATTRACTIONPOINT.push([center, center]);
      LAMBDA_CONNECTIVITY.push(p.lambdaConnectivity);
    }

    // Adhesion matrix J[(nKinds+1) x (nKinds+1)].
    const J: number[][] = [];
    for (let a = 0; a <= nKinds; a++) {
      J.push([]);
      for (let b = 0; b <= nKinds; b++) {
        if (a === b) {
          J[a].push(0); // same-pixel; ignored
        } else if (a === 0 || b === 0) {
          const k = a === 0 ? b : a;
          J[a].push(kindProfiles[k - 1].jWithMedium);
        } else {
          // cell<->cell: average the two kinds' "other" adhesion.
          J[a].push(
            (kindProfiles[a - 1].jWithOther + kindProfiles[b - 1].jWithOther) / 2
          );
        }
      }
    }

    this.cpm = new CPM([this.field, this.field], {
      seed: worldConfig.seed,
      T: worldConfig.temperature,
      torus: [false, false],
      J,
      LAMBDA_V,
      V,
      LAMBDA_P,
      P,
      // Activity + attraction added below; their params live here so we can
      // mutate them each frame to steer.
      LAMBDA_ACT,
      MAX_ACT,
      ACT_MEAN: "geometric",
      LAMBDA_ATTRACTIONPOINT,
      ATTRACTIONPOINT,
      LAMBDA_CONNECTIVITY,
    });

    this.activity = new ActivityConstraint({
      LAMBDA_ACT,
      MAX_ACT,
      ACT_MEAN: "geometric",
    });
    this.cpm.add(this.activity);
    this.cpm.add(
      new AttractionPointConstraint({
        LAMBDA_ATTRACTIONPOINT,
        ATTRACTIONPOINT,
      })
    );
    // Cohesion: a soft penalty for disconnecting a cell. Resists spontaneous
    // "lava-lamp" fragmentation; strong force / adverse conditions can still
    // overcome it (condition-gated tearing).
    this.cpm.add(
      new SoftConnectivityConstraint({ LAMBDA_CONNECTIVITY })
    );

    this.conf = this.cpm.conf as unknown as SteerConf;
    this.gm = new GridManipulator(this.cpm);
  }

  // ---- spawning ------------------------------------------------------------

  /** Spawn a cell of `kind` (1-based) at a lattice position. */
  spawnCellAtLattice(kind: number, x: number, y: number): CellRecord {
    const id = this.gm.seedCellAt(kind, [Math.round(x), Math.round(y)]);
    const rec: CellRecord = { id, kind, profile: this.profiles[kind], alive: true };
    this.cells.set(id, rec);
    return rec;
  }

  /** Spawn a cell at a WORLD position (converted to lattice). */
  spawnCellAtWorld(kind: number, wx: number, wy: number): CellRecord {
    const [lx, ly] = this.worldToLattice(wx, wy);
    return this.spawnCellAtLattice(kind, lx, ly);
  }

  killCell(id: CellId): void {
    const rec = this.cells.get(id);
    if (!rec) return;
    this.gm.killCell(id);
    rec.alive = false;
    this.cells.delete(id);
  }

  // ---- stepping & steering -------------------------------------------------

  step(): void {
    for (let i = 0; i < this.stepsPerFrame; i++) this.cpm.timeStep();
  }

  /** Command a kind toward a lattice point and switch it to active protrusion. */
  steerKindToLattice(kind: number, x: number, y: number): void {
    const cx = clamp(x, 0, this.field - 1);
    const cy = clamp(y, 0, this.field - 1);
    this.conf.ATTRACTIONPOINT[kind][0] = cx;
    this.conf.ATTRACTIONPOINT[kind][1] = cy;
    this.conf.LAMBDA_ATTRACTIONPOINT[kind] = this.profiles[kind].steerLambda;
    this.conf.LAMBDA_ACT[kind] = this.profiles[kind].lambdaAct;
  }

  /** Return a kind to rest (no directional drive, protrusion drops to rest). */
  restKind(kind: number): void {
    this.conf.LAMBDA_ATTRACTIONPOINT[kind] = 0;
    this.conf.LAMBDA_ACT[kind] = this.profiles[kind].lambdaActRest;
  }

  // ---- reads ---------------------------------------------------------------

  getCells(): IterableIterator<CellRecord> {
    return this.cells.values();
  }

  getCell(id: CellId): CellRecord | undefined {
    return this.cells.get(id);
  }

  activityAtIndex(i: number): number {
    return this.activity.pxact(i);
  }

  /** Centroid of a cell in lattice coords + its pixel count, or null if gone. */
  centroidLattice(id: CellId): { x: number; y: number; pixels: number } | null {
    let n = 0,
      sx = 0,
      sy = 0;
    for (const [[x, y], v] of this.cpm.grid.pixels()) {
      if (v === id) {
        n++;
        sx += x;
        sy += y;
      }
    }
    if (n === 0) return null;
    return { x: sx / n, y: sy / n, pixels: n };
  }

  /** Connected-component count per cell id (>1 means the cell has fragmented).
   *  Used by the rules layer for structural-failure / tear detection. */
  connectedComponentsByCell(): Record<number, Record<number, number>> {
    return this.cpm.getStat(ConnectedComponentsByCell) as Record<
      number,
      Record<number, number>
    >;
  }

  // ---- world<->lattice transform ------------------------------------------

  worldToLattice(wx: number, wy: number): [number, number] {
    return [(wx - this.originWX) / this.scale, (wy - this.originWY) / this.scale];
  }

  latticeToWorld(lx: number, ly: number): [number, number] {
    return [this.originWX + lx * this.scale, this.originWY + ly * this.scale];
  }

  // ---- infinite-world streaming -------------------------------------------

  /** Keep `anchorId` (the player) centered for an effectively infinite world:
   *  recenter the bubble when it drifts, demote cells that left the bubble to
   *  dormant, and re-activate dormant cells whose world position re-enters.
   *  Returns the set of cell ids that changed (demoted/promoted) for the
   *  renderer to forget/refresh. */
  streamAround(anchorId: CellId): { demoted: CellId[]; promoted: CellId[] } {
    const demoted: CellId[] = [];
    const promoted: CellId[] = [];

    const c = this.centroidLattice(anchorId);
    if (c) {
      const center = this.field / 2;
      const margin = this.recenterMargin * this.field;
      const dx = Math.round(center - c.x);
      const dy = Math.round(center - c.y);
      if (Math.abs(center - c.x) > margin || Math.abs(center - c.y) > margin) {
        this.shiftLattice(dx, dy, anchorId, demoted);
      }
    }

    this.demoteEdgeCells(anchorId, demoted);
    this.promoteDormant(promoted);
    return { demoted, promoted };
  }

  /** Translate all live pixels by (dx,dy) lattice px and shift the world origin
   *  oppositely so every cell keeps its world position. Cells whose shifted
   *  centroid leaves the keep-region are demoted to dormant.
   *
   *  Implementation note (Artistoo internals): we clear then re-stamp via setpix
   *  so border bookkeeping stays correct, but clearing a cell to volume 0 makes
   *  CPM.setpixi delete its `t2k` (kind) and `cellvolume`. We therefore snapshot
   *  per-cell state and repair t2k/cellvolume/nr_cells before re-stamping, and
   *  restore each pixel's Act value (setpix resets it to MAX_ACT, which would
   *  erase the gradient the Act model needs to crawl). */
  private shiftLattice(
    dx: number,
    dy: number,
    anchorId: CellId,
    demoted: CellId[]
  ): void {
    if (dx === 0 && dy === 0) return;
    const grid = this.cpm.grid;
    const oldOriginWX = this.originWX;
    const oldOriginWY = this.originWY;

    // Group pixels (with Act) by cell id, accumulating the centroid.
    interface CellSnap {
      kind: number;
      px: { x: number; y: number; act: number }[];
      sx: number;
      sy: number;
    }
    const byId = new Map<number, CellSnap>();
    for (const [[x, y], id] of grid.pixels()) {
      let s = byId.get(id);
      if (!s) {
        s = { kind: this.cells.get(id)?.kind ?? this.cpm.cellKind(id), px: [], sx: 0, sy: 0 };
        byId.set(id, s);
      }
      s.px.push({ x, y, act: this.activity.pxact(grid.p2i([x, y])) });
      s.sx += x;
      s.sy += y;
    }

    // Clear the whole grid (this drops kinds/volumes; we repair below).
    for (const s of byId.values()) for (const p of s.px) this.cpm.setpix([p.x, p.y], 0);

    this.originWX -= dx * this.scale;
    this.originWY -= dy * this.scale;

    const lo = this.edgeBand;
    const hi = this.field - this.edgeBand;
    for (const [id, s] of byId) {
      const cx = s.sx / s.px.length + dx;
      const cy = s.sy / s.px.length + dy;
      const keep =
        id === anchorId || (cx >= lo && cx <= hi && cy >= lo && cy <= hi);
      if (!keep) {
        // Demote: remember its world position (invariant under the shift).
        const wx = oldOriginWX + (s.sx / s.px.length) * this.scale;
        const wy = oldOriginWY + (s.sy / s.px.length) * this.scale;
        this.dormant.push({ kind: s.kind, wx, wy });
        this.cells.delete(id);
        demoted.push(id);
        continue;
      }
      // Repair CPM bookkeeping for this id before re-stamping its pixels.
      this.cpm.t2k[id] = s.kind;
      this.cpm.cellvolume[id] = 0;
      this.cpm.nr_cells++;
      for (const p of s.px) {
        const nx = p.x + dx,
          ny = p.y + dy;
        if (nx < 0 || nx >= this.field || ny < 0 || ny >= this.field) continue;
        this.cpm.setpix([nx, ny], id);
        const ni = grid.p2i([nx, ny]);
        if (p.act > 0) this.activity.cellpixelsact[ni] = p.act;
        else delete this.activity.cellpixelsact[ni];
      }
    }
  }

  /** Demote cells whose centroid sits in the edge band (about to leave) to
   *  dormant, removing them cleanly instead of letting them bulge against the
   *  hard boundary. */
  private demoteEdgeCells(anchorId: CellId, demoted: CellId[]): void {
    const lo = this.edgeBand;
    const hi = this.field - this.edgeBand;
    for (const rec of [...this.cells.values()]) {
      if (rec.id === anchorId) continue;
      const cc = this.centroidLattice(rec.id);
      if (!cc || cc.x < lo || cc.x > hi || cc.y < lo || cc.y > hi) {
        this.makeDormant(rec, demoted);
      }
    }
  }

  private makeDormant(rec: CellRecord, demoted: CellId[]): void {
    const cc = this.centroidLattice(rec.id);
    const wx = cc ? this.latticeToWorld(cc.x, cc.y)[0] : this.originWX;
    const wy = cc ? this.latticeToWorld(cc.x, cc.y)[1] : this.originWY;
    this.dormant.push({ kind: rec.kind, wx, wy });
    this.gm.killCell(rec.id);
    this.cells.delete(rec.id);
    demoted.push(rec.id);
  }

  /** Re-activate dormant cells whose remembered world position has re-entered
   *  the bubble's interior (not the edge band). */
  private promoteDormant(promoted: CellId[]): void {
    const lo = this.edgeBand + 4;
    const hi = this.field - this.edgeBand - 4;
    for (let i = this.dormant.length - 1; i >= 0; i--) {
      const d = this.dormant[i];
      const [lx, ly] = this.worldToLattice(d.wx, d.wy);
      if (lx >= lo && lx <= hi && ly >= lo && ly <= hi) {
        const rec = this.spawnCellAtLattice(d.kind, lx, ly);
        promoted.push(rec.id);
        this.dormant.splice(i, 1);
      }
    }
  }

  /** Number of cells currently remembered as dormant (off-bubble). */
  get dormantCount(): number {
    return this.dormant.length;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
