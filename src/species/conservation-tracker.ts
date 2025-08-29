/**
 * Conservation Tracker - Milestone 2 Task 8
 * 
 * Tracks total species amounts across the grid for debugging conservation laws
 * and monitoring passive effect behavior.
 */

import Phaser from "phaser";
import { HexGrid } from "../hex/hex-grid";
import { getAllSpeciesIds, type SpeciesId } from "../species/species-registry";
import { PassiveEffectsSystem } from "./passive-effects-system";

export interface ConservationData {
  speciesId: SpeciesId;
  totalAmount: number;
  lastAmount: number;
  changeRate: number; // Amount change per second
}

export class ConservationTracker {
  private hexGrid: HexGrid;
  private passiveEffectsSystem: PassiveEffectsSystem;
  private data: Map<string, ConservationData> = new Map();
  private lastUpdateTime = 0;
  private panel: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, hexGrid: HexGrid, passiveEffectsSystem: PassiveEffectsSystem) {
    this.hexGrid = hexGrid;
    this.passiveEffectsSystem = passiveEffectsSystem;
    this.initializeData();
    
    this.panel = scene.add.text(14, 800, "", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#ffcc88",
      backgroundColor: "#000000",
      padding: { x: 6, y: 4 },
      stroke: "#444444",
      strokeThickness: 1,
    });
    
    this.panel.setDepth(1001);
    this.panel.setScrollFactor(0);
    this.panel.setVisible(false);
    
    console.log('Conservation tracker initialized');
  }

  /**
   * Initialize tracking data for all species
   */
  private initializeData(): void {
    for (const speciesId of getAllSpeciesIds()) {
      this.data.set(speciesId, {
        speciesId,
        totalAmount: 0,
        lastAmount: 0,
        changeRate: 0
      });
    }
  }

  /**
   * Update conservation tracking
   */
  public update(): void {

    const currentTime = Date.now();
    const deltaSeconds = this.lastUpdateTime > 0 ? (currentTime - this.lastUpdateTime) / 1000 : 0;
    
    for (const speciesId of getAllSpeciesIds()) {
      const total = this.calculateTotal(speciesId);
      const conservationData = this.data.get(speciesId);
      
      if (conservationData) {
        const lastTotal = conservationData.totalAmount;
        conservationData.lastAmount = lastTotal;
        conservationData.totalAmount = total;
        
        if (deltaSeconds > 0) {
          conservationData.changeRate = (total - lastTotal) / deltaSeconds;
        }
      }
    }

    const report = this.getSummaryReport();
    this.panel.setText(report.join('\n'));
    this.panel.setVisible(false);
    
    this.lastUpdateTime = currentTime;
  }

  /**
   * Calculate total amount of a species across all tiles
   */
  private calculateTotal(speciesId: SpeciesId): number {
    let total = 0;
    const allTiles = this.hexGrid.getAllTiles();
    
    for (const tile of allTiles) {
      total += tile.concentrations[speciesId] || 0;
    }
    
    return total;
  }

  /**
   * Get all conservation data
   */
  public getAllConservationData(): ConservationData[] {
    return Array.from(this.data.values());
  }

  /**
   * Get summary report of conservation
   */
  public getSummaryReport(): string[] {
    const report: string[] = [];
    report.push("=== CONSERVATION REPORT ===");
    
    for (const data of this.data.values()) {
      const changeSign = data.changeRate >= 0 ? '+' : '';
      const expectedRate = this.passiveEffectsSystem.getTotalEffectRate(data.speciesId);
      const tolerance = Math.abs(expectedRate * 0.1); // 10% tolerance
      const isConserved = Math.abs(data.changeRate - expectedRate) <= tolerance;
      
      report.push(
        `${data.speciesId}: ${data.totalAmount.toFixed(1)} ` +
        `(${changeSign}${data.changeRate.toFixed(2)}/s) ` +
        `[expected: ${changeSign}${expectedRate.toFixed(2)}/s] ` +
        `${isConserved ? '✓' : '✗'}`
      );
    }
    
    return report;
  }

  /**
   * Reset tracking data
   */
  public reset(): void {
    this.initializeData();
    this.lastUpdateTime = 0;
    console.log('Conservation tracking reset');
  }

  /**
   * Check if totals are conserved within tolerance (for diffusion-only scenarios)
   */
  public checkConservation(tolerancePercent = 1.0): boolean {
    for (const data of this.data.values()) {
      const effect = this.passiveEffectsSystem.getEffect(data.speciesId);
      
      // If no passive effects, should be conserved
      if (!effect || !effect.enabled) {
        const changePercent = Math.abs(data.changeRate / Math.max(data.totalAmount, 1)) * 100;
        if (changePercent > tolerancePercent) {
          return false;
        }
      }
    }
    return true;
  }
}
