/**
 * Blueprint Renderer - Milestone 5 Task 5
 * 
 * Renders blueprint footprints with dashed outlines and progress bars
 */

import Phaser from "phaser";
import type { Blueprint } from "./blueprint-system";
import { BlueprintSystem } from "./blueprint-system";
import { CONSTRUCTION_RECIPES } from "./construction-recipes";

export class BlueprintRenderer {
  private scene: Phaser.Scene;
  private blueprintSystem: BlueprintSystem;
  private graphics: Phaser.GameObjects.Graphics;
  private hexSize: number;
  private textObjects: Map<string, Phaser.GameObjects.Text> = new Map(); // Track text objects
  private parentContainer?: Phaser.GameObjects.Container; // HOTFIX: Support for cellRoot parenting

  constructor(scene: Phaser.Scene, blueprintSystem: BlueprintSystem, hexSize: number, parentContainer?: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.blueprintSystem = blueprintSystem;
    this.hexSize = hexSize;
    this.parentContainer = parentContainer;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(10); // Above hex grid but below UI
    
    // HOTFIX H5: Add to cellRoot if provided
    if (this.parentContainer) {
      this.parentContainer.add(this.graphics);
    }
  }

  public render(): void {
    this.graphics.clear();
    
    // Clean up old text objects
    this.textObjects.forEach(text => text.destroy());
    this.textObjects.clear();

    const blueprints = this.blueprintSystem.getAllBlueprints();
    for (const blueprint of blueprints) {
      this.renderBlueprint(blueprint);
    }
  }

  private renderBlueprint(blueprint: Blueprint): void {
    const recipe = CONSTRUCTION_RECIPES.getRecipe(blueprint.recipeId);
    if (!recipe) return;

    const footprintTiles = this.blueprintSystem.getFootprintTiles(blueprint.id);
    if (footprintTiles.length === 0) return;

    // Calculate footprint centroid for progress bar
    const centroid = this.calculateCentroid(footprintTiles);
    
    // Render dashed footprint outline
    this.renderFootprintOutline(footprintTiles, recipe.color || 0x4a90e2);
    
    // Render progress bar at centroid
    this.renderProgressBar(blueprint, centroid, recipe);
  }

  private renderFootprintOutline(footprintTiles: any[], color: number): void {
    this.graphics.lineStyle(2, color, 0.8);
    
    for (const tileCoord of footprintTiles) {
      // Get tile from hex grid to get world position
      const hexGrid = (this.scene as any).hexGrid; // Access hex grid from scene
      const tile = hexGrid?.getTile({ q: tileCoord.q, r: tileCoord.r });
      
      if (tile) {
        this.drawDashedHexagon(tile.worldPos.x, tile.worldPos.y, this.hexSize, color);
      }
    }
  }

  private drawDashedHexagon(x: number, y: number, size: number, color: number): void {
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      points.push(px, py);
    }

    // Draw dashed outline
    this.graphics.lineStyle(2, color, 0.6);
    for (let i = 0; i < points.length; i += 2) {
      const nextIndex = (i + 2) % points.length;
      this.drawDashedLine(
        points[i], points[i + 1],
        points[nextIndex], points[nextIndex + 1],
        8, 4 // dash length, gap length
      );
    }

    // Add ghost fill
    this.graphics.fillStyle(color, 0.1);
    this.graphics.beginPath();
    this.graphics.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) {
      this.graphics.lineTo(points[i], points[i + 1]);
    }
    this.graphics.closePath();
    this.graphics.fillPath();
  }

  private drawDashedLine(x1: number, y1: number, x2: number, y2: number, dashLength: number, gapLength: number): void {
    const totalLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const dx = (x2 - x1) / totalLength;
    const dy = (y2 - y1) / totalLength;
    
    let currentLength = 0;
    let isDash = true;
    
    while (currentLength < totalLength) {
      const segmentLength = isDash ? dashLength : gapLength;
      const endLength = Math.min(currentLength + segmentLength, totalLength);
      
      const startX = x1 + dx * currentLength;
      const startY = y1 + dy * currentLength;
      const endX = x1 + dx * endLength;
      const endY = y1 + dy * endLength;
      
      if (isDash) {
        this.graphics.beginPath();
        this.graphics.moveTo(startX, startY);
        this.graphics.lineTo(endX, endY);
        this.graphics.strokePath();
      }
      
      currentLength = endLength;
      isDash = !isDash;
    }
  }

  private calculateCentroid(footprintTiles: any[]): { x: number; y: number } {
    if (footprintTiles.length === 0) return { x: 0, y: 0 };

    const hexGrid = (this.scene as any).hexGrid;
    let totalX = 0;
    let totalY = 0;
    let validTiles = 0;

    for (const tileCoord of footprintTiles) {
      const tile = hexGrid?.getTile({ q: tileCoord.q, r: tileCoord.r });
      if (tile) {
        totalX += tile.worldPos.x;
        totalY += tile.worldPos.y;
        validTiles++;
      }
    }

    return validTiles > 0 
      ? { x: totalX / validTiles, y: totalY / validTiles }
      : { x: 0, y: 0 };
  }

  private renderProgressBar(blueprint: Blueprint, centroid: { x: number; y: number }, _recipe: any): void {
    const totalCost = CONSTRUCTION_RECIPES.getTotalCost(blueprint.recipeId);
    const progress = blueprint.totalProgress / totalCost;
    
    const barWidth = 40;
    const barHeight = 6;
    const x = centroid.x - barWidth / 2;
    const y = centroid.y - barHeight / 2;

    // Background
    this.graphics.fillStyle(0x000000, 0.6);
    this.graphics.fillRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    // Progress bar background
    this.graphics.fillStyle(0x333333, 0.8);
    this.graphics.fillRect(x, y, barWidth, barHeight);

    // Progress fill
    const fillWidth = barWidth * Math.min(progress, 1);
    const progressColor = progress >= 1 ? 0x00ff00 : 0x4a90e2;
    this.graphics.fillStyle(progressColor, 0.9);
    this.graphics.fillRect(x, y, fillWidth, barHeight);

    // Progress text
    const progressText = `${Math.round(progress * 100)}%`;
    const textStyle = {
      fontSize: '10px',
      fontFamily: 'Arial',
      color: '#ffffff'
    };
    
    const text = this.scene.add.text(centroid.x, centroid.y + 12, progressText, textStyle);
    text.setOrigin(0.5, 0.5);
    text.setDepth(11);
    text.setAlpha(0.8);
    
    // HOTFIX H5: Add text to cellRoot if we have a parent container
    if (this.parentContainer) {
      this.parentContainer.add(text);
    }
    
    // Track the text object for cleanup
    this.textObjects.set(blueprint.id, text);
  }

  public onResize(): void {
    // Called when the viewport resizes
    this.render();
  }

  public destroy(): void {
    // Clean up all text objects
    this.textObjects.forEach(text => text.destroy());
    this.textObjects.clear();
    this.graphics.destroy();
  }
}
