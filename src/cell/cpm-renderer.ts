// CpmRenderer — draws the CPM lattice into the game world (NOT a screen-fixed
// canvas). The lattice is blitted into a Phaser CanvasTexture once per frame and
// shown as a world-space Image anchored at the bubble's world origin and scaled
// by worldPerPixel, so the camera pans/zooms over it like any world object.
//
// Each non-background pixel is coloured by its cell's profile, brightened toward
// white by that pixel's Act value (the protrusion "glow").

import Phaser from "phaser";
import { CpmSimulation } from "./cpm-simulation";
import type { CpmField } from "./cpm-field";

/** Concentration that renders as full-intensity molecular glow. */
const FIELD_FULL = 8;

export class CpmRenderer {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly buf32: Uint32Array;
  private readonly field: number;

  // Per-cell colour cache (id -> packed base channels + maxAct).
  private readonly colorCache = new Map<
    number,
    { r: number; g: number; b: number; maxAct: number }
  >();

  // Optional molecular field rendered as a green glow inside the cell.
  private molField?: CpmField;

  setField(field: CpmField): void {
    this.molField = field;
  }

  constructor(
    scene: Phaser.Scene,
    private readonly sim: CpmSimulation,
    depth = 10
  ) {
    this.field = sim.field;
    const key = `cpm-world-${Math.random().toString(36).slice(2)}`;
    const tex = scene.textures.createCanvas(key, this.field, this.field);
    if (!tex) throw new Error("CpmRenderer: failed to create canvas texture");
    this.texture = tex;
    this.ctx = tex.getContext();
    this.imageData = this.ctx.createImageData(this.field, this.field);
    this.buf32 = new Uint32Array(this.imageData.data.buffer);

    this.image = scene.add
      .image(sim.originWX, sim.originWY, key)
      .setOrigin(0, 0)
      .setScale(sim.scale)
      .setDepth(depth);
    // Nearest-neighbour so lattice pixels stay crisp when zoomed.
    this.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  private channels(id: number): { r: number; g: number; b: number; maxAct: number } {
    let c = this.colorCache.get(id);
    if (!c) {
      const rec = this.sim.getCell(id);
      const color = rec ? rec.profile.color : 0x888888;
      c = {
        r: (color >> 16) & 0xff,
        g: (color >> 8) & 0xff,
        b: color & 0xff,
        maxAct: rec ? rec.profile.maxAct || 1 : 1,
      };
      this.colorCache.set(id, c);
    }
    return c;
  }

  /** Redraw the lattice and keep the image anchored to the (possibly recentered)
   *  world origin. */
  render(): void {
    const buf = this.buf32;
    buf.fill(0);
    const grid = this.sim.cpm.grid;
    const field = this.field;
    for (const [[x, y], id] of grid.pixels()) {
      const c = this.channels(id);
      const a = this.sim.activityAtIndex(grid.p2i([x, y])) / c.maxAct;
      const t = a > 1 ? 1 : a < 0 ? 0 : a;
      let r = (c.r + (255 - c.r) * t) | 0;
      let g = (c.g + (245 - c.g) * t) | 0;
      let b = (c.b + (200 - c.b) * t) | 0;
      // Molecular field glow (additive green) routed through the cytosol.
      if (this.molField) {
        const fv = this.molField.valueAt(x, y) / FIELD_FULL;
        if (fv > 0) {
          const m = fv > 1 ? 1 : fv;
          r = (r * (1 - 0.5 * m)) | 0;
          g = Math.min(255, g + 210 * m) | 0;
          b = (b * (1 - 0.3 * m)) | 0;
        }
      }
      buf[y * field + x] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }
    this.ctx.putImageData(this.imageData, 0, 0);
    this.texture.refresh();
    this.image.setPosition(this.sim.originWX, this.sim.originWY);
  }

  /** Drop a cell's cached colour (call when a cell dies/leaves). */
  forgetCell(id: number): void {
    this.colorCache.delete(id);
  }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }
}
