// cpm-gpu-spike.ts — WebGPU checkerboard CPM spike. Answers ONE question: does running the CPM
// step on the GPU give a real, large speedup at our border scale? It implements a REDUCED CPM
// (adhesion + volume only, single cell kind — the dominant compute + memory pattern) as a WGSL
// compute step using the validated 4-colour checkerboard, and times GPU MCS/sec vs an identical
// CPU reference. Physics is intentionally simplified (this measures the SUBSTRATE, not the full
// game); the full port would add the other constraints + the real J matrix.
//
// Run in a WebGPU browser (Chrome). Exposed as `window.__cpm.gpuSpike()`. Standalone — builds
// its own packed lattice, touches nothing in the live sim.

// Minimal ambient WebGPU decls so we don't add an @webgpu/types dependency for a spike. The
// GPU objects are used dynamically; only the two flag enums need to resolve as globals.
declare const GPUBufferUsage: {
  STORAGE: number; COPY_DST: number; COPY_SRC: number; UNIFORM: number; MAP_READ: number;
};
declare const GPUMapMode: { READ: number };

/** Build a packed lattice: a grid of square cells of `cellSize`, row-major cell-id per pixel
 *  (0 = background border frame). Returns the lattice, per-cell volumes, and the border count. */
function packLattice(field: number, cellSize: number): {
  lattice: Int32Array;
  vol: Int32Array;
  maxId: number;
  border: number;
} {
  const lattice = new Int32Array(field * field); // 0 = background
  const cols = Math.floor((field - 4) / cellSize);
  let id = 0;
  const volMap: number[] = [0];
  for (let cy = 0; cy < cols; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      id++;
      volMap[id] = 0;
      const x0 = 2 + cx * cellSize;
      const y0 = 2 + cy * cellSize;
      for (let y = y0; y < y0 + cellSize - 1 && y < field; y++) {
        for (let x = x0; x < x0 + cellSize - 1 && x < field; x++) {
          lattice[y * field + x] = id;
          volMap[id]++;
        }
      }
    }
  }
  const vol = Int32Array.from(volMap);
  // border count
  let border = 0;
  for (let y = 0; y < field; y++)
    for (let x = 0; x < field; x++) {
      const v = lattice[y * field + x];
      if (v === 0) continue;
      let isB = false;
      for (let ky = -1; ky <= 1 && !isB; ky++)
        for (let kx = -1; kx <= 1; kx++) {
          if (kx === 0 && ky === 0) continue;
          const nx = x + kx;
          const ny = y + ky;
          const nid = nx < 0 || nx >= field || ny < 0 || ny >= field ? 0 : lattice[ny * field + nx];
          if (nid !== v) {
            isB = true;
            break;
          }
        }
      if (isB) border++;
    }
  return { lattice, vol, maxId: id, border };
}

const WGSL = /* wgsl */ `
struct Params {
  W: u32, H: u32, B: u32, phase: u32,
  ox: u32, oy: u32, seed: u32, _pad: u32,
  lambdaV: f32, targetVol: f32, J: f32, T: f32,
};
@group(0) @binding(0) var<storage, read_write> lattice: array<i32>;
@group(0) @binding(1) var<storage, read_write> vol: array<atomic<i32>>;
@group(0) @binding(2) var<uniform> P: Params;

fn inb(x: i32, y: i32) -> bool { return x >= 0 && x < i32(P.W) && y >= 0 && y < i32(P.H); }
fn at(x: i32, y: i32) -> i32 { if (inb(x,y)) { return lattice[y * i32(P.W) + x]; } return 0; }

fn rng(state: ptr<function, u32>) -> f32 {
  var s = *state; s ^= s << 13u; s ^= s >> 17u; s ^= s << 5u; *state = s;
  return f32(s) * 2.3283064e-10;
}
// adhesion energy around (x,y) if that pixel were cell id: J * (# unlike 8-neighbours)
fn adh(x: i32, y: i32, id: i32) -> f32 {
  var c = 0.0;
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      if (kx == 0 && ky == 0) { continue; }
      if (at(x+kx, y+ky) != id) { c += P.J; }
    }
  }
  return c;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nbx = (P.W + P.B - 1u) / P.B;
  let nby = (P.H + P.B - 1u) / P.B;
  let bi = gid.x;
  if (bi >= nbx * nby) { return; }
  let bcol = bi % nbx;
  let brow = bi / nbx;
  if (((bcol & 1u) | ((brow & 1u) << 1u)) != P.phase) { return; } // 4-colour class gate

  var st = P.seed ^ (bi * 2654435761u) + 1u;
  st ^= st << 13u; st ^= st >> 17u;

  let bx0 = i32(bcol * P.B) - i32(P.ox);
  let by0 = i32(brow * P.B) - i32(P.oy);

  // reservoir-pick one border pixel in the block
  var chosen = -1;
  var cx = 0; var cy = 0; var cnt = 0u;
  for (var dy = 0u; dy < P.B; dy++) {
    for (var dx = 0u; dx < P.B; dx++) {
      let x = bx0 + i32(dx); let y = by0 + i32(dy);
      if (!inb(x, y)) { continue; }
      let id = lattice[y * i32(P.W) + x];
      var isB = false;
      for (var ky = -1; ky <= 1; ky++) { for (var kx = -1; kx <= 1; kx++) {
        if (kx == 0 && ky == 0) { continue; }
        if (at(x+kx, y+ky) != id) { isB = true; }
      }}
      if (isB) { cnt += 1u; if (rng(&st) < 1.0 / f32(cnt)) { chosen = 1; cx = x; cy = y; } }
    }
  }
  if (chosen < 0) { return; }

  let dxs = array<i32,8>(-1, 0, 1, -1, 1, -1, 0, 1);
  let dys = array<i32,8>(-1, -1, -1, 0, 0, 1, 1, 1);
  let d = u32(rng(&st) * 8.0) & 7u;
  let sx = cx + dxs[d]; let sy = cy + dys[d];
  if (!inb(sx, sy)) { return; }
  let srcId = lattice[sy * i32(P.W) + sx];
  let tgtId = lattice[cy * i32(P.W) + cx];
  if (srcId == tgtId) { return; }

  var dH = adh(cx, cy, srcId) - adh(cx, cy, tgtId);
  if (tgtId > 0) {
    let v = f32(atomicLoad(&vol[tgtId]));
    dH += P.lambdaV * ((v-1.0-P.targetVol)*(v-1.0-P.targetVol) - (v-P.targetVol)*(v-P.targetVol));
  }
  if (srcId > 0) {
    let v = f32(atomicLoad(&vol[srcId]));
    dH += P.lambdaV * ((v+1.0-P.targetVol)*(v+1.0-P.targetVol) - (v-P.targetVol)*(v-P.targetVol));
  }
  var accept = dH < 0.0;
  if (!accept) { accept = rng(&st) < exp(-dH / P.T); }
  if (accept) {
    lattice[cy * i32(P.W) + cx] = srcId;
    if (tgtId > 0) { atomicSub(&vol[tgtId], 1); }
    if (srcId > 0) { atomicAdd(&vol[srcId], 1); }
  }
}
`;

/** Run the WebGPU spike: build a lattice, run `mcs` checkerboard MCS on the GPU, measure, and
 *  compare to an identical CPU reference. Returns timings + a fidelity check (volume drift). */
export async function gpuSpike(field = 336, cellSize = 10, mcs = 200, B = 4): Promise<object> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as unknown as { gpu?: any }).gpu;
  if (!gpu) return { error: "WebGPU not available (navigator.gpu missing)" };
  const adapter = await gpu.requestAdapter();
  if (!adapter) return { error: "no GPU adapter" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const device: any = await adapter.requestDevice();

  const packed = packLattice(field, cellSize);
  const N = field * field;
  const volN = packed.maxId + 1;

  const latBuf = device.createBuffer({
    size: N * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const volBuf = device.createBuffer({
    size: volN * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(latBuf, 0, packed.lattice);
  device.queue.writeBuffer(volBuf, 0, packed.vol);

  const paramBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: latBuf } },
      { binding: 1, resource: { buffer: volBuf } },
      { binding: 2, resource: { buffer: paramBuf } },
    ],
  });

  const nbx = Math.ceil(field / B);
  const numBlocks = nbx * nbx;
  const wg = Math.ceil(numBlocks / 64);
  const u32 = new Uint32Array(12); // 48 bytes
  const f32 = new Float32Array(u32.buffer);
  const setParams = (phase: number, ox: number, oy: number, seed: number): void => {
    u32[0] = field; u32[1] = field; u32[2] = B; u32[3] = phase;
    u32[4] = ox; u32[5] = oy; u32[6] = seed >>> 0; u32[7] = 0;
    f32[8] = 50; f32[9] = cellSize * cellSize; f32[10] = 20; f32[11] = 20; // lambdaV, targetVol, J, T
    device.queue.writeBuffer(paramBuf, 0, u32);
  };

  // warmup
  for (let i = 0; i < 20; i++) {
    const ox = (Math.random() * B) | 0, oy = (Math.random() * B) | 0;
    const enc = device.createCommandEncoder();
    for (let phase = 0; phase < 4; phase++) {
      setParams(phase, ox, oy, (Math.random() * 1e9) | 0);
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(wg); pass.end();
    }
    device.queue.submit([enc.finish()]);
  }
  await device.queue.onSubmittedWorkDone();

  const t0 = performance.now();
  for (let i = 0; i < mcs; i++) {
    const ox = (Math.random() * B) | 0, oy = (Math.random() * B) | 0;
    const enc = device.createCommandEncoder();
    for (let phase = 0; phase < 4; phase++) {
      setParams(phase, ox, oy, (Math.random() * 1e9) | 0);
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(wg); pass.end();
    }
    device.queue.submit([enc.finish()]);
  }
  await device.queue.onSubmittedWorkDone();
  const gpuMs = (performance.now() - t0) / mcs;

  // read back volumes for a fidelity check
  const staging = device.createBuffer({ size: volN * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(volBuf, 0, staging, 0, volN * 4);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const volOut = new Int32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  let dev = 0, n = 0;
  const target = cellSize * cellSize;
  for (let i = 1; i < volN; i++) { if (volOut[i] > 0) { dev += Math.abs(volOut[i] - target) / target; n++; } }

  // CPU reference: identical reduced model, single-threaded
  const cpuMs = cpuReference(packLattice(field, cellSize), field, B, mcs, target);

  device.destroy?.();
  return {
    field, cellSize, B, mcs,
    border: packed.border, cells: packed.maxId,
    parallelBlocks: numBlocks,
    gpu_msPerMCS: +gpuMs.toFixed(3),
    cpu_msPerMCS: +cpuMs.toFixed(3),
    speedup: +(cpuMs / gpuMs).toFixed(1),
    gpu_meanVolDevPct: n ? +((dev / n) * 100).toFixed(1) : 0,
  };
}

/** Single-threaded CPU version of the SAME reduced checkerboard model, for the speed baseline. */
function cpuReference(
  packed: { lattice: Int32Array; vol: Int32Array; maxId: number },
  field: number,
  B: number,
  mcs: number,
  target: number
): number {
  const lat = packed.lattice;
  const vol = packed.vol;
  const W = field, H = field, J = 20, lambdaV = 50, T = 20;
  const at = (x: number, y: number): number => (x < 0 || x >= W || y < 0 || y >= H ? 0 : lat[y * W + x]);
  const adh = (x: number, y: number, id: number): number => {
    let c = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      if (at(x + kx, y + ky) !== id) c += J;
    }
    return c;
  };
  const dxs = [-1, 0, 1, -1, 1, -1, 0, 1], dys = [-1, -1, -1, 0, 0, 1, 1, 1];
  const nbx = Math.ceil(W / B), nby = Math.ceil(H / B);
  // warmup not separately timed; just measure mcs steps
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
            if (at(x + kx, y + ky) !== id) { isB = true; break; }
          }
          if (isB) { cnt++; if (Math.random() < 1 / cnt) { cx = x; cy = y; } }
        }
        if (cx < 0) continue;
        const d = (Math.random() * 8) | 0;
        const sx = cx + dxs[d], sy = cy + dys[d];
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
        const srcId = lat[sy * W + sx], tgtId = lat[cy * W + cx];
        if (srcId === tgtId) continue;
        let dH = adh(cx, cy, srcId) - adh(cx, cy, tgtId);
        if (tgtId > 0) { const v = vol[tgtId]; dH += lambdaV * ((v - 1 - target) ** 2 - (v - target) ** 2); }
        if (srcId > 0) { const v = vol[srcId]; dH += lambdaV * ((v + 1 - target) ** 2 - (v - target) ** 2); }
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
