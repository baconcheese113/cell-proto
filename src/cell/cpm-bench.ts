// CPM Monte-Carlo stress bench — a harness to measure the SOLVER in isolation, so perf work
// can iterate in seconds instead of waiting for a live world to spawn in. It builds a real
// CpmSimulation (same profiles/constraints as the game), packs the field to a target
// border-pixel count (default ~30k — the heavy case the user profiled), optionally steers a
// player cell in a circle each step, and times cpm.stepN with a clean warmup + median-of-runs
// so a genuine optimization is distinguishable from JIT/GC noise.
//
// Exposed (DEV) as `window.__cpm.bench(targetBorder)` — runs a fresh isolated sim, so it does
// NOT need the world to populate and does not touch the live game. Call it from the browser
// console or drive it via Playwright to compare optimizations. (It lives with the game code
// rather than as a node script because the CpmSimulation import chain is bundler-resolved.)

import { CpmSimulation } from "./cpm-simulation";
import { checkerboardStepN, parallelWidth } from "./cpm-checkerboard-spike";
import {
  DEFAULT_WORLD_CONFIG,
  PLAYER_PROFILE,
  TISSUE_PROFILE,
  MICROBE_PROFILE,
  ENDOTHELIAL_PROFILE,
  FIBROBLAST_PROFILE,
  DIGESTING_PROFILE,
  GRIPPED_PROFILE,
  DEBRIS_PROFILE,
  type CpmWorldConfig,
} from "./cpm-config";

const CONTROLLED_KIND = 1;
const MICROBE_KIND = 4;

/** Build a sim whose kind table matches the game (so constraint costs are representative). */
export function makeBenchSim(config: CpmWorldConfig = DEFAULT_WORLD_CONFIG): CpmSimulation {
  return new CpmSimulation(
    config,
    [
      PLAYER_PROFILE, // 1 CONTROLLED
      PLAYER_PROFILE, // 2 MACROPHAGE
      TISSUE_PROFILE, // 3 EPITHELIAL
      MICROBE_PROFILE, // 4 MICROBE
      ENDOTHELIAL_PROFILE, // 5 ENDOTHELIAL
      FIBROBLAST_PROFILE, // 6 FIBROBLAST
      DIGESTING_PROFILE, // 7 DIGEST
      DEBRIS_PROFILE, // 8 DEBRIS
      GRIPPED_PROFILE, // 9 GRIPPED
    ],
    CONTROLLED_KIND
  );
}

export interface PackResult {
  sim: CpmSimulation;
  playerId: number;
  border: number;
  cells: number;
}

/** Pack the field with a dense grid of motile microbe-sized cells (high border-to-area, like
 *  the real lumen traffic) plus one player, then settle briefly, until the border-pixel count
 *  reaches ~targetBorder. Returns the settled sim. Deterministic-ish (seeded config RNG). */
export function packToBorder(
  targetBorder: number,
  config: CpmWorldConfig = DEFAULT_WORLD_CONFIG,
  settleSteps = 30
): PackResult {
  const sim = makeBenchSim(config);
  const f = config.fieldSize;
  const radius = 4; // small cells => lots of border per unit area
  const spacing = 10; // packed but not overlapping (denser => more border)
  const margin = 6;

  const player = sim.spawnCellFilled(CONTROLLED_KIND, Math.floor(f / 2), Math.floor(f / 2), 9).id;
  sim.setKindActive(MICROBE_KIND, true);

  let spawned = 0;
  outer: for (let y = margin; y < f - margin; y += spacing) {
    for (let x = margin; x < f - margin; x += spacing) {
      if (sim.ownerAtLattice(x, y) !== 0) continue;
      sim.spawnCellFilled(MICROBE_KIND, x, y, radius);
      // border() is O(field²) — only sample it occasionally to decide when to stop.
      if (++spawned % 40 === 0 && border(sim) >= targetBorder) break outer;
    }
  }
  for (let i = 0; i < settleSteps; i++) sim.step();
  return { sim, playerId: player, border: border(sim), cells: [...sim.getCells()].length };
}

/** Actual border-pixel count (pixels adjacent to a different cell id) — the driver of MC cost. */
export function border(sim: CpmSimulation): number {
  const grid = sim.cpm.grid;
  let n = 0;
  for (const [[x, y], id] of grid.pixels()) {
    const i = grid.p2i([x, y]);
    for (const ni of grid.neighi(i)) {
      if (grid.pixti(ni) !== id) {
        n++;
        break;
      }
    }
  }
  return n;
}

export interface BenchStats {
  border: number;
  cells: number;
  runs: number[];
  medianMsPerStep: number;
  minMsPerStep: number;
  nsPerBorder: number;
}

/** Time cpm.stepN with a warmup + several timed runs; report median (robust to GC spikes).
 *  `steerCircle` moves the player around a circle each MCS to exercise the active path. */
export function benchStep(
  pack: PackResult,
  { warmup = 40, runs = 9, stepsPerRun = 20, steerCircle = true } = {}
): BenchStats {
  const { sim, playerId } = pack;
  const f = sim.field;
  const cx = f / 2;
  const cy = f / 2;
  let phase = 0;
  const steer = (): void => {
    if (!steerCircle) return;
    phase += 0.15;
    sim.steerCell(playerId, cx + Math.cos(phase) * f * 0.3, cy + Math.sin(phase) * f * 0.3);
  };

  for (let i = 0; i < warmup; i++) {
    steer();
    sim.step();
  }
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (let i = 0; i < stepsPerRun; i++) {
      steer();
      sim.stepN(1);
    }
    times.push((performance.now() - t0) / stepsPerRun);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const b = border(sim);
  return {
    border: b,
    cells: [...sim.getCells()].length,
    runs: times.map((t) => +t.toFixed(3)),
    medianMsPerStep: +median.toFixed(3),
    minMsPerStep: +sorted[0].toFixed(3),
    nsPerBorder: +((median * 1e6) / b).toFixed(1),
  };
}

/** Fidelity snapshot: how far cells are from their target volume (health check — a broken
 *  update makes cells collapse/explode/fragment, spiking this) + connected-component count. */
function fidelity(sim: CpmSimulation): { cells: number; meanVolDevPct: number; fragmented: number } {
  const sizes = sim.componentSizesByCell();
  let n = 0;
  let dev = 0;
  let fragmented = 0;
  for (const rec of sim.getCells()) {
    const target = sim.targetVolume(rec.id);
    const c = sim.centroidLattice(rec.id);
    if (target > 0 && c) {
      dev += Math.abs(c.pixels - target) / target;
      n++;
    }
    if ((sizes.get(rec.id)?.length ?? 1) > 1) fragmented++;
  }
  return { cells: n, meanVolDevPct: n ? +((dev / n) * 100).toFixed(1) : 0, fragmented };
}

/** Checkerboard SPIKE comparison: pack two fresh sims to the same border, settle each under its
 *  own step (sequential vs checkerboard) for `mcs` steps, and report timing + fidelity so we can
 *  judge whether the parallel-friendly update preserves the dynamics before building the
 *  substrate. `parallelWidth` = how many independent copy attempts run per phase (the ceiling on
 *  cores/GPU-threads it could use). */
export function spikeCompare(targetBorder = 20000, B = 4, mcs = 80): object {
  const time = (fn: () => void, runs = 30): number => {
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) fn();
    return +((performance.now() - t0) / runs).toFixed(2);
  };
  const seq = packToBorder(targetBorder);
  for (let i = 0; i < mcs; i++) seq.sim.step();
  const seqStats = { msPerMCS: time(() => seq.sim.stepN(1)), ...fidelity(seq.sim) };

  const cb = packToBorder(targetBorder);
  for (let i = 0; i < mcs; i++) checkerboardStepN(cb.sim, 1, B);
  const cbStats = {
    msPerMCS: time(() => checkerboardStepN(cb.sim, 1, B)),
    ...fidelity(cb.sim),
    B,
    parallelWidth: parallelWidth(cb.sim.field, B),
  };
  const out = { border: seq.border, sequential: seqStats, checkerboard: cbStats };
  console.log("🎛️ checkerboard spike (single-threaded — timing not the point; fidelity is):", out);
  return out;
}

/** One-call bench for the DEV console/Playwright: pack a fresh sim to ~targetBorder, time the
 *  solver, and return + log the stats. Independent of the live game (own CpmSimulation). */
export function runBench(targetBorder = 30000, opts?: Parameters<typeof benchStep>[1]): BenchStats {
  const t0 = performance.now();
  const pack = packToBorder(targetBorder);
  const packMs = Math.round(performance.now() - t0);
  const stats = benchStep(pack, opts);
  console.log(
    `🏋️ cpm bench: packed ${pack.cells} cells / ${pack.border} border in ${packMs}ms → ` +
      `${stats.medianMsPerStep}ms/MCS median (min ${stats.minMsPerStep}), ${stats.nsPerBorder}ns/border`,
    stats
  );
  return stats;
}
