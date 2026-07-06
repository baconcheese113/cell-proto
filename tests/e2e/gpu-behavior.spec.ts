import { test, expect } from "@playwright/test";

// M1c gates: steering (PerCellAttraction) and the hard barrier (PermeableBarrierConstraint) on
// the GPU. Headless, real Chrome GPU, no MCP.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __cpm?: {
      gpuSteerTest?: (mcs?: number) => Promise<any>;
      gpuBarrierTest?: (mcs?: number) => Promise<any>;
    };
  }
}

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") console.log("PAGE error:", m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto("/?local");
  await page.waitForFunction(() => typeof window.__cpm?.gpuSteerTest === "function", undefined, { timeout: 60_000 });
});

// NOTE: the per-attempt LOGIC of steering + the barrier is unit-tested in cpm-gpu-physics.test.ts.
// These e2e checks confirm the constraints are correctly WIRED into the live GPU step (integration),
// using robust properties that don't depend on finely-tuned Act migration.

test("steering: attraction points the cell toward its target", async ({ page }) => {
  const res = await page.evaluate(async () => await window.__cpm!.gpuSteerTest!(1000));
  console.log("gpuSteerTest:", res);
  expect(res.error, "no error").toBeUndefined();
  // Pulled right, the cell ends meaningfully further right than when pulled left.
  expect(res.directionSpread, "right-pull ends right of left-pull").toBeGreaterThan(2);
});

test("barrier: an active non-player is provably contained by the wall", async ({ page }) => {
  const res = await page.evaluate(async () => await window.__cpm!.gpuBarrierTest!(600));
  console.log("gpuBarrierTest:", res);
  expect(res.error, "no error").toBeUndefined();
  // The non-player mover is ACTIVE (it grows into the open background) ...
  expect(res.nonPlayer_latChanged, "non-player mover is active").toBeGreaterThan(50);
  // ... yet it can never place a pixel at or past the barrier: the hard constraint contains it.
  expect(res.nonPlayer_moverInWall, "non-player cannot cross the barrier").toBe(0);
});
