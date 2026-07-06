import { test, expect } from "@playwright/test";

// M2 gate: the live ?gpu sandbox boots, steps the GPU CPM, and renders — headless, real GPU.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __gpuSandbox?: { ready: boolean; error?: string; fps?: number; sps?: number; cells?: number };
  }
}

test("the ?gpu sandbox boots and steps the GPU sim live", async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") console.log("PAGE error:", m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));

  await page.goto("/?gpu");
  // wait until the scene has published a telemetry sample (ready or error)
  await page.waitForFunction(() => window.__gpuSandbox !== undefined, undefined, { timeout: 60_000 });
  // give it a moment to accumulate a real step-rate sample
  await page.waitForTimeout(1500);

  await page.mouse.move(700, 200); // nudge the player so the steer path is exercised
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/gpu-sandbox.png" });
  const s = await page.evaluate(() => window.__gpuSandbox);
  console.log("gpu sandbox:", s);
  expect(s?.error, "WebGPU available").toBeUndefined();
  expect(s?.ready, "sandbox ready").toBe(true);
  expect(s?.cells ?? 0, "world has many cells").toBeGreaterThan(30);
  expect(s?.sps ?? 0, "GPU is stepping (MCS/s > 0)").toBeGreaterThan(0);
});
