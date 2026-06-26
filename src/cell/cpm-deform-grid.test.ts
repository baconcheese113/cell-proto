import { test } from "node:test";
import assert from "node:assert/strict";
import { CpmDeformGrid, type Frame } from "./cpm-deform-grid.ts";

const everywhere = () => true;

test("occupant anchored in the frame regroups inward when the cell narrows", () => {
  const g = new CpmDeformGrid();
  const wide: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  const o = g.add("ribosome", 0xffffff, 2, wide, 66, 50); // fx ~ +0.8
  for (let i = 0; i < 50; i++) g.step(wide, everywhere);
  const xWide = o.x;
  // Squeeze the cell to a thin strip; the occupant should pull inward toward cx.
  const narrow: Frame = { cx: 50, cy: 50, halfW: 5, halfH: 20 };
  for (let i = 0; i < 80; i++) g.step(narrow, everywhere);
  assert.ok(o.x < xWide - 6, `xWide=${xWide} xNarrow=${o.x}`);
});

test("containment keeps an occupant inside the cytoplasm", () => {
  const g = new CpmDeformGrid();
  const frame: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  // Cytoplasm is only a disc of radius 6 about (50,50); anchor is far out.
  const disc = (x: number, y: number) => Math.hypot(x - 50, y - 50) <= 6;
  const o = g.add("ribosome", 0xffffff, 2, frame, 68, 50);
  for (let i = 0; i < 80; i++) g.step(frame, disc);
  assert.ok(disc(Math.round(o.x), Math.round(o.y)), `outside: ${o.x},${o.y}`);
});

test("two occupants at the same anchor are pushed apart by spacing", () => {
  const g = new CpmDeformGrid();
  const frame: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  const a = g.add("ribosome", 0xffffff, 2, frame, 50, 50);
  const b = g.add("ribosome", 0xffffff, 2, frame, 50, 50);
  for (let i = 0; i < 120; i++) g.step(frame, everywhere);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d > 4, `separation=${d}`);
});

test("shift translates all occupants", () => {
  const g = new CpmDeformGrid();
  const frame: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  const o = g.add("ribosome", 0xffffff, 2, frame, 55, 50);
  const x0 = o.x;
  g.shift(7, -3);
  assert.ok(Math.abs(o.x - (x0 + 7)) < 1e-6);
});
