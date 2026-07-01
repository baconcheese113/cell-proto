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
  ConnectedComponentsByCell,
  type CellId,
  type ActivityConstraint,
  type PerimeterConstraint,
} from "../vendor/artistoo";
import { PerCellAttractionConstraint } from "./per-cell-attraction-constraint";
import { CpmFootprintConstraint } from "./cpm-footprint-constraint";
import { CpmFlowConstraint } from "./cpm-flow-constraint";
import type { CpmCellProfile, CpmWorldConfig } from "./cpm-config";

export interface CellRecord {
  readonly id: CellId;
  readonly kind: number; // 1-based index into the kinds array
  readonly profile: CpmCellProfile;
  alive: boolean;
}

/** Mutable conf shape we read/write each frame to toggle per-kind protrusion and
 *  retarget a host's perimeter budget as it wraps compartments. */
interface SteerConf {
  LAMBDA_ACT: number[];
  P: number[];
}

export class CpmSimulation {
  readonly field: number;
  readonly cpm: CPM;
  readonly profiles: readonly CpmCellProfile[]; // index 0 unused (background)
  private readonly gm: GridManipulator;
  private readonly activity: ActivityConstraint;
  private readonly perimeter: PerimeterConstraint;
  private readonly attraction: PerCellAttractionConstraint;
  private readonly footprint: CpmFootprintConstraint;
  /** The vessel current (heart pump). Public so the scene sets dir + pulse. */
  readonly flow: CpmFlowConstraint;
  private readonly conf: SteerConf;
  /** Per-kind baseline target perimeter (a solid blob); the host's live budget is
   *  this plus the perimeter its enclosed compartments add. */
  private readonly basePerim: number[];
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
  // Kinds whose cells are KILLED (not remembered as dormant) when they leave the
  // bubble. Used for procedurally-refilled tissue: individual tissue cells are
  // generic and re-spawned to fill space, so remembering each one would bloat the
  // dormant list as you migrate. The owner (CpmTissue) maintains density instead.
  private readonly transientKinds = new Set<number>();

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

    // Per-kind conf arrays (index 0 = background).
    const V = [0];
    const LAMBDA_V = [0];
    const P = [0];
    const LAMBDA_P = [0];
    const MAX_ACT = [0];
    const LAMBDA_ACT = [0];
    const LAMBDA_CONNECTIVITY = [0];
    for (const p of kindProfiles) {
      V.push(p.volume);
      LAMBDA_V.push(p.lambdaV);
      P.push(p.perimeter);
      LAMBDA_P.push(p.lambdaP);
      MAX_ACT.push(p.maxAct);
      LAMBDA_ACT.push(p.lambdaActRest); // start at rest
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
      // Activity params live here so we can mutate LAMBDA_ACT per kind to toggle
      // a kind between rest and active protrusion.
      LAMBDA_ACT,
      MAX_ACT,
      ACT_MEAN: "geometric",
      LAMBDA_CONNECTIVITY,
    });

    // Activity (amoeboid protrusion) and Perimeter are AUTO-added by CPM from the
    // LAMBDA_ACT / LAMBDA_P conf keys (see AutoAdderConfig). Grab those instances
    // rather than adding our own — a second ActivityConstraint doubles the
    // protrusion force and runs a parallel activity state, which corrupts the
    // gradient and rigidifies the membrane. We keep the Perimeter handle so we can
    // read per-cell perimeter and retarget a host's budget as it wraps compartments.
    this.activity = this.cpm.getConstraint("ActivityConstraint") as ActivityConstraint;
    this.perimeter = this.cpm.getConstraint("PerimeterConstraint") as PerimeterConstraint;
    this.basePerim = [...P];

    // Per-cell directed motion (steering). Each cell (player, enemy, later
    // cargo) gets its own target + strength.
    this.attraction = new PerCellAttractionConstraint();
    this.cpm.add(this.attraction);
    // The single coupling between the CPM membrane and the big-organelle soft
    // bodies (nucleus): the host is penalized for not covering their footprint.
    this.footprint = new CpmFootprintConstraint(this.field);
    this.cpm.add(this.footprint);
    // The vessel current: pushes flowing (lumen) kinds along the heart-pump flow.
    this.flow = new CpmFlowConstraint();
    this.cpm.add(this.flow);
    // NOTE: no SoftConnectivityConstraint. Profiling showed it was ~72% of the CPM
    // step cost (a per-copy-attempt local flood-fill), and it was leftover from the
    // old embedded-compartment era — the solid cell + soft-body nucleus stays
    // cohesive from volume + perimeter tension alone (verified: 0 fragmentation
    // under hard steering). Removing it ~tripled the step rate (27ms -> 9ms). If a
    // future cell type needs anti-fragmentation, raise its LAMBDA_P instead.

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

  /** Spawn a cell ALREADY GROWN to ~`radius` lattice px (a stamped disc over free
   *  background pixels), instead of a 1px seed that visibly blooms. Used when
   *  promoting an off-lattice agent into the bubble: the agent was already drawn as a
   *  disc of this size, so the swap to a CPM cell is size-preserving (no pop). */
  spawnCellFilled(kind: number, x: number, y: number, radius: number): CellRecord {
    const rec = this.spawnCellAtLattice(kind, x, y);
    const r = Math.max(1, Math.round(radius));
    const r2 = r * r;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= this.field || ny < 0 || ny >= this.field) continue;
        if (this.cpm.pixt([nx, ny]) === 0) this.cpm.setpix([nx, ny], rec.id);
      }
    }
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
    this.attraction.forget(id);
    rec.alive = false;
    this.cells.delete(id);
  }

  /** Mark a kind as transient: its cells are KILLED (not remembered as dormant)
   *  when they leave the bubble. For procedurally-refilled background populations
   *  whose individuals are generic and re-spawned rather than tracked. */
  setTransient(kind: number, on = true): void {
    if (on) this.transientKinds.add(kind);
    else this.transientKinds.delete(kind);
  }

  // ---- stepping & steering -------------------------------------------------

  step(): void {
    for (let i = 0; i < this.stepsPerFrame; i++) this.cpm.timeStep();
  }

  /** Advance exactly `n` Monte-Carlo steps. Used by the scene's fixed-timestep clock
   *  so the sim advances at a constant rate in real time, independent of render FPS. */
  stepN(n: number): void {
    for (let i = 0; i < n; i++) this.cpm.timeStep();
  }

  /** Command a single cell toward a lattice point at its profile's strength. */
  steerCell(id: CellId, x: number, y: number, lambdaScale = 1): void {
    const rec = this.cells.get(id);
    if (!rec) return;
    const cx = clamp(x, 0, this.field - 1);
    const cy = clamp(y, 0, this.field - 1);
    this.attraction.setTarget(id, cx, cy, rec.profile.steerLambda * lambdaScale);
  }

  /** Stop directing a single cell (it keeps whatever Act its kind has). */
  restCell(id: CellId): void {
    this.attraction.clear(id);
  }

  /** Toggle a whole kind between active protrusion and rest (Act strength). */
  setKindActive(kind: number, active: boolean): void {
    this.conf.LAMBDA_ACT[kind] = active
      ? this.profiles[kind].lambdaAct
      : this.profiles[kind].lambdaActRest;
  }

  // ---- compartments: perimeter budget + cytoskeletal carry -----------------

  /** Current actual perimeter (border-mismatch count) of a live cell. */
  cellPerimeter(id: CellId): number {
    return this.perimeter.cellperimeters[id] ?? 0;
  }

  /** A kind's baseline target perimeter (the solid-blob value from its profile). */
  basePerimeter(kind: number): number {
    return this.basePerim[kind] ?? 0;
  }

  /** Sum of actual perimeters over all live cells whose kind is in `kinds`.
   *  An enclosed compartment inflates its host's perimeter by ~its own perimeter
   *  (the inner boundary the host must wrap), so this is exactly the extra budget
   *  the host needs to avoid perimeter-locking (which would freeze its membrane). */
  compartmentPerimeterSum(kinds: readonly number[]): number {
    let s = 0;
    for (const rec of this.cells.values()) {
      if (kinds.includes(rec.kind)) s += this.cellPerimeter(rec.id);
    }
    return s;
  }

  /** Retarget a kind's perimeter budget (mutates the shared conf the
   *  PerimeterConstraint reads). Used each frame to size the host's budget to the
   *  compartments it currently wraps. */
  setKindPerimeterTarget(kind: number, value: number): void {
    this.conf.P[kind] = value;
  }

  /** Softly bias a single compartment toward a lattice point (cytoskeletal
   *  anchoring via the attraction constraint — a smooth force, not pixel surgery,
   *  so it never disrupts the host's topology). `lambda` sets how firmly it's held;
   *  0 releases it to drift. The compartment still deforms and flows with the
   *  cytoplasm — it's biased, not pinned. */
  attractCellTo(id: CellId, x: number, y: number, lambda: number): void {
    if (!this.cells.has(id)) return;
    this.attraction.setTarget(
      id,
      clamp(x, 0, this.field - 1),
      clamp(y, 0, this.field - 1),
      lambda
    );
  }

  /** Set the big-organelle footprint mask the membrane must keep covered this
   *  frame (rasterized by the soft bodies). `lambda` sets the bottleneck/rupture
   *  resistance; 0 disables. */
  setBigOrganelleFootprint(
    hostId: CellId,
    cells: Iterable<[number, number]>,
    lambda: number
  ): void {
    this.footprint.setFootprint(hostId, cells, this.field, lambda);
  }

  /** Clear the footprint coupling (no big organelles this frame). */
  clearBigOrganelleFootprint(): void {
    this.footprint.setFootprint(0, [], this.field, 0);
  }

  // ---- reads ---------------------------------------------------------------

  getCells(): IterableIterator<CellRecord> {
    return this.cells.values();
  }

  getCell(id: CellId): CellRecord | undefined {
    return this.cells.get(id);
  }

  /** Cell id owning a lattice pixel (0 = background/medium). For build placement:
   *  a structure is only valid on a pixel the host actually owns. */
  ownerAtLattice(x: number, y: number): CellId {
    if (x < 0 || x >= this.field || y < 0 || y >= this.field) return 0;
    return this.cpm.pixt([x, y]);
  }

  /** Clear the pixel at (x,y) to background IF it belongs to a cell of one of `kinds`
   *  AND that cell is still above `minVolFrac` of its target volume. Returns true if a
   *  pixel was cleared. Used for diapedesis: the immune cell carves a corridor through
   *  the lining in its path so it crosses at full crawl speed instead of inching; the
   *  lining regrows behind it = re-seal. The volume floor keeps carving NON-LETHAL —
   *  real diapedesis doesn't kill the endothelium — so a cell only ever squishes to
   *  `minVolFrac` (above the rules' stress/death thresholds) and then survives + regrows. */
  carvePixel(x: number, y: number, kinds: readonly number[], minVolFrac: number): boolean {
    if (x < 0 || x >= this.field || y < 0 || y >= this.field) return false;
    const id = this.cpm.pixt([x, y]);
    if (id === 0) return false;
    const rec = this.cells.get(id);
    if (!rec || !kinds.includes(rec.kind)) return false;
    if ((this.cpm.cellvolume[id] ?? 0) <= minVolFrac * rec.profile.volume) return false;
    this.cpm.setpix([x, y], 0);
    return true;
  }

  activityAtIndex(i: number): number {
    return this.activity.pxact(i);
  }

  /** Iterate the lattice pixels belonging to one cell (for field masks). */
  *cellPixels(id: CellId): IterableIterator<[number, number]> {
    for (const [[x, y], v] of this.cpm.grid.pixels()) {
      if (v === id) yield [x, y];
    }
  }

  /** Host-authoritative replication snapshot: one byte per lattice pixel holding
   *  the cell KIND (0 = background). Row-major (y*field + x). A client renders
   *  the world from this (colour by kind) without re-simulating; see
   *  cpm-replication for the binary delta codec that puts it on the wire. */
  snapshotKinds(): Uint8Array {
    const f = this.field;
    const out = new Uint8Array(f * f);
    for (const [[x, y], id] of this.cpm.grid.pixels()) {
      out[y * f + x] = this.cpm.cellKind(id) & 0xff;
    }
    return out;
  }

  /** Centroid + half-extents (bounding-box) of a cell in one pass. Defines a
   *  DEFORMING local frame: anchors stored as fractions of (halfW,halfH) stretch
   *  and compress with the cell, so things pinned to it move organically with the
   *  cell's shape rather than at a rigid pixel offset. Null if the cell is gone. */
  cellFrame(
    id: CellId
  ): { cx: number; cy: number; halfW: number; halfH: number } | null {
    let n = 0,
      sx = 0,
      sy = 0,
      minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const [[x, y], v] of this.cpm.grid.pixels()) {
      if (v !== id) continue;
      n++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (n === 0) return null;
    return {
      cx: sx / n,
      cy: sy / n,
      // Guard against a degenerate (1-px) extent so fractions stay finite.
      halfW: Math.max((maxX - minX) / 2, 1),
      halfH: Math.max((maxY - minY) / 2, 1),
    };
  }

  /** Centroids + pixel counts for ALL live cells in ONE lattice pass. Per-cell
   *  `centroidLattice` is O(field^2) each; systems that need every cell's centroid
   *  (behaviour, life, census) must share this instead of calling it per cell —
   *  the profiler showed that was the dominant cost as population scaled. */
  centroidsAll(): Map<CellId, { x: number; y: number; pixels: number }> {
    const acc = new Map<number, { sx: number; sy: number; n: number }>();
    for (const [[x, y], id] of this.cpm.grid.pixels()) {
      let a = acc.get(id);
      if (!a) {
        a = { sx: 0, sy: 0, n: 0 };
        acc.set(id, a);
      }
      a.sx += x;
      a.sy += y;
      a.n++;
    }
    const out = new Map<CellId, { x: number; y: number; pixels: number }>();
    for (const [id, a] of acc) {
      if (this.cells.has(id)) out.set(id, { x: a.sx / a.n, y: a.sy / a.n, pixels: a.n });
    }
    return out;
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

  /** Connected-component pixel-counts per live cell, each sorted descending.
   *  Computed once (one stat pass) for the rules layer. */
  componentSizesByCell(): Map<CellId, number[]> {
    const cc = this.cpm.getStat(ConnectedComponentsByCell) as Record<
      number,
      Record<number, ArrayLike<unknown>>
    >;
    const out = new Map<CellId, number[]>();
    for (const rec of this.cells.values()) {
      const comps = cc[rec.id];
      if (!comps) {
        out.set(rec.id, []);
        continue;
      }
      const sizes: number[] = [];
      for (const k of Object.keys(comps)) sizes.push(comps[k as never].length);
      sizes.sort((a, b) => b - a);
      out.set(rec.id, sizes);
    }
    return out;
  }

  /** Connected-component sizes (descending) of the STRUCTURE formed by a host
   *  cell together with its internal compartments — flood-filled over the union of
   *  `primaryId`'s pixels and all pixels owned by cells of `memberKinds`.
   *
   *  This is the correct "is the cell torn?" test for a compartmentalized cell:
   *  an organelle sitting between two lobes of cytoplasm BRIDGES them in the union,
   *  so normal compartment-wrapping reads as ONE component. Only a genuine tear —
   *  a piece that separates with no compartment bridging it — splits the union. */
  structureComponentSizes(
    primaryId: CellId,
    memberKinds: readonly number[]
  ): number[] {
    const f = this.field;
    const mark = new Uint8Array(f * f);
    for (const [[x, y], v] of this.cpm.grid.pixels()) {
      if (v === primaryId || memberKinds.includes(this.cpm.t2k[v])) {
        mark[y * f + x] = 1;
      }
    }
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let s = 0; s < mark.length; s++) {
      if (mark[s] !== 1) continue;
      let n = 0;
      stack.push(s);
      mark[s] = 2;
      while (stack.length) {
        const j = stack.pop()!;
        n++;
        const x = j % f,
          y = (j / f) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || nx >= f || ny < 0 || ny >= f) continue;
            const k = ny * f + nx;
            if (mark[k] === 1) {
              mark[k] = 2;
              stack.push(k);
            }
          }
        }
      }
      sizes.push(n);
    }
    sizes.sort((a, b) => b - a);
    return sizes;
  }

  /** Target volume (lattice px) for a cell's kind. */
  targetVolume(id: CellId): number {
    const rec = this.cells.get(id);
    return rec ? rec.profile.volume : 0;
  }

  /** How engulfed `id` is by `hostId`: the fraction of its boundary that is NOT
   *  exposed to background/other cells (1 = fully internalized inside the host).
   *  Engulfment is the topological end-state — the prey ends up inside a closed
   *  compartment of the host. */
  engulfedFraction(id: CellId, hostId: CellId): number {
    const grid = this.cpm.grid;
    let border = 0,
      enclosed = 0;
    for (const [[x, y], v] of grid.pixels()) {
      if (v !== id) continue;
      let exposed = false;
      let isBorder = false;
      for (const ni of grid.neighi(grid.p2i([x, y]))) {
        const t = this.cpm.pixti(ni);
        if (t === id) continue;
        isBorder = true;
        if (t !== hostId) exposed = true; // background or third cell
      }
      if (isBorder) {
        border++;
        if (!exposed) enclosed++;
      }
    }
    return border === 0 ? 0 : enclosed / border;
  }

  /** Live-modulate the adhesion (J) between two kinds (symmetric). Lower = the
   *  two stick/wrap; used during engulfment so the host flows around the prey. */
  setKindAdhesion(kindA: number, kindB: number, value: number): void {
    const J = (this.cpm.conf as { J: number[][] }).J;
    J[kindA][kindB] = value;
    J[kindB][kindA] = value;
  }

  /** Reassign a live cell to a different kind (changes which per-kind CPM
   *  parameters govern it). Used to convert engulfed prey into the inert,
   *  volume-target-0 "digesting" kind so it dissolves without regrowing. */
  setCellKind(id: CellId, kind: number): void {
    const rec = this.cells.get(id);
    if (!rec) return;
    this.cpm.t2k[id] = kind;
    this.cells.set(id, { ...rec, kind, profile: this.profiles[kind] });
  }

  /** Remove up to `count` pixels of a cell (digestion). Returns remaining pixel
   *  count; finalizes removal (kills the cell) when it reaches zero. */
  shrinkCell(id: CellId, count: number): number {
    const grid = this.cpm.grid;
    const px: [number, number][] = [];
    for (const [[x, y], v] of grid.pixels()) if (v === id) px.push([x, y]);
    const remove = Math.min(count, px.length);
    for (let i = 0; i < remove; i++) this.cpm.setpix(px[i], 0);
    const remaining = px.length - remove;
    if (remaining <= 0) this.killCell(id);
    return remaining;
  }

  /** Forcibly tear a cell by carving a thin gap through its centroid, splitting
   *  it into two parts. Represents adverse force/chemistry overcoming cohesion;
   *  the rules layer then detects the split and kills the cell. `axis` = the cut
   *  orientation. Returns false if the cell isn't present. */
  tearCell(id: CellId, axis: "h" | "v" = "h", halfWidth = 1): boolean {
    const c = this.centroidLattice(id);
    if (!c) return false;
    const cut: [number, number][] = [];
    for (const [[x, y], v] of this.cpm.grid.pixels()) {
      if (v !== id) continue;
      const d = axis === "h" ? y - c.y : x - c.x;
      if (Math.abs(d) <= halfWidth) cut.push([x, y]);
    }
    for (const [x, y] of cut) this.cpm.setpix([x, y], 0);
    return true;
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
  streamAround(anchorId: CellId): {
    demoted: CellId[];
    promoted: CellId[];
    shiftX: number;
    shiftY: number;
  } {
    const demoted: CellId[] = [];
    const promoted: CellId[] = [];
    let shiftX = 0,
      shiftY = 0;

    // One shared centroid pass (was O(field^2) per cell inside demoteEdgeCells).
    let cents = this.centroidsAll();
    const c = cents.get(anchorId);
    if (c) {
      const center = this.field / 2;
      const margin = this.recenterMargin * this.field;
      const dx = Math.round(center - c.x);
      const dy = Math.round(center - c.y);
      if (Math.abs(center - c.x) > margin || Math.abs(center - c.y) > margin) {
        this.shiftLattice(dx, dy, anchorId, demoted);
        shiftX = dx;
        shiftY = dy;
        cents = this.centroidsAll(); // positions changed; refresh for the demote check
      }
    }

    this.demoteEdgeCells(anchorId, demoted, cents);
    this.promoteDormant(promoted);
    return { demoted, promoted, shiftX, shiftY };
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
        // Demote: remember its world position (invariant under the shift) — unless
        // the kind is transient, in which case it's dropped (the owner refills).
        if (!this.transientKinds.has(s.kind)) {
          const wx = oldOriginWX + (s.sx / s.px.length) * this.scale;
          const wy = oldOriginWY + (s.sy / s.px.length) * this.scale;
          this.dormant.push({ kind: s.kind, wx, wy });
        }
        this.attraction.forget(id);
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
  private demoteEdgeCells(
    anchorId: CellId,
    demoted: CellId[],
    cents: Map<CellId, { x: number; y: number; pixels: number }>
  ): void {
    const lo = this.edgeBand;
    const hi = this.field - this.edgeBand;
    for (const rec of [...this.cells.values()]) {
      if (rec.id === anchorId) continue;
      const cc = cents.get(rec.id);
      if (!cc || cc.x < lo || cc.x > hi || cc.y < lo || cc.y > hi) {
        this.makeDormant(rec, demoted);
      }
    }
  }

  private makeDormant(rec: CellRecord, demoted: CellId[]): void {
    if (!this.transientKinds.has(rec.kind)) {
      const cc = this.centroidLattice(rec.id);
      const wx = cc ? this.latticeToWorld(cc.x, cc.y)[0] : this.originWX;
      const wy = cc ? this.latticeToWorld(cc.x, cc.y)[1] : this.originWY;
      this.dormant.push({ kind: rec.kind, wx, wy });
    }
    this.gm.killCell(rec.id);
    this.attraction.forget(rec.id);
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
