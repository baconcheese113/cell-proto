// sim-worker.ts — runs the entire WorldSim off the render thread. It advances the
// fixed-timestep sim at ~display rate (its own clock, independent of render FPS) and
// posts a fresh snapshot each tick. The render thread (WorkerSimClient) renders the
// latest snapshot it has, so the frame rate is decoupled from cpm.step cost.
//
// WorldSim + its whole dependency graph are Phaser-free (only the scene/renderer import
// Phaser), so this module is worker-safe. Vite bundles it via the `new Worker(new URL(...))`
// form in sim-client.ts.

import { WorldSim } from "./world-sim";
import type { ToWorker, FromWorker } from "./sim-client";

// Minimal typing for the dedicated-worker global (avoids needing the webworker lib).
const ctx = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((e: { data: ToWorker }) => void) | null;
};

const sim = new WorldSim();

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.t === "input") sim.setInput(m.input);
  else if (m.t === "build") sim.growOrganelleAt(m.wx, m.wy);
};

const TARGET_MS = 16; // ~60Hz tick when cpm.step allows; the sim clock self-corrects.
let last = performance.now();

function loop(): void {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  sim.tick(dt);
  // Structured clone copies the framebuffer; the worker keeps its own buffer to render
  // into next tick (no transfer/ownership dance).
  ctx.postMessage({ t: "snapshot", snap: sim.snapshot() });
  setTimeout(loop, TARGET_MS);
}

loop();
