// gpu-bridge-scenario.ts — the M-Bridge-1 gate. Proves the GpuStepBridge round-trip: build a real
// Artistoo CpmSimulation, advance it on the GPU through the bridge (export -> step -> write-back),
// and confirm the CPU-side sim is left in a normally-evolved, self-consistent state — a steered cell
// crawled, cells stayed cohesive, volumes held, and grid._pixels / cellvolume agree exactly. A CPU
// control sim (same setup, advanced with sim.stepN) is measured alongside so the bridge's health can
// be read against the ground truth. Headless via window.__cpm.gpuBridgeParity.

import { CpmSimulation } from "../cpm-simulation";
import { GpuStepBridge } from "./gpu-step-bridge";
import { PLAYER_PROFILE, ENEMY_PROFILE, ENDOTHELIAL_PROFILE, DEFAULT_WORLD_CONFIG } from "../cpm-config";
import type { CpmWorldConfig, CpmCellProfile } from "../cpm-config";
import type { CellId } from "../../vendor/artistoo";

const FIELD = 90;
const PLAYER_START: [number, number] = [26, 45];
const PLAYER_TARGET: [number, number] = [70, 45];
const ENEMY_SPOTS: [number, number][] = [[45, 20], [58, 66], [30, 70]];

/** Build an identical bench sim: a steerable player + a few resting enemies on an empty field.
 *  Player kind is set active (crawling) and steered toward PLAYER_TARGET. Returns the sim + player id. */
function buildBench(): { sim: CpmSimulation; playerId: CellId } {
  const cfg: CpmWorldConfig = {
    ...DEFAULT_WORLD_CONFIG,
    fieldSize: FIELD,
    temperature: 20, // match the established GPU move-test regime
    stepsPerFrame: 1,
    seed: 1,
  };
  const sim = new CpmSimulation(cfg, [PLAYER_PROFILE, ENEMY_PROFILE]);
  const player = sim.spawnCellFilled(1, PLAYER_START[0], PLAYER_START[1], 9);
  for (const [x, y] of ENEMY_SPOTS) sim.spawnCellFilled(2, x, y, 6);
  sim.setKindActive(1, true); // player protrudes (crawls) while steered
  sim.steerCell(player.id, PLAYER_TARGET[0], PLAYER_TARGET[1]);
  return { sim, playerId: player.id };
}

interface Health {
  fractionOfWay: number; // % of the way the player crawled toward its target
  fragmented: number; // cells with >1 connected component
  meanVolDevPct: number; // mean |actual - target| / target over live cells
  consistent: boolean; // sum(cellvolume) === count(non-bg pixels)
  cells: number;
}

/** Measure sim health from Artistoo's own reads (the surfaces the write-back must populate). */
function measure(sim: CpmSimulation, playerId: CellId, startX: number): Health {
  const cents = sim.centroidsAll();
  const player = cents.get(playerId);
  const fractionOfWay = player
    ? ((player.x - startX) / (PLAYER_TARGET[0] - startX)) * 100
    : 0;

  const comps = sim.componentSizesByCell();
  let fragmented = 0;
  for (const sizes of comps.values()) if (sizes.length > 1) fragmented++;

  let devSum = 0, n = 0;
  for (const rec of sim.getCells()) {
    const c = cents.get(rec.id);
    if (!c) continue;
    const target = rec.profile.volume;
    if (target > 0) { devSum += Math.abs(c.pixels - target) / target; n++; }
  }
  const meanVolDevPct = n ? (devSum / n) * 100 : 0;

  // Self-consistency: cellvolume bookkeeping must equal the actual pixel census.
  let volSum = 0;
  const cv = (sim.cpm as unknown as { cellvolume: number[] }).cellvolume;
  for (const key in cv) volSum += cv[+key] || 0;
  let pixels = 0;
  for (const _ of sim.cpm.grid.pixels()) pixels++;

  return {
    fractionOfWay: +fractionOfWay.toFixed(0),
    fragmented,
    meanVolDevPct: +meanVolDevPct.toFixed(1),
    consistent: volSum === pixels,
    cells: n,
  };
}

/** Run the GPU-bridge sim and a CPU control for `mcs` steps and report both health snapshots. */
export async function gpuBridgeParity(mcs = 1000): Promise<object> {
  // --- CPU control ---
  const cpu = buildBench();
  const cpuStartX = cpu.sim.centroidsAll().get(cpu.playerId)?.x ?? PLAYER_START[0];
  cpu.sim.stepN(mcs);
  const cpuHealth = measure(cpu.sim, cpu.playerId, cpuStartX);

  // --- GPU bridge ---
  const gpu = buildBench();
  const gpuStartX = gpu.sim.centroidsAll().get(gpu.playerId)?.x ?? PLAYER_START[0];
  const bridge = await GpuStepBridge.create(gpu.sim);
  if ("error" in bridge) return { error: bridge.error };
  // Advance in batches to exercise the per-tick round-trip (export -> step -> write-back) repeatedly,
  // which is exactly how WorldSim.tick will drive it — and the real test of sync stability.
  const batch = 40;
  let dead = 0;
  for (let done = 0; done < mcs; done += batch) {
    const r = await bridge.step(Math.min(batch, mcs - done));
    dead += r.dead.length;
  }
  const gpuHealth = measure(gpu.sim, gpu.playerId, gpuStartX);
  bridge.destroy();

  return {
    mcs,
    cpu_fractionOfWay: cpuHealth.fractionOfWay,
    cpu_fragmented: cpuHealth.fragmented,
    cpu_meanVolDevPct: cpuHealth.meanVolDevPct,
    cpu_consistent: cpuHealth.consistent,
    gpu_fractionOfWay: gpuHealth.fractionOfWay,
    gpu_fragmented: gpuHealth.fragmented,
    gpu_meanVolDevPct: gpuHealth.meanVolDevPct,
    gpu_consistent: gpuHealth.consistent,
    gpu_dead: dead,
    cells: gpuHealth.cells,
  };
}

/** Boundary-sharpness diagnostic: press two different-kind, at-rest cells together and settle, then
 *  measure how crisp their shared membrane is on CPU (sequential) vs GPU (cell-parallel). "Jello"
 *  boundaries show up as higher perimeter (rougher membrane) + more DEEP interlocking pixels (a cell
 *  pixel with >=3 unlike-cell neighbours = the two cells fraying into each other). */
export async function gpuBridgeBoundaryTest(mcs = 800): Promise<object> {
  const field = 80;
  const NB: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const build = (): { sim: CpmSimulation; a: CellId } => {
    // DENSE pack: a grid of small resting cells, alternating kinds 1/2 so every neighbour is unlike
    // (real cell-cell boundaries everywhere). The 2-cell case matches CPU exactly; the jello only
    // shows up under DENSITY, where the cell-parallel step's simultaneous boundary contention scales.
    const cfg: CpmWorldConfig = { ...DEFAULT_WORLD_CONFIG, fieldSize: field, temperature: 20, stepsPerFrame: 1, seed: 1 };
    // FLOPPY tissue-like profile: lambdaP 0 / perimeter 0 (no membrane tension), sessile (no Act) —
    // exactly the endothelial/fibroblast cells that go rough on the GPU in the live world.
    const FLOPPY: CpmCellProfile = { ...PLAYER_PROFILE, perimeter: 0, lambdaP: 0, maxAct: 0, lambdaAct: 0, lambdaActRest: 0 };
    const sim = new CpmSimulation(cfg, [FLOPPY, FLOPPY]);
    let first = 0;
    const step = 11;
    for (let gy = 12; gy <= field - 12; gy += step) {
      for (let gx = 12; gx <= field - 12; gx += step) {
        const kind = ((gx + gy) / step) % 2 === 0 ? 1 : 2;
        const c = sim.spawnCellFilled(kind, gx, gy, 5);
        if (!first) first = c.id;
      }
    }
    sim.setKindActive(1, false);
    sim.setKindActive(2, false);
    return { sim, a: first };
  };
  const measure = (sim: CpmSimulation): { perim: number; iface: number; deep: number; activeFrac: number; cells: number } => {
    const f = field;
    const kindAt = new Int32Array(f * f);
    let cellPix = 0, active = 0;
    for (const [[x, y], id] of sim.cpm.grid.pixels()) {
      kindAt[y * f + x] = sim.cpm.cellKind(id);
      cellPix++;
      if (sim.activityAtIndex(sim.cpm.grid.p2i([x, y])) > 0) active++;
    }
    const at = (x: number, y: number): number => (x < 0 || x >= f || y < 0 || y >= f ? 0 : kindAt[y * f + x]);
    let perim = 0, iface = 0, deep = 0;
    for (let y = 0; y < f; y++) {
      for (let x = 0; x < f; x++) {
        const k = kindAt[y * f + x];
        if (k === 0) continue;
        let unlike = 0, other = 0;
        for (const [dx, dy] of NB) {
          const nk = at(x + dx, y + dy);
          if (nk !== k) unlike++;
          if (nk !== 0 && nk !== k) other++;
        }
        perim += unlike; // CPM perimeter (unlike-neighbour count) summed over both cells
        if (other > 0) { iface++; if (other >= 3) deep++; }
      }
    }
    return { perim, iface, deep, activeFrac: cellPix ? active / cellPix : 0, cells: cellPix };
  };

  // Churn: fraction of lattice pixels that CHANGE owner in one MCS after settling. High churn = a
  // jittery, shimmering membrane (visual "jello") even when the time-averaged shape is fine.
  const cpu = build();
  cpu.sim.stepN(mcs);
  const cpuBefore = snapshotLattice(cpu.sim, field);
  cpu.sim.stepN(1);
  const cpuChurn = latticeDiff(cpuBefore, cpu.sim, field);
  const cpuM = measure(cpu.sim);

  const gpu = build();
  const bridge = await GpuStepBridge.create(gpu.sim);
  if ("error" in bridge) return { error: bridge.error };
  for (let done = 0; done < mcs; done += 40) await bridge.step(Math.min(40, mcs - done));
  const gpuBefore = snapshotLattice(gpu.sim, field);
  await bridge.step(1);
  const gpuChurn = latticeDiff(gpuBefore, gpu.sim, field);
  const gpuM = measure(gpu.sim);
  bridge.destroy();

  return {
    targetPerim: PLAYER_PROFILE.perimeter,
    cpu_perim: cpuM.perim, cpu_deep: cpuM.deep, cpu_activeFrac: +cpuM.activeFrac.toFixed(3), cpu_churn: cpuChurn,
    gpu_perim: gpuM.perim, gpu_deep: gpuM.deep, gpu_activeFrac: +gpuM.activeFrac.toFixed(3), gpu_churn: gpuChurn,
    activeFracRatio: +(gpuM.activeFrac / Math.max(0.001, cpuM.activeFrac)).toFixed(2), // >1 => GPU "hotter"
    churnRatio: +(gpuChurn / Math.max(1, cpuChurn)).toFixed(2), // >1 => GPU membrane jitters more per MCS
  };
}

/** Snapshot the tight (y*field+x) lattice ids. */
function snapshotLattice(sim: CpmSimulation, field: number): Int32Array {
  const out = new Int32Array(field * field);
  for (const [[x, y], id] of sim.cpm.grid.pixels()) out[y * field + x] = id;
  return out;
}
/** Count pixels whose owner id changed vs the snapshot. */
function latticeDiff(before: Int32Array, sim: CpmSimulation, field: number): number {
  const now = snapshotLattice(sim, field);
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

/** Frozen (wall-sleep) fidelity: a FROZEN cell must be perfectly static — its pixels never change —
 *  exactly like the CPU PermeableBarrierConstraint pins it. Two adjacent floppy cells, both frozen;
 *  a frozen cell's border must not move at all. Reproduces the live "jello lining" if GPU freeze leaks. */
export async function gpuBridgeFrozenTest(mcs = 400): Promise<object> {
  const field = 64;
  const FLOPPY: CpmCellProfile = { ...PLAYER_PROFILE, perimeter: 0, lambdaP: 0, maxAct: 0, lambdaAct: 0, lambdaActRest: 0 };
  const border = (sim: CpmSimulation, id: number): number => {
    const f = field;
    const idAt = new Int32Array(f * f);
    for (const [[x, y], v] of sim.cpm.grid.pixels()) idAt[y * f + x] = v;
    const at = (x: number, y: number): number => (x < 0 || x >= f || y < 0 || y >= f ? -1 : idAt[y * f + x]);
    let b = 0;
    for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) {
      if (idAt[y * f + x] !== id) continue;
      for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as [number,number][]) if (at(x + dx, y + dy) !== id) b++;
    }
    return b;
  };
  const build = (): { sim: CpmSimulation; a: number } => {
    const cfg: CpmWorldConfig = { ...DEFAULT_WORLD_CONFIG, fieldSize: field, temperature: 20, stepsPerFrame: 1, seed: 1 };
    const sim = new CpmSimulation(cfg, [FLOPPY, FLOPPY]);
    const a = sim.spawnCellFilled(1, 26, 32, 8);
    const b = sim.spawnCellFilled(2, 42, 32, 8);
    sim.setKindActive(1, false); sim.setKindActive(2, false);
    sim.setCellFrozen(a.id, true); sim.setCellFrozen(b.id, true);
    return { sim, a: a.id };
  };
  const cpu = build();
  const cpuBefore = border(cpu.sim, cpu.a);
  cpu.sim.stepN(mcs);
  const cpuAfter = border(cpu.sim, cpu.a);

  const gpu = build();
  const gpuBefore = border(gpu.sim, gpu.a);
  const bridge = await GpuStepBridge.create(gpu.sim);
  if ("error" in bridge) return { error: bridge.error };
  for (let done = 0; done < mcs; done += 40) await bridge.step(Math.min(40, mcs - done));
  const gpuAfter = border(gpu.sim, gpu.a);
  bridge.destroy();

  return {
    cpu_before: cpuBefore, cpu_after: cpuAfter, cpu_changed: cpuAfter - cpuBefore,
    gpu_before: gpuBefore, gpu_after: gpuAfter, gpu_changed: gpuAfter - gpuBefore,
  };
}

/** Spawn survival: a cell spawned MID-RUN must not immediately dissolve. Reproduces the live report
 *  "too many cells dissolving on spawn". Runs with generous id headroom so this isolates step
 *  DYNAMICS (not a capacity/rebuild miss). Reports the new cell's pixel count right after spawn vs
 *  after more steps, CPU vs GPU. */
export async function gpuBridgeSpawnTest(mcs = 300, headroom = 200): Promise<object> {
  const field = 80;
  const run = async (useGpu: boolean): Promise<{ before: number; after: number; rebuilds: number }> => {
    const cfg: CpmWorldConfig = { ...DEFAULT_WORLD_CONFIG, fieldSize: field, temperature: 20, stepsPerFrame: 1, seed: 1 };
    const sim = new CpmSimulation(cfg, [PLAYER_PROFILE, ENEMY_PROFILE]);
    // a crowd of active cells (like the busy lumen a promoted cell spawns into)
    for (let gy = 16; gy <= field - 16; gy += 16) for (let gx = 16; gx <= field - 16; gx += 16) {
      sim.spawnCellFilled(((gx + gy) / 16) % 2 === 0 ? 1 : 2, gx, gy, 6);
    }
    sim.setKindActive(1, true); sim.setKindActive(2, true);
    let bridge: GpuStepBridge | null = null;
    let rebuilds = 0;
    if (useGpu) {
      const b = await GpuStepBridge.create(sim, { idHeadroom: headroom });
      if ("error" in b) return { before: -1, after: -1, rebuilds: 0 };
      bridge = b;
    }
    // WorldSim-style step: rebuild the bridge if a spawn outgrew capacity (mirrors WorldSim.gpuStep).
    const step = async (n: number): Promise<void> => {
      if (!bridge) { sim.stepN(n); return; }
      if (GpuStepBridge.maxLiveId(sim) > bridge.capacity) {
        bridge.destroy();
        const b = await GpuStepBridge.create(sim, { idHeadroom: headroom });
        if ("error" in b) return;
        bridge = b; rebuilds++;
      }
      for (let d = 0; d < n; d += 40) await bridge.step(Math.min(40, n - d));
    };
    await step(mcs);
    const nc = sim.spawnCellFilled(2, 40, 40, 6); // spawn a fresh, properly-sized active cell mid-run
    const before = sim.centroidLattice(nc.id)?.pixels ?? 0;
    await step(mcs);
    const after = sim.centroidLattice(nc.id)?.pixels ?? 0;
    bridge?.destroy();
    return { before, after, rebuilds };
  };
  const cpu = await run(false);
  const gpu = await run(true);
  return {
    targetVol: ENEMY_PROFILE.volume, headroom,
    cpu_before: cpu.before, cpu_after: cpu.after,
    gpu_before: gpu.before, gpu_after: gpu.after, gpu_rebuilds: gpu.rebuilds,
  };
}

/** Diapedesis vs smoothing sweep: an immune cell (strong Act) must push THROUGH a cohesive lining
 *  band (immune↔lining adhesion=100, so Act drives it through). GPU-only perimeter tension on the
 *  lining (smoothKinds) resists that poke. Sweeps the lining lambdaP and reports how far the immune
 *  cell got past the lining for each — so we can pick the largest lambdaP that still transmigrates. */
export async function gpuBridgeDiapedesisTest(mcs = 2500): Promise<object> {
  const field = 70;
  const liningY0 = 30, liningY1 = 40; // lining band rows
  const runOne = async (liningLambdaP: number): Promise<number> => {
    const cfg: CpmWorldConfig = { ...DEFAULT_WORLD_CONFIG, fieldSize: field, temperature: 20, stepsPerFrame: 1, seed: 1 };
    // kind 1 = immune (PLAYER: strong Act), kind 2 = lining (ENDOTHELIAL: inert, cohesive).
    const sim = new CpmSimulation(cfg, [PLAYER_PROFILE, ENDOTHELIAL_PROFILE]);
    // two lining cells forming a band with a junction at x=field/2 (the immune pushes the junction).
    sim.spawnCellFilled(2, Math.round(field * 0.3), 35, 0); // seed; grow via stamping below
    // stamp the band directly as two kind-2 cells
    const mid = Math.round(field / 2);
    const stampBand = (kind: number, x0: number, x1: number): void => {
      const rec = sim.spawnCellAtLattice(kind, Math.round((x0 + x1) / 2), 35);
      for (let y = liningY0; y < liningY1; y++) for (let x = x0; x < x1; x++) {
        if (sim.ownerAtLattice(x, y) === 0) (sim.cpm as unknown as { setpix(p: [number, number], t: number): void }).setpix([x, y], rec.id);
      }
    };
    stampBand(2, 8, mid);
    stampBand(2, mid, field - 8);
    const immune = sim.spawnCellFilled(1, mid, 54, 7);
    // diapedesis adhesion (mirror world-sim): immune↔lining expensive, lining cohesive.
    sim.setKindAdhesion(1, 2, 100);
    sim.setKindAdhesion(2, 2, 20);
    sim.setKindActive(1, true);
    sim.setKindActive(2, false);
    sim.steerCell(immune.id, mid, 6); // drive the immune cell UP through the lining

    const bridge = await GpuStepBridge.create(sim, {
      smoothKinds: liningLambdaP > 0 ? { kinds: [2], lambdaP: liningLambdaP } : undefined,
    });
    if ("error" in bridge) return NaN;
    for (let done = 0; done < mcs; done += 40) await bridge.step(Math.min(40, mcs - done));
    bridge.destroy();
    // How far ABOVE the lining top (liningY0) the immune centroid got. >0 = broke through.
    const c = sim.centroidsAll().get(immune.id);
    return c ? +(liningY0 - c.y).toFixed(1) : NaN; // positive => above the lining = transmigrated
  };
  const out: Record<string, number> = {};
  for (const lp of [0, 0.5, 1, 2]) out[`lambdaP_${lp}`] = await runOne(lp);
  return out; // per lambdaP: immune centroid's px ABOVE the lining top (>0 means it transmigrated)
}

/** Flow gate (M-Bridge-2): a resting, unsteered flowing-kind cell should drift DOWNSTREAM under the
 *  vessel current when it's on, and barely move when it's off. Proves CpmFlowConstraint is mirrored
 *  into the GPU step through the bridge (upload + shader term). */
export async function gpuBridgeFlowTest(mcs = 800): Promise<object> {
  const field = 80;
  const startX = 20;
  const runOne = async (flowLambda: number): Promise<number> => {
    const cfg: CpmWorldConfig = { ...DEFAULT_WORLD_CONFIG, fieldSize: field, temperature: 20, stepsPerFrame: 1, seed: 1 };
    const sim = new CpmSimulation(cfg, [PLAYER_PROFILE, ENEMY_PROFILE]);
    const cell = sim.spawnCellFilled(1, startX, 40, 8);
    sim.setKindActive(1, false); // rest (player lambdaActRest=0 => still); flow is the only force
    sim.flow.setFlowingKinds([1]);
    sim.flow.setFlow(1, 0, flowLambda); // +x current
    const bridge = await GpuStepBridge.create(sim);
    if ("error" in bridge) return NaN;
    for (let done = 0; done < mcs; done += 40) await bridge.step(Math.min(40, mcs - done));
    bridge.destroy();
    return sim.centroidsAll().get(cell.id)?.x ?? NaN;
  };
  const withFlowX = await runOne(60);
  const noFlowX = await runOne(0);
  return {
    startX,
    withFlowX: +withFlowX.toFixed(1),
    noFlowX: +noFlowX.toFixed(1),
    drift: +(withFlowX - noFlowX).toFixed(1), // downstream displacement attributable to the current
  };
}
