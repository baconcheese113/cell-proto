// SimClient — the boundary between the render thread and the simulation. Two
// implementations behind one interface:
//   - WorkerSimClient: the sim runs on a Web Worker at its own real-time rate; the
//     render thread just posts input and renders the latest snapshot it has received
//     (so render FPS is fully decoupled from cpm.step cost).
//   - LocalSimClient: the sim runs inline on the render thread (ticks once per
//     takeSnapshot). Used as a debug/fallback path (?local) where __cpm needs the
//     live WorldSim.
//
// Both speak the same message protocol so the worker file and the local client share
// types. Snapshots are sent by structured clone (the framebuffer Uint32Array is copied,
// ~400KB/frame — cheap vs. the multi-ms cpm.step we move off-thread).

import { WorldSim } from "./world-sim";
import type { WorldInput, WorldSnapshot } from "./world-sim";

export type ToWorker =
  | { t: "input"; input: WorldInput }
  | { t: "build"; wx: number; wy: number }
  | { t: "mcs"; delta: number }
  | { t: "pick"; wx: number; wy: number };

export type FromWorker = { t: "snapshot"; snap: WorldSnapshot };

export interface SimClient {
  /** Forward the latest player input to the sim. */
  setInput(input: WorldInput): void;
  /** Request building an organelle at a world position (B key). */
  build(wx: number, wy: number): void;
  /** Nudge the Monte-Carlo rate (live speed/smoothness dial). */
  adjustMcs(delta: number): void;
  /** DEV: log full provenance of the CPM cell under a world position (hover + I). */
  pickCell(wx: number, wy: number): void;
  /** The freshest snapshot to render, or null if none has arrived yet. */
  takeSnapshot(): WorldSnapshot | null;
  dispose(): void;
}

/** Sim on the render thread (debug/fallback). Self-driven at ~60Hz (was render-driven) because the
 *  tick is now async — the GPU-world path (?gpuworld) awaits its readback, so takeSnapshot can no
 *  longer tick inline and return synchronously. The render loop just reads the latest snapshot. */
export class LocalSimClient implements SimClient {
  readonly worldSim = new WorldSim();
  private lastTime = performance.now();
  private latest: WorldSnapshot | null = null;
  private disposed = false;

  /** @param gpu run the CPM Monte-Carlo step on the GPU (GpuStepBridge) instead of the CPU. */
  constructor(gpu = false) {
    if (gpu) this.worldSim.enableGpu();
    void this.loop();
  }

  private async loop(): Promise<void> {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    await this.worldSim.tick(dt);
    this.latest = this.worldSim.snapshot();
    if (!this.disposed) setTimeout(() => void this.loop(), 1000 / 60);
  }

  setInput(input: WorldInput): void {
    this.worldSim.setInput(input);
  }
  build(wx: number, wy: number): void {
    this.worldSim.growOrganelleAt(wx, wy);
  }
  adjustMcs(delta: number): void {
    this.worldSim.setMcsRate(delta);
  }
  pickCell(wx: number, wy: number): void {
    this.worldSim.pickCellAt(wx, wy);
  }
  takeSnapshot(): WorldSnapshot | null {
    return this.latest;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/** Sim on a Web Worker. The worker ticks itself; we keep only the latest snapshot. */
export class WorkerSimClient implements SimClient {
  private readonly worker: Worker;
  private latest: WorldSnapshot | null = null;

  constructor() {
    this.worker = new Worker(new URL("./sim-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.t === "snapshot") this.latest = m.snap;
    };
  }
  setInput(input: WorldInput): void {
    this.worker.postMessage({ t: "input", input } satisfies ToWorker);
  }
  build(wx: number, wy: number): void {
    this.worker.postMessage({ t: "build", wx, wy } satisfies ToWorker);
  }
  adjustMcs(delta: number): void {
    this.worker.postMessage({ t: "mcs", delta } satisfies ToWorker);
  }
  pickCell(wx: number, wy: number): void {
    this.worker.postMessage({ t: "pick", wx, wy } satisfies ToWorker);
  }
  takeSnapshot(): WorldSnapshot | null {
    return this.latest;
  }
  dispose(): void {
    this.worker.terminate();
  }
}
