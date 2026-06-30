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
  else if (m.t === "mcs") sim.setMcsRate(m.delta);
};

// Cap at ~60Hz but, when the sim is heavy (cycle > budget), reschedule IMMEDIATELY via
// a MessageChannel instead of setTimeout. Nested setTimeout is clamped to ~4ms minimum,
// which at a ~30Hz cycle wastes ~12% of the budget as idle; the MessageChannel port
// posts back with ~0ms latency, so a heavy worker runs flat-out. Only when there is real
// slack (cheap sim) do we setTimeout the remainder to avoid busy-spinning a core.
const TARGET_MS = 1000 / 60;
const pump = new MessageChannel();
pump.port1.onmessage = () => loop();
const scheduleNow = (): void => pump.port2.postMessage(0);

let last = performance.now();

function loop(): void {
  const start = performance.now();
  const dt = Math.min((start - last) / 1000, 0.1);
  last = start;
  sim.tick(dt);
  // Structured clone copies the framebuffer (a ~400KB buffer copy — cheaper than the
  // multi-ms step we moved off-thread); the worker keeps its own buffer for next tick.
  ctx.postMessage({ t: "snapshot", snap: sim.snapshot() });
  const remaining = TARGET_MS - (performance.now() - start);
  if (remaining > 1) setTimeout(loop, remaining);
  else scheduleNow();
}

loop();
