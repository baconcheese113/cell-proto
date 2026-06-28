import { test } from "node:test";
import assert from "node:assert/strict";
import { flowDeltaH } from "./flow-cost.ts";

const L = 10;

test("moving along the flow is rewarded (negative deltaH)", () => {
  // flow +x; a copy displacing +x.
  assert.ok(flowDeltaH(1, 0, 1, 0, L) < 0);
});

test("moving against the flow is penalized (positive deltaH)", () => {
  assert.ok(flowDeltaH(-1, 0, 1, 0, L) > 0);
});

test("moving perpendicular to the flow is free", () => {
  assert.equal(Math.abs(flowDeltaH(0, 1, 1, 0, L)), 0); // Math.abs avoids -0 vs 0
});

test("strength scales with lambda (the heartbeat pulse)", () => {
  const lull = flowDeltaH(1, 0, 1, 0, 1);
  const surge = flowDeltaH(1, 0, 1, 0, 20);
  assert.ok(surge < lull, "a stronger pulse pushes harder");
});
