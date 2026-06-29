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

export class CpmWorldScene extends Phaser.Scene {
  private sim!: SimClient;
  private cpmRenderer?: CpmRenderer; // created lazily from the first snapshot
  private lastSnap?: WorldSnapshot;
  private agentGfx!: Phaser.GameObjects.Graphics;
  private interiorGfx!: Phaser.GameObjects.Graphics;
  private bg!: Phaser.GameObjects.TileSprite;
  private hud!: Phaser.GameObjects.Text;
  private profText!: Phaser.GameObjects.Text;
  private camCx: number | undefined;
  private camCy: number | undefined;
  private camZoom = 1.8;

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
      });
    }
    (window as unknown as { __cpm?: unknown }).__cpm = base;
  }

  override update(): void {
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;

    this.sim.setInput({
      steering: pointer.leftButtonDown(),
      pointerWX: pointer.worldX,
      pointerWY: pointer.worldY,
      engulf: pointer.rightButtonDown(),
      viewHalfDiag: Math.hypot(cam.width / cam.zoom, cam.height / cam.zoom) / 2,
    });

    // Render the freshest snapshot we have. In worker mode the sim ticks on its own
    // thread, so the render rate is independent of cpm.step cost; here we just re-draw
    // the latest frame each rAF.
    const snap = this.sim.takeSnapshot();
    if (snap) this.renderSnapshot(snap);
  }

  /** Draw one frame purely from a WorldSnapshot (lattice blit + agents + interior +
   *  camera + HUD + FX). The render thread never touches the sim. */
  private renderSnapshot(snap: WorldSnapshot): void {
    this.lastSnap = snap;
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
    this.cpmRenderer.blit(snap.framebuffer, snap.originWX, snap.originWY);
    this.drawInterior(snap);
    this.renderAgents(snap);

    for (const fx of snap.fx) this.spawnDeathFx(fx.wx, fx.wy, fx.radius, fx.color);
    if (snap.controlChanged) {
      this.camCx = undefined;
      this.camCy = undefined;
    }

    // Camera follows the player (with lag) unless frozen for study.
    if (!DEV_FREEZE_STREAMING && snap.playerWorld) {
      const p = snap.playerWorld;
      this.camCx = this.camCx === undefined ? p.x : this.camCx + (p.x - this.camCx) * 0.1;
      this.camCy = this.camCy === undefined ? p.y : this.camCy + (p.y - this.camCy) * 0.1;
      this.cameras.main.centerOn(this.camCx, this.camCy);
    }
    this.bg.tilePositionX = this.cameras.main.scrollX;
    this.bg.tilePositionY = this.cameras.main.scrollY;

    const s = snap.stats;
    this.hud.setText(
      `Vessel world — ${s.combatStatus}   LMB steer · RMB engulf   you: hp ${s.hp} energy ${s.energy}\n` +
        `world:  macrophages ${s.macrophages}   vessel-wall ${s.lining}   microbes ${s.microbes}   nutrients ${s.nutrients}`
    );
    this.profText.setText(snap.profOverlay);
  }

  private makeBackground(): void {
    const key = "cpm-grid-tile";
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(0x0b1119, 1).fillRect(0, 0, 64, 64);
      g.lineStyle(1, 0x16222e, 1).strokeRect(0, 0, 64, 64);
      g.generateTexture(key, 64, 64);
      g.destroy();
    }
    this.bg = this.add
      .tileSprite(0, 0, this.scale.width, this.scale.height, key)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-100);
    this.scale.on("resize", (size: Phaser.Structs.Size) => this.bg.setSize(size.width, size.height));
  }

  /** Brief expanding, fading ring + flash where a cell died/digested. */
  private spawnDeathFx(wx: number, wy: number, radius: number, color: number): void {
    const ring = this.add.circle(wx, wy, radius, color, 0.5).setDepth(20);
    this.tweens.add({
      targets: ring, scale: 2.2, alpha: 0, duration: 520, ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
  }

  /** Draw every agent as a simple body-coloured disc in world space (from snapshot). */
  private renderAgents(snap: WorldSnapshot): void {
    const g = this.agentGfx;
    g.clear();
    for (const a of snap.agents) {
      g.fillStyle(a.color, 1);
      g.fillCircle(a.x, a.y, a.r);
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
