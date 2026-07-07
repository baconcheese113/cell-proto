// cpm-gpu-world.ts — builds a small demo world for the live GPU sandbox (?gpu): a barrier wall
// frame, a lawn of motile microbes, and one steerable player cell. Returns exactly the arrays
// GpuCpm.create needs, plus the player's cell id. Pure/worker-safe (no Phaser).

import { flattenJ } from "./cpm-gpu-encoding";
import { buildKindColorLut } from "./cpm-gpu-palette";

// KIND.WALL is the endothelial vessel lining (a hard barrier).
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
  border: number; // border-pixel count (drives the CPM step cost)
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

/** Build a vessel world: top + bottom endothelial walls (each SEGMENTED into distinct cells) form
 *  a tube; the player + a lawn of microbes live in the lumen between them. The endothelial lining is
 *  a hard barrier that NOTHING crosses, so the walls confine everyone. `microbeSpacing`/`microbeR`
 *  set the lumen density. */
export function buildGpuWorld(field = 320, microbeSpacing = 15, microbeR = 5): GpuWorld {
  const lattice = new Int32Array(field * field);
  const kindArr: number[] = [0];
  const volArr: number[] = [0];
  let id = 0;

  const stampRect = (k: number, x0: number, y0: number, x1: number, y1: number): number => {
    id++;
    let area = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= field || y < 0 || y >= field) continue;
      if (lattice[y * field + x] !== 0) continue;
      lattice[y * field + x] = id;
      area++;
    }
    kindArr[id] = k;
    volArr[id] = area;
    return id;
  };
  const stampDisc = (k: number, cx: number, cy: number, r: number): number => {
    const r2 = r * r;
    let area = 0;
    id++;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= field || y < 0 || y >= field) continue;
      if (lattice[y * field + x] !== 0) continue; // don't overwrite walls / other cells
      lattice[y * field + x] = id;
      area++;
    }
    kindArr[id] = k;
    volArr[id] = area;
    return id;
  };

  // Vessel: top + bottom endothelial walls, each split into distinct cells (segments).
  const wallH = Math.round(field * 0.15);
  const segW = 26;
  const firstEndo = id + 1;
  for (let x0 = 0; x0 < field; x0 += segW) {
    const x1 = Math.min(x0 + segW, field);
    stampRect(KIND.WALL, x0, 0, x1, wallH); // top
    stampRect(KIND.WALL, x0, field - wallH, x1, field); // bottom
  }

  // Player in the lumen centre.
  const lumenTop = wallH, lumenBot = field - wallH;
  const pc = Math.floor(field / 2);
  const playerId = stampDisc(KIND.PLAYER, pc, pc, 9);
  const firstMicrobe = id + 1;

  // Distinct microbes scattered through the lumen (never in the walls).
  const spacing = microbeSpacing;
  for (let gy = lumenTop + 10; gy < lumenBot - 10; gy += spacing) {
    for (let gx = 12; gx < field - 12; gx += spacing) {
      if (Math.abs(gx - pc) < 26 && Math.abs(gy - pc) < 26) continue; // clear around the player
      if (lattice[gy * field + gx] !== 0) continue;
      stampDisc(KIND.MICROBE, gx, gy, microbeR);
    }
  }

  const kind = Int32Array.from(kindArr);
  const targetVol = Float32Array.from(volArr);

  // border-pixel count (pixels adjacent to a different id) — the driver of step cost.
  let border = 0;
  for (let y = 0; y < field; y++) for (let x = 0; x < field; x++) {
    const v = lattice[y * field + x];
    if (v === 0) continue;
    let isB = false;
    for (let ky = -1; ky <= 1 && !isB; ky++) for (let kx = -1; kx <= 1; kx++) {
      if (kx === 0 && ky === 0) continue;
      const nx = x + kx, ny = y + ky;
      const nid = nx < 0 || nx >= field || ny < 0 || ny >= field ? 0 : lattice[ny * field + nx];
      if (nid !== v) { isB = true; break; }
    }
    if (isB) border++;
  }

  // Per-kind target perimeter, from a representative cell of each kind.
  const targetP = [
    0,
    perimOf(lattice, field, playerId), // player disc
    firstMicrobe <= id ? perimOf(lattice, field, firstMicrobe) : 40, // microbe disc
    perimOf(lattice, field, firstEndo), // endothelial wall segment
  ];

  // Adhesion (J[kindA][kindB]). Same-kind microbe adhesion is HIGH (28) so microbes stay distinct
  // instead of merging into one blob; endothelial lining is cohesive (6).
  const { J, nKinds } = flattenJ([
    [0, 20, 20, 20], // bg
    [20, 0, 14, 20], // player: a touch sticky to microbes (14) so it can grab
    [20, 14, 28, 16], // microbe: microbe<->microbe 28 => distinct
    [20, 20, 16, 6], // endothelial: cohesive wall
  ]);
  const lut = buildKindColorLut([0x000000, 0x49d0ff, 0xff7043, 0x8a6f9e]); // bg, player, microbe, endothelial

  return {
    field, border, lattice, kind, targetVol, maxId: id, playerId, nKinds, J, lut,
    // player & microbes crawl (Act); the endothelial lining is inert (it's a hard barrier anyway).
    maxAct: [0, 80, 45, 0],
    lambdaAct: [0, 220, 130, 0],
    lambdaP: [0, 2, 2, 3],
    targetP,
    lambdaV: 50,
    T: 20,
    // No permeable kind (99 = nothing) so the endothelial barrier BLOCKS everyone — the player is
    // confined to the vessel lumen, microbes can't escape it.
    permeableKind: 99,
    barrierKinds: [KIND.WALL], // KIND.WALL is the endothelial vessel lining
  };
}
