import { test, expect } from "@playwright/test";

// The cell-parallel step is the REAL game step: one thread per cell runs Artistoo's sequential
// border loop (so the Act crawl works) while cells run concurrently and contested boundary pixels
// are claimed atomically (collision-safe). These gates lock in migration + collisions + fidelity.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { __cpm?: any }
}

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") console.log("PAGE error:", m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto("/?local");
  await page.waitForFunction(() => typeof window.__cpm?.gpuMoveTest === "function", undefined, { timeout: 60_000 });
});

test("cell-parallel: a steered cell actually crawls to its target (Act wave works)", async ({ page }) => {
  const res = await page.evaluate(async () => await window.__cpm.gpuMoveTest(2500, { cellParallel: true }));
  console.log("cell-parallel move:", res);
  // reaches most of the way to the target (CPU Artistoo does ~100%); the checkerboard only ~4%.
  expect(res.fractionOfWay, "cell crawls most of the way to its target").toBeGreaterThan(60);
});

test("cell-parallel: collisions hold — wall contains a non-player, player crosses", async ({ page }) => {
  const res = await page.evaluate(async () => await window.__cpm.gpuBarrierTest(600, true));
  console.log("cell-parallel barrier:", res);
  expect(res.nonPlayer_moverInWall, "non-player is contained by the wall").toBe(0);
  expect(res.player_moverInWall, "permeable player crosses the wall").toBeGreaterThan(0);
});

test("cell-parallel: population fidelity + still faster than the CPU worker", async ({ page }) => {
  const res = await page.evaluate(async () => await window.__cpm.gpuBench({ mcs: 100, cellParallel: true }));
  console.log("cell-parallel bench:", res);
  expect(res.gpu_meanVolDevPct, "volume drift under control").toBeLessThan(5);
  expect(res.gpu_fragmented, "cells stay cohesive").toBeLessThan(res.cells * 0.05);
  expect(res.gpu_activeFrac, "cells are actively crawling").toBeGreaterThan(0.02);
  expect(res.speedup, "faster than the CPU reference").toBeGreaterThan(1);
});
