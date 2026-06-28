import { test } from "node:test";
import assert from "node:assert/strict";
import { CpmSoftBody, DEFAULT_NUCLEUS_SOFT_BODY } from "./cpm-soft-body.ts";

const everywhere = () => true;

test("recenters toward its target after displacement", () => {
  // Body built off-target; with no confinement it should drift to the target.
  const b = new CpmSoftBody(60, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  for (let i = 0; i < 300; i++) b.step({ x: 50, y: 50 }, everywhere);
  const c = b.center();
  assert.ok(Math.abs(c.x - 50) < 1.5, `center.x=${c.x}`);
  assert.ok(Math.abs(c.y - 50) < 1.5, `center.y=${c.y}`);
});

test("preserves area and oozes oval when squeezed into a channel", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  // A vertical channel well narrower than the body, scaled to its radius so the
  // squeeze ratio (~0.6x diameter) is the same at any restRadius.
  const half = DEFAULT_NUCLEUS_SOFT_BODY.restRadius * 0.6;
  const channel = (x: number, _y: number) => Math.abs(x - 50) <= half;
  for (let i = 0; i < 400; i++) b.step({ x: 50, y: 50 }, channel);
  const area = b.area();
  // Area held within tolerance (soft preservation, not rigid).
  assert.ok(area > 0.6 * b.area0, `area=${area} area0=${b.area0}`);
  assert.ok(area < 1.6 * b.area0, `area=${area} area0=${b.area0}`);
  // Forced narrow horizontally -> taller than wide (oozed oval).
  assert.ok(b.ovalness() > 1.4, `ovalness=${b.ovalness()}`);
});

test("footprint area is close to the disc area", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  const fp = b.footprint();
  const r = DEFAULT_NUCLEUS_SOFT_BODY.restRadius;
  const expected = Math.PI * r * r;
  assert.ok(Math.abs(fp.length - expected) < expected * 0.45, `fp=${fp.length} ~ ${expected}`);
});

test("exposedFraction is 0 when fully contained, positive when over-confined", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  assert.equal(b.exposedFraction(everywhere), 0);
  const slit = (x: number, _y: number) => Math.abs(x - 50) <= 2; // width 5 << body
  // One step so the body hasn't fully conformed yet -> footprint pokes out.
  b.step({ x: 50, y: 50 }, slit);
  assert.ok(b.exposedFraction(slit) > 0.15, `exposed=${b.exposedFraction(slit)}`);
});

test("shift translates every node", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  const before = b.center();
  b.shift(10, -4);
  const after = b.center();
  assert.ok(Math.abs(after.x - (before.x + 10)) < 1e-6);
  assert.ok(Math.abs(after.y - (before.y - 4)) < 1e-6);
});
