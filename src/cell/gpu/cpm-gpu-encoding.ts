// cpm-gpu-encoding.ts — pure, worker-safe helpers for the GPU CPM.
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
