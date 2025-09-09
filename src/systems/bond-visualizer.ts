/**
 * Visual renderer for adhesion bonds between vesicles and membrane particles
 */
export class BondVisualizer {
  private graphics: Phaser.GameObjects.Graphics;
  private enabled = true;
  
  constructor(scene: Phaser.Scene, parent?: Phaser.GameObjects.Container) {
    this.graphics = scene.add.graphics();
    
    if (parent) {
      parent.add(this.graphics);
    }
  }

  /**
   * Render all active bonds
   */
  public render(bonds: any[], vesicles: any[], membraneParticles: any[]): void {
    if (!this.enabled) return;
    
    this.graphics.clear();
    
    if (bonds.length === 0) return;
    
    // Render bond lines
    for (const bond of bonds) {
      const vesicle = vesicles.find(v => v.id === bond.vesicleId);
      const membraneParticle = membraneParticles[bond.membraneParticleIndex];
      
      if (!vesicle || !membraneParticle) continue;
      
      const vesiclePos = vesicle.position;
      const membranePos = membraneParticle.position;
      
      // Color based on bond force (green = low force, red = high force)
      const forceNormalized = Math.min(bond.force / 100, 1); // Normalize to 0-1
      const red = Math.floor(255 * forceNormalized);
      const green = Math.floor(255 * (1 - forceNormalized));
      const color = (red << 16) | (green << 8) | 0;
      
      // Bond line thickness based on force
      const thickness = Math.max(1, Math.min(4, bond.force / 50));
      
      this.graphics.lineStyle(thickness, color, 0.8);
      this.graphics.lineBetween(
        vesiclePos.x, vesiclePos.y,
        membranePos.x, membranePos.y
      );
      
      // Small circle at membrane attachment point
      this.graphics.fillStyle(color, 0.6);
      this.graphics.fillCircle(membranePos.x, membranePos.y, 2);
    }
  }

  /**
   * Render bond statistics as text overlay
   */
  public renderStats(_x: number, _y: number, stats: any): void {
    if (!this.enabled) return;
    
    // Note: For text rendering, we'd need a separate text object
    // For now, just log to console periodically
    if (stats.totalBonds > 0) {
      console.log(`🔗 Bonds: ${stats.totalBonds}, Avg Force: ${stats.avgForce.toFixed(1)}pN, Max: ${stats.maxForce.toFixed(1)}pN`);
    }
  }

  /**
   * Toggle visualization
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.graphics.clear();
    }
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    this.graphics.destroy();
  }
}
