import { test } from "node:test";
import assert from "node:assert/strict";
import { barrierAllows, steerDeltaH } from "./cpm-gpu-physics.ts";

// kinds: 1 = player (permeable), 2 = barrier wall, 3 = microbe. barrierKinds = [2] -> bitmask 1<<2.
const BARRIER = 1 << 2;
const PERMEABLE = 1;

test("barrier: a copy between two non-barrier cells is always allowed", () => {
  assert.equal(barrierAllows(1, 3, false, false, BARRIER, PERMEABLE), true);
  assert.equal(barrierAllows(3, 3, false, false, BARRIER, PERMEABLE), true);
});

test("barrier: a non-permeable kind cannot cross a barrier", () => {
  // microbe (3) into wall (2), and wall into microbe — both rejected.
  assert.equal(barrierAllows(3, 2, false, false, BARRIER, PERMEABLE), false);
  assert.equal(barrierAllows(2, 3, false, false, BARRIER, PERMEABLE), false);
});

test("barrier: the permeable (player) kind crosses a barrier", () => {
  assert.equal(barrierAllows(1, 2, false, false, BARRIER, PERMEABLE), true);
  assert.equal(barrierAllows(2, 1, false, false, BARRIER, PERMEABLE), true);
});

test("barrier: a frozen cell behaves as a barrier (blocks non-permeable, passes the player)", () => {
  // src cell is a non-barrier KIND but frozen -> acts as a barrier.
  assert.equal(barrierAllows(3, 3, true, false, BARRIER, PERMEABLE), false); // microbe vs frozen microbe
  assert.equal(barrierAllows(1, 3, false, true, BARRIER, PERMEABLE), true); // player vs frozen microbe
});

test("steer: a copy toward the attraction point is favoured (negative dH)", () => {
  // source at (10,10), target point far to the right; copying into (11,10) moves toward it.
  const toward = steerDeltaH(10, 10, 11, 10, 50, 10, 100);
  assert.ok(toward < 0, `expected negative, got ${toward}`);
});

test("steer: a copy away from the attraction point is penalised (positive dH)", () => {
  const away = steerDeltaH(10, 10, 9, 10, 50, 10, 100);
  assert.ok(away > 0, `expected positive, got ${away}`);
});

test("steer: a copy perpendicular to the target direction, or zero lambda, is neutral", () => {
  // target directly right; a purely vertical copy has zero dot product.
  assert.equal(steerDeltaH(10, 10, 10, 11, 50, 10, 100), 0);
  assert.equal(steerDeltaH(10, 10, 11, 10, 50, 10, 0), 0);
});

test("steer: magnitude scales with lambda and is normalised by target distance", () => {
  const a = steerDeltaH(10, 10, 11, 10, 50, 10, 100);
  const b = steerDeltaH(10, 10, 11, 10, 50, 10, 200);
  assert.ok(Math.abs(b) > Math.abs(a), "stronger lambda -> stronger bias");
  // unit step directly toward a target on the +x axis: dH = -lambda (r/|dir| = 1).
  assert.ok(Math.abs(a + 100) < 1e-9, `expected -100, got ${a}`);
});
