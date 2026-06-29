import { test } from "node:test";
import assert from "node:assert/strict";
import { planPromotions } from "./bubble-manager-core.ts";

const P = { x: 0, y: 0 };
const at = (id: number, x: number, y: number) => ({ id, x, y });

test("promotes agents within the promote radius, ignores far ones", () => {
  const plan = planPromotions(P, [at(1, 50, 0), at(2, 500, 0)], [], 100, 200);
  assert.deepEqual(plan.promote, [1]);
  assert.deepEqual(plan.demote, []);
});

test("demotes promoted cells beyond the demote radius, keeps near ones", () => {
  const plan = planPromotions(P, [], [at(10, 150, 0), at(11, 900, 0)], 100, 200);
  assert.deepEqual(plan.demote, [11]);
  assert.deepEqual(plan.promote, []);
});

test("hysteresis band: an agent between rPromote and rDemote is NOT promoted", () => {
  // distance 150 is outside promote(100) but inside demote(200) -> no tier change
  const plan = planPromotions(P, [at(1, 150, 0)], [], 100, 200);
  assert.deepEqual(plan.promote, []);
});

test("a promoted cell inside the hysteresis band stays promoted", () => {
  const plan = planPromotions(P, [], [at(10, 150, 0)], 100, 200);
  assert.deepEqual(plan.demote, []);
});
