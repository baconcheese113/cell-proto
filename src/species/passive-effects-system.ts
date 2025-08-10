/**
 * Passive Effects System - Milestone 2 Task 6
 * 
 * Applies global passive source/sink effects to all tiles before diffusion.
 * Includes configurable ATP decay and ROS rise.
 */

import { HexGrid } from "../hex/hex-grid";

export interface PassiveEffect {
  speciesId: string;
  rate: number; // Amount per second (can be negative for decay)
  enabled: boolean;
}

export class PassiveEffectsSystem {
  private hexGrid: HexGrid;
  private effects: Map<string, PassiveEffect> = new Map();

  constructor(hexGrid: HexGrid) {
    this.hexGrid = hexGrid;
    this.initializeDefaultEffects();
  }

  /**
   * Initialize default passive effects
   */
  private initializeDefaultEffects(): void {
    // ATP slowly decays everywhere (disabled by default for testing)
    this.addEffect({
      speciesId: 'ATP',
      rate: -0.5, // Loses 0.5 per second
      enabled: false // Start disabled
    });

    // ROS slowly rises everywhere (disabled by default for testing)
    this.addEffect({
      speciesId: 'ROS',
      rate: 0.2, // Gains 0.2 per second
      enabled: false // Start disabled
    });
  }

  /**
   * Add or update a passive effect
   */
  public addEffect(effect: PassiveEffect): void {
    this.effects.set(effect.speciesId, { ...effect });
  }

  /**
   * Remove a passive effect
   */
  public removeEffect(speciesId: string): void {
    this.effects.delete(speciesId);
  }

  /**
   * Enable/disable a passive effect
   */
  public setEffectEnabled(speciesId: string, enabled: boolean): void {
    const effect = this.effects.get(speciesId);
    if (effect) {
      effect.enabled = enabled;
    }
  }

  /**
   * Get all effects
   */
  public getAllEffects(): PassiveEffect[] {
    return Array.from(this.effects.values());
  }

  /**
   * Get effect for specific species
   */
  public getEffect(speciesId: string): PassiveEffect | undefined {
    return this.effects.get(speciesId);
  }

  /**
   * Apply passive effects to all tiles for given timestep
   */
  public step(deltaSeconds: number): void {
    const allTiles = this.hexGrid.getAllTiles();
    
    for (const tile of allTiles) {
      for (const effect of this.effects.values()) {
        if (!effect.enabled) continue;
        
        const currentConcentration = tile.concentrations[effect.speciesId] || 0;
        const change = effect.rate * deltaSeconds;
        const newConcentration = Math.max(0, currentConcentration + change);
        
        tile.concentrations[effect.speciesId] = newConcentration;
      }
    }
  }

  /**
   * Get total effect rate for a species (for conservation tracking)
   */
  public getTotalEffectRate(speciesId: string): number {
    const effect = this.effects.get(speciesId);
    if (!effect || !effect.enabled) return 0;
    
    const tileCount = this.hexGrid.getTileCount();
    return effect.rate * tileCount;
  }

  /**
   * Toggle all passive effects on/off
   */
  public setAllEffectsEnabled(enabled: boolean): void {
    for (const effect of this.effects.values()) {
      effect.enabled = enabled;
    }
    console.log(`All passive effects ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get summary of active effects
   */
  public getActiveSummary(): string[] {
    const summary: string[] = [];
    
    for (const effect of this.effects.values()) {
      if (effect.enabled) {
        const sign = effect.rate >= 0 ? '+' : '';
        summary.push(`${effect.speciesId}: ${sign}${effect.rate.toFixed(2)}/s`);
      }
    }
    
    return summary;
  }
}
