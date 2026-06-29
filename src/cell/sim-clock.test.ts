import { test } from "node:test";
import assert from "node:assert/strict";
import { simStepsFor } from "./sim-clock.ts";

const MS_PER_MCS = 1000 / 180; // 180 MCS/s target ~= 5.555ms

test("runs whole MCS for the accumulated time and carries the remainder", () => {
  const r = simStepsFor(12, MS_PER_MCS, 6);
  assert.equal(r.steps, 2); // floor(12 / 5.555) = 2
  assert.ok(Math.abs(r.remainderMs - (12 - 2 * MS_PER_MCS)) < 1e-9);
});

test("accumulates sub-step time without stepping", () => {
  const r = simStepsFor(4, MS_PER_MCS, 6);
  assert.equal(r.steps, 0);
  assert.equal(r.remainderMs, 4);
});

test("caps steps and DROPS the backlog (no spiral of death)", () => {
  // A big hitch wants 18 steps; cap at 6 and discard the rest so we never
  // accumulate an ever-growing debt that slows every subsequent frame.
  const r = simStepsFor(100, MS_PER_MCS, 6);
  assert.equal(r.steps, 6);
  assert.equal(r.remainderMs, 0);
});

test("at 60fps (16.7ms) it runs ~3 MCS, keeping the 180/s rate", () => {
  const r = simStepsFor(1000 / 60, MS_PER_MCS, 6);
  assert.equal(r.steps, 3);
});

test("a non-positive budget is a no-op (guards bad config)", () => {
  assert.deepEqual(simStepsFor(50, 0, 6), { steps: 0, remainderMs: 0 });
});
