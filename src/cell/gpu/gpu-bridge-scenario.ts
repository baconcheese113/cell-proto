// gpu-bridge-scenario.ts — the M-Bridge-1 gate. Proves the GpuStepBridge round-trip: build a real
// Artistoo CpmSimulation, advance it on the GPU through the bridge (export -> step -> write-back),
// and confirm the CPU-side sim is left in a normally-evolved, self-consistent state — a steered cell
// crawled, cells stayed cohesive, volumes held, and grid._pixels / cellvolume agree exactly. A CPU
// control sim (same setup, advanced with sim.stepN) is measured alongside so the bridge's health can
// be read against the ground truth. Headless via window.__cpm.gpuBridgeParity.

import { CpmSimulation } from "../cpm-simulation";
import { GpuStepBridge } from "./gpu-step-bridge";
import { PLAYER_PROFILE, ENEMY_PROFILE, DEFAULT_WORLD_CONFIG } from "../cpm-config";
import type { CpmWorldConfig } from "../cpm-config";
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
