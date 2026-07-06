// cpm-gpu-world.ts — builds a small demo world for the live GPU sandbox (?gpu): a barrier wall
// frame, a lawn of motile microbes, and one steerable player cell. Returns exactly the arrays
// GpuCpm.create needs, plus the player's cell id. Pure/worker-safe (no Phaser).

import { flattenJ } from "./cpm-gpu-encoding";
import { buildKindColorLut } from "./cpm-gpu-palette";

export const KIND = { BG: 0, PLAYER: 1, MICROBE: 2, WALL: 3 } as const;

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

export interface GpuWorld {
  field: number;
  lattice: Int32Array;
  kind: Int32Array;
  targetVol: Float32Array;
  maxId: number;
  playerId: number;
  nKinds: number;
  J: Float32Array;
  lut: Uint32Array;
  maxAct: number[];
  lambdaAct: number[];
  lambdaP: number[];
  targetP: number[];
  lambdaV: number;
  T: number;
  permeableKind: number;
  barrierKinds: number[];
}

/** Build the demo world. `field` is the lattice edge (≈200 keeps a full lawn at 60fps). */
export function buildGpuWorld(field = 200): GpuWorld {
  const lattice = new Int32Array(field * field);
  const kindArr: number[] = [0];
  const volArr: number[] = [0];
  let id = 0;

  // Border frame = one WALL (barrier) cell.
  id++;
  const wallId = id;
  kindArr[id] = KIND.WALL;
  const t = 3;
  let wallArea = 0;
  for (let y = 0; y < field; y++) for (let x = 0; x < field; x++) {
    if (x < t || x >= field - t || y < t || y >= field - t) { lattice[y * field + x] = wallId; wallArea++; }
  }
  volArr[wallId] = wallArea;

  const stampDisc = (k: number, cx: number, cy: number, r: number): number => {
    const r2 = r * r;
    let area = 0;
    id++;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= field || y < 0 || y >= field) continue;
      if (lattice[y * field + x] !== 0) continue; // don't overwrite the wall / other cells
      lattice[y * field + x] = id;
      area++;
    }
    kindArr[id] = k;
    volArr[id] = area;
    return id;
  };

  // Player near the centre.
  const playerR = 9;
  const playerId = stampDisc(KIND.PLAYER, Math.floor(field / 2), Math.floor(field / 2), playerR);

  // A lawn of microbes, skipping the player's neighbourhood.
  const microbeR = 5;
  const spacing = 20;
  const pc = Math.floor(field / 2);
  for (let gy = 16; gy < field - 16; gy += spacing) {
    for (let gx = 16; gx < field - 16; gx += spacing) {
      if (Math.abs(gx - pc) < 24 && Math.abs(gy - pc) < 24) continue; // keep clear around the player
      if (lattice[gy * field + gx] !== 0) continue;
      stampDisc(KIND.MICROBE, gx, gy, microbeR);
    }
  }

  const kind = Int32Array.from(kindArr);
  const targetVol = Float32Array.from(volArr);

  // Per-kind target perimeter, from a representative cell of each kind.
  let aMicrobe = playerId + 1;
  const targetP = [0, perimOf(lattice, field, playerId), aMicrobe <= id ? perimOf(lattice, field, aMicrobe) : 0, 0];

  // Adhesion: like=0, most unlike=20, player<->microbe a touch stickier (16).
  const { J, nKinds } = flattenJ([
    [0, 20, 20, 20],
    [20, 0, 16, 20],
    [20, 16, 0, 20],
    [20, 20, 20, 0],
  ]);
  const lut = buildKindColorLut([0x000000, 0x4fc3f7, 0xff7043, 0x5a6b7a]); // bg, player=cyan, microbe=orange, wall=slate

  return {
    field, lattice, kind, targetVol, maxId: id, playerId, nKinds, J, lut,
    // Matches the tuned PLAYER_PROFILE (cpm-config): hot Act (maxAct 80) is what makes the
    // amoeboid crawl actually translate; wall is inert. Microbes wander more gently.
    maxAct: [0, 80, 50, 0],
    lambdaAct: [0, 220, 120, 0],
    lambdaP: [0, 2, 2, 0],
    targetP,
    lambdaV: 50,
    T: 20,
    permeableKind: KIND.PLAYER, // the player plows through walls/debris
    barrierKinds: [KIND.WALL],
  };
}
