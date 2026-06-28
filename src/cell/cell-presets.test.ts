import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, rollComponents } from "./cell-presets.ts";

const rngHalf = () => 0.5; // midpoint of every range

test("macrophage rolls the hunter components incl. 2 mitochondria", () => {
  const comps = rollComponents(PRESETS.macrophage, rngHalf);
  const kinds = comps.map((c) => c.kind);
  assert.equal(kinds.filter((k) => k === "mitochondrion").length, 2);
  assert.ok(kinds.includes("phagocytic-receptor"));
  assert.ok(kinds.includes("cytoskeleton"));
  assert.ok(kinds.includes("chemoreceptor"));
});

test("epithelial is sessile + non-phagocytic (no motility/engulf components)", () => {
  const kinds = rollComponents(PRESETS.epithelial, rngHalf).map((c) => c.kind);
  assert.ok(!kinds.includes("cytoskeleton"));
  assert.ok(!kinds.includes("flagellum"));
  assert.ok(!kinds.includes("phagocytic-receptor"));
});

test("microbe has a flagellum but no phagocytosis", () => {
  const kinds = rollComponents(PRESETS.microbe, rngHalf).map((c) => c.kind);
  assert.ok(kinds.includes("flagellum"));
  assert.ok(!kinds.includes("phagocytic-receptor"));
});

test("rolled strengths land inside the spec range", () => {
  const comps = rollComponents(PRESETS.macrophage, rngHalf);
  // midpoint roll: every strength is the average of its spec's min/max.
  for (const c of comps) assert.ok(c.strength > 0.6 && c.strength < 1.5);
});

test("randomization makes two rolls differ", () => {
  let i = 0;
  const seq = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5];
  const rng = () => seq[i++ % seq.length];
  const a = rollComponents(PRESETS.microbe, rng).map((c) => c.strength);
  const b = rollComponents(PRESETS.microbe, rng).map((c) => c.strength);
  assert.notDeepEqual(a, b);
});
