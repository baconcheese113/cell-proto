/**
 * Base blueprint interface - shared between organelle and cytoskeleton blueprints
 * Reduces code duplication by providing common fields and behavior patterns
 */

import type { HexCoord } from "../hex/hex-grid";

/**
 * Common blueprint fields shared by all blueprint types
 */
export interface BaseBlueprint {
  id: string;
  isActive: boolean;
  createdAt: number;
  progress: Record<string, number>; // Resource progress (e.g., AA, PROTEIN)
  required: Record<string, number>; // Resource requirements
}

/**
 * Placement-based blueprint that has a location in the world
 */
export interface PlacementBlueprint extends BaseBlueprint {
  anchorCoord: HexCoord; // Primary placement coordinate
}

/**
 * Progress calculation utilities shared by all blueprint types
 */
export class BlueprintProgressUtils {
  /**
   * Calculate overall progress percentage (0-1) for a blueprint
   */
  static calculateOverallProgress(blueprint: BaseBlueprint): number {
    const progressEntries = Object.entries(blueprint.progress);
    const requiredEntries = Object.entries(blueprint.required);
    
    if (progressEntries.length === 0 || requiredEntries.length === 0) {
      return 0;
    }
    
    // Calculate minimum progress across all required resources
    let minProgress = 1.0;
    for (const [speciesId, requiredAmount] of requiredEntries) {
      const currentProgress = blueprint.progress[speciesId] || 0;
      const progressRatio = requiredAmount > 0 ? currentProgress / requiredAmount : 1;
      minProgress = Math.min(minProgress, progressRatio);
    }
    
    return Math.max(0, Math.min(1, minProgress));
  }
  
  /**
   * Check if blueprint is complete (all resources satisfied)
   */
  static isComplete(blueprint: BaseBlueprint): boolean {
    for (const [speciesId, requiredAmount] of Object.entries(blueprint.required)) {
      const currentProgress = blueprint.progress[speciesId] || 0;
      if (currentProgress < requiredAmount) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * Get formatted progress display for UI
   */
  static getProgressDisplay(blueprint: BaseBlueprint): Array<{
    speciesId: string;
    current: number;
    required: number;
    percentage: number;
    isComplete: boolean;
  }> {
    return Object.entries(blueprint.required).map(([speciesId, requiredAmount]) => {
      const current = blueprint.progress[speciesId] || 0;
      const percentage = requiredAmount > 0 ? Math.round((current / requiredAmount) * 100) : 100;
      const isComplete = current >= requiredAmount;
      
      return {
        speciesId,
        current,
        required: requiredAmount,
        percentage,
        isComplete
      };
    });
  }
}
