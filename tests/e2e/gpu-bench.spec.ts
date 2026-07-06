import { test, expect } from "@playwright/test";

// M1a gate: the GpuCpm foundation must beat the CPU reference at equal border, with volume drift
// under control. Runs entirely headless via the real Chrome GPU — no Playwright MCP needed.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __cpm?: { gpuBench?: (o?: { mcs?: number }) => Promise<any> };
  }
}

test("WebGPU adapter is a hardware adapter (not software fallback)", async ({ page }) => {
  await page.goto("/?local");
  const info = await page.evaluate(async () => {
    const gpu = (navigator as any).gpu;
    if (!gpu) return { hasGpu: false };
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { hasGpu: true, hasAdapter: false };
    const i = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    return {
      hasGpu: true,
      hasAdapter: true,
      vendor: i.vendor ?? "",
      architecture: i.architecture ?? "",
      description: i.description ?? "",
    };
  });
  console.log("WebGPU adapter:", info);
  expect(info.hasGpu, "navigator.gpu present").toBe(true);
  expect(info.hasAdapter, "GPU adapter obtained").toBe(true);
});

test("gpuBench: GpuCpm beats CPU ref with volume drift under control", async ({ page }) => {
  await page.goto("/?local");
  await page.waitForFunction(
    () => typeof window.__cpm?.gpuBench === "function",
    undefined,
    { timeout: 60_000 }
  );
  const res = await page.evaluate(async () => await window.__cpm!.gpuBench!({ mcs: 200 }));
  console.log("gpuBench result:", res);

  expect(res.error, "gpuBench returned no error").toBeUndefined();
  expect(res.speedup, "GPU >= 5x CPU at equal border").toBeGreaterThanOrEqual(5);
  expect(res.gpu_meanVolDevPct, "volume drift < 5%").toBeLessThan(5);
});
