import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEdible,
  hostile,
  NEUTRAL_TEAM,
  SpatialHash,
  separation,
  stepVelocity,
  feedingEvents,
  type FeedAgent,
} from "./agent-world-core.ts";

test("hostile: different non-neutral teams fight; same team and neutrals don't", () => {
  assert.equal(hostile(1, 2), true); // immune vs microbe
  assert.equal(hostile(1, 1), false); // allies
  assert.equal(hostile(1, NEUTRAL_TEAM), false); // lining is never attacked
  assert.equal(hostile(NEUTRAL_TEAM, 2), false);
  assert.equal(hostile(NEUTRAL_TEAM, NEUTRAL_TEAM), false);
});

const cell = (over: Partial<{ vol: number; phagocytic: number; motility: number }> = {}) => ({
  id: 1,
  x: 0,
  y: 0,
  vol: over.vol ?? 280,
  phagocytic: over.phagocytic ?? 0,
  motility: over.motility ?? 1,
});

test("a predator can eat a smaller, motile, non-predatory cell", () => {
  const predator = cell({ vol: 1300, phagocytic: 1.2 });
  const prey = cell({ vol: 280, phagocytic: 0, motility: 1 });
  assert.equal(isEdible(predator, prey), true);
});

test("sessile cells (motility ~0) are never prey", () => {
  const predator = cell({ vol: 1300, phagocytic: 1.2 });
  const wall = cell({ vol: 280, phagocytic: 0, motility: 0 });
  assert.equal(isEdible(predator, wall), false);
});

test("a cell as large or larger than the predator is not edible", () => {
  const predator = cell({ vol: 1300, phagocytic: 1.2 });
  const big = cell({ vol: 1300, phagocytic: 0, motility: 1 });
  assert.equal(isEdible(predator, big), false);
});

test("another predator is not edible", () => {
  const predator = cell({ vol: 1300, phagocytic: 1.2 });
  const rival = cell({ vol: 280, phagocytic: 1.0, motility: 1 });
  assert.equal(isEdible(predator, rival), false);
});

test("spatial hash returns same- and adjacent-bucket points, excludes far ones", () => {
  const pts = [
    { x: 5, y: 5 }, // 0: bucket (0,0)
    { x: 8, y: 8 }, // 1: bucket (0,0)
    { x: 12, y: 5 }, // 2: bucket (1,0) — adjacent to (0,0)
    { x: 100, y: 100 }, // 3: bucket (10,10) — far
  ];
  const hash = new SpatialHash(10);
  hash.rebuild(pts);
  const near = new Set(hash.queryNeighborhood(5, 5));
  assert.ok(near.has(0));
  assert.ok(near.has(1));
  assert.ok(near.has(2)); // adjacent bucket included (3x3 neighbourhood)
  assert.ok(!near.has(3)); // far bucket excluded
});

test("separation pushes away from a crowding neighbour", () => {
  const self = { x: 0, y: 0 };
  const f = separation(self, [{ x: 3, y: 0 }], 10);
  assert.ok(f.sx < 0); // neighbour on the right => push left
  assert.ok(Math.abs(f.sy) < 1e-9);
});

test("separation ignores neighbours beyond the radius", () => {
  const f = separation({ x: 0, y: 0 }, [{ x: 50, y: 0 }], 10);
  assert.deepEqual([f.sx, f.sy], [0, 0]);
});

test("separation from symmetric neighbours cancels out", () => {
  const f = separation({ x: 0, y: 0 }, [{ x: 5, y: 0 }, { x: -5, y: 0 }], 10);
  assert.ok(Math.abs(f.sx) < 1e-9);
});

test("separation skips a coincident point (no divide-by-zero)", () => {
  const f = separation({ x: 0, y: 0 }, [{ x: 0, y: 0 }], 10);
  assert.deepEqual([f.sx, f.sy], [0, 0]);
});

test("stepVelocity clamps speed to maxSpeed", () => {
  const v = stepVelocity({ vx: 0, vy: 0 }, 10, 0, 0.9, 2);
  assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - 2) < 1e-9);
  assert.ok(v.vx > 0 && Math.abs(v.vy) < 1e-9);
});

test("a sessile cell (maxSpeed 0) never moves", () => {
  const v = stepVelocity({ vx: 5, vy: 5 }, 100, 100, 0.9, 0);
  assert.deepEqual([v.vx, v.vy], [0, 0]);
});

test("damping bleeds off velocity when there is no acceleration", () => {
  const v = stepVelocity({ vx: 2, vy: 0 }, 0, 0, 0.5, 10);
  assert.ok(Math.abs(v.vx - 1) < 1e-9);
});

const feeder = (over: Partial<FeedAgent> & { id: number }): FeedAgent => ({
  x: 0,
  y: 0,
  vol: 280,
  phagocytic: 0,
  motility: 1,
  r: 9,
  ...over,
});

test("a predator touching an edible prey produces one feed event", () => {
  const p = feeder({ id: 1, phagocytic: 1.2, vol: 1300, r: 20 });
  const q = feeder({ id: 2, x: 25 }); // d=25 < (20+9)*0.95
  const events = feedingEvents([p, q]);
  assert.deepEqual(events, [{ predator: 1, prey: 2 }]);
});

test("no feed event when prey is out of touching range", () => {
  const p = feeder({ id: 1, phagocytic: 1.2, vol: 1300, r: 20 });
  const q = feeder({ id: 2, x: 100 });
  assert.deepEqual(feedingEvents([p, q]), []);
});

test("a non-predator produces no feed events", () => {
  const a = feeder({ id: 1, phagocytic: 0, vol: 1300, r: 20 });
  const q = feeder({ id: 2, x: 25 });
  assert.deepEqual(feedingEvents([a, q]), []);
});

test("a predator bites only once per tick even with two prey adjacent", () => {
  const p = feeder({ id: 1, phagocytic: 1.2, vol: 1300, r: 20 });
  const q1 = feeder({ id: 2, x: 22 });
  const q2 = feeder({ id: 3, x: -22 });
  assert.equal(feedingEvents([p, q1, q2]).length, 1);
});
