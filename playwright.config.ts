import { defineConfig } from "@playwright/test";

// Headless WebGPU benchmark harness. We launch real Chrome (channel: "chrome") because the
// headless-shell build often only exposes a software (SwiftShader) adapter, which would make the
// GPU benchmark meaningless. WebGPU flags are belt-and-suspenders (Chrome stable enables WebGPU
// by default, but --enable-unsafe-webgpu + --ignore-gpu-blocklist force a hardware adapter under
// new headless). The dev server is auto-started and reused if already running.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    channel: "chrome",
    launchOptions: {
      args: [
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
        "--use-angle=d3d11",
      ],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
