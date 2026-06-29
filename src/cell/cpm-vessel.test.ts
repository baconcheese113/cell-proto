import { test } from "node:test";
import assert from "node:assert/strict";
import { CpmVessel, DEFAULT_VESSEL } from "./cpm-vessel.ts";

const v = new CpmVessel(DEFAULT_VESSEL);

test("the loop is closed and starts at the origin", () => {
  const a = v.pathPoint(0);
  const b = v.pathPoint(Math.PI * 2);
  assert.ok(Math.hypot(a.x, a.y) < 1e-6, `start ${a.x},${a.y}`);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, "P(0) == P(2pi)");
});

test("tangent is unit length and points downstream", () => {
  const t = v.tangent(0);
  assert.ok(Math.abs(Math.hypot(t.x, t.y) - 1) < 1e-9);
  assert.ok(t.y > 0, "initial flow heads +y around the loop");
});

test("classify: origin is lumen, far away is outside", () => {
  assert.equal(v.classify(0, 0).region, "lumen");
  assert.equal(v.classify(99999, 99999).region, "outside");
});

test("classify: a point just outside the lumen is lining, further is tissue", () => {
  // At t=0 the path heads +y, so perpendicular is ~x. Step out along +x.
  const lumen = v.classify(DEFAULT_VESSEL.lumenR - 10, 0).region;
  const lining = v.classify(DEFAULT_VESSEL.lumenR + DEFAULT_VESSEL.liningW * 0.5, 0).region;
  const tissue = v.classify(
    DEFAULT_VESSEL.lumenR + DEFAULT_VESSEL.liningW + DEFAULT_VESSEL.tissueW * 0.5,
    0
  ).region;
  assert.equal(lumen, "lumen");
  assert.equal(lining, "lining");
  assert.equal(tissue, "tissue");
});

test("generated lining slots actually classify as lining; tissue as tissue", () => {
  const slots = v.slots(0, 0.05, 80);
  const lining = slots.filter((s) => s.role === "lining");
  const tissue = slots.filter((s) => s.role === "tissue");
  assert.ok(lining.length >= 2, "lining slots on both walls");
  assert.ok(tissue.length >= 2, "tissue slots on both walls");
  // Slots near the start (mild curvature) should land in their band.
  const near = (s: { x: number; y: number }) => Math.hypot(s.x, s.y) < 600;
  for (const s of lining.filter(near)) {
    assert.equal(v.classify(s.x, s.y, 0).region, "lining", `lining slot ${s.x},${s.y}`);
  }
  for (const s of tissue.filter(near)) {
    assert.equal(v.classify(s.x, s.y, 0).region, "tissue", `tissue slot ${s.x},${s.y}`);
  }
});

test("confinement: a point inside the lumen needs no correction", () => {
  const c = v.confinement(0, 0); // origin is lumen centre
  assert.equal(c.over, 0);
});

test("confinement: a point far outside is pushed back toward the lumen", () => {
  // The loop centre is at (-radius, 0); the origin sits at polar angle 0, distance
  // = radius. Moving +x increases distance from the centre, so x just past the outer
  // lumen wall is outside -> correction points inward (-x, back toward the centre).
  const farOut = DEFAULT_VESSEL.lumenR + 400; // distance radius + lumenR + 400 from centre
  const c = v.confinement(farOut, 0);
  assert.ok(c.over > 300, `over=${c.over}`);
  assert.ok(c.nx < -0.5, `should push -x (inward toward centre), nx=${c.nx}`);
});

test("nearestT windowed search agrees with full search near the player's arc", () => {
  const p = v.pathPoint(0.5);
  const full = v.nearestT(p.x, p.y);
  const win = v.nearestT(p.x, p.y, 0.5);
  assert.ok(Math.abs(full.t - win.t) < 0.05, `full ${full.t} win ${win.t}`);
});
