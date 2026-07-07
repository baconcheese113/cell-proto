// cpm-gpu-scene.ts — the live WebGPU sandbox (?gpu). Runs a GpuCpm world entirely on the GPU and
// renders its framebuffer each frame via the shared CpmRenderer. Steer the player cell with the
// mouse; Q/E change MCS/frame. This is the M2 "see it live" milestone — it proves the GPU step +
// framebuffer readback + render path end to end, ahead of full WorldSim integration.

import Phaser from "phaser";
import { GpuCpm } from "./gpu/cpm-gpu";
import { CpmRenderer } from "./cpm-renderer";
import { buildGpuWorld, type GpuWorld } from "./gpu/cpm-gpu-world";

export class CpmGpuScene extends Phaser.Scene {
  private gpu?: GpuCpm;
  private cpmRenderer?: CpmRenderer;
  private world!: GpuWorld;
  private scaleF = 1;
  private originX = 0;
  private originY = 0;
  private busy = false;
  private mcsPerFrame = 3;
  private readonly steerLambda = 400;
  private hud!: Phaser.GameObjects.Text;

  // frame/step-rate telemetry
  private frames = 0;
  private steps = 0;
  private lastSample = 0;
  private fps = 0;
  private sps = 0;

  constructor() {
    super("CpmGpuScene");
  }

  create(): void {
    const view = this.scale;
    this.world = buildGpuWorld(200);
    const field = this.world.field;
    this.scaleF = Math.max(1, Math.floor(Math.min(view.width, view.height) / field));
    this.originX = Math.floor((view.width - field * this.scaleF) / 2);
    this.originY = Math.floor((view.height - field * this.scaleF) / 2);
    this.cameras.main.setBackgroundColor("#0b0f14");

    this.hud = this.add
      .text(8, 8, "initializing WebGPU…", { fontFamily: "monospace", fontSize: "13px", color: "#9fe6c8" })
      .setScrollFactor(0)
      .setDepth(100);

    void (async () => {
      const g = await GpuCpm.create(this.world);
      if ("error" in g) {
        this.hud.setText(`WebGPU unavailable: ${g.error}\nThis sandbox needs Chrome/Edge with WebGPU.`);
        this.hud.setColor("#ff8a80");
        (window as unknown as { __gpuSandbox?: unknown }).__gpuSandbox = { ready: false, error: g.error };
        return;
      }
      this.gpu = g;
      this.cpmRenderer = new CpmRenderer(this, field, this.scaleF, 10);
      this.lastSample = this.time.now;
    })();

    this.input.keyboard?.on("keydown-Q", () => { this.mcsPerFrame = Math.max(1, this.mcsPerFrame - 1); });
    this.input.keyboard?.on("keydown-E", () => { this.mcsPerFrame = Math.min(20, this.mcsPerFrame + 1); });
  }

  override update(): void {
    const gpu = this.gpu;
    const renderer = this.cpmRenderer;
    if (!gpu || !renderer) return;

    // Steer the player toward the cursor (screen -> lattice coords).
    const p = this.input.activePointer;
    const lx = (p.x - this.originX) / this.scaleF;
    const ly = (p.y - this.originY) / this.scaleF;
    gpu.setSteer(this.world.playerId, lx, ly, this.steerLambda);

    // One in-flight GPU step/read at a time; the render pace follows the GPU.
    if (!this.busy) {
      this.busy = true;
      void (async () => {
        gpu.stepCellParallelN(this.mcsPerFrame); // cell-parallel: cells actually crawl
        const fb = await gpu.readFramebuffer();
        renderer.blit(fb, this.originX, this.originY);
        this.steps += this.mcsPerFrame;
        this.busy = false;
      })();
    }

    this.frames++;
    const now = this.time.now;
    if (now - this.lastSample >= 500) {
      const dt = (now - this.lastSample) / 1000;
      this.fps = Math.round(this.frames / dt);
      this.sps = Math.round(this.steps / dt);
      this.frames = 0;
      this.steps = 0;
      this.lastSample = now;
      (window as unknown as { __gpuSandbox?: unknown }).__gpuSandbox = {
        ready: true, fps: this.fps, sps: this.sps, cells: this.world.maxId, mcsPerFrame: this.mcsPerFrame,
      };
    }
    this.hud.setText(
      `GPU CPM sandbox — ${this.world.field}² lattice, ${this.world.maxId} cells\n` +
        `${this.fps} fps · ${this.sps} MCS/s · ${this.mcsPerFrame} MCS/frame (Q/E)\n` +
        `move the mouse to steer the cyan player; it plows through walls`
    );
  }
}
