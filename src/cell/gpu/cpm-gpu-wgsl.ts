// cpm-gpu-wgsl.ts — WGSL for the reduced GPU CPM (adhesion matrix + volume).
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
