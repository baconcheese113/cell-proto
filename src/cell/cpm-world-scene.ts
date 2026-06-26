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
import { CpmBuildGrid } from "./cpm-build-grid";
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
  private buildGrid!: CpmBuildGrid;
  private interiorGfx!: Phaser.GameObjects.Graphics;
  private playerId = 0;
  private bg!: Phaser.GameObjects.TileSprite;
  private hud!: Phaser.GameObjects.Text;
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
    this.playerId = this.sim.spawnCellAtLattice(PLAYER_KIND, center, center).id;
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
      getPlayerId: () => this.playerId,
    });
    this.combat = new CpmCombat(this.sim, {
      playerKind: PLAYER_KIND,
      enemyKind: ENEMY_KIND,
      digestKind: DIGEST_KIND,
      getPlayerId: () => this.playerId,
      // Recolour the prey to the "digesting" tint once internalized.
      onConsumeStart: (id) => this.cpmRenderer.forgetCell(id),
      onDigested: (wx, wy) => this.spawnDeathFx(wx, wy, 26, 0xffe066),
    });

    // Shape-conforming internal build grid. Organelles are structures placed in
    // slots that exist only where there's cytoplasm — so the cell's size/shape
    // shapes its interior. The cell ships with a nucleus; the player builds more.
    this.buildGrid = new CpmBuildGrid(this.sim, () => this.playerId, 5);
    this.interiorGfx = this.add.graphics().setDepth(12);
    const pc = this.sim.centroidLattice(this.playerId);
    if (pc) {
      const N = CpmWorldScene.NUCLEUS;
      this.buildGrid.place(N.type, N.color, N.radius, pc.x, pc.y);
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
        getPlayerId: () => this.playerId,
        occupants: () => this.buildGrid.occupants,
        occupantLattice: (o: unknown) =>
          this.buildGrid.occupantLattice(o as never),
        deaths: () => this.deaths,
        tear: (id?: number, axis: "h" | "v" = "h", halfWidth = 1) =>
          this.sim.tearCell(id ?? this.playerId, axis, halfWidth),
      };
    }
  }

  /** A cell crossed a fatal threshold (tear / mortal damage). Remove it, play a
   *  death effect, and respawn the player if it was the one that died. */
  private onCellDeath(id: number, reason: DeathReason): void {
    const c = this.sim.centroidLattice(id);
    const rec = this.sim.getCell(id);
    const color = rec ? rec.profile.color : 0xffffff;
    if (c) {
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      const radius = Math.sqrt(c.pixels / Math.PI) * this.sim.scale;
      this.spawnDeathFx(wx, wy, radius, color);
    }
    const wasPlayer = id === this.playerId;
    this.sim.killCell(id);
    this.cpmRenderer.forgetCell(id);
    this.deaths++;
    console.log(`💀 cell ${id} died (${reason})${wasPlayer ? " — PLAYER" : ""}`);
    if (wasPlayer) this.respawnPlayer();
  }

  private respawnPlayer(): void {
    const center = Math.floor(this.sim.field / 2);
    this.playerId = this.sim.spawnCellAtLattice(PLAYER_KIND, center, center).id;
    for (let i = 0; i < 110; i++) this.sim.step();
    // Fresh interior: just a nucleus.
    this.buildGrid.clear();
    const pc = this.sim.centroidLattice(this.playerId);
    const N = CpmWorldScene.NUCLEUS;
    if (pc) this.buildGrid.place(N.type, N.color, N.radius, pc.x, pc.y);
  }

  /** Build interaction: place a lightweight organelle where the cursor points (if
   *  that spot is interior to the cell, else fall back to the centre). Cycles
   *  through buildable types so you can see several kinds coexist. */
  private growOrganelle(): void {
    const c = this.sim.centroidLattice(this.playerId);
    if (!c) return;
    const ptr = this.input.activePointer;
    const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
    const cx = Math.round(lx);
    const cy = Math.round(ly);
    const interior = this.sim.ownerAtLattice(cx, cy) === this.playerId;
    const sx = interior ? cx : Math.round(c.x);
    const sy = interior ? cy : Math.round(c.y);
    const kind = CpmWorldScene.BUILDABLES[this.buildIndex % CpmWorldScene.BUILDABLES.length];
    this.buildIndex++;
    this.buildGrid.place(kind.type, kind.color, kind.radius, sx, sy);
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
    if (this.steering) {
      const [lx, ly] = this.sim.worldToLattice(pointer.worldX, pointer.worldY);
      this.sim.setKindActive(PLAYER_KIND, true);
      this.sim.steerCell(this.playerId, lx, ly);
    } else {
      this.sim.setKindActive(PLAYER_KIND, false);
      this.sim.restCell(this.playerId);
    }

    // Enemy behaviour (per-cell wander/flee), then combat (hold RIGHT mouse to
    // engulf the nearest enemy — overrides the AI for the grabbed prey).
    this.enemyAi.update(1 / 60);
    this.combat.update(pointer.rightButtonDown());

    // Compartments-in-membrane is the digesting prey only now (built organelles
    // are lightweight, not CPM cells), so size the perimeter budget to those.
    this.sim.setKindPerimeterTarget(
      PLAYER_KIND,
      this.sim.basePerimeter(PLAYER_KIND) +
        this.sim.compartmentPerimeterSum([DIGEST_KIND])
    );

    this.sim.step();

    // Infinite-world streaming: recenter the bubble on the player, demote cells
    // that left, re-activate ones that returned.
    const { demoted, shiftX, shiftY } = this.sim.streamAround(this.playerId);
    for (const id of demoted) {
      this.cpmRenderer.forgetCell(id);
      this.rules.forget(id); // dormant != dead
    }

    // Build grid: relocate any structure whose slot was squeezed out of cytoplasm.
    this.buildGrid.update();

    // Molecular signal field: follow the recenter, re-mask to the current cytosol
    // shape, produce around the nucleus (first occupant), diffuse.
    this.signal.shift(shiftX, shiftY);
    this.signal.setMask(this.sim.cellPixels(this.playerId));
    const nuc = this.buildGrid.occupants[0];
    if (nuc) {
      const [nx, ny] = this.buildGrid.occupantLattice(nuc);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        this.signal.addSource(
          nx + Math.cos(a) * (nuc.radius + 2),
          ny + Math.sin(a) * (nuc.radius + 2),
          0.6
        );
      }
    }
    this.signal.step(0.18, 0.03);

    // Biology/rules layer: structural-failure death etc.
    this.rules.update();

    this.cpmRenderer.render();
    this.drawInterior();

    // Camera follows the player, but with a little lag so the cell visibly drifts
    // as it crawls instead of being pinned dead-centre (gives the interior life).
    const c = this.sim.centroidLattice(this.playerId);
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
    const hp = Math.round(this.rules.healthFraction(this.playerId) * 100);
    const stressed = this.buildGrid.displacedCount;
    this.hud.setText(
      `CPM world — ${combatStatus}   LMB move · RMB engulf · B build@cursor   ` +
        `hp ${hp}   organelles ${this.buildGrid.occupants.length}` +
        (stressed > 0 ? ` (${stressed} displaced!)` : "") +
        `   nutrients ${this.combat.nutrients}`
    );
  }

  /** Draw the conforming build grid + the organelles as distinct structures. */
  private drawInterior(): void {
    const g = this.interiorGfx;
    g.clear();
    const s = this.sim.scale;
    const c = this.sim.centroidLattice(this.playerId);
    if (!c) return;

    // The buildable interior: faint dots on every cytoplasm slot (this set grows
    // and shrinks with the cell, showing the conforming grid the factory uses).
    g.fillStyle(0xbfefff, 0.06);
    for (const slot of this.buildGrid.validSlots()) {
      const [lx, ly] = this.buildGrid.slotToLattice(c.x, c.y, slot.gx, slot.gy);
      const [wx, wy] = this.sim.latticeToWorld(lx, ly);
      g.fillCircle(wx, wy, s * 0.45);
    }

    // Organelles as distinct, placed structures.
    for (const o of this.buildGrid.occupants) {
      const [lx, ly] = this.buildGrid.occupantLattice(o);
      const [wx, wy] = this.sim.latticeToWorld(lx, ly);
      this.drawStructure(g, o, wx, wy, s);
    }
  }

  private drawStructure(
    g: Phaser.GameObjects.Graphics,
    o: { type: string; color: number; radius: number; gx: number; gy: number; displaced: boolean },
    wx: number,
    wy: number,
    s: number
  ): void {
    const r = o.radius * s;
    const alpha = o.displaced ? 0.4 : 0.92;
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
        const ang = (((o.gx * 3 + o.gy * 7) % 6) / 6) * Math.PI;
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
