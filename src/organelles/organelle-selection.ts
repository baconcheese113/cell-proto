/**
 * Organelle Selection System - Enhanced selection for multi-hex organelles
 * 
 * Handles selection state, hover effects, and visual feedback for organelles
 */

import Phaser from "phaser";
import { OrganelleSystem } from "./organelle-system";
import type { Organelle } from "./organelle-system";
import { getFootprintTiles } from "./organelle-footprints";
import type { HexCoord } from "../hex/hex-grid";

export interface SelectionState {
  selectedOrganelle?: Organelle;
  hoveredOrganelle?: Organelle;
  hoveredTile?: HexCoord;
}

export class OrganelleSelectionSystem {
  private scene: Phaser.Scene;
  private organelleSystem: OrganelleSystem;
  private hexSize: number;
  
  // Visual elements
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private hoverGraphics!: Phaser.GameObjects.Graphics;
  
  // State
  private state: SelectionState = {};
  
  // Events
  public onSelectionChanged?: (organelle?: Organelle) => void;

  constructor(scene: Phaser.Scene, organelleSystem: OrganelleSystem, hexSize: number) {
    this.scene = scene;
    this.organelleSystem = organelleSystem;
    this.hexSize = hexSize;
    this.initializeGraphics();
    this.setupInputHandlers();
  }

  /**
   * Initialize graphics objects
   */
  private initializeGraphics(): void {
    // Selection highlight (higher depth)
    this.selectionGraphics = this.scene.add.graphics();
    this.selectionGraphics.setDepth(1.9);
    
    // Hover highlight (lower depth)
    this.hoverGraphics = this.scene.add.graphics();
    this.hoverGraphics.setDepth(1.8);
  }

  /**
   * Setup input handlers for selection
   */
  private setupInputHandlers(): void {
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerMove(pointer);
    });
    
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerDown(pointer);
    });
  }

  /**
   * Handle pointer movement for hover effects
   */
  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const worldCoord = this.screenToHex(pointer.worldX, pointer.worldY);
    const organelle = this.organelleSystem.getOrganelleAtTile(worldCoord);
    
    if (organelle !== this.state.hoveredOrganelle) {
      this.state.hoveredOrganelle = organelle;
      this.state.hoveredTile = worldCoord;
      this.updateHoverDisplay();
    }
  }

  /**
   * Handle pointer clicks for selection
   */
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.button !== 0) return; // Only left click
    
    const worldCoord = this.screenToHex(pointer.worldX, pointer.worldY);
    const organelle = this.organelleSystem.getOrganelleAtTile(worldCoord);
    
    if (organelle !== this.state.selectedOrganelle) {
      this.state.selectedOrganelle = organelle;
      this.updateSelectionDisplay();
      
      if (this.onSelectionChanged) {
        this.onSelectionChanged(organelle);
      }
      
      // Log detailed organelle info to console
      if (organelle) {
        const info = this.organelleSystem.getOrganelleInfo(worldCoord);
        console.log('=== ORGANELLE SELECTED ===');
        info.forEach(line => console.log(line));
      }
    }
  }

  /**
   * Update hover visual effects
   */
  private updateHoverDisplay(): void {
    this.hoverGraphics.clear();
    
    if (this.state.hoveredOrganelle && this.state.hoveredOrganelle !== this.state.selectedOrganelle) {
      this.renderOrganelleHighlight(
        this.state.hoveredOrganelle,
        this.hoverGraphics,
        0x88ddff,
        0.3,
        2
      );
    }
  }

  /**
   * Update selection visual effects
   */
  private updateSelectionDisplay(): void {
    this.selectionGraphics.clear();
    
    if (this.state.selectedOrganelle) {
      this.renderOrganelleHighlight(
        this.state.selectedOrganelle,
        this.selectionGraphics,
        0xffff88,
        0.5,
        3
      );
    }
  }

  /**
   * Render highlight effect for an organelle
   */
  private renderOrganelleHighlight(
    organelle: Organelle,
    graphics: Phaser.GameObjects.Graphics,
    color: number,
    alpha: number,
    lineWidth: number
  ): void {
    const footprintTiles = getFootprintTiles(
      organelle.config.footprint,
      organelle.coord.q,
      organelle.coord.r
    );
    
    graphics.lineStyle(lineWidth, color, alpha);
    graphics.fillStyle(color, alpha * 0.1);
    
    // Highlight each tile in the footprint
    for (const tileCoord of footprintTiles) {
      const worldPos = this.hexToWorld(tileCoord);
      this.drawHexagonHighlight(graphics, worldPos.x, worldPos.y, this.hexSize * 0.95);
    }
  }

  /**
   * Draw a hexagon highlight
   */
  private drawHexagonHighlight(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number): void {
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      points.push(x + size * Math.cos(angle));
      points.push(y + size * Math.sin(angle));
    }
    graphics.fillPoints(points, true);
    graphics.strokePoints(points, true);
  }

  /**
   * Convert screen coordinates to hex coordinates
   */
  private screenToHex(screenX: number, screenY: number): HexCoord {
    // Get center of screen
    const centerX = this.scene.scale.gameSize.width * 0.5;
    const centerY = this.scene.scale.gameSize.height * 0.5;
    
    // Convert to hex space
    const x = screenX - centerX;
    const y = screenY - centerY;
    
    const q = (2/3 * x) / this.hexSize;
    const r = (-1/3 * x + Math.sqrt(3)/3 * y) / this.hexSize;
    
    return this.roundHex(q, r);
  }

  /**
   * Convert hex coordinate to world position
   */
  private hexToWorld(coord: HexCoord): { x: number, y: number } {
    const centerX = this.scene.scale.gameSize.width * 0.5;
    const centerY = this.scene.scale.gameSize.height * 0.5;
    
    const x = this.hexSize * (3/2 * coord.q);
    const y = this.hexSize * (Math.sqrt(3)/2 * coord.q + Math.sqrt(3) * coord.r);
    
    return {
      x: centerX + x,
      y: centerY + y
    };
  }

  /**
   * Round floating point hex coordinates to nearest hex
   */
  private roundHex(q: number, r: number): HexCoord {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    let rs = Math.round(s);

    const qDiff = Math.abs(rq - q);
    const rDiff = Math.abs(rr - r);
    const sDiff = Math.abs(rs - s);

    if (qDiff > rDiff && qDiff > sDiff) {
      rq = -rr - rs;
    } else if (rDiff > sDiff) {
      rr = -rq - rs;
    }

    return { q: rq, r: rr };
  }

  /**
   * Get current selection state
   */
  public getSelection(): Organelle | undefined {
    return this.state.selectedOrganelle;
  }

  /**
   * Clear selection
   */
  public clearSelection(): void {
    this.state.selectedOrganelle = undefined;
    this.updateSelectionDisplay();
    
    if (this.onSelectionChanged) {
      this.onSelectionChanged(undefined);
    }
  }

  /**
   * Update graphics when resize occurs
   */
  public onResize(): void {
    this.updateSelectionDisplay();
    this.updateHoverDisplay();
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.selectionGraphics.destroy();
    this.hoverGraphics.destroy();
  }
}
