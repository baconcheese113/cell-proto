/**
 * Construction Recipe Registry - Milestone 5 Task 1
 * 
 * Centralized registry of buildable structures with costs, footprints,
 * and completion targets. Now uses centralized organelle registry.
 */

import type { HexCoord } from "../hex/hex-grid";
import { getBuildableOrganelleDefinitions, getFootprintShape } from "../organelles/organelle-registry";

export interface ConstructionRecipe {
  id: string;
  label: string;
  
  // Footprint definition (relative to anchor point)
  footprintShape: HexCoord[];
  
  // Build requirements
  buildCost: Record<string, number>; // species ID -> amount needed
  buildRatePerTick: number; // max units that can be consumed per tick
  
  // Completion target
  onCompleteType: string; // organelle type to spawn when finished
  
  // Display
  description?: string;
  color?: number;
}

/**
 * Construction recipe registry
 */
class ConstructionRecipeRegistry {
  private recipes: Map<string, ConstructionRecipe> = new Map();

  constructor() {
    this.initializeRecipes();
  }

  private initializeRecipes(): void {
    // Generate recipes from organelle registry for buildable organelles
    const buildableDefinitions = getBuildableOrganelleDefinitions();
    
    for (const definition of buildableDefinitions) {
      this.registerRecipe({
        id: definition.id,
        label: definition.label,
        footprintShape: getFootprintShape(definition.footprint),
        buildCost: definition.buildCost,
        buildRatePerTick: definition.buildRatePerTick,
        onCompleteType: definition.type,
        description: `Build ${definition.label}`,
        color: definition.color
      });
    }
  }

  private registerRecipe(recipe: ConstructionRecipe): void {
    this.recipes.set(recipe.id, recipe);
  }

  public getRecipe(id: string): ConstructionRecipe | undefined {
    return this.recipes.get(id);
  }

  public getAllRecipes(): ConstructionRecipe[] {
    return Array.from(this.recipes.values());
  }

  public getRecipeIds(): string[] {
    return Array.from(this.recipes.keys());
  }

  // Calculate total cost for a recipe
  public getTotalCost(recipeId: string): number {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) return 0;
    
    return Object.values(recipe.buildCost).reduce((sum, cost) => sum + cost, 0);
  }

  // Get footprint tiles at a specific location
  public getFootprintAt(recipeId: string, anchorQ: number, anchorR: number): HexCoord[] {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) return [];
    
    return recipe.footprintShape.map(offset => ({
      q: anchorQ + offset.q,
      r: anchorR + offset.r
    }));
  }
}

// Export singleton instance
export const CONSTRUCTION_RECIPES = new ConstructionRecipeRegistry();

// Logging for acceptance test
console.log('Construction Recipe Registry loaded:');
for (const recipe of CONSTRUCTION_RECIPES.getAllRecipes()) {
  console.log(`- ${recipe.label} (${recipe.id}):`, {
    footprint: recipe.footprintShape,
    costs: recipe.buildCost,
    totalCost: CONSTRUCTION_RECIPES.getTotalCost(recipe.id),
    rate: recipe.buildRatePerTick
  });
}
