/**
 * Construction Recipe Registry - Milestone 5 Task 1
 * 
 * Centralized registry of buildable structures with costs, footprints,
 * and completion targets. Now uses centralized organelle registry.
 * 
 * Milestone 13: Extended to support filaments and organelle upgrades
 */

import type { HexCoord } from "../hex/hex-grid";
import type { SpeciesId } from "../species/species-registry";
import type { OrganelleType } from "../organelles/organelle-registry";
import { getBuildableOrganelleDefinitions, getFootprintShape } from "../organelles/organelle-registry";

// Milestone 13: Recipe types for different build categories
export type RecipeType = 'organelle' | 'filament' | 'upgrade';
export type FilamentType = 'actin' | 'microtubule';
export type UpgradeType = 'npc_exporter' | 'er_exit' | 'golgi_tgn' | 'exocyst_hotspot';

export interface ConstructionRecipe {
  id: string; // Can be OrganelleType, FilamentType, or UpgradeType
  type: RecipeType;
  label: string;
  
  // Footprint definition (relative to anchor point)
  footprintShape: HexCoord[];
  
  // Build requirements
  buildCost: Partial<Record<SpeciesId, number>>; // species ID -> amount needed
  buildRatePerTick: number; // max units that can be consumed per tick
  
  // Completion target
  onCompleteType?: OrganelleType; // organelle type to spawn when finished
  
  // Display
  description?: string;
  color?: number;
  
  // Milestone 6: Membrane-specific constraints
  membraneOnly?: boolean; // Only placeable on membrane tiles
  cytosolOnly?: boolean;  // Only placeable on cytosol (non-membrane) tiles
  
  // Milestone 13: Context constraints
  organelleRimOnly?: boolean; // Only placeable on organelle rim tiles
  organelleTypeFilter?: OrganelleType[]; // Which organelle types support this upgrade
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
        type: 'organelle',
        label: definition.label,
        footprintShape: getFootprintShape(definition.footprint),
        buildCost: definition.buildCost,
        buildRatePerTick: definition.buildRatePerTick,
        onCompleteType: definition.type,
        description: `Build ${definition.label}`,
        color: definition.color,
        cytosolOnly: true // Regular organelles are cytosol-only
      });
    }
    
    // Milestone 6: Add membrane-specific recipes
    this.initializeMembraneRecipes();
    
    // Milestone 13: Add filament and upgrade recipes
    this.initializeFilamentRecipes();
    this.initializeUpgradeRecipes();
  }

  private initializeMembraneRecipes(): void {
    // Membrane Port - basic transport structure
    this.registerRecipe({
      id: 'membrane-port',
      type: 'organelle',
      label: 'Membrane Port',
      footprintShape: [{ q: 0, r: 0 }], // Single tile
      buildCost: {
        'PROTEIN': 30,
        'LIPID': 20
      },
      buildRatePerTick: 2.0,
      onCompleteType: 'membrane-port',
      description: 'Basic membrane transport structure',
      color: 0x44aa44,
      membraneOnly: true
    });
    
    // Transporter - specialized transport protein
    this.registerRecipe({
      id: 'transporter',
      type: 'organelle',
      label: 'Transporter',
      footprintShape: [{ q: 0, r: 0 }], // Single tile
      buildCost: {
        'PROTEIN': 50,
        'NT': 15
      },
      buildRatePerTick: 1.5,
      onCompleteType: 'transporter',
      description: 'Specialized transport protein',
      color: 0x6666ff,
      membraneOnly: true
    });
    
    // Receptor - signaling protein
    this.registerRecipe({
      id: 'receptor',
      type: 'organelle',
      label: 'Receptor',
      footprintShape: [{ q: 0, r: 0 }], // Single tile
      buildCost: {
        'PROTEIN': 40,
        'NT': 10
      },
      buildRatePerTick: 1.8,
      onCompleteType: 'receptor',
      description: 'Membrane signaling protein',
      color: 0xff6644,
      membraneOnly: true
    });
  }

  // Milestone 13: Filament construction recipes
  private initializeFilamentRecipes(): void {
    // Actin filaments - short, flexible, for local transport
    this.registerRecipe({
      id: 'actin',
      type: 'filament',
      label: 'Actin Filament',
      footprintShape: [{ q: 0, r: 0 }], // Single segment
      buildCost: {
        'AA': 15,
        'PROTEIN': 10
      },
      buildRatePerTick: 3.0,
      description: 'Short, flexible filament for local transport',
      color: 0x00ff88,
      cytosolOnly: true
    });
    
    // Microtubules - long, rigid, for long-distance transport
    this.registerRecipe({
      id: 'microtubule',
      type: 'filament',
      label: 'Microtubule',
      footprintShape: [{ q: 0, r: 0 }], // Single segment
      buildCost: {
        'AA': 25,
        'PROTEIN': 20
      },
      buildRatePerTick: 2.0,
      description: 'Long, rigid filament for fast transport',
      color: 0x4488ff,
      cytosolOnly: true
    });
  }

  // Milestone 13: Organelle upgrade recipes
  private initializeUpgradeRecipes(): void {
    // NPC Exporter - allows transcripts to enter transport network
    this.registerRecipe({
      id: 'npc_exporter',
      type: 'upgrade',
      label: 'NPC Exporter',
      footprintShape: [{ q: 0, r: 0 }], // Single tile
      buildCost: {
        'PROTEIN': 40,
        'NT': 20
      },
      buildRatePerTick: 1.5,
      description: 'Nuclear export complex - install on nucleus rim',
      color: 0xffaa00,
      organelleRimOnly: true,
      organelleTypeFilter: ['nucleus']
    });
    
    // ER Exit - COPII coat for vesicle formation
    this.registerRecipe({
      id: 'er_exit',
      type: 'upgrade',
      label: 'ER Exit (COPII)',
      footprintShape: [{ q: 0, r: 0 }], // Single tile
      buildCost: {
        'PROTEIN': 50,
        'LIPID': 15
      },
      buildRatePerTick: 1.2,
      description: 'ER exit site - install on ER rim for vesicle formation',
      color: 0x88ff44,
      organelleRimOnly: true,
      organelleTypeFilter: ['ribosome-hub', 'proto-er'] // ER-related organelles
    });
    
    // Golgi TGN - trans-Golgi network for final processing
    this.registerRecipe({
      id: 'golgi_tgn',
      type: 'upgrade',
      label: 'Golgi TGN',
      footprintShape: [{ q: 0, r: 0 }], // Single tile
      buildCost: {
        'PROTEIN': 60,
        'LIPID': 25
      },
      buildRatePerTick: 1.0,
      description: 'Trans-Golgi network - install on Golgi rim for vesicle sorting',
      color: 0xff6600,
      organelleRimOnly: true,
      organelleTypeFilter: ['golgi'] // Golgi-related organelles
    });
    
    // Exocyst Hotspot - membrane targeting complex
    this.registerRecipe({
      id: 'exocyst_hotspot',
      type: 'upgrade',
      label: 'Exocyst Hotspot',
      footprintShape: [{ q: 0, r: 0 }], // Single tile
      buildCost: {
        'PROTEIN': 45,
        'LIPID': 30
      },
      buildRatePerTick: 1.3,
      description: 'Membrane targeting complex for vesicle delivery',
      color: 0xff4488,
      membraneOnly: true // Can only be placed on membrane tiles
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
  public getFootprintAt(recipeId: string, anchorQ: number, anchorR: number): HexCoord[] {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) return [];
    
    return recipe.footprintShape.map(offset => ({
      q: anchorQ + offset.q,
      r: anchorR + offset.r
    }));
  }

  // Milestone 13: Context-aware filtering methods
  public getRecipesForContext(context: {
    isMembrane?: boolean;
    isCytosol?: boolean;
    organelleType?: OrganelleType;
    isOrganelleRim?: boolean;
  }): ConstructionRecipe[] {
    return this.getAllRecipes().filter(recipe => {
      // Check membrane constraints
      if (recipe.membraneOnly && !context.isMembrane) return false;
      if (recipe.cytosolOnly && !context.isCytosol) return false;
      
      // Check organelle rim constraints
      if (recipe.organelleRimOnly && !context.isOrganelleRim) return false;
      
      // Check organelle type filter for upgrades
      if (recipe.organelleTypeFilter && context.organelleType) {
        if (!recipe.organelleTypeFilter.includes(context.organelleType)) return false;
      }
      
      return true;
    });
  }

  // Filter recipes by type (organelle, filament, upgrade)
  public getRecipesByType(type: RecipeType): ConstructionRecipe[] {
    return this.getAllRecipes().filter(recipe => recipe.type === type);
  }

  // Get recipes that can be built on cytosol tiles
  public getCytosolRecipes(): ConstructionRecipe[] {
    return this.getAllRecipes().filter(recipe => 
      recipe.cytosolOnly || (!recipe.membraneOnly && !recipe.organelleRimOnly)
    );
  }

  // Get recipes that can be built on membrane tiles
  public getMembraneRecipes(): ConstructionRecipe[] {
    return this.getAllRecipes().filter(recipe => 
      recipe.membraneOnly || (!recipe.cytosolOnly && !recipe.organelleRimOnly)
    );
  }

  // Get upgrade recipes for a specific organelle type
  public getUpgradesForOrganelle(organelleType: OrganelleType): ConstructionRecipe[] {
    return this.getRecipesByType('upgrade').filter(recipe => 
      !recipe.organelleTypeFilter || recipe.organelleTypeFilter.includes(organelleType)
    );
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
