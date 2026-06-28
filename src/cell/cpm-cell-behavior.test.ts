import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseSteer, type Agent } from "./cpm-cell-behavior.ts";

const hunter: Agent = { id: 1, x: 0, y: 0, vol: 1300, phagocytic: 1.2 };
const microbe = (id: number, x: number, y: number): Agent => ({
  id,
  x,
  y,
  vol: 280,
  phagocytic: 0,
});

test("a predator hunts the nearest edible cell within sense range", () => {
  const near = microbe(2, 20, 0);
  const far = microbe(3, 50, 0);
  const c = chooseSteer(hunter, [hunter, near, far], 80, 40);
  assert.ok(c);
  assert.equal(c!.mode, "hunt");
  assert.deepEqual([c!.x, c!.y], [20, 0]); // chases the nearer microbe
});

test("a predator with no edible cell in range wanders (null)", () => {
  const c = chooseSteer(hunter, [hunter, microbe(2, 200, 0)], 80, 40);
  assert.equal(c, null);
});

test("a predator does not hunt another predator or a bigger cell", () => {
  const otherPredator: Agent = { id: 2, x: 10, y: 0, vol: 1300, phagocytic: 1.0 };
  const bigger: Agent = { id: 3, x: 12, y: 0, vol: 2000, phagocytic: 0 };
  const c = chooseSteer(hunter, [hunter, otherPredator, bigger], 80, 40);
  assert.equal(c, null);
});

test("prey flees directly away from the nearest predator", () => {
  const prey = microbe(2, 10, 0);
  const c = chooseSteer(prey, [prey, hunter], 80, 40);
  assert.ok(c);
  assert.equal(c!.mode, "flee");
  // hunter is at x=0 (to the left); prey should aim further +x (away).
  assert.ok(c!.x > prey.x);
});

test("prey with no predator near does not flee (null -> wander)", () => {
  const prey = microbe(2, 300, 300);
  const c = chooseSteer(prey, [prey, hunter], 80, 40);
  assert.equal(c, null);
});
