// CpmRenderer — blits a pre-computed RGBA lattice framebuffer into the game world.
// All pixel math now lives in WorldSim.renderLattice (so it can run on a worker);
// this class is a thin Phaser blitter: it owns the CanvasTexture + world-anchored
// Image and copies the latest snapshot framebuffer into it once per frame.

import Phaser from "phaser";

export class CpmRenderer {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly buf32: Uint32Array;

  constructor(scene: Phaser.Scene, field: number, scale: number, depth = 10) {
    const key = `cpm-world-${Math.random().toString(36).slice(2)}`;
    const tex = scene.textures.createCanvas(key, field, field);
    if (!tex) throw new Error("CpmRenderer: failed to create canvas texture");
    this.texture = tex;
    this.ctx = tex.getContext();
    this.imageData = this.ctx.createImageData(field, field);
    this.buf32 = new Uint32Array(this.imageData.data.buffer);

    this.image = scene.add
      .image(0, 0, key)
      .setOrigin(0, 0)
      .setScale(scale)
      .setDepth(depth);
    // Nearest-neighbour so lattice pixels stay crisp when zoomed.
    this.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  /** Copy a snapshot framebuffer into the texture and anchor to its world origin. */
  blit(src: Uint32Array, originWX: number, originWY: number): void {
    this.buf32.set(src);
    this.ctx.putImageData(this.imageData, 0, 0);
    this.texture.refresh();
    this.image.setPosition(originWX, originWY);
  }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }
}
