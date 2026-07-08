import { test, expect } from "@playwright/test";

// M-Bridge-1 gate: the GpuStepBridge offloads ONLY the Monte-Carlo step to the GPU while the CPU-side
// Artistoo CpmSimulation stays authoritative. This locks in that the export -> GPU step -> write-back
// round-trip leaves the CPU sim in a normally-evolved, self-consistent state: a steered cell crawled,
// cells stayed cohesive, volumes held, and grid._pixels agrees with cellvolume — validated against a
// CPU control sim advanced the ordinary way.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { __cpm?: any }
}

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") console.log("PAGE error:", m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto("/?local");
  await page.waitForFunction(() => typeof window.__cpm?.gpuBridgeParity === "function", undefined, { timeout: 60_000 });
});

test("bridge: a real CpmSimulation stepped on the GPU stays healthy + self-consistent", async ({ page }) => {
  const res = await page.evaluate(async () => await window.__cpm.gpuBridgeParity(1000));
  console.log("bridge parity:", res);
  expect(res.error, "GPU available").toBeUndefined();

  // The write-back must leave grid._pixels and cellvolume in exact agreement (the core sync invariant).
  expect(res.gpu_consistent, "cellvolume matches the pixel census after write-back").toBe(true);
  // The steered player crawled a meaningful distance toward its target THROUGH the bridge (Act works).
  expect(res.gpu_fractionOfWay, "steered cell crawls toward its target via the bridge").toBeGreaterThan(40);
  // Cells stay cohesive and hold their volume, like the CPU control.
  expect(res.gpu_fragmented, "cells stay in one piece").toBe(0);
  expect(res.gpu_meanVolDevPct, "volumes held near target").toBeLessThan(20);
  // No cell should die on this bench (nothing digests/tears here).
  expect(res.gpu_dead, "no spurious cell deaths").toBe(0);

  // Sanity: the CPU control is itself healthy, so the bench is a fair comparison.
  expect(res.cpu_consistent).toBe(true);
  expect(res.cpu_fragmented).toBe(0);
});

test("bridge: the vessel current (Flow) drifts a flowing cell downstream (M-Bridge-2)", async ({ page }) => {
  const res = await page.evaluate(async () => await window.__cpm.gpuBridgeFlowTest(800));
  console.log("bridge flow:", res);
  expect(res.error, "GPU available").toBeUndefined();
  // With the current on, the resting cell is carried downstream (+x) noticeably further than with it off.
  expect(res.drift, "flow carries the cell downstream").toBeGreaterThan(3);
});
