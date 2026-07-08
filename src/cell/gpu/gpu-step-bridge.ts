// gpu-step-bridge.ts — the RETROFIT seam. Keeps the CPU-side Artistoo CpmSimulation authoritative
// for ALL game logic/structure and offloads ONLY the Monte-Carlo step to a GpuCpm. Each tick it
// exports the live Artistoo state into GPU-resident buffers, runs the cell-parallel step on the GPU,
// then writes the stepped lattice/volume/perimeter/activity back into Artistoo's own arrays — so
// every downstream reader (rendering, centroids, rules, streaming) sees a normally-evolved sim,
// just advanced on the GPU instead of in `cpm.timeStep()`.
//
// This is a straight substitution for `sim.stepN(n)`. It preserves the feel-critical constraint set
// the GpuCpm supports: Adhesion (J) + Volume + Act (crawl) + Perimeter + per-cell steering + the
// hard permeable-barrier. Footprint (nucleus) + Flow are NOT yet ported into the GPU step — see the
// KNOWN GAPS note at the bottom — so a sim relying on those will diverge until M-Bridge-2.

import { GpuCpm } from "./cpm-gpu";
import { flattenJ } from "./cpm-gpu-encoding";
import { buildKindColorLut } from "./cpm-gpu-palette";
import type { CpmSimulation } from "../cpm-simulation";

// --- minimal structural views into the Artistoo internals the bridge touches. -------------------
interface CpmConf {
  T: number;
  J: number[][];
  V: number[];
  P: number[];
  LAMBDA_V: number[];
  LAMBDA_P: number[];
  LAMBDA_ACT: number[];
  MAX_ACT: number[];
  torus: boolean[];
}
interface CpmGrid {
  _pixels: Uint16Array;
  Y_BITS: number;
  Y_MASK: number;
}
interface CpmInternals {
  grid: CpmGrid;
  conf: CpmConf;
  t2k: number[];
  cellvolume: number[];
  nr_cells: number;
  getConstraint(name: string): unknown;
}
interface ActConstraint { cellpixelsact: Record<number, number>; }
interface PerimConstraint { cellperimeters: Record<number, number>; }
interface AttractConstraint {
  targets: Map<number, [number, number]>;
  lambdas: Map<number, number>;
}
interface FlowConstraint {
  dirX: number; dirY: number; strength: number; flowKindsBitmask(): number;
}
interface FootprintConstraint {
  host: number; strength: number; writeTightMask(out: Uint32Array, field: number): void;
}

export interface GpuStepBridgeOptions {
  /** Kind that may cross barrier boundaries (the player). Mirror the sim's barrierPermeableKind. */
  permeableKind?: number;
  /** Kinds that act as hard barriers (debris/walls). */
  barrierKinds?: number[];
}

/** Export the live Artistoo state into GPU-tight (y*field+x) buffers. Lattice + activity are
 *  remapped from Artistoo's padded x-major index (i = (x<<yBits)+y). Per-cell kind/targetVol/steer
 *  are indexed by cell id. Free function so both create() and step() share it without needing a
 *  half-built instance. */
function exportArtistooState(
  cpm: CpmInternals, act: ActConstraint, attract: AttractConstraint,
  field: number, volN: number, yBits: number, yMask: number,
  isFrozen: (id: number) => boolean,
): { lattice: Int32Array; actArr: Int32Array; kind: Int32Array; targetVol: Float32Array; steer: Float32Array } {
  const f = field, N = f * f;
  const xStep = 1 << yBits;
  const px = cpm.grid._pixels;

  // lattice: padded x-major -> tight y-major.
  const lattice = new Int32Array(N);
  for (let y = 0; y < f; y++) {
    for (let x = 0; x < f; x++) {
      const id = px[x * xStep + y];
      if (id > 0) lattice[y * f + x] = id;
    }
  }

  // activity: sparse padded index -> tight index.
  const actArr = new Int32Array(N);
  const cpa = act.cellpixelsact;
  for (const key in cpa) {
    const pi = +key;
    const a = cpa[pi];
    if (a > 0) actArr[((pi & yMask) * f) + (pi >> yBits)] = a;
  }

  // per-cell kind + target volume (index 0 = background).
  const kind = new Int32Array(volN);
  const targetVol = new Float32Array(volN);
  const t2k = cpm.t2k, V = cpm.conf.V;
  for (let id = 1; id < volN; id++) {
    const k = t2k[id];
    if (k === undefined || k === 0) continue;
    kind[id] = k;
    targetVol[id] = V[k] ?? 0;
  }

  // per-cell steering (vec4: targetX, targetY, lambda, frozen).
  const steer = new Float32Array(volN * 4);
  for (const [id, tgt] of attract.targets) {
    if (id <= 0 || id >= volN) continue;
    const l = attract.lambdas.get(id) ?? 0;
    if (l <= 0) continue;
    steer[id * 4] = tgt[0];
    steer[id * 4 + 1] = tgt[1];
    steer[id * 4 + 2] = l;
  }
  // frozen (wall-sleep): a settled far-from-player wall is a hard barrier on the GPU too, so the
  // vessel lining doesn't drift. Set the w-component for every frozen live cell (even λ=0 ones).
  for (let id = 1; id < volN; id++) {
    if (kind[id] !== 0 && isFrozen(id)) steer[id * 4 + 3] = 1;
  }

  return { lattice, actArr, kind, targetVol, steer };
}

export class GpuStepBridge {
  private constructor(
    private readonly gpu: GpuCpm,
    private readonly sim: CpmSimulation,
    private readonly cpm: CpmInternals,
    private readonly act: ActConstraint,
    private readonly perim: PerimConstraint,
    private readonly attract: AttractConstraint,
    private readonly flow: FlowConstraint,
    private readonly foot: FootprintConstraint,
    private readonly field: number,
    /** Buffer capacity = highest cell id the GPU buffers can address + 1. */
    private readonly volN: number,
    private readonly yBits: number,
    private readonly yMask: number,
  ) {}

  /** Reusable tight footprint-mask scratch (lazily sized; rebuilt each step). */
  private fpMask: Uint32Array | null = null;

  /** Highest cell id the GPU buffers can address. Exceed it (a spawn beyond headroom) and the
   *  caller must rebuild the bridge with a bigger allocation. */
  get capacity(): number { return this.volN - 1; }

  /** Highest live cell id currently on the grid (drives GPU buffer sizing / rebuild checks). */
  static maxLiveId(sim: CpmSimulation): number {
    const cv = (sim.cpm as unknown as { cellvolume: number[] }).cellvolume;
    let m = 0;
    for (const key in cv) {
      const id = +key;
      if (cv[id] > 0 && id > m) m = id;
    }
    return m;
  }

  /** Build a GpuCpm from a CpmSimulation's current static config + state. `idHeadroom` over-allocates
   *  the per-cell buffers so a few spawns after build still fit without a rebuild (0 = exact fit). */
  static async create(
    sim: CpmSimulation,
    opts: GpuStepBridgeOptions & { idHeadroom?: number } = {},
  ): Promise<GpuStepBridge | { error: string }> {
    const cpm = sim.cpm as unknown as CpmInternals;
    const field = sim.field;
    const conf = cpm.conf;
    const grid = cpm.grid;
    const yBits = grid.Y_BITS;
    const yMask = grid.Y_MASK;

    const { J, nKinds } = flattenJ(conf.J); // nKinds = full matrix dim (includes background)
    const maxId = GpuStepBridge.maxLiveId(sim) + (opts.idHeadroom ?? 0);
    const volN = maxId + 1;

    const act = cpm.getConstraint("ActivityConstraint") as ActConstraint;
    const perim = cpm.getConstraint("PerimeterConstraint") as PerimConstraint;
    const attract = cpm.getConstraint("PerCellAttractionConstraint") as AttractConstraint;
    const flow = cpm.getConstraint("CpmFlowConstraint") as FlowConstraint;
    const foot = cpm.getConstraint("CpmFootprintConstraint") as FootprintConstraint;

    // GpuCpm carries a single scalar lambdaV (per-cell target volume, but one shared strength).
    // Use kind 1's; the bench keeps LAMBDA_V uniform so this is exact. (Per-kind lambdaV is a
    // known GPU-shader gap — see the note at the bottom.)
    const lambdaV = conf.LAMBDA_V[1] ?? 50;

    // Framebuffer is unused by the retrofit (WorldSim renders itself from grid._pixels), but
    // GpuCpm.create requires a lut for its colour-map pass. A neutral one is fine.
    const lut = buildKindColorLut(new Array(nKinds).fill(0x000000));

    const { lattice, actArr, kind, targetVol } =
      exportArtistooState(cpm, act, attract, field, volN, yBits, yMask, (id) => sim.isFrozen(id));

    const gpu = await GpuCpm.create({
      field, lambdaV, T: conf.T, J, nKinds, lut,
      lattice, kind, targetVol, maxId,
      maxAct: conf.MAX_ACT, lambdaAct: conf.LAMBDA_ACT,
      lambdaP: conf.LAMBDA_P, targetP: conf.P,
      permeableKind: opts.permeableKind, barrierKinds: opts.barrierKinds,
    });
    if ("error" in gpu) return gpu;
    gpu.uploadAct(actArr);
    // Seed the resident vol/perim baselines from the uploaded lattice.
    gpu.recomputeReductions();
    return new GpuStepBridge(gpu, sim, cpm, act, perim, attract, flow, foot, field, volN, yBits, yMask);
  }

  /** Advance the sim `n` Monte-Carlo steps on the GPU and write the result back into Artistoo.
   *  Returns the ids of any cells that died on the GPU (lost all pixels) so the caller can
   *  reconcile its own bookkeeping (CellRecord map, agent tier). */
  async step(n: number): Promise<{ dead: number[] }> {
    // export live Artistoo state -> upload -> refresh baselines -> step
    const { lattice, actArr, kind, targetVol, steer } = exportArtistooState(
      this.cpm, this.act, this.attract, this.field, this.volN, this.yBits, this.yMask,
      (id) => this.sim.isFrozen(id),
    );
    const conf = this.cpm.conf;
    // Per-kind params are mutated live (setKindActive -> LAMBDA_ACT, perimeter budget -> P), so
    // re-upload them every step or the player's crawl toggle + perimeter budget would be frozen
    // at build state.
    this.gpu.uploadKindParams(conf.MAX_ACT, conf.LAMBDA_ACT, conf.LAMBDA_P, conf.P);
    this.gpu.uploadLattice(lattice);
    this.gpu.uploadAct(actArr);
    this.gpu.uploadKind(kind);
    this.gpu.uploadTargetVol(targetVol);
    this.gpu.uploadSteer(steer);
    // Flow (vessel current) + Footprint (nucleus coupling), mirrored from the CPU constraints.
    if (!this.fpMask) this.fpMask = new Uint32Array(this.field * this.field);
    this.foot.writeTightMask(this.fpMask, this.field);
    this.gpu.uploadFootprint(this.fpMask);
    this.gpu.setFlowFootprint(
      this.flow.dirX, this.flow.dirY, this.flow.strength,
      this.foot.strength, this.foot.host, this.flow.flowKindsBitmask(),
    );
    this.gpu.recomputeReductions();
    this.gpu.stepCellParallelN(n);
    return this.writeBack();
  }

  /** Pull the stepped lattice/perimeter/activity off the GPU and write them back into Artistoo's
   *  arrays directly (NOT via setpixi replay, which would reset Act + is O(changed×listeners)).
   *  Volume is recounted from the downloaded lattice so grid._pixels and cellvolume stay exactly
   *  consistent. */
  private async writeBack(): Promise<{ dead: number[] }> {
    const f = this.field;
    const xStep = 1 << this.yBits;
    // Serial, not Promise.all: readLattice + readAct share one staging buffer (latStaging) and
    // readPerimeters shares volStaging with readVolumes — concurrent maps collide ("outstanding map").
    const lat = await this.gpu.readLattice();
    const perimArr = await this.gpu.readPerimeters();
    const actArr = await this.gpu.readAct();

    // Rewrite the padded pixel array from the tight lattice; recount volumes as we go.
    const px = this.cpm.grid._pixels;
    const vol: number[] = [];
    for (let y = 0; y < f; y++) {
      for (let x = 0; x < f; x++) {
        const id = lat[y * f + x];
        px[x * xStep + y] = id;
        if (id > 0) vol[id] = (vol[id] ?? 0) + 1;
      }
    }

    // Reconcile per-cell bookkeeping: keep survivors, drop cells that lost all pixels on the GPU.
    const dead: number[] = [];
    const t2k = this.cpm.t2k;
    const cellperimeters = this.perim.cellperimeters;
    let nr = 0;
    for (let id = 1; id < this.volN; id++) {
      const v = vol[id] ?? 0;
      if (v > 0) {
        nr++;
        cellperimeters[id] = perimArr[id] ?? 0;
      } else if (t2k[id] !== undefined) {
        dead.push(id);
        delete t2k[id];
        delete cellperimeters[id];
      }
    }
    this.cpm.cellvolume = vol;
    this.cpm.nr_cells = nr;

    // Activity write-back (rendering-only). Rebuild the sparse map keyed by padded index.
    const cpa: Record<number, number> = {};
    for (let y = 0; y < f; y++) {
      for (let x = 0; x < f; x++) {
        const a = actArr[y * f + x];
        if (a > 0) cpa[(x * xStep) + y] = a;
      }
    }
    this.act.cellpixelsact = cpa;

    return { dead };
  }

  destroy(): void {
    this.gpu.destroy();
  }
}

// KNOWN GAPS:
//  - lambdaV is a single scalar on the GPU; per-kind LAMBDA_V is not honoured (kindParams carries
//    maxAct/lambdaAct/lambdaP/targetP but not lambdaV).
//  - Live per-kind conf changes (setKindActive -> LAMBDA_ACT, perimeter-budget retarget -> P) are
//    captured only at create(); a per-tick kindParams re-upload is needed for the live world.
//  - cpm.borderpixels / _neighbours are left stale after a GPU step (the CPU no longer steps). If any
//    CPU timeStep or border-stat runs post-step they must be rebuilt first.
