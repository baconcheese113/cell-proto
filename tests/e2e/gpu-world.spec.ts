import { test, expect } from "@playwright/test";

// M-Bridge-3 gate: ?gpuworld runs the REAL WorldSim with its CPM Monte-Carlo step offloaded to the
// GPU (GpuStepBridge) while everything else stays on the CPU. This proves the live world actually
// boots, builds the bridge, and keeps advancing on the GPU without crashing — the "see it live" milestone.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { __cpm?: any }
}

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") console.log("PAGE error:", m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto("/?gpuworld");
  await page.waitForFunction(() => typeof window.__cpm?.gpuActive === "function", undefined, { timeout: 60_000 });
});

test("gpuworld: the real world boots and its CPM step runs on the GPU", async ({ page }) => {
  // The bridge builds lazily on the first stepped tick — wait for it to actually engage the GPU.
  await page.waitForFunction(() => window.__cpm.gpuActive() === true, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__cpm.mode)).toBe("local");

  // The sim must keep advancing while GPU-stepping (no stall/crash on the async readback path).
  const t0 = await page.evaluate(() => window.__cpm.simTime().simTimeSec ?? 0);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => window.__cpm.simTime().simTimeSec ?? 0);
  console.log("gpuworld sim advanced:", { t0, t1, gpuActive: true });
  expect(t1, "sim time advances under GPU stepping").toBeGreaterThan(t0);

  // Still on the GPU (didn't silently fall back mid-run) and the world is populated + rendering.
  expect(await page.evaluate(() => window.__cpm.gpuActive())).toBe(true);
  const snap = await page.evaluate(() => {
    const s = window.__cpm.snapshot();
    return s ? { hasFb: !!s.framebuffer, occupants: s.occupants?.length ?? 0, hasStats: !!s.stats } : null;
  });
  console.log("gpuworld snapshot:", snap);
  expect(snap, "a snapshot is being produced").not.toBeNull();
  expect(snap!.hasFb, "framebuffer present").toBe(true);
});
