// CpmWorldScene — the Phaser render/input CLIENT for the CPM cell world. The whole
// simulation runs behind a SimClient: by default on a Web Worker (render FPS decoupled
// from cpm.step), or inline on the render thread with ?local (debug/fallback, where
// __cpm exposes the live WorldSim). This scene only: captures input → forwards it to the
// client, renders the latest snapshot (lattice/agents/interior), follows the camera,
// draws the HUD, and plays FX.

import Phaser from "phaser";
import { CpmRenderer } from "./cpm-renderer";
import { DEV_FREEZE_STREAMING } from "./world-sim";
import type { WorldSnapshot, SnapshotOccupant } from "./world-sim";
import { LocalSimClient, WorkerSimClient, type SimClient } from "./sim-client";
import { runBench, spikeCompare, cpuMoveTest } from "./cpm-bench";
import { gpuSpike } from "./cpm-gpu-spike";
import { gpuBench } from "./gpu/cpm-gpu-bench";
import { gpuSteerTest, gpuBarrierTest, gpuMoveTest } from "./gpu/cpm-gpu-scenarios";

export class CpmWorldScene extends Phaser.Scene {
  private sim!: SimClient;
  private cpmRenderer?: CpmRenderer; // created lazily from the first snapshot
  private lastSnap?: WorldSnapshot;
  private agentGfx!: Phaser.GameObjects.Graphics;
  private interiorGfx!: Phaser.GameObjects.Graphics;
  // World-anchored grid backdrop drawn to EXACTLY cover the CPM framebuffer (the lattice
  // bubble), so the reference grid + its border show the real CPM-render boundary. (Was a
  // screen-fixed tile whose extent didn't match the world-anchored framebuffer.)
  private gridGfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private profText!: Phaser.GameObjects.Text;
  private camCx: number | undefined;
  private camCy: number | undefined;
  private camZoom = 1.8;
  // Only redraw the lattice/agents/interior when the sim produced a NEW frame; the
  // camera still pans every rAF so motion stays smooth between sim ticks.
  private lastRenderedTick = -1;
  private lastHudText = "";
  // Diagnostic: render FPS (rAF) vs worker sim-Hz (distinct snapshots), so we can tell
  // whether a low frame rate is render-bound (main thread) or sim-bound (worker).
  private renderFrames = 0;
  private fpsT0 = performance.now();
  private renderFps = 0;
  private hzTick0 = 0;
  private workerHz = 0;
  // Previous cursor SCREEN position, to derive pointer SPEED (screen px/sec) for the
  // trogocytosis thrash-to-tear. MUST be screen space, not world: the camera follows the
  // player, so a world-space cursor "moves" whenever the player drifts even if the mouse is
  // still — which would tear continuously while merely holding. Screen space = real mouse motion.
  private prevPointerX: number | undefined;
  private prevPointerY: number | undefined;
  // Seam diagnostic (toggle G): draw agent-tier cells as uniform cyan discs, promoted
  // (now-CPM) cells as magenta rings at their durable record, and tint the CPM lattice
  // orange — so the agent↔CPM handoff is unmistakable and mis-snaps are visible.
  private diag = false;

  create(): void {
    this.makeBackground();

    // The whole simulation, behind the client boundary. Worker by default; ?local runs
    // it inline (so __cpm can reach the live WorldSim for debugging).
    const useLocal = new URLSearchParams(location.search).has("local");
    this.sim = useLocal ? new LocalSimClient() : new WorkerSimClient();

    // Agent tier drawn BELOW the CPM lattice (depth 8 < 10) so promoted CPM detail
    // draws over agents where they coincide. The lattice renderer is created lazily
    // once the first snapshot tells us the field size + scale.
    this.agentGfx = this.add.graphics().setDepth(8);
    this.interiorGfx = this.add.graphics().setDepth(12);

    // Camera. Non-frozen follows the player; dev-freeze fit is applied lazily when the
    // first snapshot arrives (it needs the field size).
    this.camZoom = 1.8;
    this.cameras.main.setZoom(this.camZoom);
    this.cameras.main.setBackgroundColor("#1a0d12");
    this.cameras.main.centerOn(0, 0);
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.camZoom *= dy > 0 ? 0.9 : 1.1;
      this.camZoom = Math.max(0.2, Math.min(6, this.camZoom));
      this.cameras.main.setZoom(this.camZoom);
    });

    this.hud = this.add
      .text(12, 10, "", { fontFamily: "monospace", fontSize: "14px", color: "#9bdcff" })
      .setScrollFactor(0)
      .setDepth(1000);
    this.profText = this.add
      .text(this.scale.width - 12, 10, "", {
        fontFamily: "monospace", fontSize: "12px", color: "#8fe39b", align: "right",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    this.scale.on("resize", (size: Phaser.Structs.Size) => this.profText.setX(size.width - 12));

    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on("keydown-B", () => {
      const ptr = this.input.activePointer;
      this.sim.build(ptr.worldX, ptr.worldY);
    });
    // Live speed/smoothness dial: [ slower+smoother, ] faster+choppier (MCS rate).
    this.input.keyboard?.on("keydown-CLOSED_BRACKET", () => this.sim.adjustMcs(+15));
    this.input.keyboard?.on("keydown-OPEN_BRACKET", () => this.sim.adjustMcs(-15));
    // Seam-diagnostic overlay toggle (sent to the sim via setInput each frame).
    this.input.keyboard?.on("keydown-G", () => { this.diag = !this.diag; });
    // Cell inspector: hover a CPM cell + press I to log its full provenance (which code path
    // created it, whether it's an orphan with no agent link, frozen state, etc.) to the
    // console. In worker mode this logs in the worker's console context.
    this.input.keyboard?.on("keydown-I", () => {
      const ptr = this.input.activePointer;
      this.sim.pickCell(ptr.worldX, ptr.worldY);
    });

    if (import.meta.env.DEV) this.installDebugHandle();
  }

  /** Expose a `window.__cpm` debug handle. In ?local mode it reaches the live WorldSim;
   *  in worker mode only render-thread state (latest snapshot) is reachable. */
  private installDebugHandle(): void {
    const base: Record<string, unknown> = {
      scene: this,
      mode: this.sim instanceof LocalSimClient ? "local" : "worker",
      snapshot: () => this.lastSnap,
      // Render-thread view of the sim clock — verifies the worker keeps advancing
      // independently of render FPS.
      simTime: () => ({ simTimeSec: this.lastSnap?.simTimeSec, tickSeq: this.lastSnap?.tickSeq }),
      stats: () => this.lastSnap?.stats,
      // MC solver stress bench (fresh isolated sim; no world spawn-in). __cpm.bench(30000).
      bench: (targetBorder = 30000, opts?: Parameters<typeof runBench>[1]) => runBench(targetBorder, opts),
      // Checkerboard spike: sequential vs checkerboard timing + fidelity. __cpm.spike().
      spike: (targetBorder = 20000, B = 4) => spikeCompare(targetBorder, B),
      // WebGPU substrate spike: GPU vs CPU MCS/sec for the checkerboard step. __cpm.gpuSpike().
      gpuSpike: (field = 336, cellSize = 10, mcs = 200, B = 4) => gpuSpike(field, cellSize, mcs, B),
      // GpuCpm foundation A/B: real class (J matrix + volume + drift fix) vs CPU ref at equal
      // border. The M1a gate. __cpm.gpuBench({ mcs: 200 }).
      gpuBench: (o?: Parameters<typeof gpuBench>[0]) => gpuBench(o),
      // M1c behaviour tests: a steered cell migrates; a barrier blocks non-players, not the player.
      gpuSteerTest: (mcs?: number) => gpuSteerTest(mcs),
      gpuBarrierTest: (mcs?: number, cellParallel?: boolean) => gpuBarrierTest(mcs, cellParallel),
      gpuMoveTest: (mcs?: number, opts?: Parameters<typeof gpuMoveTest>[1]) => gpuMoveTest(mcs, opts),
      cpuMoveTest: (mcs?: number) => cpuMoveTest(mcs),
    };
    if (this.sim instanceof LocalSimClient) {
      const ws = this.sim.worldSim;
      Object.assign(base, {
        sim: ws.sim,
        worldSim: ws,
        combat: ws.combat,
        rules: ws.rules,
        getPlayerId: () => ws.controlledCellId,
        occupants: () => ws.grid.occupants,
        deaths: () => ws.deaths,
        perf: () => ws.prof.report(),
        nucleus: () => {
          const n = ws.bigOrganelles.organelles[0];
          if (!n) return null;
          const host = ws.controlledCellId;
          const inside = (x: number, y: number) => ws.sim.ownerAtLattice(x, y) === host;
          const c = n.body.center();
          return { cx: c.x, cy: c.y, exposed: n.body.exposedFraction(inside), oval: n.body.ovalness(), stress: n.stress };
        },
        tear: (id?: number, axis: "h" | "v" = "h", halfWidth = 1) =>
          ws.sim.tearCell(id ?? ws.controlledCellId, axis, halfWidth),
        // T1 gate: rip a conserved fragment off the nearest cell; returns mass before +
        // moved + remaining (assert before === moved + remaining) and the fragment id.
        rip: (count = 30) => ws.debugRip(count),
        // T2 gate: inspect/drive the trogocytosis pseudopod + flick control.
        trog: () => ({ status: ws.trog.status, latched: ws.trog.latched }),
      });
    }
    (window as unknown as { __cpm?: unknown }).__cpm = base;
  }

  override update(_time: number, delta: number): void {
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;

    // Cursor speed in SCREEN px/sec (real mouse motion, camera-independent) for the
    // trogocytosis thrash-to-tear.
    const dtSec = delta > 0 ? delta / 1000 : 1 / 60;
    let pointerSpeed = 0;
    if (this.prevPointerX !== undefined && this.prevPointerY !== undefined) {
      pointerSpeed = Math.hypot(pointer.x - this.prevPointerX, pointer.y - this.prevPointerY) / dtSec;
    }
    this.prevPointerX = pointer.x;
    this.prevPointerY = pointer.y;

    this.sim.setInput({
      steering: pointer.leftButtonDown(),
      pointerWX: pointer.worldX,
      pointerWY: pointer.worldY,
      engulf: pointer.rightButtonDown(),
      pointerSpeed,
      viewHalfDiag: Math.hypot(cam.width / cam.zoom, cam.height / cam.zoom) / 2,
      diag: this.diag,
    });

    const snap = this.sim.takeSnapshot();
    this.sampleFps(snap);
    if (snap) this.renderSnapshot(snap);
  }

  /** Render a WorldSnapshot. Heavy work (lattice blit, agents, interior, HUD) runs ONLY
   *  when the sim produced a new frame (tickSeq changed); the camera pans every rAF so
   *  motion is smooth between sim ticks. The render thread never touches the sim. */
  private renderSnapshot(snap: WorldSnapshot): void {
    // Lazily build the lattice renderer + apply dev-freeze fit once we know field/scale.
    if (!this.cpmRenderer) {
      this.cpmRenderer = new CpmRenderer(this, snap.field, snap.scale, 10);
      if (DEV_FREEZE_STREAMING) {
        const worldSize = snap.field * snap.scale;
        this.camZoom = (Math.min(this.scale.width, this.scale.height) / worldSize) * 0.95;
        this.cameras.main.setZoom(this.camZoom);
        this.cameras.main.centerOn(0, 0);
      }
    }

    const fresh = snap.tickSeq !== this.lastRenderedTick;
    if (fresh) {
      this.lastRenderedTick = snap.tickSeq;
      this.lastSnap = snap;
      this.drawGridBackdrop(snap);
      this.cpmRenderer.blit(snap.framebuffer, snap.originWX, snap.originWY);
      this.drawInterior(snap);
      this.renderAgents(snap);
      for (const fx of snap.fx) this.spawnDeathFx(fx.wx, fx.wy, fx.radius, fx.color);
      if (snap.controlChanged) {
        this.camCx = undefined;
        this.camCy = undefined;
      }
      this.updateHud(snap);
    }

    // Camera follows the player (with lag) unless frozen for study — every frame.
    if (!DEV_FREEZE_STREAMING && snap.playerWorld) {
      const p = snap.playerWorld;
      this.camCx = this.camCx === undefined ? p.x : this.camCx + (p.x - this.camCx) * 0.1;
      this.camCy = this.camCy === undefined ? p.y : this.camCy + (p.y - this.camCy) * 0.1;
      this.cameras.main.centerOn(this.camCx, this.camCy);
    }
  }

  /** Sample render FPS (every rAF) + worker sim-Hz (distinct snapshots) over 500ms. */
  private sampleFps(snap: WorldSnapshot | null): void {
    this.renderFrames++;
    const now = performance.now();
    const dt = now - this.fpsT0;
    if (dt >= 500) {
      this.renderFps = Math.round((this.renderFrames * 1000) / dt);
      if (snap) {
        this.workerHz = Math.round(((snap.tickSeq - this.hzTick0) * 1000) / dt);
        this.hzTick0 = snap.tickSeq;
      }
      this.renderFrames = 0;
      this.fpsT0 = now;
    }
  }

  private updateHud(snap: WorldSnapshot): void {
    const s = snap.stats;
    // Keep the HUD short + LEFT-contained so it never runs across the top-right FPS/perf
    // readout. Control hints live in-code, not on-screen. The diag legend only shows when on.
    const text =
      `${s.combatStatus}   speed ${snap.mcsPerSec} [ / ]\n` +
      `hp ${s.hp}  energy ${s.energy}  microbes ${s.microbes}  nutrients ${s.nutrients}` +
      (this.diag ? `\nDIAG(G): cyan=agent  magenta=promoted  orange=CPM  RED=leak(ghost/orphan)` : "");
    if (text !== this.lastHudText) {
      this.hud.setText(text);
      this.lastHudText = text;
    }
    this.profText.setText(`render ${this.renderFps}fps · sim ${this.workerHz}Hz\n${snap.profOverlay}`);
  }

  private makeBackground(): void {
    // Camera background shows OUTSIDE the CPM bubble; the grid backdrop (drawn each frame in
    // drawGridBackdrop, once we know the framebuffer bounds) fills the bubble itself.
    this.gridGfx = this.add.graphics().setDepth(-100);
  }

  /** Draw the reference grid as a world-anchored backdrop covering EXACTLY the CPM framebuffer
   *  (originWX/WY .. +field*scale), so its fill + border delimit the real CPM-render area and
   *  its lines sit under the cells. Grid lines are world-aligned (stable across recenters);
   *  only the outer border tracks the framebuffer bounds. */
  private drawGridBackdrop(snap: WorldSnapshot): void {
    const g = this.gridGfx;
    g.clear();
    const w = snap.field * snap.scale;
    const left = snap.originWX;
    const top = snap.originWY;
    const right = left + w;
    const bottom = top + w;
    g.fillStyle(0x0b1119, 1).fillRect(left, top, w, w);
    const step = snap.scale * 8; // one grid cell = 8 lattice px
    g.lineStyle(1, 0x16222e, 1).beginPath();
    for (let x = Math.ceil(left / step) * step; x < right; x += step) {
      g.moveTo(x, top);
      g.lineTo(x, bottom);
    }
    for (let y = Math.ceil(top / step) * step; y < bottom; y += step) {
      g.moveTo(left, y);
      g.lineTo(right, y);
    }
    g.strokePath();
    // Bright boundary = the edge of CPM rendering (what the user wants the grid to show).
    g.lineStyle(2, 0x3a5a6a, 1).strokeRect(left, top, w, w);
  }

  /** Brief expanding, fading ring + flash where a cell died/digested. */
  private spawnDeathFx(wx: number, wy: number, radius: number, color: number): void {
    const ring = this.add.circle(wx, wy, radius, color, 0.5).setDepth(20);
    this.tweens.add({
      targets: ring, scale: 2.2, alpha: 0, duration: 520, ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
  }

  /** Draw every on-screen agent as a body-coloured disc in world space (from snapshot).
   *  Off-screen agents are culled — Phaser Graphics fillCircle tessellates per call, so
   *  drawing hundreds of off-view discs is pure waste on the render thread. */
  private renderAgents(snap: WorldSnapshot): void {
    const g = this.agentGfx;
    g.clear();
    const v = this.cameras.main.worldView;
    const m = 40; // margin so discs near the edge still draw
    const minX = v.x - m, maxX = v.right + m, minY = v.y - m, maxY = v.bottom + m;
    const ringW = Math.max(1.5, snap.scale * 0.3);
    for (const a of snap.agents) {
      if (a.x < minX || a.x > maxX || a.y < minY || a.y > maxY) continue;
      if (this.diag) {
        // Uniform cyan = an agent-tier LOD disc; a magenta ring = the durable record of a
        // cell PROMOTED to CPM (drawn over its orange blob, so a mis-snap shows as
        // ring-not-on-blob and a demote flips the ring back to a cyan disc). A RED ring =
        // a GHOST: a record claiming a CPM shadow that no longer exists (a leak).
        if (a.tier === "cpm") {
          g.lineStyle(a.ghost ? ringW * 1.6 : ringW, a.ghost ? 0xff2a2a : 0xff00ff, 1);
          g.beginPath(); // reset the path so consecutive rings aren't joined by stray lines
          g.strokeCircle(a.x, a.y, a.r);
        } else {
          g.fillStyle(0x00e5ff, 1);
          g.fillCircle(a.x, a.y, a.r);
        }
        continue;
      }
      g.fillStyle(a.color, 1);
      g.fillCircle(a.x, a.y, a.r);
    }

    // Diagnostic: true ORPHAN CPM cells (no agent link) — draw a bold red ring at the
    // blob so a real leak stands out from the benign magenta/cyan handoff markers.
    if (this.diag) {
      for (const o of snap.diagOrphans) {
        if (o.wx < minX || o.wx > maxX || o.wy < minY || o.wy > maxY) continue;
        g.lineStyle(ringW * 1.6, 0xff2a2a, 1);
        g.beginPath();
        g.strokeCircle(o.wx, o.wy, o.r);
      }
    }
  }

  /** Draw the deforming-grid small organelles + the nucleus soft body (from snapshot,
   *  all coords already world-projected). */
  private drawInterior(snap: WorldSnapshot): void {
    const g = this.interiorGfx;
    g.clear();
    const s = snap.scale;

    for (const o of snap.occupants) {
      this.drawStructure(g, o, o.wx, o.wy, s);
    }

    for (const big of snap.organelles) {
      const pts = big.nodes;
      if (pts.length === 0) continue;
      const stress = big.stress;
      g.fillStyle(big.color, 0.9);
      g.lineStyle(Math.max(1, s * 0.35), stress > 0.01 ? 0xff5d5d : 0x2a1a4a, 0.7 + 0.3 * stress);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
      if (big.type === "nucleus") {
        g.fillStyle(0x5b2f9e, 0.9);
        g.fillCircle(big.cx, big.cy, big.restRadiusW);
      }
    }

    // Team NUCLEUS DOTS: a small allegiance-coloured dot at each non-neutral cell's centre
    // (both agent discs and CPM shadows), with a dark rim for legibility. Drawn here (depth
    // 12) so it sits above the lattice + agent discs. Culled to the view.
    const v = this.cameras.main.worldView;
    const mm = 24;
    for (const k of snap.markers) {
      if (k.wx < v.x - mm || k.wx > v.right + mm || k.wy < v.y - mm || k.wy > v.bottom + mm) continue;
      g.lineStyle(Math.max(1, s * 0.25), 0x0a0f14, 0.85);
      g.fillStyle(k.color, 1);
      g.fillCircle(k.wx, k.wy, k.r);
      g.strokeCircle(k.wx, k.wy, k.r);
    }
  }

  private drawStructure(
    g: Phaser.GameObjects.Graphics,
    o: SnapshotOccupant,
    wx: number,
    wy: number,
    s: number
  ): void {
    const r = o.radius * s;
    const alpha = 0.92 - 0.4 * o.compressed;
    g.lineStyle(Math.max(1, s * 0.28), 0x0a0f14, 0.5);
    g.fillStyle(o.color, alpha);
    switch (o.type) {
      case "nucleus":
        g.fillCircle(wx, wy, r);
        g.strokeCircle(wx, wy, r);
        g.fillStyle(0x5b2f9e, 0.9);
        g.fillCircle(wx + r * 0.2, wy - r * 0.15, r * 0.35); // nucleolus
        break;
      case "mitochondrion": {
        const ang = (((Math.round(o.x) * 3 + Math.round(o.y) * 7) % 6) / 6) * Math.PI;
        const len = r * 2.0;
        for (let k = 0; k < 4; k++) {
          const t = (k / 3 - 0.5) * len;
          g.fillCircle(wx + Math.cos(ang) * t, wy + Math.sin(ang) * t, r * 0.8);
        }
        break;
      }
      case "golgi":
        for (let k = 0; k < 3; k++) {
          g.fillStyle(o.color, alpha * (1 - k * 0.18));
          g.fillEllipse(wx, wy + (k - 1) * r * 0.55, r * 2.4, r * 0.7);
        }
        break;
      default:
        g.fillCircle(wx, wy, r);
        break;
    }
  }
}
