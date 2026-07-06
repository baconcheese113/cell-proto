// cpm-gpu-bench.ts — live A/B: GpuCpm vs an identical single-thread CPU reference at equal border.
// This is the M1a completion gate — it must show a real GPU speedup with volume drift under
// control. Exposed via window.__cpm.gpuBench().

import { GpuCpm } from "./cpm-gpu";
import { packSquareLattice, flattenJ } from "./cpm-gpu-encoding";
import { buildKindColorLut } from "./cpm-gpu-palette";

// Single-kind reduced J: background<->cell adhesion = 20, like<->like = 0.
const J_ROWS = [
  [0, 20],
  [20, 0],
];
const LAMBDA_V = 50;
const T = 20;

export async function gpuBench(
  opts: { field?: number; cellSize?: number; mcs?: number; B?: number } = {}
): Promise<object> {
  const field = opts.field ?? 336;
  const cellSize = opts.cellSize ?? 10;
  const mcs = opts.mcs ?? 200;
  const B = opts.B ?? 4;

  const packed = packSquareLattice(field, cellSize);
  const { J, nKinds } = flattenJ(J_ROWS);
  const lut = buildKindColorLut([0x000000, 0x4fc3f7]);
  const target = (cellSize - 1) * (cellSize - 1);

  const gpu = await GpuCpm.create({
    field, B, lambdaV: LAMBDA_V, T, J, nKinds, lut,
    lattice: packed.lattice.slice(), kind: packed.kind, targetVol: packed.targetVol, maxId: packed.maxId,
  });
  if ("error" in gpu) return gpu;

  // warmup + timed GPU run
  gpu.stepN(20); await gpu.flush();
  const g0 = performance.now();
  gpu.stepN(mcs); await gpu.flush();
  const gpuMs = (performance.now() - g0) / mcs;

  const vols = await gpu.readVolumes();
  let dev = 0, n = 0;
  for (let i = 1; i < vols.length; i++) if (vols[i] > 0) { dev += Math.abs(vols[i] - target) / target; n++; }
  gpu.destroy();

  const cpuMs = cpuReference(packed.lattice.slice(), packed.kind, packed.targetVol, field, B, mcs);

  const out = {
    field, B, mcs, border: packed.border, cells: packed.maxId,
    gpu_msPerMCS: +gpuMs.toFixed(3),
    cpu_msPerMCS: +cpuMs.toFixed(3),
    speedup: +(cpuMs / gpuMs).toFixed(1),
    gpu_meanVolDevPct: n ? +((dev / n) * 100).toFixed(1) : 0,
  };
  console.log("🟢 gpuBench (GpuCpm vs CPU ref, equal border):", out);
  return out;
}

/** Identical reduced model, single-thread, for the speed baseline + fidelity anchor. */
function cpuReference(
  lat: Int32Array, kind: Int32Array, targetVol: Float32Array,
  field: number, B: number, mcs: number
): number {
  const W = field, H = field;
  const vol = new Int32Array(targetVol.length);
  for (let i = 0; i < lat.length; i++) if (lat[i] > 0) vol[lat[i]]++;
  const nk = 2;
  const J = [0, 20, 20, 0]; // flat 2x2
  const latAt = (x: number, y: number): number => (x < 0 || x >= W || y < 0 || y >= H ? 0 : lat[y * W + x]);
  const kindAt = (x: number, y: number): number => kind[latAt(x, y)];
  const adh = (x: number, y: number, k: number): number => {
    let e = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      e += J[k * nk + kindAt(x + kx, y + ky)];
    }
    return e;
  };
  const dxs = [-1, 0, 1, -1, 1, -1, 0, 1], dys = [-1, -1, -1, 0, 0, 1, 1, 1];
  const nbx = Math.ceil(W / B), nby = Math.ceil(H / B);
  const t0 = performance.now();
  for (let m = 0; m < mcs; m++) {
    const ox = (Math.random() * B) | 0, oy = (Math.random() * B) | 0;
    for (let phase = 0; phase < 4; phase++) {
      for (let brow = 0; brow < nby; brow++) for (let bcol = 0; bcol < nbx; bcol++) {
        if (((bcol & 1) | ((brow & 1) << 1)) !== phase) continue;
        const bx0 = bcol * B - ox, by0 = brow * B - oy;
        let cx = -1, cy = -1, cnt = 0;
        for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) {
          const x = bx0 + dx, y = by0 + dy;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const id = lat[y * W + x];
          let isB = false;
          for (let ky = -1; ky <= 1 && !isB; ky++) for (let kx = -1; kx <= 1; kx++) {
            if (kx === 0 && ky === 0) continue;
            if (latAt(x + kx, y + ky) !== id) { isB = true; break; }
          }
          if (isB) { cnt++; if (Math.random() < 1 / cnt) { cx = x; cy = y; } }
        }
        if (cx < 0) continue;
        const d = (Math.random() * 8) | 0;
        const sx = cx + dxs[d], sy = cy + dys[d];
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
        const srcId = lat[sy * W + sx], tgtId = lat[cy * W + cx];
        if (srcId === tgtId) continue;
        let dH = adh(cx, cy, kind[srcId]) - adh(cx, cy, kind[tgtId]);
        if (tgtId > 0) { const v = vol[tgtId], tv = targetVol[tgtId]; dH += LAMBDA_V * ((v - 1 - tv) ** 2 - (v - tv) ** 2); }
        if (srcId > 0) { const v = vol[srcId], tv = targetVol[srcId]; dH += LAMBDA_V * ((v + 1 - tv) ** 2 - (v - tv) ** 2); }
        if (dH < 0 || Math.random() < Math.exp(-dH / T)) {
          lat[cy * W + cx] = srcId;
          if (tgtId > 0) vol[tgtId]--;
          if (srcId > 0) vol[srcId]++;
        }
      }
    }
  }
  return (performance.now() - t0) / mcs;
}
