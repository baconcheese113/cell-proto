/**
 * Organelle Renderer - Milestone 3 Task 1
 * 
 * Handles visual rendering of organelles on the hex grid with outlines and labels.
 */

import Phaser from "phaser";
import { OrganelleSystem } from "./organelle-system";
import type { Organelle } from "./organelle-system";
import { getFootprintTiles } from "./organelle-footprints";
import type { WorldRefs } from "../core/world-refs";

export class OrganelleRenderer {
  private scene: Phaser.Scene;
  private organelleSystem: OrganelleSystem;
  private worldRefs?: WorldRefs;
  private hexSize: number;
  
  // Visual elements
  private graphics!: Phaser.GameObjects.Graphics;
  private labelGroup!: Phaser.GameObjects.Group;
  private parentContainer?: Phaser.GameObjects.Container; // HOTFIX: Support for cellRoot parenting

  constructor(scene: Phaser.Scene, organelleSystem: OrganelleSystem, hexSize: number, parentContainer?: Phaser.GameObjects.Container, worldRefs?: WorldRefs) {
    this.scene = scene;
    this.organelleSystem = organelleSystem;
    this.worldRefs = worldRefs;
    this.hexSize = hexSize;
    this.parentContainer = parentContainer;
    this.initializeGraphics();
  }

  /**
   * Initialize graphics objects
   */
  private initializeGraphics(): void {
    // Graphics for outlines and shapes
    this.graphics = this.scene.add.graphics();
    this.graphics.setDepth(1.7); // Above hex grid, below UI
    
    // HOTFIX H2: Re-parent to cellRoot if provided
    if (this.parentContainer) {
      this.parentContainer.add(this.graphics);
    }
    
    // Group for text labels
    this.labelGroup = this.scene.add.group();
  }

  /**
   * Render all organelles
   */
  public render(): void {
    this.graphics.clear();
    this.labelGroup.clear(true, true); // Remove and destroy all labels
    
    const organelles = this.organelleSystem.getAllOrganelles();
    
    for (const organelle of organelles) {
      this.renderOrganelle(organelle);
    }
  }

  /**
   * Render a single organelle
   */
  private renderOrganelle(organelle: Organelle): void {
    const config = organelle.config;
    
    // Get all tiles this organelle occupies
    const footprintTiles = getFootprintTiles(
      config.footprint,
      organelle.coord.q,
      organelle.coord.r
    );
    
    // Check if this is a transporter with installed proteins
    const isTransporterWithProtein = organelle.type === 'transporter' && 
      this.worldRefs?.membraneExchangeSystem?.hasInstalledProtein(organelle.coord);
    
    // Set style for organelle - modify for transporters with proteins
    let organelleColor = config.color;
    let fillAlpha = 0.15;
    
    if (isTransporterWithProtein) {
      organelleColor = 0x00ff00; // Green for active transporters
      fillAlpha = 0.3; // More visible fill
    }
    
    this.graphics.lineStyle(2, organelleColor, 0.8);
    this.graphics.fillStyle(organelleColor, fillAlpha);
    
    // Draw each hex tile in the footprint
    for (const tileCoord of footprintTiles) {
      const worldPos = this.hexToWorld(tileCoord);
      this.drawHexagon(worldPos.x, worldPos.y, this.hexSize * 0.9);
    }
    
    // Add outline around the entire footprint
    this.graphics.lineStyle(3, organelleColor, 1.0);
    for (const tileCoord of footprintTiles) {
      const worldPos = this.hexToWorld(tileCoord);
      this.graphics.strokeCircle(worldPos.x, worldPos.y, this.hexSize * 0.6);
      
      // Add special indicator for transporters with proteins
      if (isTransporterWithProtein) {
        // Draw a small protein indicator
        this.graphics.fillStyle(0xffffff, 0.9);
        this.graphics.fillCircle(worldPos.x, worldPos.y, this.hexSize * 0.2);
        this.graphics.lineStyle(1, 0x000000, 1.0);
        this.graphics.strokeCircle(worldPos.x, worldPos.y, this.hexSize * 0.2);
      }
    }
    
    // Get center position for label (use primary coordinate)
    const centerPos = this.hexToWorld(organelle.coord);
    
    // Add main label - modify text for active transporters
    let labelText = config.label;
    if (isTransporterWithProtein) {
      labelText = "Active " + config.label;
    }
    
    const colorString = `#${organelleColor.toString(16).padStart(6, '0')}`;
    const label = this.scene.add.text(centerPos.x, centerPos.y - this.hexSize - 12, labelText, {
      fontFamily: "monospace",
      fontSize: "12px",
      color: colorString,
      stroke: "#000000",
      strokeThickness: 2,
      align: "center"
    });
    
    label.setOrigin(0.5, 0.5);
    label.setDepth(1.8);
    this.labelGroup.add(label);
    
    // HOTFIX H5: Add label to cellRoot if we have a parent container
    if (this.parentContainer) {
      this.parentContainer.add(label);
    }
    
    // Add footprint size indicator
    const sizeLabel = this.scene.add.text(centerPos.x, centerPos.y + this.hexSize + 8, 
      `${config.footprint.name} (${footprintTiles.length} tiles)`, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: "#88ddff",
      stroke: "#000000",
      strokeThickness: 1,
      align: "center"
    });
    
    sizeLabel.setOrigin(0.5, 0.5);
    sizeLabel.setDepth(1.8);
    sizeLabel.setAlpha(0.7);
    this.labelGroup.add(sizeLabel);
    
    // HOTFIX H5: Add size label to cellRoot if we have a parent container
    if (this.parentContainer) {
      this.parentContainer.add(sizeLabel);
    }
  }

  /**
   * Draw a hexagon at the given position
   */
  private drawHexagon(x: number, y: number, size: number): void {
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      points.push(x + size * Math.cos(angle));
      points.push(y + size * Math.sin(angle));
    }
    this.graphics.fillPoints(points, true);
    this.graphics.strokePoints(points, true);
  }

  /**
   * Convert hex coordinate to local position relative to cellRoot
   * HOTFIX H5: Now uses local coordinates (0,0 center) since we're in cellRoot
   */
  private hexToWorld(coord: { q: number, r: number }): { x: number, y: number } {
    // Use local coordinates (0,0 at center) since we're now in cellRoot container
    const x = this.hexSize * (3/2 * coord.q);
    const y = this.hexSize * (Math.sqrt(3)/2 * coord.q + Math.sqrt(3) * coord.r);
    
    return {
      x: x,
      y: y
    };
  }

  /**
   * Update organelle visuals (call when organelles change)
   */
  public update(): void {
    this.render();
  }

  /**
   * Get organelle at world position (for mouse interaction)
   */
  public getOrganelleAtWorld(worldX: number, worldY: number): Organelle | undefined {
    const organelles = this.organelleSystem.getAllOrganelles();
    
    for (const organelle of organelles) {
      const worldPos = this.hexToWorld(organelle.coord);
      const radius = this.hexSize * organelle.config.size;
      
      const distance = Phaser.Math.Distance.Between(worldX, worldY, worldPos.x, worldPos.y);
      if (distance <= radius) {
        return organelle;
      }
    }
    
    return undefined;
  }

  /**
   * Set visibility of organelle visuals
   */
  public setVisible(visible: boolean): void {
    this.graphics.setVisible(visible);
    this.labelGroup.setVisible(visible);
  }

  /**
   * Handle window resize
   */
  public onResize(): void {
    this.render(); // Re-render with new positions
  }
}
