import Phaser from "phaser";
import { HexGrid } from "../hex/hex-grid";
import type { HexTile } from "../hex/hex-grid";
import { getAllSpeciesIds, getSpecies, type SpeciesId } from "../species/species-registry";

export class HeatmapSystem {
  private scene: Phaser.Scene;
  private hexGrid: HexGrid;
  private hexSize: number;
  private graphics!: Phaser.GameObjects.Graphics;
  
  private isVisible = false;
  private currentSpeciesIndex = 0;
  private allSpeciesIds: SpeciesId[];

  constructor(scene: Phaser.Scene, hexGrid: HexGrid, hexSize: number) {
    this.scene = scene;
    this.hexGrid = hexGrid;
    this.hexSize = hexSize;
    this.allSpeciesIds = getAllSpeciesIds();
    this.initializeGraphics();
  }

  private initializeGraphics(): void {
    this.graphics = this.scene.add.graphics();
    this.graphics.setDepth(1.4); // Above background, below hex grid lines
    this.graphics.setVisible(false);
  }

  /**
   * Toggle heatmap visibility
   */
  public toggle(): void {
    this.isVisible = !this.isVisible;
    this.graphics.setVisible(this.isVisible);
    if (this.isVisible) {
      this.render();
    }
    console.log(`Heatmap ${this.isVisible ? 'shown' : 'hidden'}`);
  }

  /**
   * Cycle to next species
   */
  public nextSpecies(): void {
    this.currentSpeciesIndex = (this.currentSpeciesIndex + 1) % this.allSpeciesIds.length;
    if (this.isVisible) {
      this.render();
    }
    const currentSpecies = this.getCurrentSpecies();
    console.log(`Heatmap now showing: ${currentSpecies}`);
  }

  /**
   * Cycle to previous species
   */
  public prevSpecies(): void {
    this.currentSpeciesIndex = (this.currentSpeciesIndex - 1 + this.allSpeciesIds.length) % this.allSpeciesIds.length;
    if (this.isVisible) {
      this.render();
    }
    const currentSpecies = this.getCurrentSpecies();
    console.log(`Heatmap now showing: ${currentSpecies}`);
  }

  /**
   * Get current species being visualized
   */
  public getCurrentSpecies(): SpeciesId {
    return this.allSpeciesIds[this.currentSpeciesIndex] || 'ATP';
  }

  /**
   * Check if heatmap is visible
   */
  public isHeatmapVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Render the heatmap for current species
   */
  public render(): void {
    if (!this.isVisible) return;

    this.graphics.clear();
    
    const currentSpeciesId = this.getCurrentSpecies();
    const speciesData = getSpecies(currentSpeciesId);
    const baseColor = speciesData?.color ?? 0xffffff;
    
    const allTiles = this.hexGrid.getAllTiles();
    const maxConcentration = this.findMaxConcentration(allTiles, currentSpeciesId);
    
    if (maxConcentration <= 0) return; // Nothing to render
    
    for (const tile of allTiles) {
      const concentration = tile.concentrations[currentSpeciesId] || 0;
      if (concentration <= 0) continue;
      
      const intensity = Math.min(concentration / maxConcentration, 1.0);
      const alpha = intensity * 0.6; // Max 60% opacity
      
      this.drawHexagonFill(tile.worldPos.x, tile.worldPos.y, this.hexSize, baseColor, alpha);
    }
  }

  /**
   * Find maximum concentration for normalization
   */
  private findMaxConcentration(tiles: HexTile[], speciesId: SpeciesId): number {
    let max = 0;
    for (const tile of tiles) {
      const concentration = tile.concentrations[speciesId] || 0;
      max = Math.max(max, concentration);
    }
    return max;
  }

  /**
   * Draw filled hexagon
   */
  private drawHexagonFill(x: number, y: number, size: number, color: number, alpha: number): void {
    this.graphics.fillStyle(color, alpha);
    
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      points.push(px, py);
    }
    
    this.graphics.beginPath();
    this.graphics.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) {
      this.graphics.lineTo(points[i], points[i + 1]);
    }
    this.graphics.closePath();
    this.graphics.fillPath();
  }

  /**
   * Update heatmap (call each frame if visible)
   */
  public update(): void {
    if (this.isVisible) {
      this.render();
    }
  }

  /**
   * Get current species info for display
   */
  public getCurrentSpeciesInfo(): { id: string, label: string, index: number, total: number } {
    const id = this.getCurrentSpecies();
    const speciesData = getSpecies(id);
    return {
      id,
      label: speciesData?.label || id,
      index: this.currentSpeciesIndex + 1,
      total: this.allSpeciesIds.length
    };
  }
}
