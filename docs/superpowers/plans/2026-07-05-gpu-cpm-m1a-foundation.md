# GPU-resident CPM — M1a: GpuCpm foundation + benchmark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, tested `GpuCpm` class that steps a checkerboard CPM (full per-kind J
adhesion matrix + per-cell volume, with a drift-safe per-MCS volume recompute) entirely in GPU
buffers, produces the RGBA framebuffer on-GPU, and reads it back — validated by a live A/B
benchmark against the CPU worker at equal border count.

**Architecture:** Foundation layer for the staged GPU-resident CPM (see
`docs/superpowers/specs/2026-07-05-gpu-resident-cpm-design.md`). This plan is **M1a**: it stands
up the GPU plumbing and the benchmark harness with known-good physics (adhesion + volume). It
does **not** yet port the Act model / barrier, nor wire the GPU sim into the live world tick —
those are the next plan (M1b). `GpuCpm` runs standalone (main-thread, like the existing
`gpuSpike`) and is exercised through `window.__cpm.gpuBench(...)`.

**Tech Stack:** TypeScript ~5.8, WebGPU (WGSL compute), Vite, Phaser (renderer only — not touched
here), Node `node:test` for pure-helper unit tests.

## Global Constraints

- Target **Chrome/Edge desktop with WebGPU**; no CPU fallback path (prototype).
- New GPU modules live under `src/cell/gpu/` and must be **Phaser-free / worker-safe** (only
  `navigator.gpu`, typed arrays, and pure TS) so they can later move into `sim-worker.ts`.
- Keep the existing CPU `CpmSimulation` untouched and runnable as the **fidelity oracle**.
- **Benchmark gate:** this plan's completion is defined by a recorded A/B benchmark
  (`gpuBench`) showing the GPU beats the CPU at equal border, with volume drift under control.
- Ambient WebGPU decls: do **not** add an `@webgpu/types` dependency; declare the two flag enums
  (`GPUBufferUsage`, `GPUMapMode`) as ambient `const`s and cast GPU objects to `any` (matches
  `cpm-gpu-spike.ts`).
- Node tests import sibling modules with the explicit `.ts` extension and run via
  `node --test --experimental-strip-types <file>` (Node 24).

---

## File Structure

- Create: `src/cell/gpu/cpm-gpu-encoding.ts` — pure helpers (J flatten/index, square-lattice
  packer, block/dispatch math, param-struct encoder). Worker-safe, node-testable.
- Create: `src/cell/gpu/cpm-gpu-encoding.test.ts` — node tests for the above.
- Create: `src/cell/gpu/cpm-gpu-palette.ts` — pure owner/kind → RGBA colour LUT.
- Create: `src/cell/gpu/cpm-gpu-palette.test.ts` — node tests for the LUT.
- Create: `src/cell/gpu/cpm-gpu-device.ts` — `acquireGpu()` worker-safe device acquisition + feature check.
- Create: `src/cell/gpu/cpm-gpu-wgsl.ts` — WGSL sources: `STEP_WGSL`, `VOL_WGSL`, `COLORMAP_WGSL`.
- Create: `src/cell/gpu/cpm-gpu.ts` — the `GpuCpm` class (buffers, pipelines, `stepN`, readbacks).
- Create: `src/cell/gpu/cpm-gpu-bench.ts` — `gpuBench()` A/B vs a CPU reference at equal border.
- Modify: `src/cell/cpm-world-scene.ts` — expose `gpuBench` on the existing `__cpm` dev handle.

---

## Task 1: Pure encoding helpers

**Files:**
- Create: `src/cell/gpu/cpm-gpu-encoding.ts`
- Test: `src/cell/gpu/cpm-gpu-encoding.test.ts`

**Interfaces:**
- Produces:
  - `flattenJ(jRows: number[][]): { J: Float32Array; nKinds: number }` — row-major flatten of a
    square `(nKinds+1)²` adhesion matrix (index 0 = background/medium).
  - `jIndex(a: number, b: number, nKinds: number): number` — `a * nKinds + b`.
  - `packSquareLattice(field: number, cellSize: number): { lattice: Int32Array; kind: Int32Array;
    targetVol: Float32Array; maxId: number; border: number }` — a packed grid of `cellSize`
    square cells (all kind 1), id 0 = background; `kind[id]`/`targetVol[id]` indexed by cell id
    (`kind[0]=0`, `targetVol[0]=0`).
  - `blockDispatch(field: number, B: number, wgSize: number): { nbx: number; numBlocks: number;
    workgroups: number }` — `nbx = ceil(field/B)`, `numBlocks = nbx*nbx`, `workgroups =
    ceil(numBlocks/wgSize)`.
  - `encodeParams(p: { W: number; H: number; B: number; phase: number; ox: number; oy: number;
    seed: number; lambdaV: number; T: number }): ArrayBuffer` — 48-byte std140-compatible
    uniform buffer: eight `u32` then... (see code; matches `Params` in `cpm-gpu-wgsl.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/cell/gpu/cpm-gpu-encoding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenJ, jIndex, packSquareLattice, blockDispatch, encodeParams } from "./cpm-gpu-encoding.ts";

test("flattenJ row-majors a square matrix and reports nKinds", () => {
  const { J, nKinds } = flattenJ([
    [0, 10, 12],
    [10, 0, 8],
    [12, 8, 0],
  ]);
  assert.equal(nKinds, 3);
  assert.equal(J.length, 9);
  assert.equal(J[jIndex(0, 1, 3)], 10);
  assert.equal(J[jIndex(2, 1, 3)], 8);
});

test("packSquareLattice fills cells, ids are 1-based, background is 0", () => {
  const { lattice, kind, targetVol, maxId, border } = packSquareLattice(40, 10);
  assert.ok(maxId >= 4, `expected several cells, got ${maxId}`);
  assert.equal(kind[0], 0);
  assert.equal(targetVol[0], 0);
  assert.equal(kind[1], 1);
  assert.ok(targetVol[1] > 0);
  assert.ok(border > 0);
  // every non-zero lattice entry references a valid cell id
  for (const v of lattice) assert.ok(v >= 0 && v <= maxId);
});

test("blockDispatch computes block grid + workgroup count", () => {
  const d = blockDispatch(336, 4, 64);
  assert.equal(d.nbx, 84);
  assert.equal(d.numBlocks, 84 * 84);
  assert.equal(d.workgroups, Math.ceil((84 * 84) / 64));
});

test("encodeParams writes an exactly-48-byte buffer with u32 header + f32 tail", () => {
  const buf = encodeParams({ W: 336, H: 336, B: 4, phase: 2, ox: 1, oy: 3, seed: 123, lambdaV: 50, T: 20 });
  assert.equal(buf.byteLength, 48);
  const u = new Uint32Array(buf);
  assert.equal(u[0], 336);
  assert.equal(u[3], 2); // phase
  const f = new Float32Array(buf);
  assert.equal(f[8], 50); // lambdaV
  assert.equal(f[9], 20); // T
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/cell/gpu/cpm-gpu-encoding.test.ts`
Expected: FAIL — cannot find module `./cpm-gpu-encoding.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cell/gpu/cpm-gpu-encoding.ts — pure, worker-safe helpers for the GPU CPM.
// No WebGPU / Phaser imports so this can be unit-tested in node and later run in the sim worker.

/** Row-major flatten of a square adhesion matrix `jRows[a][b]` (index 0 = background). */
export function flattenJ(jRows: number[][]): { J: Float32Array; nKinds: number } {
  const nKinds = jRows.length;
  const J = new Float32Array(nKinds * nKinds);
  for (let a = 0; a < nKinds; a++)
    for (let b = 0; b < nKinds; b++) J[a * nKinds + b] = jRows[a][b];
  return { J, nKinds };
}

/** Flat index into the J matrix. */
export function jIndex(a: number, b: number, nKinds: number): number {
  return a * nKinds + b;
}

/** Pack a grid of `cellSize` square cells (all kind 1) into a `field²` lattice. Returns the
 *  lattice plus per-cell-id `kind` / `targetVol` arrays (index 0 = background) and the border. */
export function packSquareLattice(
  field: number,
  cellSize: number
): { lattice: Int32Array; kind: Int32Array; targetVol: Float32Array; maxId: number; border: number } {
  const lattice = new Int32Array(field * field);
  const cols = Math.floor((field - 4) / cellSize);
  let id = 0;
  const target = (cellSize - 1) * (cellSize - 1);
  const kindArr: number[] = [0];
  const volArr: number[] = [0];
  for (let cy = 0; cy < cols; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      id++;
      kindArr[id] = 1;
      volArr[id] = target;
      const x0 = 2 + cx * cellSize;
      const y0 = 2 + cy * cellSize;
      for (let y = y0; y < y0 + cellSize - 1 && y < field; y++)
        for (let x = x0; x < x0 + cellSize - 1 && x < field; x++) lattice[y * field + x] = id;
    }
  }
  let border = 0;
  for (let y = 0; y < field; y++)
    for (let x = 0; x < field; x++) {
      const v = lattice[y * field + x];
      if (v === 0) continue;
      let isB = false;
      for (let ky = -1; ky <= 1 && !isB; ky++)
        for (let kx = -1; kx <= 1; kx++) {
          if (kx === 0 && ky === 0) continue;
          const nx = x + kx, ny = y + ky;
          const nid = nx < 0 || nx >= field || ny < 0 || ny >= field ? 0 : lattice[ny * field + nx];
          if (nid !== v) { isB = true; break; }
        }
      if (isB) border++;
    }
  return { lattice, kind: Int32Array.from(kindArr), targetVol: Float32Array.from(volArr), maxId: id, border };
}

/** Block-grid + workgroup counts for the checkerboard dispatch. */
export function blockDispatch(
  field: number,
  B: number,
  wgSize: number
): { nbx: number; numBlocks: number; workgroups: number } {
  const nbx = Math.ceil(field / B);
  const numBlocks = nbx * nbx;
  return { nbx, numBlocks, workgroups: Math.ceil(numBlocks / wgSize) };
}

/** Encode the 48-byte uniform block: 8×u32 header, then f32 lambdaV, T (slots 8,9). */
export function encodeParams(p: {
  W: number; H: number; B: number; phase: number;
  ox: number; oy: number; seed: number; lambdaV: number; T: number;
}): ArrayBuffer {
  const buf = new ArrayBuffer(48);
  const u = new Uint32Array(buf);
  const f = new Float32Array(buf);
  u[0] = p.W; u[1] = p.H; u[2] = p.B; u[3] = p.phase;
  u[4] = p.ox; u[5] = p.oy; u[6] = p.seed >>> 0; u[7] = 0;
  f[8] = p.lambdaV; f[9] = p.T; f[10] = 0; f[11] = 0;
  return buf;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/cell/gpu/cpm-gpu-encoding.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cell/gpu/cpm-gpu-encoding.ts src/cell/gpu/cpm-gpu-encoding.test.ts
git commit -m "feat(gpu): pure encoding helpers for GPU CPM (J flatten, packer, dispatch, params)"
```

---

## Task 2: Owner/kind → RGBA colour LUT

**Files:**
- Create: `src/cell/gpu/cpm-gpu-palette.ts`
- Test: `src/cell/gpu/cpm-gpu-palette.test.ts`

**Interfaces:**
- Produces:
  - `buildKindColorLut(kindColors: number[]): Uint32Array` — maps kind index → packed
    `0xAABBGGRR` (little-endian RGBA, the byte order `putImageData` expects). `kindColors[k]` is a
    `0xRRGGBB`; index 0 (background) is fully transparent (`0x00000000`).
  - `packRGBA(r: number, g: number, b: number, a: number): number` — pack 0–255 channels into a
    little-endian `0xAABBGGRR` u32.

- [ ] **Step 1: Write the failing test**

```ts
// src/cell/gpu/cpm-gpu-palette.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKindColorLut, packRGBA } from "./cpm-gpu-palette.ts";

test("packRGBA packs little-endian AABBGGRR", () => {
  // r=0x11 g=0x22 b=0x33 a=0xFF  -> 0xFF332211
  assert.equal(packRGBA(0x11, 0x22, 0x33, 0xff) >>> 0, 0xff332211);
});

test("buildKindColorLut: background transparent, kinds opaque with swapped R/B order", () => {
  const lut = buildKindColorLut([0x000000, 0xff8000]); // kind0 bg, kind1 = R255 G128 B0
  assert.equal(lut[0] >>> 0, 0x00000000); // background transparent
  // kind1: r=0xff g=0x80 b=0x00 a=0xff -> 0xff0080ff
  assert.equal(lut[1] >>> 0, 0xff0080ff);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/cell/gpu/cpm-gpu-palette.test.ts`
Expected: FAIL — cannot find module `./cpm-gpu-palette.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cell/gpu/cpm-gpu-palette.ts — pure colour packing for the GPU framebuffer pass.
// Byte order is little-endian RGBA (0xAABBGGRR) so a Uint32 store lands as R,G,B,A bytes,
// which is exactly what ImageData / putImageData consumes in CpmRenderer.

/** Pack 0–255 channels into a little-endian 0xAABBGGRR u32. */
export function packRGBA(r: number, g: number, b: number, a: number): number {
  return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

/** kind index → packed RGBA. Index 0 (background) is transparent. `kindColors[k]` is 0xRRGGBB. */
export function buildKindColorLut(kindColors: number[]): Uint32Array {
  const lut = new Uint32Array(kindColors.length);
  lut[0] = 0x00000000;
  for (let k = 1; k < kindColors.length; k++) {
    const c = kindColors[k];
    lut[k] = packRGBA((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 0xff);
  }
  return lut;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/cell/gpu/cpm-gpu-palette.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cell/gpu/cpm-gpu-palette.ts src/cell/gpu/cpm-gpu-palette.test.ts
git commit -m "feat(gpu): owner/kind RGBA colour LUT for the GPU framebuffer pass"
```

---

## Task 3: WebGPU device acquisition

**Files:**
- Create: `src/cell/gpu/cpm-gpu-device.ts`

**Interfaces:**
- Produces:
  - `type GpuHandle = { device: any; queue: any }`
  - `acquireGpu(): Promise<GpuHandle | { error: string }>` — worker-safe; returns `{ error }`
    (never throws) if `navigator.gpu` / adapter / device is unavailable.

This task has no node test (it needs a real GPU) — it is validated in Task 6's browser run. Keep
it tiny and defensive.

- [ ] **Step 1: Write the implementation**

```ts
// src/cell/gpu/cpm-gpu-device.ts — worker-safe WebGPU device acquisition. Returns a soft error
// object instead of throwing, so callers (bench, later the sim worker) can degrade gracefully.

// Minimal ambient decls so we don't pull in @webgpu/types for a prototype.
declare const GPUBufferUsage: {
  STORAGE: number; COPY_DST: number; COPY_SRC: number; UNIFORM: number; MAP_READ: number;
};
declare const GPUMapMode: { READ: number };
export { }; // ensure module scope for the ambient consts above

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GpuHandle = { device: any; queue: any };

export async function acquireGpu(): Promise<GpuHandle | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as unknown as { gpu?: any }).gpu;
  if (!gpu) return { error: "WebGPU not available (navigator.gpu missing)" };
  const adapter = await gpu.requestAdapter();
  if (!adapter) return { error: "no GPU adapter" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const device: any = await adapter.requestDevice();
  return { device, queue: device.queue };
}

// Re-export the ambient flag enums as runtime values for buffer creation elsewhere.
export const BUF = {
  STORAGE: () => GPUBufferUsage.STORAGE,
  COPY_DST: () => GPUBufferUsage.COPY_DST,
  COPY_SRC: () => GPUBufferUsage.COPY_SRC,
  UNIFORM: () => GPUBufferUsage.UNIFORM,
  MAP_READ: () => GPUBufferUsage.MAP_READ,
};
export const MAP_READ_FLAG = (): number => GPUMapMode.READ;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `cpm-gpu-device.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/cell/gpu/cpm-gpu-device.ts
git commit -m "feat(gpu): worker-safe WebGPU device acquisition helper"
```

---

## Task 4: WGSL sources (step + volume recompute + colour-map)

**Files:**
- Create: `src/cell/gpu/cpm-gpu-wgsl.ts`

**Interfaces:**
- Produces three exported WGSL strings:
  - `STEP_WGSL` — one checkerboard phase: border-biased reservoir pick, J-matrix adhesion +
    per-cell volume deltaH, Metropolis accept, writes `lattice` + atomically adjusts `vol`.
    Bindings: 0 `lattice: array<i32>` (rw), 1 `vol: array<atomic<i32>>` (rw), 2 `cellKind:
    array<u32>` (read), 3 `targetVol: array<f32>` (read), 4 `J: array<f32>` (read), 5 `P: Params`
    (uniform), 6 `nKinds: u32` (uniform via a second small uniform — see code, packed as a
    one-u32 buffer).
  - `VOL_WGSL` — two entry points `clear` (zero `vol`) and `scatter` (one thread/pixel,
    `atomicAdd(vol[lattice[i]], 1)`) — the drift-safe recompute.
  - `COLORMAP_WGSL` — one thread/pixel: `framebuffer[i] = lut[cellKind[lattice[i]]]`.

No standalone test (WGSL compiles only on a device); validated in Task 5/6.

- [ ] **Step 1: Write the implementation**

```ts
// src/cell/gpu/cpm-gpu-wgsl.ts — WGSL for the reduced GPU CPM (adhesion matrix + volume).
// The Act model, perimeter, steering, and the hard barrier are deliberately NOT here yet
// (M1b). Bindings are shared across the step/colourmap passes where possible.

export const STEP_WGSL = /* wgsl */ `
struct Params {
  W: u32, H: u32, B: u32, phase: u32,
  ox: u32, oy: u32, seed: u32, _pad: u32,
  lambdaV: f32, T: f32, _p2: f32, _p3: f32,
};
@group(0) @binding(0) var<storage, read_write> lattice: array<i32>;
@group(0) @binding(1) var<storage, read_write> vol: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> cellKind: array<u32>;
@group(0) @binding(3) var<storage, read> targetVol: array<f32>;
@group(0) @binding(4) var<storage, read> J: array<f32>;
@group(0) @binding(5) var<uniform> P: Params;
@group(0) @binding(6) var<uniform> NK: vec4<u32>; // NK.x = nKinds

fn inb(x: i32, y: i32) -> bool { return x >= 0 && x < i32(P.W) && y >= 0 && y < i32(P.H); }
fn latAt(x: i32, y: i32) -> i32 { if (inb(x,y)) { return lattice[y * i32(P.W) + x]; } return 0; }
fn kindAt(x: i32, y: i32) -> u32 { return cellKind[latAt(x,y)]; }

fn rng(state: ptr<function, u32>) -> f32 {
  var s = *state; s ^= s << 13u; s ^= s >> 17u; s ^= s << 5u; *state = s;
  return f32(s) * 2.3283064e-10;
}
// adhesion energy of pixel (x,y) if it held kind k: sum over 8 neighbours of J[k, kindOf(nb)].
fn adh(x: i32, y: i32, k: u32) -> f32 {
  let nk = NK.x;
  var e = 0.0;
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      if (kx == 0 && ky == 0) { continue; }
      e += J[k * nk + kindAt(x+kx, y+ky)];
    }
  }
  return e;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nbx = (P.W + P.B - 1u) / P.B;
  let nby = (P.H + P.B - 1u) / P.B;
  let bi = gid.x;
  if (bi >= nbx * nby) { return; }
  let bcol = bi % nbx;
  let brow = bi / nbx;
  if (((bcol & 1u) | ((brow & 1u) << 1u)) != P.phase) { return; }

  var st = (P.seed ^ (bi * 2654435761u)) + 1u;
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
        if (latAt(x+kx, y+ky) != id) { isB = true; }
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

  let kSrc = cellKind[srcId];
  let kTgt = cellKind[tgtId];
  var dH = adh(cx, cy, kSrc) - adh(cx, cy, kTgt);
  if (tgtId > 0) {
    let v = f32(atomicLoad(&vol[tgtId])); let tv = targetVol[tgtId];
    dH += P.lambdaV * ((v-1.0-tv)*(v-1.0-tv) - (v-tv)*(v-tv));
  }
  if (srcId > 0) {
    let v = f32(atomicLoad(&vol[srcId])); let tv = targetVol[srcId];
    dH += P.lambdaV * ((v+1.0-tv)*(v+1.0-tv) - (v-tv)*(v-tv));
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

export const VOL_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> lattice: array<i32>;
@group(0) @binding(1) var<storage, read_write> vol: array<atomic<i32>>;
@group(0) @binding(2) var<uniform> DIM: vec4<u32>; // x=N pixels, y=volN

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.y) { return; }
  atomicStore(&vol[i], 0);
}
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.x) { return; }
  let id = lattice[i];
  if (id > 0) { atomicAdd(&vol[id], 1); }
}
`;

export const COLORMAP_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> lattice: array<i32>;
@group(0) @binding(1) var<storage, read> cellKind: array<u32>;
@group(0) @binding(2) var<storage, read> lut: array<u32>;
@group(0) @binding(3) var<storage, read_write> framebuffer: array<u32>;
@group(0) @binding(4) var<uniform> DIM: vec4<u32>; // x=N pixels

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.x) { return; }
  framebuffer[i] = lut[cellKind[lattice[i]]];
}
`;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (these are plain string exports).

- [ ] **Step 3: Commit**

```bash
git add src/cell/gpu/cpm-gpu-wgsl.ts
git commit -m "feat(gpu): WGSL for reduced GPU CPM step, volume recompute, colour-map"
```

---

## Task 5: `GpuCpm` class

**Files:**
- Create: `src/cell/gpu/cpm-gpu.ts`

**Interfaces:**
- Consumes: `acquireGpu`, `BUF`, `MAP_READ_FLAG` (Task 3); `STEP_WGSL`, `VOL_WGSL`,
  `COLORMAP_WGSL` (Task 4); `blockDispatch`, `encodeParams` (Task 1); `Uint32Array` LUT (Task 2).
- Produces:
  - `class GpuCpm` with:
    - `static async create(opts: { field: number; B?: number; lambdaV: number; T: number;
      J: Float32Array; nKinds: number; lut: Uint32Array; lattice: Int32Array; kind: Int32Array;
      targetVol: Float32Array; maxId: number }): Promise<GpuCpm | { error: string }>`
    - `stepN(n: number): void` — enqueue `n` MCS (each = 4 phases + one volume recompute).
    - `async flush(): Promise<void>` — await GPU completion.
    - `async readVolumes(): Promise<Int32Array>` — length `maxId+1`.
    - `async readFramebuffer(): Promise<Uint32Array>` — length `field²`, run colour-map then map.
    - `destroy(): void`.

This task is validated in-browser in Task 6 (no node GPU). After writing, do a smoke check via
the dev server before committing.

- [ ] **Step 1: Write the implementation**

```ts
// src/cell/gpu/cpm-gpu.ts — GPU-resident reduced CPM (adhesion matrix + volume) on a checkerboard.
// Owns all state in GPU buffers; the host only enqueues steps and reads back volumes / framebuffer.
// Worker-safe (no Phaser). Physics is intentionally reduced (no Act/perimeter/barrier yet — M1b).

import { acquireGpu, BUF, MAP_READ_FLAG } from "./cpm-gpu-device.ts";
import { STEP_WGSL, VOL_WGSL, COLORMAP_WGSL } from "./cpm-gpu-wgsl.ts";
import { blockDispatch, encodeParams } from "./cpm-gpu-encoding.ts";

const WG = 64;

export class GpuCpm {
  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly d: any,
    private readonly field: number,
    private readonly B: number,
    private readonly lambdaV: number,
    private readonly T: number,
    private readonly volN: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly buf: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly pipe: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly bind: Record<string, any>
  ) {}

  static async create(opts: {
    field: number; B?: number; lambdaV: number; T: number;
    J: Float32Array; nKinds: number; lut: Uint32Array;
    lattice: Int32Array; kind: Int32Array; targetVol: Float32Array; maxId: number;
  }): Promise<GpuCpm | { error: string }> {
    const g = await acquireGpu();
    if ("error" in g) return g;
    const d = g.device;
    const { field } = opts;
    const B = opts.B ?? 4;
    const N = field * field;
    const volN = opts.maxId + 1;

    const store = (bytes: number): any =>
      d.createBuffer({ size: bytes, usage: BUF.STORAGE() | BUF.COPY_DST() | BUF.COPY_SRC() });
    const uniform = (bytes: number): any =>
      d.createBuffer({ size: bytes, usage: BUF.UNIFORM() | BUF.COPY_DST() });

    const buf: Record<string, any> = {
      lattice: store(N * 4),
      vol: store(volN * 4),
      kind: store(volN * 4),
      targetVol: store(volN * 4),
      J: store(opts.J.byteLength),
      lut: store(opts.lut.byteLength),
      framebuffer: store(N * 4),
      params: uniform(48),
      nk: uniform(16),
      volDim: uniform(16),
      cmDim: uniform(16),
      volStaging: d.createBuffer({ size: volN * 4, usage: BUF.COPY_DST() | BUF.MAP_READ() }),
      fbStaging: d.createBuffer({ size: N * 4, usage: BUF.COPY_DST() | BUF.MAP_READ() }),
    };
    d.queue.writeBuffer(buf.lattice, 0, opts.lattice);
    d.queue.writeBuffer(buf.kind, 0, opts.kind);
    d.queue.writeBuffer(buf.targetVol, 0, opts.targetVol);
    d.queue.writeBuffer(buf.J, 0, opts.J);
    d.queue.writeBuffer(buf.lut, 0, opts.lut);
    d.queue.writeBuffer(buf.nk, 0, new Uint32Array([opts.nKinds, 0, 0, 0]));
    d.queue.writeBuffer(buf.volDim, 0, new Uint32Array([N, volN, 0, 0]));
    d.queue.writeBuffer(buf.cmDim, 0, new Uint32Array([N, 0, 0, 0]));

    const mod = (code: string): any => d.createShaderModule({ code });
    const pipe = {
      step: d.createComputePipeline({ layout: "auto", compute: { module: mod(STEP_WGSL), entryPoint: "main" } }),
      volClear: d.createComputePipeline({ layout: "auto", compute: { module: mod(VOL_WGSL), entryPoint: "clear" } }),
      volScatter: d.createComputePipeline({ layout: "auto", compute: { module: mod(VOL_WGSL), entryPoint: "scatter" } }),
      colormap: d.createComputePipeline({ layout: "auto", compute: { module: mod(COLORMAP_WGSL), entryPoint: "main" } }),
    };
    // NOTE: volClear and volScatter share one WGSL module so their bind-group layout is identical.
    const bind = {
      step: d.createBindGroup({
        layout: pipe.step.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.vol } },
          { binding: 2, resource: { buffer: buf.kind } },
          { binding: 3, resource: { buffer: buf.targetVol } },
          { binding: 4, resource: { buffer: buf.J } },
          { binding: 5, resource: { buffer: buf.params } },
          { binding: 6, resource: { buffer: buf.nk } },
        ],
      }),
      volClear: d.createBindGroup({
        layout: pipe.volClear.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.vol } },
          { binding: 2, resource: { buffer: buf.volDim } },
        ],
      }),
      volScatter: d.createBindGroup({
        layout: pipe.volScatter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.vol } },
          { binding: 2, resource: { buffer: buf.volDim } },
        ],
      }),
      colormap: d.createBindGroup({
        layout: pipe.colormap.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.kind } },
          { binding: 2, resource: { buffer: buf.lut } },
          { binding: 3, resource: { buffer: buf.framebuffer } },
          { binding: 4, resource: { buffer: buf.cmDim } },
        ],
      }),
    };
    return new GpuCpm(d, field, B, opts.lambdaV, opts.T, volN, buf, pipe, bind);
  }

  private dispatch(enc: any, pipeline: any, bindGroup: any, threads: number): void {
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(threads / WG));
    pass.end();
  }

  stepN(n: number): void {
    const { workgroups } = blockDispatch(this.field, this.B, WG);
    const N = this.field * this.field;
    for (let m = 0; m < n; m++) {
      const ox = (Math.random() * this.B) | 0;
      const oy = (Math.random() * this.B) | 0;
      const enc = this.d.createCommandEncoder();
      for (let phase = 0; phase < 4; phase++) {
        this.d.queue.writeBuffer(
          this.buf.params, 0,
          encodeParams({ W: this.field, H: this.field, B: this.B, phase, ox, oy,
            seed: (Math.random() * 1e9) | 0, lambdaV: this.lambdaV, T: this.T })
        );
        const pass = enc.beginComputePass();
        pass.setPipeline(this.pipe.step);
        pass.setBindGroup(0, this.bind.step);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
      }
      // drift-safe volume recompute (once per MCS): clear then scatter from the lattice.
      this.dispatch(enc, this.pipe.volClear, this.bind.volClear, this.volN);
      this.dispatch(enc, this.pipe.volScatter, this.bind.volScatter, N);
      this.d.queue.submit([enc.finish()]);
    }
  }

  async flush(): Promise<void> {
    await this.d.queue.onSubmittedWorkDone();
  }

  async readVolumes(): Promise<Int32Array> {
    const enc = this.d.createCommandEncoder();
    enc.copyBufferToBuffer(this.buf.vol, 0, this.buf.volStaging, 0, this.volN * 4);
    this.d.queue.submit([enc.finish()]);
    await this.buf.volStaging.mapAsync(MAP_READ_FLAG());
    const out = new Int32Array(this.buf.volStaging.getMappedRange().slice(0));
    this.buf.volStaging.unmap();
    return out;
  }

  async readFramebuffer(): Promise<Uint32Array> {
    const N = this.field * this.field;
    const enc = this.d.createCommandEncoder();
    this.dispatch(enc, this.pipe.colormap, this.bind.colormap, N);
    enc.copyBufferToBuffer(this.buf.framebuffer, 0, this.buf.fbStaging, 0, N * 4);
    this.d.queue.submit([enc.finish()]);
    await this.buf.fbStaging.mapAsync(MAP_READ_FLAG());
    const out = new Uint32Array(this.buf.fbStaging.getMappedRange().slice(0));
    this.buf.fbStaging.unmap();
    return out;
  }

  destroy(): void {
    for (const k of Object.keys(this.buf)) this.buf[k].destroy?.();
    this.d.destroy?.();
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `cpm-gpu.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/cell/gpu/cpm-gpu.ts
git commit -m "feat(gpu): GpuCpm class — GPU-resident reduced CPM with drift-safe volume recompute"
```

---

## Task 6: A/B benchmark + `__cpm.gpuBench` (the gate)

**Files:**
- Create: `src/cell/gpu/cpm-gpu-bench.ts`
- Modify: `src/cell/cpm-world-scene.ts` (expose `gpuBench` on the `__cpm` handle)

**Interfaces:**
- Consumes: `GpuCpm.create/stepN/flush/readVolumes` (Task 5); `packSquareLattice`, `flattenJ`
  (Task 1); `buildKindColorLut` (Task 2).
- Produces:
  - `gpuBench(opts?: { field?: number; cellSize?: number; mcs?: number; B?: number }):
    Promise<object>` — builds a packed world, times `GpuCpm` MCS/s and an identical single-thread
    CPU reference at the SAME border, and returns `{ field, border, cells, gpu_msPerMCS,
    cpu_msPerMCS, speedup, gpu_meanVolDevPct }`.

- [ ] **Step 1: Write the implementation**

```ts
// src/cell/gpu/cpm-gpu-bench.ts — live A/B: GpuCpm vs an identical single-thread CPU reference at
// equal border. This is the M1a completion gate — it must show a real GPU speedup with volume
// drift under control. Exposed via window.__cpm.gpuBench().

import { GpuCpm } from "./cpm-gpu.ts";
import { packSquareLattice, flattenJ } from "./cpm-gpu-encoding.ts";
import { buildKindColorLut } from "./cpm-gpu-palette.ts";

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
```

- [ ] **Step 2: Expose `gpuBench` on the `__cpm` dev handle**

In `src/cell/cpm-world-scene.ts`, find where `__cpm` is assigned (it already exposes `bench`,
`spike`, `gpuSpike`). Add the import at the top:

```ts
import { gpuBench } from "./gpu/cpm-gpu-bench";
```

and add `gpuBench` to the handle object (alongside the existing `gpuSpike` entry), e.g.:

```ts
    gpuBench,
```

- [ ] **Step 3: Type-check + dev build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the benchmark in the browser (the gate)**

Start the dev server (`npm run dev`), then drive it with the Playwright MCP:
1. `browser_navigate` to `http://localhost:5173/?local`.
2. `browser_evaluate`: `async () => await window.__cpm.gpuBench({ mcs: 200 })`.

Expected: an object like
`{ field:336, border:~20000, cells:~900, gpu_msPerMCS:<~0.15, cpu_msPerMCS:>~15, speedup:>=20, gpu_meanVolDevPct:<5 }`.

**Gate assertions (record the actual numbers in the commit message):**
- `speedup >= 5` (expect far higher; ≥5 is the floor to proceed).
- `gpu_meanVolDevPct < 5` (the drift fix is working — materially better than the ~13–23% of the
  original `gpuSpike`).

If `speedup < 5` or `gpu_meanVolDevPct >= 5`, STOP and diagnose before proceeding to M1b.

- [ ] **Step 5: Sanity-check the framebuffer readback**

`browser_evaluate`:

```js
async () => {
  const g = await window.__cpm._gpuFbSmoke?.();
  return g; // if not wired, skip — covered by gpuBench + M1b live wiring
}
```

(Optional; the framebuffer path is exercised for real when M1b wires `readFramebuffer` into the
renderer. Skip if `_gpuFbSmoke` is not present.)

- [ ] **Step 6: Commit**

```bash
git add src/cell/gpu/cpm-gpu-bench.ts src/cell/cpm-world-scene.ts
git commit -m "feat(gpu): live A/B gpuBench (GpuCpm vs CPU) + expose on __cpm — <speedup>x, <volDev>% drift"
```

---

## Self-Review

**Spec coverage (against `2026-07-05-gpu-resident-cpm-design.md`):**
- GPU-resident lattice + per-cell params in buffers → Tasks 4–5. ✅
- Checkerboard MC step → `STEP_WGSL` (Task 4). ✅
- Full per-kind J matrix → `flattenJ` + `adh()` (Tasks 1, 4). ✅
- Per-cell volume + **drift fix (recompute from lattice)** → `VOL_WGSL` + `stepN` recompute
  (Tasks 4, 5). ✅
- Framebuffer color-map on GPU + readback → `COLORMAP_WGSL` + `readFramebuffer` (Tasks 4, 5). ✅
- CPU oracle retained + A/B benchmark gate → `gpuBench` / `cpuReference` (Task 6). ✅
- Worker-safe (Phaser-free) GPU modules → all under `src/cell/gpu/`, no Phaser imports. ✅
- **Deferred to M1b (explicitly out of this plan):** Act model, Perimeter, PerCellAttraction,
  hard Barrier, per-cell centroid/summary reduction, wiring into `sim-worker.ts`/live tick,
  discrete edits. Noted in the plan header and architecture section.

**Placeholder scan:** No TBD/TODO; every code step has complete code; the optional Step 5 in
Task 6 is explicitly skippable, not a placeholder deliverable.

**Type consistency:** `GpuCpm.create` option names (`lattice`/`kind`/`targetVol`/`maxId`/`J`/
`nKinds`/`lut`) match `packSquareLattice`/`flattenJ`/`buildKindColorLut` outputs and the bench's
call site. `encodeParams` field names match the `Params` struct slot order in `STEP_WGSL`
(u32 0–7, f32 8=lambdaV, 9=T). `blockDispatch(...).workgroups` used consistently in `stepN`.
Binding indices in `bind.*` match each WGSL `@binding`.

**Note on physics honesty:** with adhesion+volume only (no Act/perimeter), packed cells will
relax toward rounded squares and NOT crawl — expected and correct for M1a. Crawl arrives with the
Act port in M1b. `gpuBench` measures speed + volume fidelity, which is all M1a claims.
