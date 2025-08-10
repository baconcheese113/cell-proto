/**
 * Construction Recipe Registry - Milestone 5 Task 1
 * 
 * Centralized registry of buildable structures with costs, footprints,
 * and completion targets.
 */

import type { HexCoordinate } from "../organelles/organelle-footprints";

export interface ConstructionRecipe {
  id: string;
  label: string;
  
  // Footprint definition (relative to anchor point)
  footprintShape: HexCoordinate[];
  
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
    // Ribosome Hub (1 tile) — cost: AA+PRE_MRNA small amounts → completes to ribosome-hub
    this.registerRecipe({
      id: 'ribosome-hub',
      label: 'Ribosome Hub',
      footprintShape: [
        { q: 0, r: 0 } // single tile
      ],
      buildCost: {
        'AA': 15,      // amino acids for protein synthesis
        'PRE_MRNA': 8  // pre-mRNA for ribosome assembly
      },
      buildRatePerTick: 0.5, // slow steady construction
      onCompleteType: 'ribosome-hub',
      description: 'Protein synthesis hub',
      color: 0x8ef58a
    });

    // ER Patch (4–6 tiles) — cost: PROTEIN units → completes to proto-er
    this.registerRecipe({
      id: 'er-patch',
      label: 'ER Patch',
      footprintShape: [
        { q: 0, r: 0 },   // center
        { q: 1, r: 0 },   // right
        { q: -1, r: 0 },  // left
        { q: 0, r: 1 },   // bottom-right
        { q: 0, r: -1 },  // top-left
        { q: 1, r: -1 }   // top-right (6 tiles total)
      ],
      buildCost: {
        'PROTEIN': 45 // substantial protein investment
      },
      buildRatePerTick: 0.8,
      onCompleteType: 'proto-er',
      description: 'Protein processing network',
      color: 0x4a90e2
    });

    // Golgi Patch (3–4 tiles) — cost: PROTEIN + CARGO small → completes to golgi
    this.registerRecipe({
      id: 'golgi-patch',
      label: 'Golgi Patch',
      footprintShape: [
        { q: 0, r: 0 },   // center
        { q: 1, r: 0 },   // right
        { q: 0, r: 1 },   // bottom-right
        { q: -1, r: 0 }   // left (4 tiles in diamond)
      ],
      buildCost: {
        'PROTEIN': 30,
        'CARGO': 12   // processing machinery
      },
      buildRatePerTick: 0.6,
      onCompleteType: 'golgi',
      description: 'Cargo processing center',
      color: 0xf5a623
    });

    // Peroxisome (3 tiles) — cost: PROTEIN modest → completes to peroxisome
    this.registerRecipe({
      id: 'peroxisome',
      label: 'Peroxisome',
      footprintShape: [
        { q: 0, r: 0 },   // center
        { q: 1, r: 0 },   // right
        { q: -1, r: 0 }   // left (3 tiles in line)
      ],
      buildCost: {
        'PROTEIN': 25 // moderate protein cost
      },
      buildRatePerTick: 0.4,
      onCompleteType: 'peroxisome',
      description: 'Detoxification organelle',
      color: 0x7ed321
    });
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
  public getFootprintAt(recipeId: string, anchorQ: number, anchorR: number): HexCoordinate[] {
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
