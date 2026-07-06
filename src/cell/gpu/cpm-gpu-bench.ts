// cpm-gpu-bench.ts — live A/B: GpuCpm vs an identical single-thread CPU reference at equal border,
// now running the full reduced model WITH the Act model (crawl). The M1b gate: the GPU must (a)
// beat the CPU, (b) keep volume drift + fragmentation low, and (c) show the Act model actually
// engaged (a non-trivial fraction of active pixels, matching the CPU reference). Headless via
// window.__cpm.gpuBench().

import { GpuCpm } from "./cpm-gpu";
import { packSquareLattice, flattenJ } from "./cpm-gpu-encoding";
import { buildKindColorLut } from "./cpm-gpu-palette";

// Single-kind reduced model. background<->cell adhesion = 20, like<->like = 0.
const J_ROWS = [
  [0, 20],
  [20, 0],
];
const LAMBDA_V = 50;
const T = 20;
const MAX_ACT = [0, 20]; // per kind (0 = background)
const LAMBDA_ACT = [0, 200];
const LAMBDA_P = [0, 2]; // Perimeter constraint strength per kind — holds cells cohesive vs Act

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
  // Target perimeter = the mean perimeter of the freshly-packed cells, so the constraint pulls
  // cells back toward their compact starting shape (fighting Act-driven fingering/fragmentation).
  const targetP = [0, perimeterMean(packed.lattice, field, packed.maxId)];

  const gpu = await GpuCpm.create({
    field, B, lambdaV: LAMBDA_V, T, J, nKinds, lut, maxAct: MAX_ACT, lambdaAct: LAMBDA_ACT,
    lambdaP: LAMBDA_P, targetP,
    lattice: packed.lattice.slice(), kind: packed.kind, targetVol: packed.targetVol, maxId: packed.maxId,
  });
  if ("error" in gpu) return gpu;

  gpu.stepN(20); await gpu.flush();
  const g0 = performance.now();
  gpu.stepN(mcs); await gpu.flush();
  const gpuMs = (performance.now() - g0) / mcs;

  const vols = await gpu.readVolumes();
  const lat = await gpu.readLattice();
  const act = await gpu.readAct();
  gpu.destroy();

  const gpuVolDev = meanVolDevPct(vols, target);
  const gpuFrag = fragmentedCount(lat, field, packed.maxId);
  const gpuActive = activeFraction(lat, act);
  let gpuActMax = 0;
  for (let i = 0; i < act.length; i++) if (act[i] > gpuActMax) gpuActMax = act[i];
  let latChanged = 0;
  for (let i = 0; i < lat.length; i++) if (lat[i] !== packed.lattice[i]) latChanged++;

  const cpu = cpuReference(packed.lattice.slice(), packed.kind, packed.targetVol, field, B, mcs, target, targetP);

  const out = {
    field, B, mcs, border: packed.border, cells: packed.maxId,
    gpu_msPerMCS: +gpuMs.toFixed(3),
    cpu_msPerMCS: +cpu.ms.toFixed(3),
    speedup: +(cpu.ms / gpuMs).toFixed(1),
    gpu_meanVolDevPct: gpuVolDev,
    cpu_meanVolDevPct: cpu.meanVolDevPct,
    gpu_activeFrac: gpuActive,
    gpu_actMax: gpuActMax,
    gpu_latChanged: latChanged,
    cpu_activeFrac: cpu.activeFrac,
    gpu_fragmented: gpuFrag,
    cpu_fragmented: cpu.fragmented,
  };
  console.log("🟢 gpuBench (GpuCpm vs CPU ref, Act model on, equal border):", out);
  return out;
}

/** Mean |vol-target|/target over live cells, in %. */
function meanVolDevPct(vol: Int32Array, target: number): number {
  let dev = 0, n = 0;
  for (let i = 1; i < vol.length; i++) if (vol[i] > 0) { dev += Math.abs(vol[i] - target) / target; n++; }
  return n ? +((dev / n) * 100).toFixed(1) : 0;
}

/** Per-cell perimeter (sum over cell pixels of unlike 8-neighbours), then mean over live cells. */
function perimeterMean(lat: Int32Array, field: number, maxId: number): number {
  const perim = new Int32Array(maxId + 1);
  for (let y = 0; y < field; y++) for (let x = 0; x < field; x++) {
    const id = lat[y * field + x];
    if (id <= 0) continue;
    let c = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      const nx = x + kx, ny = y + ky;
      const nid = nx < 0 || nx >= field || ny < 0 || ny >= field ? 0 : lat[ny * field + nx];
      if (nid !== id) c++;
    }
    perim[id] += c;
  }
  let sum = 0, n = 0;
  for (let id = 1; id <= maxId; id++) if (perim[id] > 0) { sum += perim[id]; n++; }
  return n ? Math.round(sum / n) : 0;
}

/** Fraction of cell pixels (id>0) whose activity is > 0 — proves the Act model is engaged. */
function activeFraction(lat: Int32Array, act: Int32Array): number {
  let cell = 0, active = 0;
  for (let i = 0; i < lat.length; i++) if (lat[i] > 0) { cell++; if (act[i] > 0) active++; }
  return cell ? +(active / cell).toFixed(3) : 0;
}

/** Count cells whose pixels form more than one 8-connected component (fragmentation = broken cell). */
function fragmentedCount(lat: Int32Array, field: number, maxId: number): number {
  const seen = new Uint8Array(lat.length);
  const comps = new Int32Array(maxId + 1);
  const stack: number[] = [];
  for (let i = 0; i < lat.length; i++) {
    const id = lat[i];
    if (id <= 0 || seen[i]) continue;
    comps[id]++;
    seen[i] = 1;
    stack.length = 0;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % field, py = (p / field) | 0;
      for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
        if (kx === 0 && ky === 0) continue;
        const nx = px + kx, ny = py + ky;
        if (nx < 0 || nx >= field || ny < 0 || ny >= field) continue;
        const q = ny * field + nx;
        if (!seen[q] && lat[q] === id) { seen[q] = 1; stack.push(q); }
      }
    }
  }
  let frag = 0;
  for (let id = 1; id <= maxId; id++) if (comps[id] > 1) frag++;
  return frag;
}

/** Identical reduced model + Act, single-thread — the speed baseline and fidelity anchor. */
function cpuReference(
  lat: Int32Array, kind: Int32Array, targetVol: Float32Array,
  field: number, B: number, mcs: number, target: number, targetP: number[]
): { ms: number; meanVolDevPct: number; activeFrac: number; fragmented: number } {
  const W = field, H = field, N = W * H;
  const vol = new Int32Array(targetVol.length);
  for (let i = 0; i < lat.length; i++) if (lat[i] > 0) vol[lat[i]]++;
  const act = new Int32Array(N);
  const maxId = targetVol.length - 1;
  const nk = 2;
  const J = [0, 20, 20, 0];
  const latAt = (x: number, y: number): number => (x < 0 || x >= W || y < 0 || y >= H ? 0 : lat[y * W + x]);
  // per-cell perimeter, initialised from the lattice (Artistoo initializePerimeters).
  const perim = new Int32Array(maxId + 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = lat[y * W + x];
    if (id <= 0) continue;
    let c = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      if (latAt(x + kx, y + ky) !== id) c++;
    }
    perim[id] += c;
  }
  const actAt = (x: number, y: number): number => (x < 0 || x >= W || y < 0 || y >= H ? 0 : act[y * W + x]);
  const kindAt = (x: number, y: number): number => kind[latAt(x, y)];
  const adh = (x: number, y: number, k: number): number => {
    let e = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      e += J[k * nk + kindAt(x + kx, y + ky)];
    }
    return e;
  };
  const actGeom = (x: number, y: number, id: number): number => {
    if (id <= 0) return 0;
    let r = actAt(x, y), nN = 1;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      if (latAt(x + kx, y + ky) === id) {
        const a = actAt(x + kx, y + ky);
        if (a === 0) return 0;
        r *= a; nN++;
      }
    }
    return Math.pow(r, 1 / nN);
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
        const kSrc = kind[srcId], kTgt = kind[tgtId];
        let dH = adh(cx, cy, kSrc) - adh(cx, cy, kTgt);
        if (tgtId > 0) { const v = vol[tgtId], tv = targetVol[tgtId]; dH += LAMBDA_V * ((v - 1 - tv) ** 2 - (v - tv) ** 2); }
        if (srcId > 0) { const v = vol[srcId], tv = targetVol[srcId]; dH += LAMBDA_V * ((v + 1 - tv) ** 2 - (v - tv) ** 2); }
        const ak = srcId !== 0 ? kSrc : kTgt;
        const maxact = MAX_ACT[ak], lambdaact = LAMBDA_ACT[ak];
        if (maxact > 0 && lambdaact > 0) {
          dH += lambdaact * (actGeom(cx, cy, tgtId) - actGeom(sx, sy, srcId)) / maxact;
        }
        // Perimeter term (mirror of the WGSL / Artistoo PerimeterConstraint).
        const lpSrc = LAMBDA_P[kSrc], lpTgt = LAMBDA_P[kTgt];
        let pcSrc = 0, pcTgt = 0;
        if ((srcId > 0 && lpSrc > 0) || (tgtId > 0 && lpTgt > 0)) {
          for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
            if (kx === 0 && ky === 0) continue;
            const ntid = latAt(cx + kx, cy + ky);
            if (ntid !== srcId) pcSrc++; else pcSrc--;
            if (ntid !== tgtId) pcTgt--; else pcTgt++;
          }
          if (srcId > 0 && lpSrc > 0) {
            const ps = perim[srcId], ptp = targetP[kSrc];
            dH += lpSrc * ((ps + pcSrc - ptp) ** 2 - (ps - ptp) ** 2);
          }
          if (tgtId > 0 && lpTgt > 0) {
            const ps = perim[tgtId], ptp = targetP[kTgt];
            dH += lpTgt * ((ps + pcTgt - ptp) ** 2 - (ps - ptp) ** 2);
          }
        }
        if (dH < 0 || Math.random() < Math.exp(-dH / T)) {
          lat[cy * W + cx] = srcId;
          act[cy * W + cx] = MAX_ACT[kSrc];
          if (tgtId > 0) { vol[tgtId]--; perim[tgtId] += pcTgt; }
          if (srcId > 0) { vol[srcId]++; perim[srcId] += pcSrc; }
        }
      }
    }
    for (let i = 0; i < N; i++) if (act[i] > 0) act[i]--;
  }
  const ms = (performance.now() - t0) / mcs;
  return {
    ms,
    meanVolDevPct: meanVolDevPct(vol, target),
    activeFrac: activeFraction(lat, act),
    fragmented: fragmentedCount(lat, field, maxId),
  };
}
