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
