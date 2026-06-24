// CpmWorldScene — the home of the CPM cell world. This is the migration target
// that will progressively replace the hex GameScene. For now it hosts the
// deformable player cell + a few other cells in an (effectively infinite)
// scrolling world, steered by holding the left mouse button.

import Phaser from "phaser";
import { CpmSimulation } from "./cpm-simulation";
import { CpmRenderer } from "./cpm-renderer";
import {
  DEFAULT_WORLD_CONFIG,
  PLAYER_PROFILE,
  ENEMY_PROFILE,
} from "./cpm-config";

const PLAYER_KIND = 1;
const ENEMY_KIND = 2;

export class CpmWorldScene extends Phaser.Scene {
  private sim!: CpmSimulation;
  private cpmRenderer!: CpmRenderer;
  private playerId = 0;
  private bg!: Phaser.GameObjects.TileSprite;
  private hud!: Phaser.GameObjects.Text;
  private steering = false;

  constructor() {
    super("CpmWorldScene");
  }

  create(): void {
    const cfg = DEFAULT_WORLD_CONFIG;
    this.sim = new CpmSimulation(cfg, [PLAYER_PROFILE, ENEMY_PROFILE]);

    // Anchor the bubble so its centre maps to world (0,0).
    const center = Math.floor(cfg.fieldSize / 2);
    this.sim.originWX = -center * this.sim.scale;
    this.sim.originWY = -center * this.sim.scale;

    // Player at centre; a few enemies scattered around.
    this.playerId = this.sim.spawnCellAtLattice(PLAYER_KIND, center, center).id;
    const ring = 60;
    for (const ang of [0.4, 2.3, 4.1]) {
      this.sim.spawnCellAtLattice(
        ENEMY_KIND,
        center + Math.cos(ang) * ring,
        center + Math.sin(ang) * ring
      );
    }

    this.makeBackground();
    this.cpmRenderer = new CpmRenderer(this, this.sim, 10);

    this.cameras.main.setZoom(1.4);
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

    // Dev-only handle for automated verification (connectivity, centroids).
    if (import.meta.env.DEV) {
      (window as unknown as { __cpm?: unknown }).__cpm = {
        sim: this.sim,
        playerId: this.playerId,
      };
    }
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
      this.sim.steerKindToLattice(PLAYER_KIND, lx, ly);
    } else {
      this.sim.restKind(PLAYER_KIND);
    }

    this.sim.step();
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

    this.hud.setText(
      `CPM world — ${this.steering ? "STEERING (hold LMB)" : "resting"}   ` +
        `cells ${countActive(this.sim)}   area ${c ? c.pixels : 0}px`
    );
  }
}

function countActive(sim: CpmSimulation): number {
  let n = 0;
  for (const _ of sim.getCells()) n++;
  return n;
}
