// cpm-gpu-wgsl.ts — WGSL for the GPU CPM: adhesion matrix + volume + the Act model (crawl).
// Perimeter, steering, and the hard barrier are still deliberately NOT here yet (later M1
// steps). Bindings are shared across the step/colourmap passes where possible.
//
// Act model (Niculescu et al. 2015, as in Artistoo's ActivityConstraint): each pixel carries an
// integer activity in [0, MAX_ACT]. On an accepted copy the target pixel's activity is reset to
// its new cell-kind's MAX_ACT; every MCS all activities decay by 1. deltaH_act =
// lambdaAct * (GM(target) - GM(source)) / maxAct, where GM is the geometric mean of activity over
// a pixel and its same-cell 8-neighbours (0 if any is 0). Params (maxAct, lambdaAct) are per-kind,
// packed into kindParams.xy.

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
@group(0) @binding(6) var<uniform> NK: vec4<u32>; // x=nKinds y=permeableKind z=barrierBitmask
@group(0) @binding(7) var<storage, read_write> act: array<i32>;      // per-pixel activity
@group(0) @binding(8) var<storage, read> kindParams: array<vec4<f32>>; // per-kind: x=maxAct y=lambdaAct z=lambdaP w=targetP
@group(0) @binding(9) var<storage, read_write> perim: array<atomic<i32>>; // per-cell perimeter
@group(0) @binding(10) var<storage, read> steer: array<vec4<f32>>;   // per-cell: x=targetX y=targetY z=lambda w=frozen

fn inb(x: i32, y: i32) -> bool { return x >= 0 && x < i32(P.W) && y >= 0 && y < i32(P.H); }
fn latAt(x: i32, y: i32) -> i32 { if (inb(x,y)) { return lattice[y * i32(P.W) + x]; } return 0; }
fn kindAt(x: i32, y: i32) -> u32 { return cellKind[latAt(x,y)]; }
fn actAt(x: i32, y: i32) -> f32 { if (inb(x,y)) { return f32(act[y * i32(P.W) + x]); } return 0.0; }

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
// geometric mean of activity over pixel (x,y) and its same-cell 8-neighbours; 0 if any is 0 or
// (x,y) is background. Matches ActivityConstraint.activityAtGeom.
fn actGeom(x: i32, y: i32, id: i32) -> f32 {
  if (id <= 0) { return 0.0; }
  var r = actAt(x, y);
  var nN = 1.0;
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      if (kx == 0 && ky == 0) { continue; }
      if (latAt(x+kx, y+ky) == id) {
        let a = actAt(x+kx, y+ky);
        if (a == 0.0) { return 0.0; }
        r *= a; nN += 1.0;
      }
    }
  }
  return pow(r, 1.0 / nN);
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

  // Hard barrier (PermeableBarrierConstraint): a pixel is impassable if its KIND is a barrier or
  // its CELL is frozen. A cross-barrier copy is rejected unless the non-barrier side is the
  // permeable (player) kind. Short-circuits before deltaH, like Artistoo's hard constraints.
  let sB = ((NK.z & (1u << kSrc)) != 0u) || (srcId > 0 && steer[srcId].w > 0.5);
  let tB = ((NK.z & (1u << kTgt)) != 0u) || (tgtId > 0 && steer[tgtId].w > 0.5);
  if (sB || tB) {
    var otherKind = kSrc;
    if (sB) { otherKind = kTgt; }
    if (otherKind != NK.y) { return; }
  }

  var dH = adh(cx, cy, kSrc) - adh(cx, cy, kTgt);
  if (tgtId > 0) {
    let v = f32(atomicLoad(&vol[tgtId])); let tv = targetVol[tgtId];
    dH += P.lambdaV * ((v-1.0-tv)*(v-1.0-tv) - (v-tv)*(v-tv));
  }
  if (srcId > 0) {
    let v = f32(atomicLoad(&vol[srcId])); let tv = targetVol[srcId];
    dH += P.lambdaV * ((v+1.0-tv)*(v+1.0-tv) - (v-tv)*(v-tv));
  }
  // Act term: use source cell's params, or target's if the source is background (retraction).
  var ak = kSrc;
  if (srcId == 0) { ak = kTgt; }
  let maxAct = kindParams[ak].x;
  let lambdaAct = kindParams[ak].y;
  if (maxAct > 0.0 && lambdaAct > 0.0) {
    dH += lambdaAct * (actGeom(cx, cy, tgtId) - actGeom(sx, sy, srcId)) / maxAct;
  }
  // Perimeter term (Artistoo PerimeterConstraint). pchange for the src/tgt cells from the target's
  // 8-neighbourhood; energy is (LAMBDA_P) * ((P+dP - Ptarget)^2 - (P - Ptarget)^2) per affected cell.
  let lpSrc = kindParams[kSrc].z;
  let lpTgt = kindParams[kTgt].z;
  var pcSrc = 0;
  var pcTgt = 0;
  if ((srcId > 0 && lpSrc > 0.0) || (tgtId > 0 && lpTgt > 0.0)) {
    for (var ky = -1; ky <= 1; ky++) {
      for (var kx = -1; kx <= 1; kx++) {
        if (kx == 0 && ky == 0) { continue; }
        let ntid = latAt(cx+kx, cy+ky);
        if (ntid != srcId) { pcSrc += 1; } else { pcSrc -= 1; }
        if (ntid != tgtId) { pcTgt -= 1; } else { pcTgt += 1; }
      }
    }
    if (srcId > 0 && lpSrc > 0.0) {
      let ps = f32(atomicLoad(&perim[srcId])); let ptp = kindParams[kSrc].w;
      let hnew = (ps + f32(pcSrc)) - ptp; let hold = ps - ptp;
      dH += lpSrc * (hnew*hnew - hold*hold);
    }
    if (tgtId > 0 && lpTgt > 0.0) {
      let ps = f32(atomicLoad(&perim[tgtId])); let ptp = kindParams[kTgt].w;
      let hnew = (ps + f32(pcTgt)) - ptp; let hold = ps - ptp;
      dH += lpTgt * (hnew*hnew - hold*hold);
    }
  }
  // Steering (PerCellAttractionConstraint): reward copies whose direction (source->target pixel)
  // aligns with the source cell's direction toward its attraction point.
  if (srcId > 0) {
    let s = steer[srcId];
    if (s.z > 0.0) {
      let dirx = s.x - f32(sx); let diry = s.y - f32(sy);
      let ldir = dirx*dirx + diry*diry;
      if (ldir > 0.0) {
        let r = f32(cx - sx) * dirx + f32(cy - sy) * diry;
        dH += (-r * s.z) / sqrt(ldir);
      }
    }
  }
  var accept = dH < 0.0;
  if (!accept) { accept = rng(&st) < exp(-dH / P.T); }
  if (accept) {
    lattice[cy * i32(P.W) + cx] = srcId;
    // freshly set pixel gets its new cell-kind's MAX_ACT (0 for background).
    act[cy * i32(P.W) + cx] = i32(kindParams[kSrc].x);
    if (tgtId > 0) { atomicSub(&vol[tgtId], 1); }
    if (srcId > 0) { atomicAdd(&vol[srcId], 1); }
    if (srcId > 0) { atomicAdd(&perim[srcId], pcSrc); }
    if (tgtId > 0) { atomicAdd(&perim[tgtId], pcTgt); }
  }
}
`;

export const ACT_DECAY_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> act: array<i32>;
@group(0) @binding(1) var<uniform> DIM: vec4<u32>; // x=N pixels

@compute @workgroup_size(64)
fn decay(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.x) { return; }
  let a = act[i];
  if (a > 0) { act[i] = a - 1; }
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

export const PERIM_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> lattice: array<i32>;
@group(0) @binding(1) var<storage, read_write> perim: array<atomic<i32>>;
@group(0) @binding(2) var<uniform> DIM: vec4<u32>; // x=N pixels, y=volN, z=W, w=H

fn latAtP(x: i32, y: i32, W: i32, H: i32) -> i32 {
  if (x >= 0 && x < W && y >= 0 && y < H) { return lattice[y * W + x]; }
  return 0;
}
@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.y) { return; }
  atomicStore(&perim[i], 0);
}
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.x) { return; }
  let id = lattice[i];
  if (id <= 0) { return; }
  let W = i32(DIM.z); let H = i32(DIM.w);
  let x = i32(i % DIM.z); let y = i32(i / DIM.z);
  var c = 0;
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      if (kx == 0 && ky == 0) { continue; }
      if (latAtP(x+kx, y+ky, W, H) != id) { c += 1; }
    }
  }
  atomicAdd(&perim[id], c);
}
`;

// Build per-cell border-pixel lists (CSR-ish with a fixed CAP per cell) so the cell-parallel step
// can sample a cell's border without scanning the field. Runs once per MCS before the step.
export const BORDER_BUILD_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> lattice: array<i32>;
@group(0) @binding(1) var<storage, read_write> borderCount: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read_write> borderList: array<i32>;
@group(0) @binding(3) var<uniform> DIM: vec4<u32>; // x=N y=volN z=W w=CAP

fn latB(x: i32, y: i32, W: i32, H: i32) -> i32 {
  if (x >= 0 && x < W && y >= 0 && y < H) { return lattice[y * W + x]; }
  return 0;
}
@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.y) { return; }
  atomicStore(&borderCount[i], 0);
}
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= DIM.x) { return; }
  let W = i32(DIM.z); let H = i32(DIM.x / DIM.z);
  let x = i32(i % DIM.z); let y = i32(i / DIM.z);
  let id = lattice[i];
  let cap = i32(DIM.w);
  if (id > 0) {
    // a cell pixel is a border pixel if any neighbour is a different id — list it under its cell so
    // that cell's thread can process it as a TARGET (retraction / invasion by a neighbour).
    var isB = false;
    for (var ky = -1; ky <= 1; ky++) { for (var kx = -1; kx <= 1; kx++) {
      if (kx == 0 && ky == 0) { continue; }
      if (latB(x+kx, y+ky, W, H) != id) { isB = true; }
    }}
    if (isB) {
      let idx = atomicAdd(&borderCount[id], 1);
      if (idx < cap) { borderList[id * cap + idx] = i32(i); }
    }
  } else {
    // a BACKGROUND pixel adjacent to a cell is a valid protrusion TARGET; assign it to the
    // lowest-id adjacent cell (one owner => no double-processing) so that cell can grow into it.
    var cmin = 0;
    for (var ky = -1; ky <= 1; ky++) { for (var kx = -1; kx <= 1; kx++) {
      if (kx == 0 && ky == 0) { continue; }
      let nid = latB(x+kx, y+ky, W, H);
      if (nid > 0 && (cmin == 0 || nid < cmin)) { cmin = nid; }
    }}
    if (cmin > 0) {
      let idx = atomicAdd(&borderCount[cmin], 1);
      if (idx < cap) { borderList[cmin * cap + idx] = i32(i); }
    }
  }
}
`;

// Cell-parallel CPM step: ONE thread per cell id. Each thread runs Artistoo's sequential border
// loop for its own cell (sampling its border pixels, protruding into neighbours), so the Act wave
// builds and the cell crawls. Cells run concurrently; a contested boundary pixel is claimed with an
// atomic compare-exchange so two adjacent cells can push on their shared border without corrupting
// it. Volume/perimeter are recomputed from the lattice each MCS (same drift fix as the checkerboard).
export const CELL_STEP_WGSL = /* wgsl */ `
struct Params {
  W: u32, H: u32, B: u32, phase: u32,
  ox: u32, oy: u32, seed: u32, _pad: u32,
  lambdaV: f32, T: f32, _p2: f32, _p3: f32,
};
@group(0) @binding(0) var<storage, read_write> lattice: array<atomic<i32>>;
@group(0) @binding(1) var<storage, read_write> vol: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read_write> perim: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> act: array<i32>;
@group(0) @binding(4) var<storage, read> cellKind: array<u32>;
@group(0) @binding(5) var<storage, read> targetVol: array<f32>;
@group(0) @binding(6) var<storage, read> J: array<f32>;
@group(0) @binding(7) var<storage, read> kindParams: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> steer: array<vec4<f32>>;
@group(0) @binding(9) var<storage, read> borderCount: array<i32>;
@group(0) @binding(10) var<storage, read_write> borderList: array<i32>;
@group(0) @binding(11) var<uniform> P: Params;
@group(0) @binding(12) var<uniform> NK: vec4<u32>; // x=nKinds y=permeableKind z=barrierBitmask
@group(0) @binding(13) var<uniform> DIM: vec4<u32>; // x=N y=volN z=W w=CAP

fn inb(x: i32, y: i32) -> bool { return x >= 0 && x < i32(P.W) && y >= 0 && y < i32(P.H); }
fn latA(x: i32, y: i32) -> i32 { if (inb(x,y)) { return atomicLoad(&lattice[y * i32(P.W) + x]); } return 0; }
fn kindA(x: i32, y: i32) -> u32 { return cellKind[latA(x,y)]; }
fn actA(x: i32, y: i32) -> f32 { if (inb(x,y)) { return f32(act[y * i32(P.W) + x]); } return 0.0; }
fn rng(state: ptr<function, u32>) -> f32 {
  var s = *state; s ^= s << 13u; s ^= s >> 17u; s ^= s << 5u; *state = s;
  return f32(s) * 2.3283064e-10;
}
fn adhA(x: i32, y: i32, k: u32) -> f32 {
  let nk = NK.x; var e = 0.0;
  for (var ky = -1; ky <= 1; ky++) { for (var kx = -1; kx <= 1; kx++) {
    if (kx == 0 && ky == 0) { continue; }
    e += J[k * nk + kindA(x+kx, y+ky)];
  }}
  return e;
}
fn actGeomA(x: i32, y: i32, id: i32) -> f32 {
  if (id <= 0) { return 0.0; }
  var r = actA(x, y); var nN = 1.0;
  for (var ky = -1; ky <= 1; ky++) { for (var kx = -1; kx <= 1; kx++) {
    if (kx == 0 && ky == 0) { continue; }
    if (latA(x+kx, y+ky) == id) { let a = actA(x+kx, y+ky); if (a == 0.0) { return 0.0; } r *= a; nN += 1.0; }
  }}
  return pow(r, 1.0 / nN);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = i32(gid.x);
  if (c <= 0 || c >= i32(DIM.y)) { return; } // cell ids are 1..volN-1
  let nb0 = borderCount[c];
  if (nb0 <= 0) { return; }
  let cap = i32(DIM.w);
  let W = i32(P.W);
  let kc = cellKind[c];
  var nb = min(nb0, cap);
  var st = (P.seed ^ (u32(c) * 2654435761u)) + 1u; st ^= st << 13u; st ^= st >> 17u;
  let dxs = array<i32,8>(-1, 0, 1, -1, 1, -1, 0, 1);
  let dys = array<i32,8>(-1, -1, -1, 0, 0, 1, 1, 1);

  for (var att = 0; att < nb0; att++) {
    // Artistoo: sample a border pixel as the TARGET, a random neighbour as the SOURCE; the target
    // takes the source's id. c's list holds c's own border pixels (retraction / invasion targets)
    // plus background pixels assigned to c (protrusion targets).
    let idx = i32(rng(&st) * f32(nb));
    let ti = borderList[c * cap + idx];
    let tx = ti % W; let ty = ti / W;
    let tgtType = atomicLoad(&lattice[ti]);
    let d = u32(rng(&st) * 8.0) & 7u;
    let sx = tx + dxs[d]; let sy = ty + dys[d];
    if (!inb(sx, sy)) { continue; }
    let si = sy * W + sx;
    let srcType = atomicLoad(&lattice[si]);
    if (srcType == tgtType) { continue; }
    let kSrc = cellKind[srcType];
    let kTgt = cellKind[tgtType];

    // hard barrier (source=srcType, target=tgtType).
    let sB = ((NK.z & (1u << kSrc)) != 0u) || (srcType > 0 && steer[srcType].w > 0.5);
    let tB = ((NK.z & (1u << kTgt)) != 0u) || (tgtType > 0 && steer[tgtType].w > 0.5);
    if (sB || tB) {
      var otherKind = kSrc;
      if (sB) { otherKind = kTgt; }
      if (otherKind != NK.y) { continue; }
    }

    // deltaH for copy si -> ti (ti becomes srcType) — identical to the checkerboard step.
    var dH = adhA(tx, ty, kSrc) - adhA(tx, ty, kTgt);
    if (tgtType > 0) {
      let v = f32(atomicLoad(&vol[tgtType])); let tv = targetVol[tgtType];
      dH += P.lambdaV * ((v-1.0-tv)*(v-1.0-tv) - (v-tv)*(v-tv));
    }
    if (srcType > 0) {
      let v = f32(atomicLoad(&vol[srcType])); let tv = targetVol[srcType];
      dH += P.lambdaV * ((v+1.0-tv)*(v+1.0-tv) - (v-tv)*(v-tv));
    }
    var ak = kSrc;
    if (srcType == 0) { ak = kTgt; }
    let maxAct = kindParams[ak].x; let lambdaAct = kindParams[ak].y;
    if (maxAct > 0.0 && lambdaAct > 0.0) {
      dH += lambdaAct * (actGeomA(tx, ty, tgtType) - actGeomA(sx, sy, srcType)) / maxAct;
    }
    let lpS = kindParams[kSrc].z; let lpT = kindParams[kTgt].z;
    var pcS = 0; var pcT = 0;
    if ((srcType > 0 && lpS > 0.0) || (tgtType > 0 && lpT > 0.0)) {
      for (var ky = -1; ky <= 1; ky++) { for (var kx = -1; kx <= 1; kx++) {
        if (kx == 0 && ky == 0) { continue; }
        let ntid = latA(tx+kx, ty+ky);
        if (ntid != srcType) { pcS += 1; } else { pcS -= 1; }
        if (ntid != tgtType) { pcT -= 1; } else { pcT += 1; }
      }}
      if (srcType > 0 && lpS > 0.0) {
        let ps = f32(atomicLoad(&perim[srcType])); let ptp = kindParams[kSrc].w;
        let hn = (ps + f32(pcS)) - ptp; let ho = ps - ptp; dH += lpS * (hn*hn - ho*ho);
      }
      if (tgtType > 0 && lpT > 0.0) {
        let ps = f32(atomicLoad(&perim[tgtType])); let ptp = kindParams[kTgt].w;
        let hn = (ps + f32(pcT)) - ptp; let ho = ps - ptp; dH += lpT * (hn*hn - ho*ho);
      }
    }
    // steering uses the SOURCE cell's attraction (Artistoo). p1=source pixel, p2=target pixel.
    if (srcType > 0) {
      let s = steer[srcType];
      if (s.z > 0.0) {
        let dirx = s.x - f32(sx); let diry = s.y - f32(sy);
        let ldir = dirx*dirx + diry*diry;
        if (ldir > 0.0) { let r = f32(tx-sx)*dirx + f32(ty-sy)*diry; dH += (-r * s.z) / sqrt(ldir); }
      }
    }

    var accept = dH < 0.0;
    if (!accept) { accept = rng(&st) < exp(-dH / P.T); }
    if (accept) {
      // claim the target pixel: only commit if it still has the owner we costed against.
      let res = atomicCompareExchangeWeak(&lattice[ti], tgtType, srcType);
      if (res.exchanged) {
        act[ti] = i32(kindParams[kSrc].x);
        if (tgtType > 0) { atomicSub(&vol[tgtType], 1); if (lpT > 0.0) { atomicAdd(&perim[tgtType], pcT); } }
        if (srcType > 0) { atomicAdd(&vol[srcType], 1); if (lpS > 0.0) { atomicAdd(&perim[srcType], pcS); } }
        // Act wave: if THIS cell just grew, keep ti and its fresh background frontier in c's list so
        // the protrusion can advance again within this same MCS (sequential ⇒ real crawl).
        if (srcType == c) {
          if (nb < cap) { borderList[c * cap + nb] = ti; nb += 1; }
          for (var ky = -1; ky <= 1; ky++) { for (var kx = -1; kx <= 1; kx++) {
            if (kx == 0 && ky == 0) { continue; }
            let nx = tx + kx; let ny = ty + ky;
            if (inb(nx, ny) && atomicLoad(&lattice[ny * W + nx]) == 0 && nb < cap) {
              borderList[c * cap + nb] = ny * W + nx; nb += 1;
            }
          }}
        }
      }
    }
  }
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
