import { test } from "node:test";
import assert from "node:assert/strict";
import { CpmProfiler } from "./cpm-profiler.ts";

/** A manually-advanced fake clock so timing is deterministic. */
function fakeClock() {
  const state = { t: 0 };
  return { now: () => state.t, advance: (ms: number) => (state.t += ms), state };
}

test("measure accumulates the elapsed time per section", () => {
  const c = fakeClock();
  const p = new CpmProfiler(c.now);
  p.measure("a", () => c.advance(5));
  p.measure("b", () => c.advance(2));
  p.measure("a", () => c.advance(3)); // same section accumulates
  p.frame();
  const r = p.report();
  const map = new Map(r.sections);
  assert.equal(map.get("a"), 8);
  assert.equal(map.get("b"), 2);
  assert.equal(r.totalMs, 10);
});

test("sections are reported descending by ms", () => {
  const c = fakeClock();
  const p = new CpmProfiler(c.now);
  p.measure("small", () => c.advance(1));
  p.measure("big", () => c.advance(9));
  p.frame();
  const r = p.report();
  assert.deepEqual(r.sections.map(([n]) => n), ["big", "small"]);
});

test("msPerActiveCell divides total by active cell count", () => {
  const c = fakeClock();
  const p = new CpmProfiler(c.now);
  p.measure("x", () => c.advance(20));
  p.metrics.activeCells = 4;
  p.frame();
  assert.equal(p.report().msPerActiveCell, 5);
});

test("msPerActiveCell is 0 when there are no active cells", () => {
  const c = fakeClock();
  const p = new CpmProfiler(c.now);
  p.measure("x", () => c.advance(20));
  p.frame();
  assert.equal(p.report().msPerActiveCell, 0);
});

test("a section that stops being measured decays toward zero", () => {
  const c = fakeClock();
  const p = new CpmProfiler(c.now);
  p.measure("a", () => c.advance(10));
  p.frame();
  const first = new Map(p.report().sections).get("a")!;
  // Many idle frames with no "a" measurement: it should EMA downward.
  for (let i = 0; i < 50; i++) {
    c.advance(16);
    p.frame();
  }
  const later = new Map(p.report().sections).get("a")!;
  assert.ok(later < first * 0.2, `decayed ${first} -> ${later}`);
});
