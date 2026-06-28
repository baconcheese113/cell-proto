// CpmWorldScene — the home of the CPM cell world. This is the migration target
// that will progressively replace the hex GameScene. For now it hosts the
// deformable player cell + a few other cells in an (effectively infinite)
// scrolling world, steered by holding the left mouse button.

import Phaser from "phaser";
import { CpmSimulation } from "./cpm-simulation";
import { CpmRenderer } from "./cpm-renderer";
import { CpmRules, type DeathReason } from "./cpm-rules";
import { CpmEnemyAi } from "./cpm-enemy-ai";
import { CpmCombat } from "./cpm-combat";
import { CpmField } from "./cpm-field";
import { CpmDeformGrid } from "./cpm-deform-grid";
import { CpmBigOrganelles } from "./cpm-big-organelles";
import { CpmProfiler } from "./cpm-profiler";
import {
  DEFAULT_WORLD_CONFIG,
  PLAYER_PROFILE,
  ENEMY_PROFILE,
  DIGESTING_PROFILE,
  NUCLEUS_PROFILE,
} from "./cpm-config";

const PLAYER_KIND = 1;
const ENEMY_KIND = 2;
const DIGEST_KIND = 3;

export class CpmWorldScene extends Phaser.Scene {
  private sim!: CpmSimulation;
  private cpmRenderer!: CpmRenderer;
  private rules!: CpmRules;
  private enemyAi!: CpmEnemyAi;
  private combat!: CpmCombat;
  private signal!: CpmField;
  private grid!: CpmDeformGrid;
  private bigOrganelles!: CpmBigOrganelles;
  private interiorGfx!: Phaser.GameObjects.Graphics;
  private prof = new CpmProfiler();
  /** The one cell the player input is bound to. NOT special in any other way —
   *  it runs the same systems as every peer; input just overrides its behavior. */
  private controlledCellId = 0;
  private bg!: Phaser.GameObjects.TileSprite;
  private hud!: Phaser.GameObjects.Text;
  private profText!: Phaser.GameObjects.Text;
  private steering = false;
  private deaths = 0;
  private camCx: number | undefined;
  private camCy: number | undefined;

  // Lightweight-organelle prototype: a couple of organelle "kinds" with a colour
  // and size, placed as entities on the cytoplasm rather than as CPM sub-cells.
  private static readonly NUCLEUS = { type: "nucleus", color: 0x9b6cff, radius: 6 };
  private static readonly BUILDABLES = [
    { type: "mitochondrion", color: 0xff9d4d, radius: 3.5 },
    { type: "ribosome", color: 0x7CF6C7, radius: 2 },
    { type: "golgi", color: 0xffe066, radius: 3 },
  ];
  private buildIndex = 0;

  constructor() {
    super("CpmWorldScene");
  }

  create(): void {
    const cfg = DEFAULT_WORLD_CONFIG;
    this.sim = new CpmSimulation(cfg, [
      PLAYER_PROFILE,
      ENEMY_PROFILE,
      DIGESTING_PROFILE,
      NUCLEUS_PROFILE,
    ]);
    // Anchor the bubble so its centre maps to world (0,0).
    const center = Math.floor(cfg.fieldSize / 2);
    this.sim.originWX = -center * this.sim.scale;
    this.sim.originWY = -center * this.sim.scale;

    // Player at centre; grow it to full size. The player is ONE solid CPM cell —
    // organelles are lightweight entities (below), not embedded sub-cells, so they
    // can't fragment it. A few enemies around.
    this.controlledCellId = this.sim.spawnCellAtLattice(PLAYER_KIND, center, center).id;
    for (let i = 0; i < 110; i++) this.sim.step();
    const ring = 78;
    for (const ang of [2.1, 3.14, 4.2]) {
      this.sim.spawnCellAtLattice(
        ENEMY_KIND,
        center + Math.cos(ang) * ring,
        center + Math.sin(ang) * ring
      );
    }

    this.makeBackground();
    this.cpmRenderer = new CpmRenderer(this, this.sim, 10);
    // A molecular signal field produced near the nucleus, diffusing through the
    // cytosol (routes around the nucleus, bottlenecks where the cell squeezes).
    this.signal = new CpmField(cfg.fieldSize);
    this.cpmRenderer.setField(this.signal);
    this.rules = new CpmRules(this.sim, {
      onDeath: (id, reason) => this.onCellDeath(id, reason),
      // Don't judge prey combat owns (it owns their removal).
      ignore: (id) => this.combat.isConsuming(id),
    });
    // Enemies are always motile (Act on); the AI drives their direction.
    this.sim.setKindActive(ENEMY_KIND, true);
    this.enemyAi = new CpmEnemyAi(this.sim, {
      enemyKind: ENEMY_KIND,
      getPlayerId: () => this.controlledCellId,
    });
    this.combat = new CpmCombat(this.sim, {
      playerKind: PLAYER_KIND,
      enemyKind: ENEMY_KIND,
      digestKind: DIGEST_KIND,
      getAttackerId: () => this.controlledCellId,
      // Recolour the prey to the "digesting" tint once internalized.
      onConsumeStart: (id) => this.cpmRenderer.forgetCell(id),
      onDigested: (wx, wy) => this.spawnDeathFx(wx, wy, 26, 0xffe066),
    });

    // Shape-conforming internal build grid. Organelles are structures placed in
    // slots that exist only where there's cytoplasm — so the cell's size/shape
    // shapes its interior. The cell ships with a nucleus; the player builds more.
    this.grid = new CpmDeformGrid();
    this.interiorGfx = this.add.graphics().setDepth(12);
    // The nucleus is now a controlled soft body (not a grid slot): it recenters
    // on its own, bottlenecks the cell at tight gaps, and ruptures if over-squeezed.
    this.bigOrganelles = new CpmBigOrganelles(this.sim, () => this.controlledCellId);
    const pc = this.sim.centroidLattice(this.controlledCellId);
    if (pc) {
      const N = CpmWorldScene.NUCLEUS;
      this.bigOrganelles.add(N.type, N.color, pc.x, pc.y);
    }

    this.cameras.main.setZoom(1.8);
    this.cameras.main.setBackgroundColor("#070b10");
    this.cameras.main.centerOn(0, 0);

    this.hud = this.add
      .text(12, 10, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#9bdcff",
      })
      .setScrollFactor(0)
      .setDepth(1000);

    // Always-on performance overlay (top-right): per-system ms + scale drivers.
    this.profText = this.add
      .text(this.scale.width - 12, 10, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#8fe39b",
        align: "right",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      this.profText.setX(size.width - 12);
    });

    this.input.mouse?.disableContextMenu();
    // B = build: grow a new organelle compartment.
    this.input.keyboard?.on("keydown-B", () => this.growOrganelle());

    // Dev-only handle for automated verification (connectivity, centroids, tear).
    if (import.meta.env.DEV) {
      (window as unknown as { __cpm?: unknown }).__cpm = {
        sim: this.sim,
        scene: this,
        combat: this.combat,
        rules: this.rules,
        getPlayerId: () => this.controlledCellId,
        occupants: () => this.grid.occupants,
        deaths: () => this.deaths,
        perf: () => this.prof.report(),
        nucleus: () => {
          const n = this.bigOrganelles.organelles[0];
          if (!n) return null;
          const host = this.controlledCellId;
          const inside = (x: number, y: number) =>
            this.sim.ownerAtLattice(x, y) === host;
          const c = n.body.center();
          return {
            cx: c.x,
            cy: c.y,
            exposed: n.body.exposedFraction(inside),
            oval: n.body.ovalness(),
            stress: n.stress,
          };
        },
        tear: (id?: number, axis: "h" | "v" = "h", halfWidth = 1) =>
          this.sim.tearCell(id ?? this.controlledCellId, axis, halfWidth),
      };
    }
  }

  /** A cell crossed a fatal threshold. EVERY cell dies the same way — the only
   *  extra step for the controlled cell is handing off control (the world never
   *  "game over"s; you're reborn as another cell). */
  private onCellDeath(id: number, reason: DeathReason): void {
    const c = this.sim.centroidLattice(id);
    const rec = this.sim.getCell(id);
    const color = rec ? rec.profile.color : 0xffffff;
    if (c) {
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      const radius = Math.sqrt(c.pixels / Math.PI) * this.sim.scale;
      this.spawnDeathFx(wx, wy, radius, color);
    }
    const wasControlled = id === this.controlledCellId;
    this.sim.killCell(id);
    this.cpmRenderer.forgetCell(id);
    this.deaths++;
    console.log(`💀 cell ${id} died (${reason})${wasControlled ? " — CONTROLLED" : ""}`);
    if (wasControlled) this.handoffControl();
  }

  /** Re-bind player input to another cell after the controlled one dies. For now
   *  we're reborn as a fresh cell at centre; taking over an existing peer is
   *  enabled by `bindControl` and comes once behaviour/kinds are unified. */
  private handoffControl(): void {
    const center = Math.floor(this.sim.field / 2);
    const id = this.sim.spawnCellAtLattice(PLAYER_KIND, center, center).id;
    for (let i = 0; i < 110; i++) this.sim.step();
    this.bindControl(id);
  }

  /** Bind player input + camera + the (controlled-cell-only) interior to `id`. */
  private bindControl(id: number): void {
    this.controlledCellId = id;
    this.camCx = undefined;
    this.camCy = undefined;
    // Fresh interior for the newly-controlled cell: just a nucleus soft body.
    this.grid.clear();
    this.bigOrganelles.clear();
    const pc = this.sim.centroidLattice(id);
    const N = CpmWorldScene.NUCLEUS;
    if (pc) this.bigOrganelles.add(N.type, N.color, pc.x, pc.y);
  }

  /** Kind of the controlled cell (so steering activates the right kind's Act,
   *  whatever cell we're bound to). */
  private controlledKind(): number {
    return this.sim.getCell(this.controlledCellId)?.kind ?? PLAYER_KIND;
  }

  /** Build interaction: place a lightweight organelle where the cursor points (if
   *  that spot is interior to the cell, else fall back to the centre). Cycles
   *  through buildable types so you can see several kinds coexist. */
  private growOrganelle(): void {
    const frame = this.sim.cellFrame(this.controlledCellId);
    if (!frame) return;
    const ptr = this.input.activePointer;
    const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
    const cx = Math.round(lx);
    const cy = Math.round(ly);
    const interior = this.sim.ownerAtLattice(cx, cy) === this.controlledCellId;
    const sx = interior ? cx : Math.round(frame.cx);
    const sy = interior ? cy : Math.round(frame.cy);
    const kind = CpmWorldScene.BUILDABLES[this.buildIndex % CpmWorldScene.BUILDABLES.length];
    this.buildIndex++;
    this.grid.add(kind.type, kind.color, kind.radius, frame, sx, sy);
  }

  /** Brief expanding, fading ring + flash where a cell died. */
  private spawnDeathFx(wx: number, wy: number, radius: number, color: number): void {
    const ring = this.add.circle(wx, wy, radius, color, 0.5).setDepth(20);
    this.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: 520,
      ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
  }

  private makeBackground(): void {
    // A faint grid tile, drawn once into a texture, shown as a screen-filling
    // TileSprite whose tilePosition tracks the camera -> infinite scrolling grid.
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
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      this.bg.setSize(size.width, size.height);
    });
  }

  override update(): void {
    const pointer = this.input.activePointer;

    // Hold left mouse button -> steer the player cell toward the cursor.
    this.steering = pointer.leftButtonDown();
    const kind = this.controlledKind();
    if (this.steering) {
      const [lx, ly] = this.sim.worldToLattice(pointer.worldX, pointer.worldY);
      this.sim.setKindActive(kind, true);
      this.sim.steerCell(this.controlledCellId, lx, ly);
    } else {
      if (kind === PLAYER_KIND) this.sim.setKindActive(kind, false);
      this.sim.restCell(this.controlledCellId);
    }

    // Enemy behaviour (per-cell wander/flee), then combat (hold RIGHT mouse to
    // engulf the nearest enemy — overrides the AI for the grabbed prey).
    this.prof.measure("behavior", () => {
      this.enemyAi.update(1 / 60);
      this.combat.update(pointer.rightButtonDown());
    });

    // Compartments-in-membrane is the digesting prey only now (built organelles
    // are lightweight, not CPM cells), so size the perimeter budget to those.
    this.sim.setKindPerimeterTarget(
      PLAYER_KIND,
      this.sim.basePerimeter(PLAYER_KIND) +
        this.sim.compartmentPerimeterSum([DIGEST_KIND])
    );

    this.prof.measure("cpm.step", () => this.sim.step());

    // Infinite-world streaming: recenter the bubble on the player, demote cells
    // that left, re-activate ones that returned.
    const { demoted, shiftX, shiftY } = this.prof.measure("stream", () =>
      this.sim.streamAround(this.controlledCellId)
    );
    for (const id of demoted) {
      this.cpmRenderer.forgetCell(id);
      this.rules.forget(id); // dormant != dead
    }

    // Deforming grid: small organelles flow/regroup with the cell's current shape.
    const frame = this.sim.cellFrame(this.controlledCellId);
    if (frame) {
      this.grid.shift(shiftX, shiftY);
      this.grid.step(frame, (x, y) => this.sim.ownerAtLattice(x, y) === this.controlledCellId);
    }

    // Big organelles (nucleus): step the soft bodies, refresh the footprint
    // coupling, accumulate confinement stress. Pass the steer direction so the
    // nucleus trails slightly, and the recenter shift so it rides the world.
    let steerDir: { x: number; y: number } | null = null;
    if (this.steering) {
      const c = this.sim.centroidLattice(this.controlledCellId);
      const ptr = this.input.activePointer;
      const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
      if (c) steerDir = { x: lx - c.x, y: ly - c.y };
    }
    this.prof.measure("interior", () =>
      this.bigOrganelles.update(steerDir, shiftX, shiftY)
    );
    const burst = this.bigOrganelles.consumeRupture();
    if (burst) {
      // The nucleus ruptured under confinement — the player dies (the toy's fail
      // state for forcing too tight a gap).
      this.onCellDeath(this.controlledCellId, "ruptured");
    }

    // Molecular signal field: follow the recenter, re-mask to the current cytosol
    // shape, produce around the nucleus (first occupant), diffuse.
    this.signal.shift(shiftX, shiftY);
    this.signal.setMask(this.sim.cellPixels(this.controlledCellId));
    const nucleus = this.bigOrganelles.organelles[0];
    if (nucleus) {
      const nc = nucleus.body.center();
      const rr = nucleus.body.cfg.restRadius;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        this.signal.addSource(
          nc.x + Math.cos(a) * (rr + 2),
          nc.y + Math.sin(a) * (rr + 2),
          0.6
        );
      }
    }
    this.prof.measure("field", () => this.signal.step(0.18, 0.03));

    // Biology/rules layer: structural-failure death etc.
    this.prof.measure("rules", () => this.rules.update());

    this.prof.measure("render", () => {
      this.cpmRenderer.render();
      this.drawInterior();
    });

    // Camera follows the player, but with a little lag so the cell visibly drifts
    // as it crawls instead of being pinned dead-centre (gives the interior life).
    const c = this.sim.centroidLattice(this.controlledCellId);
    if (c) {
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      const cx = this.camCx;
      const cy = this.camCy;
      this.camCx = cx === undefined ? wx : cx + (wx - cx) * 0.1;
      this.camCy = cy === undefined ? wy : cy + (wy - cy) * 0.1;
      this.cameras.main.centerOn(this.camCx, this.camCy);
    }

    // Scroll the grid backdrop with the camera (infinite-world feel).
    this.bg.tilePositionX = this.cameras.main.scrollX;
    this.bg.tilePositionY = this.cameras.main.scrollY;

    const combatStatus = this.combat.engulfing
      ? "ENGULFING"
      : this.combat.digestingCount > 0
        ? "DIGESTING"
        : this.steering
          ? "STEERING (hold LMB)"
          : "resting";
    const hp = Math.round(this.rules.healthFraction(this.controlledCellId) * 100);
    const stressed = this.grid.compressedCount;
    const nucInteg = Math.round((1 - this.bigOrganelles.maxStress()) * 100);
    this.hud.setText(
      `CPM world — ${combatStatus}   LMB move · RMB engulf · B build@cursor   ` +
        `hp ${hp}   nucleus ${nucInteg}%` +
        `   organelles ${this.grid.occupants.length}` +
        (stressed > 0 ? ` (${stressed} squeezed!)` : "") +
        `   nutrients ${this.combat.nutrients}`
    );

    // Profiler: scale drivers + per-system ms (the always-on cost overlay).
    let activeCells = 0;
    let borderPixels = 0;
    for (const rec of this.sim.getCells()) {
      activeCells++;
      borderPixels += this.sim.cellPerimeter(rec.id);
    }
    this.prof.metrics.activeCells = activeCells;
    this.prof.metrics.dormantCells = this.sim.dormantCount;
    this.prof.metrics.borderPixels = borderPixels;
    this.prof.frame();
    this.profText.setText(this.prof.overlayText());
  }

  /** Draw the deforming-grid small organelles + the nucleus soft body. */
  private drawInterior(): void {
    const g = this.interiorGfx;
    g.clear();
    const s = this.sim.scale;
    const c = this.sim.centroidLattice(this.controlledCellId);
    if (!c) return;

    // Small organelles as distinct, placed structures on the deforming grid.
    for (const o of this.grid.occupants) {
      const [wx, wy] = this.sim.latticeToWorld(o.x, o.y);
      this.drawStructure(g, o, wx, wy, s);
    }

    // Big organelles (nucleus + mitochondrion): fill each soft-body polygon
    // (oozes/ovals visibly) and tint the outline toward red as confinement stress
    // rises (the rupture warning ramp).
    for (const big of this.bigOrganelles.organelles) {
      const nodes = big.body.nodes;
      const stress = big.stress;
      const pts: Phaser.Math.Vector2[] = [];
      for (const nd of nodes) {
        const [wx, wy] = this.sim.latticeToWorld(nd.x, nd.y);
        pts.push(new Phaser.Math.Vector2(wx, wy));
      }
      g.fillStyle(big.color, 0.9);
      g.lineStyle(Math.max(1, s * 0.35), stress > 0.01 ? 0xff5d5d : 0x2a1a4a, 0.7 + 0.3 * stress);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
      // Nucleolus at the (deforming) center — nucleus only.
      if (big.type === "nucleus") {
        const nc = big.body.center();
        const [cwx, cwy] = this.sim.latticeToWorld(nc.x, nc.y);
        g.fillStyle(0x5b2f9e, 0.9);
        g.fillCircle(cwx, cwy, big.body.cfg.restRadius * s * 0.35);
      }
    }
  }

  private drawStructure(
    g: Phaser.GameObjects.Graphics,
    o: { type: string; color: number; radius: number; x: number; y: number; compressed: number },
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
        // Oriented capsule (overlapping discs along a stable axis) = a rod, not a ball.
        const ang = (((Math.round(o.x) * 3 + Math.round(o.y) * 7) % 6) / 6) * Math.PI;
        const len = r * 2.0;
        for (let k = 0; k < 4; k++) {
          const t = (k / 3 - 0.5) * len;
          g.fillCircle(wx + Math.cos(ang) * t, wy + Math.sin(ang) * t, r * 0.8);
        }
        break;
      }
      case "golgi":
        // Stacked cisternae.
        for (let k = 0; k < 3; k++) {
          g.fillStyle(o.color, alpha * (1 - k * 0.18));
          g.fillEllipse(wx, wy + (k - 1) * r * 0.55, r * 2.4, r * 0.7);
        }
        break;
      default: // ribosome and other small structures
        g.fillCircle(wx, wy, r);
        break;
    }
  }
}
