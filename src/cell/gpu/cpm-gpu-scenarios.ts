// cpm-gpu-scenarios.ts — focused GPU-CPM behaviour tests (M1c): steering and the hard barrier.
// Small fields, decisive assertions, headless via window.__cpm.gpuSteerTest / gpuBarrierTest.

import { GpuCpm } from "./cpm-gpu";
import { flattenJ } from "./cpm-gpu-encoding";
import { buildKindColorLut } from "./cpm-gpu-palette";

/** Stamp a filled disc of `id` into `lattice`. */
function stampDisc(lattice: Int32Array, field: number, id: number, cx: number, cy: number, r: number): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r2) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || x >= field || y < 0 || y >= field) continue;
    lattice[y * field + x] = id;
  }
}

/** Perimeter (sum unlike 8-neighbours) of one cell id. */
function perimOf(lat: Int32Array, field: number, id: number): number {
  let p = 0;
  for (let y = 0; y < field; y++) for (let x = 0; x < field; x++) {
    if (lat[y * field + x] !== id) continue;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      const nx = x + kx, ny = y + ky;
      const nid = nx < 0 || nx >= field || ny < 0 || ny >= field ? 0 : lat[ny * field + nx];
      if (nid !== id) p++;
    }
  }
  return p;
}

/** Steering test (opposite biases): the SAME Act-motile cell is commanded left vs right; its
 *  centroid must end further right when pulled right than when pulled left. Comparing the two
 *  opposite pulls (rather than steer-vs-control) doubles the signal and is robust to the small
 *  absolute motion of a tiny cell — it confirms the attraction is wired into the GPU step and
 *  points the cell the right way. The per-attempt formula itself is unit-tested. */
export async function gpuSteerTest(mcs = 1000): Promise<object> {
  const field = 64;
  const startX = 32;
  const runOne = async (targetX: number): Promise<number> => {
    const lattice = new Int32Array(field * field);
    stampDisc(lattice, field, 1, startX, 32, 6);
    const kind = Int32Array.from([0, 1]);
    let area = 0;
    for (const v of lattice) if (v === 1) area++;
    const targetVol = Float32Array.from([0, area]);
    const { J, nKinds } = flattenJ([[0, 20], [20, 0]]);
    const lut = buildKindColorLut([0x000000, 0x4fc3f7]);
    const gpu = await GpuCpm.create({
      field, lambdaV: 20, T: 20, J, nKinds, lut,
      maxAct: [0, 20], lambdaAct: [0, 120], lambdaP: [0, 2], targetP: [0, perimOf(lattice, field, 1)],
      lattice, kind, targetVol, maxId: 1, permeableKind: 1,
    });
    if ("error" in gpu) return NaN;
    gpu.setSteer(1, targetX, 32, 600);
    gpu.stepN(mcs); await gpu.flush();
    const lat = await gpu.readLattice();
    gpu.destroy();
    // centroid x
    let sx = 0, n = 0;
    for (let y = 0; y < field; y++) for (let x = 0; x < field; x++) {
      if (lat[y * field + x] === 1) { sx += x; n++; }
    }
    return n ? sx / n : NaN;
  };
  const pulledRightX = await runOne(60);
  const pulledLeftX = await runOne(4);
  return {
    startX,
    pulledRightX: +pulledRightX.toFixed(1), pulledLeftX: +pulledLeftX.toFixed(1),
    directionSpread: +(pulledRightX - pulledLeftX).toFixed(1), // right-pull ends right of left-pull
  };
}

/** Movement test: a lone player cell with the tuned PLAYER_PROFILE Act params, steered to a far
 *  point, must actually TRANSLATE there (not just bulge). Proves amoeboid crawl works on the GPU
 *  with real params. Speed is MCS-bound, so this runs a healthy number of MCS. */
export async function gpuMoveTest(
  mcs = 2500,
  opts: { lambdaV?: number; lambdaP?: number; maxAct?: number; lambdaAct?: number; steerLambda?: number; B?: number } = {}
): Promise<object> {
  const field = 96;
  const startX = 26, startY = 48, targetX = 74, targetY = 48;
  const lattice = new Int32Array(field * field);
  stampDisc(lattice, field, 1, startX, startY, 9);
  const kind = Int32Array.from([0, 1]);
  let area = 0;
  for (const v of lattice) if (v === 1) area++;
  const targetVol = Float32Array.from([0, area]);
  const { J, nKinds } = flattenJ([[0, 20], [20, 0]]);
  const lut = buildKindColorLut([0x000000, 0x49d0ff]);
  const gpu = await GpuCpm.create({
    field, B: opts.B ?? 4, lambdaV: opts.lambdaV ?? 50, T: 20, J, nKinds, lut,
    maxAct: [0, opts.maxAct ?? 80], lambdaAct: [0, opts.lambdaAct ?? 220],
    lambdaP: [0, opts.lambdaP ?? 2], targetP: [0, perimOf(lattice, field, 1)],
    lattice, kind, targetVol, maxId: 1, permeableKind: 1,
  });
  if ("error" in gpu) return gpu;
  const steerLambda = opts.steerLambda ?? 260;

  const cen = (lat: Int32Array): { x: number; y: number } => {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < field; y++) for (let x = 0; x < field; x++) {
      if (lat[y * field + x] === 1) { sx += x; sy += y; n++; }
    }
    return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
  };
  const start = cen(await gpu.readLattice());
  gpu.setSteer(1, targetX, targetY, steerLambda);
  gpu.stepN(mcs); await gpu.flush();
  const end = cen(await gpu.readLattice());
  gpu.destroy();

  return {
    startX: +start.x.toFixed(1), endX: +end.x.toFixed(1),
    dx: +(end.x - start.x).toFixed(1), dy: +(end.y - start.y).toFixed(1),
    fractionOfWay: +(((end.x - start.x) / (targetX - startX)) * 100).toFixed(0), // % toward target
  };
}

/** Barrier test: a solid barrier-kind wall down the middle; a cell steered hard into it. When the
 *  mover is a non-permeable kind it must NOT cross; when it is the permeable (player) kind it must.
 *  Proves the hard PermeableBarrierConstraint + permeability on the GPU. */
export async function gpuBarrierTest(mcs = 600): Promise<object> {
  const field = 64;
  const wallX0 = 32, wallX1 = 34; // inclusive columns of the wall

  const run = async (moverKind: number): Promise<{ moverMaxX: number; moverInWall: number; latChanged: number }> => {
    const lattice = new Int32Array(field * field);
    // cell 1 = the wall (kind 2, a barrier), columns wallX0..wallX1, full height.
    for (let y = 0; y < field; y++) for (let x = wallX0; x <= wallX1; x++) lattice[y * field + x] = 1;
    // cell 2 = the mover, a rectangle flush against the wall's left face, with open background on
    // its other sides so it stays active (grows there) while it presses on the wall.
    for (let y = 22; y <= 42; y++) for (let x = 22; x <= wallX0 - 1; x++) lattice[y * field + x] = 2;
    const kind = Int32Array.from([0, 2, moverKind]); // id1 -> kind2 (barrier), id2 -> moverKind
    const maxId = 2;
    let wallArea = 0, moverArea = 0;
    for (const v of lattice) { if (v === 1) wallArea++; else if (v === 2) moverArea++; }
    // Give the mover a large volume target so it aggressively expands in every available direction.
    // The ONLY thing stopping it going right is the wall — which it may pass iff it is permeable.
    const targetVol = Float32Array.from([0, wallArea, moverArea + 400]);
    // 4 kinds: 0 bg, 1 player(permeable), 2 barrier, 3 microbe. J: unlike=20, like=0.
    const jrows = [
      [0, 20, 20, 20],
      [20, 0, 20, 20],
      [20, 20, 0, 20],
      [20, 20, 20, 0],
    ];
    const { J, nKinds } = flattenJ(jrows);
    const lut = buildKindColorLut([0x000000, 0x4fc3f7, 0x8899aa, 0xff5544]);
    const gpu = await GpuCpm.create({
      field, lambdaV: 15, T: 20, J, nKinds, lut,
      // No crawl: steering + a soft volume let the mover press its edge steadily into the wall
      // (Act-driven movers wander off contact). The wall kind (2) is inert.
      maxAct: [0, 0, 0, 0], lambdaAct: [0, 0, 0, 0],
      lambdaP: [0, 0, 0, 0], targetP: [0, 0, 0, 0], // no perimeter: the flat contact face stays flat
      lattice, kind, targetVol, maxId, permeableKind: 1, barrierKinds: [2],
    });
    if ("error" in gpu) return { moverMaxX: -1, moverInWall: -1, latChanged: -1 };

    gpu.setSteer(2, 62, 32, 900); // shove the mover right, hard, into the wall
    gpu.stepN(mcs); await gpu.flush();
    const lat = await gpu.readLattice();
    gpu.destroy();

    let latChanged = 0;
    for (let i = 0; i < lat.length; i++) if (lat[i] !== lattice[i]) latChanged++;
    // Mover pixels at/past the wall's left edge: a non-permeable mover can NEVER have one (the hard
    // barrier forbids taking any wall pixel and the full-height wall offers no way around). A
    // permeable mover expands right through it.
    let moverInWall = 0, moverMaxX = 0;
    for (let y = 0; y < field; y++) for (let x = 0; x < field; x++) {
      const v = lat[y * field + x];
      if (v === 2) { if (x >= wallX0) moverInWall++; if (x > moverMaxX) moverMaxX = x; }
    }
    return { moverMaxX, moverInWall, latChanged };
  };

  const nonPlayer = await run(3); // microbe kind — cannot cross the wall
  const player = await run(1); // permeable kind — expands through the wall
  return {
    wallX0,
    nonPlayer_moverInWall: nonPlayer.moverInWall, nonPlayer_moverMaxX: nonPlayer.moverMaxX, nonPlayer_latChanged: nonPlayer.latChanged,
    player_moverInWall: player.moverInWall, player_moverMaxX: player.moverMaxX, player_latChanged: player.latChanged,
  };
}
