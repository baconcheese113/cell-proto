import { test } from "node:test";
import assert from "node:assert/strict";
import {
  energyStep,
  shouldDivide,
  DIVIDE_THRESHOLD,
  MAX_ENERGY,
} from "./cpm-life.ts";

test("energy rises when gain exceeds drain and is clamped at max", () => {
  const up = energyStep(50, 0.2, 0.05);
  assert.ok(up > 50);
  assert.equal(energyStep(MAX_ENERGY, 1, 0), MAX_ENERGY); // clamped
});

test("energy falls when drain exceeds gain and floors at zero", () => {
  assert.ok(energyStep(50, 0.0, 0.3) < 50);
  assert.equal(energyStep(0.1, 0, 5), 0); // floored
});

test("a starving balance (no gain) trends to death", () => {
  let e = 10;
  for (let i = 0; i < 1000; i++) e = energyStep(e, 0, 0.05);
  assert.equal(e, 0);
});

test("division requires both well-fed AND space", () => {
  assert.equal(shouldDivide(DIVIDE_THRESHOLD, true), true);
  assert.equal(shouldDivide(DIVIDE_THRESHOLD, false), false); // no room
  assert.equal(shouldDivide(DIVIDE_THRESHOLD - 1, true), false); // not fed enough
});
