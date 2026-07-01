import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CellComposition,
  deriveCapabilities,
  deriveMetabolism,
  mutateComponents,
  BASE_DRAIN,
  type Component,
} from "./cell-composition.ts";

test("capabilities derive from the components present", () => {
  const caps = deriveCapabilities([
    { kind: "cytoskeleton", strength: 1 },
    { kind: "phagocytic-receptor", strength: 1 },
    { kind: "chemoreceptor", strength: 1 },
  ]);
  assert.ok(caps.motility > 0);
  assert.ok(caps.phagocytic > 0);
  assert.ok(caps.chemotaxis > 0);
});

test("the tearing-receptor grants trogocytosis and nothing else", () => {
  const caps = deriveCapabilities([{ kind: "tearing-receptor", strength: 1.2 }]);
  assert.ok(caps.tearing > 0);
  assert.equal(caps.phagocytic, 0); // a ripper is not (by itself) an engulfer
  assert.equal(caps.motility, 0);
  // Abilities are orthogonal components: a cell can be built for BOTH verbs.
  const both = deriveCapabilities([
    { kind: "phagocytic-receptor", strength: 1 },
    { kind: "tearing-receptor", strength: 1 },
  ]);
  assert.ok(both.phagocytic > 0 && both.tearing > 0);
});

test("a sessile cell (no motility components) cannot move", () => {
  const caps = deriveCapabilities([
    { kind: "nucleus", strength: 1 },
    { kind: "ribosome", strength: 1 },
  ]);
  assert.equal(caps.motility, 0);
  assert.equal(caps.phagocytic, 0);
});

test("flagellum grants more motility than cytoskeleton at equal strength", () => {
  const cyto = deriveCapabilities([{ kind: "cytoskeleton", strength: 1 }]);
  const flag = deriveCapabilities([{ kind: "flagellum", strength: 1 }]);
  assert.ok(flag.motility > cyto.motility);
});

test("metabolism: mitochondria add gain; everything adds drain over the baseline", () => {
  const bare = deriveMetabolism([{ kind: "nucleus", strength: 1 }]);
  assert.equal(bare.gain, 0);
  assert.ok(bare.drain > BASE_DRAIN);
  const powered = deriveMetabolism([
    { kind: "nucleus", strength: 1 },
    { kind: "mitochondrion", strength: 2 },
  ]);
  assert.ok(powered.gain > 0);
});

test("removing the phagocytic component strips the engulf capability", () => {
  const comp = new CellComposition([
    { kind: "cytoskeleton", strength: 1 },
    { kind: "phagocytic-receptor", strength: 1 },
  ]);
  assert.ok(comp.capabilities.phagocytic > 0);
  comp.remove("phagocytic-receptor");
  assert.equal(comp.capabilities.phagocytic, 0);
  assert.ok(comp.capabilities.motility > 0); // still motile
});

test("mutation jitters strengths but keeps them in range and same kinds", () => {
  const parent: Component[] = [
    { kind: "mitochondrion", strength: 1 },
    { kind: "cytoskeleton", strength: 1 },
  ];
  let i = 0;
  const seq = [0.0, 1.0, 0.5, 0.5]; // deterministic rng
  const rng = () => seq[i++ % seq.length];
  const child = mutateComponents(parent, rng, 0.2);
  assert.deepEqual(child.map((c) => c.kind), parent.map((c) => c.kind));
  for (const c of child) {
    assert.ok(c.strength >= 0.3 && c.strength <= 2, `strength ${c.strength}`);
  }
  // First child differs from parent (rng=0 -> 1-0.2 = 0.8x).
  assert.ok(Math.abs(child[0].strength - 1) > 1e-6);
});
