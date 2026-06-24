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
const ORGANELLE_KIND = 4;

export class CpmWorldScene extends Phaser.Scene {
  private sim!: CpmSimulation;
  private cpmRenderer!: CpmRenderer;
  private rules!: CpmRules;
  private enemyAi!: CpmEnemyAi;
  private combat!: CpmCombat;
  private signal!: CpmField;
  private playerId = 0;
  private nucleusId = 0;
  private bg!: Phaser.GameObjects.TileSprite;
  private hud!: Phaser.GameObjects.Text;
  private steering = false;
  private deaths = 0;

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
    // Organelle adhesion: the nucleus sticks to the cytosol interior (low J with
    // the player) and is repelled by the medium (high J via its profile), so it
    // stays inside and flows with the cell.
    this.sim.setKindAdhesion(PLAYER_KIND, ORGANELLE_KIND, 4);

    // Anchor the bubble so its centre maps to world (0,0).
    const center = Math.floor(cfg.fieldSize / 2);
    this.sim.originWX = -center * this.sim.scale;
    this.sim.originWY = -center * this.sim.scale;

    // Player at centre; grow it briefly, then seed a nucleus INSIDE it (seeding
    // onto the 1-pixel seed would destroy the host). A few enemies around.
    this.playerId = this.sim.spawnCellAtLattice(PLAYER_KIND, center, center).id;
    for (let i = 0; i < 40; i++) this.sim.step();
    this.nucleusId = this.sim.spawnCellAtLattice(ORGANELLE_KIND, center, center).id;
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
      // Don't judge prey combat owns, nor organelle compartments (not creatures).
      ignore: (id) =>
        this.combat.isConsuming(id) ||
        this.sim.getCell(id)?.kind === ORGANELLE_KIND,
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
        combat: this.combat,
        rules: this.rules,
        getPlayerId: () => this.playerId,
        getNucleusId: () => this.nucleusId,
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
    if (this.sim.getCell(this.nucleusId)) this.sim.killCell(this.nucleusId);
    this.playerId = this.sim.spawnCellAtLattice(PLAYER_KIND, center, center).id;
    for (let i = 0; i < 40; i++) this.sim.step();
    this.nucleusId = this.sim.spawnCellAtLattice(ORGANELLE_KIND, center, center).id;
  }

  /** Build interaction: grow a new organelle compartment at the player centre
   *  (placeholder for nanobot-located building). */
  private growOrganelle(): void {
    const c = this.sim.centroidLattice(this.playerId);
    if (c) this.sim.spawnCellAtLattice(ORGANELLE_KIND, c.x, c.y);
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

    this.sim.step();

    // Infinite-world streaming: recenter the bubble on the player, demote cells
    // that left, re-activate ones that returned.
    const { demoted, shiftX, shiftY } = this.sim.streamAround(this.playerId);
    for (const id of demoted) {
      this.cpmRenderer.forgetCell(id);
      this.rules.forget(id); // dormant != dead
    }

    // Molecular signal field: follow the recenter, re-mask to the current
    // cytosol shape, produce around the nucleus, diffuse.
    this.signal.shift(shiftX, shiftY);
    this.signal.setMask(this.sim.cellPixels(this.playerId));
    const nc = this.sim.centroidLattice(this.nucleusId);
    if (nc) {
      const rad = Math.sqrt(120 / Math.PI) + 2;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        this.signal.addSource(nc.x + Math.cos(a) * rad, nc.y + Math.sin(a) * rad, 0.6);
      }
    }
    this.signal.step(0.18, 0.03);

    // Biology/rules layer: structural-failure death etc.
    this.rules.update();

    this.cpmRenderer.render();

    // Camera follows the player cell's centroid (in world space).
    const c = this.sim.centroidLattice(this.playerId);
    if (c) {
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      this.cameras.main.centerOn(wx, wy);
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
    this.hud.setText(
      `CPM world — ${combatStatus}   LMB move · RMB engulf · B build   ` +
        `hp ${hp}   active ${countActive(this.sim)}   ` +
        `dormant ${this.sim.dormantCount}   nutrients ${this.combat.nutrients}`
    );
  }
}

function countActive(sim: CpmSimulation): number {
  let n = 0;
  for (const _ of sim.getCells()) n++;
  return n;
}
