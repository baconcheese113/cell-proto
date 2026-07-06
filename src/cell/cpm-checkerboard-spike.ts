// cpm-checkerboard-spike.ts — CHEAP, single-threaded validation of a checkerboard CPM update,
// BEFORE investing in GPU/multi-worker parallelism. The parallel lever needs a checkerboard so
// non-adjacent lattice regions can update concurrently; but a checkerboard changes the update
// ORDER vs Artistoo's sequential border-sampling MC. The open question is FIDELITY: do cells
// still crawl / seal / deform believably? This runs the checkerboard ORDER single-threaded (so
// it is NOT faster here — that's expected) purely so we can judge the algorithm on the bench
// and by eye (world-sim can swap its step to this via `useCheckerboard`). If the dynamics hold,
// the same scheme ports to N workers over a SharedArrayBuffer or to a WebGPU compute shader.
//
// Scheme: tile the lattice into B×B blocks; 4-COLOUR the blocks by (blockCol&1, blockRow&1) so
// simultaneously-updated blocks are ≥2 blocks apart in every direction (their 1-pixel copy
// reach + border bookkeeping can't collide when parallelised). Each block attempts ONE copy
// into a random pixel it owns. A random per-MCS offset moves the seams so the tiling leaves no
// artefact. Per-attempt math (hard constraints → deltaH → docopy → setpixi) is IDENTICAL to
// Artistoo's timeStep, so only the SELECTION/ORDER differs.

import type { CpmSimulation } from "./cpm-simulation";

/** The Artistoo CPM internals the step needs (loosely typed — this is a spike). */
interface RawCPM {
  grid: {
    extents: number[];
    p2i(p: number[]): number;
    pixti(i: number): number;
    neighi(i: number): number[];
  };
  deltaH(si: number, ti: number, st: number, tt: number): number;
  docopy(dH: number): boolean;
  setpixi(i: number, t: number): void;
  hard_constraints: Array<{
    fulfilled(si: number, ti: number, st: number, tt: number): boolean;
  }>;
  random(): number;
  time: number;
  stat_values: object;
  post_mcs_listeners: Array<() => void>;
}

/** One checkerboard MCS (see file header). `B` = block edge in lattice px. Each active block
 *  makes one BORDER-biased copy attempt: it scans its B² pixels for ones that border a
 *  different cell and attempts a copy at one of them. Border-biasing is ESSENTIAL — sampling a
 *  random block pixel (mostly cell interior) starves the leading-edge attempts the Act model
 *  needs, so cells hold their shape but stop crawling. A real parallel impl keeps a per-block
 *  border list instead of rescanning; the scan here is the single-threaded stand-in. */
export function checkerboardStep(cpm: RawCPM, B = 4): void {
  const grid = cpm.grid;
  const W = grid.extents[0];
  const H = grid.extents[1];
  const ox = (cpm.random() * B) | 0;
  const oy = (cpm.random() * B) | 0;
  const border: number[] = []; // reused per block
  // 4 colour classes: (blockCol&1, blockRow&1). Members are 2 blocks apart -> parallel-safe.
  for (let cls = 0; cls < 4; cls++) {
    const wantCol = cls & 1;
    const wantRow = (cls >> 1) & 1;
    for (let by = -oy; by < H; by += B) {
      if ((Math.round((by + oy) / B) & 1) !== wantRow) continue;
      for (let bx = -ox; bx < W; bx += B) {
        if ((Math.round((bx + ox) / B) & 1) !== wantCol) continue;
        // collect this block's border pixels (bordering a different cell)
        border.length = 0;
        for (let dy = 0; dy < B; dy++) {
          const y = by + dy;
          if (y < 0 || y >= H) continue;
          for (let dx = 0; dx < B; dx++) {
            const x = bx + dx;
            if (x < 0 || x >= W) continue;
            const i = grid.p2i([x, y]);
            const t = grid.pixti(i);
            for (const ni of grid.neighi(i)) {
              if (grid.pixti(ni) !== t) {
                border.push(i);
                break;
              }
            }
          }
        }
        if (border.length === 0) continue;
        const tgt_i = border[(cpm.random() * border.length) | 0];
        const Ni = grid.neighi(tgt_i);
        const src_i = Ni[(cpm.random() * Ni.length) | 0];
        const src_type = grid.pixti(src_i);
        const tgt_type = grid.pixti(tgt_i);
        if (src_type === tgt_type) continue;
        let ok = true;
        for (const h of cpm.hard_constraints) {
          if (!h.fulfilled(src_i, tgt_i, src_type, tgt_type)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (cpm.docopy(cpm.deltaH(src_i, tgt_i, src_type, tgt_type))) {
          cpm.setpixi(tgt_i, src_type);
        }
      }
    }
  }
  cpm.time++;
  cpm.stat_values = {}; // invalidate stat cache (as timeStep does)
  for (const l of cpm.post_mcs_listeners) l();
}

/** Advance `n` checkerboard MCS on a CpmSimulation's lattice. */
export function checkerboardStepN(sim: CpmSimulation, n: number, B = 4): void {
  const cpm = sim.cpm as unknown as RawCPM;
  for (let i = 0; i < n; i++) checkerboardStep(cpm, B);
}

/** How many blocks fall in each of the 4 colour classes for a field/B — i.e. the width of
 *  the parallelism (how many independent copy attempts run concurrently per phase). */
export function parallelWidth(field: number, B: number): number {
  const blocks = Math.ceil(field / B) ** 2;
  return Math.round(blocks / 4);
}
