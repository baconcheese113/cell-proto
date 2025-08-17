/**
 * Blueprint System - Milestone 5 Tasks 2-3
 * 
 * Manages blueprint placement, validation, construction progress,
 * and species consumption during building.
 */

import type { HexCoord } from "../hex/hex-grid";
import { HexGrid } from "../hex/hex-grid";
import type { ConstructionRecipe } from "./construction-recipes";
import { CONSTRUCTION_RECIPES } from "./construction-recipes";
import type { MembraneExchangeSystem } from "../membrane/membrane-exchange-system";
import type { SpeciesId } from "../species/species-registry";
import type { OrganelleType } from "../organelles/organelle-registry";
import { getAllSpeciesIds } from "../species/species-registry";

export interface Blueprint {
  id: string;
  recipeId: OrganelleType;
  anchorCoord: HexCoord; // Primary placement coordinate
  
  // Construction state
  progress: Record<SpeciesId, number>; // species ID -> amount contributed
  totalProgress: number; // sum of all progress
  isActive: boolean;
  
  // Runtime
  createdAt: number;
  lastTickTime: number;
}

export interface PlacementValidation {
  isValid: boolean;
  errors: string[];
  footprintTiles: HexCoord[];
}

export class BlueprintSystem {
  private hexGrid: HexGrid;
  private blueprints: Map<string, Blueprint> = new Map();
  private blueprintsByTile: Map<string, Blueprint> = new Map(); // tile key -> blueprint
  private nextBlueprintId: number = 1;

  // For organelle system integration
  private getOccupiedTiles: () => Set<string>;
  private spawnOrganelle?: (type: OrganelleType, coord: HexCoord) => void;
  
  // Milestone 6: Membrane system integration
  private membraneExchangeSystem?: MembraneExchangeSystem;

  constructor(hexGrid: HexGrid, getOccupiedTiles: () => Set<string>, spawnOrganelle?: (type: OrganelleType, coord: HexCoord) => void, membraneExchangeSystem?: MembraneExchangeSystem) {
    this.hexGrid = hexGrid;
    this.getOccupiedTiles = getOccupiedTiles;
    this.spawnOrganelle = spawnOrganelle;
    this.membraneExchangeSystem = membraneExchangeSystem;
  }

  /**
   * Task 2: Validate blueprint placement
   */
  public validatePlacement(recipeId: OrganelleType, anchorQ: number, anchorR: number): PlacementValidation {
    const recipe = CONSTRUCTION_RECIPES.getRecipe(recipeId);
    if (!recipe) {
      return {
        isValid: false,
        errors: ['Recipe not found'],
        footprintTiles: []
      };
    }

    const footprintTiles = CONSTRUCTION_RECIPES.getFootprintAt(recipeId, anchorQ, anchorR);
    const errors: string[] = [];
    const occupiedTiles = this.getOccupiedTiles();

    // Check each footprint tile
    for (const tile of footprintTiles) {
      // Check if tile exists in grid
      if (!this.hexGrid.getTile({ q: tile.q, r: tile.r })) {
        errors.push(`Tile (${tile.q}, ${tile.r}) is outside the cell`);
        continue;
      }

      // Check if tile is already occupied by organelle or blueprint
      const tileKey = `${tile.q},${tile.r}`;
      if (occupiedTiles.has(tileKey) || this.blueprintsByTile.has(tileKey)) {
        errors.push(`Tile (${tile.q}, ${tile.r}) is already occupied`);
      }

      // Check if tile is within membrane (using approximate circular boundary)
      const distance = Math.sqrt(tile.q * tile.q + tile.r * tile.r + tile.q * tile.r);
      if (distance >= 8) { // cell radius
        errors.push(`Tile (${tile.q}, ${tile.r}) is outside the membrane`);
      }
      
      // Milestone 6 Task 3: Membrane-specific build rules
      const isMembraneTile = this.hexGrid.isMembraneCoord({ q: tile.q, r: tile.r });
      
      if (recipe.membraneOnly && !isMembraneTile) {
        errors.push(`${recipe.label} can only be built on membrane tiles`);
      }
      
      if (recipe.cytosolOnly && isMembraneTile) {
        errors.push(`${recipe.label} cannot be built on membrane tiles (cytosol only)`);
      }
      
      // Milestone 6 Task 3: One build per membrane tile constraint
      if (recipe.membraneOnly && isMembraneTile && this.membraneExchangeSystem) {
        const hasTransporters = this.membraneExchangeSystem.hasTransporters({ q: tile.q, r: tile.r });
        const hasInstalledProtein = this.membraneExchangeSystem.hasInstalledProtein({ q: tile.q, r: tile.r });
        
        if (hasTransporters || hasInstalledProtein) {
          errors.push(`Membrane tile (${tile.q}, ${tile.r}) already occupied`);
        }
      }

      // Task 2: Reject cytosolic organelles on membrane hexes
      if (!recipe.membraneOnly && isMembraneTile) {
        errors.push(`Non-membrane structures cannot be built on membrane tiles`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      footprintTiles
    };
  }

  /**
   * Task 2: Place a blueprint
   */
  public placeBlueprint(recipeId: OrganelleType, anchorQ: number, anchorR: number): { success: boolean; blueprintId?: string; error?: string } {
    const validation = this.validatePlacement(recipeId, anchorQ, anchorR);
    
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.errors.join('; ')
      };
    }

    const recipe = CONSTRUCTION_RECIPES.getRecipe(recipeId)!;
    const blueprintId = `blueprint-${this.nextBlueprintId++}`;
    
    // Initialize progress tracking
    const progress: Record<string, number> = {};
    for (const speciesId of Object.keys(recipe.buildCost)) {
      progress[speciesId] = 0;
    }

    const blueprint: Blueprint = {
      id: blueprintId,
      recipeId,
      anchorCoord: { q: anchorQ, r: anchorR },
      progress,
      totalProgress: 0,
      isActive: true,
      createdAt: Date.now(),
      lastTickTime: Date.now()
    };

    this.blueprints.set(blueprintId, blueprint);

    // Mark footprint tiles as occupied by this blueprint
    for (const tile of validation.footprintTiles) {
      const tileKey = `${tile.q},${tile.r}`;
      this.blueprintsByTile.set(tileKey, blueprint);
    }

    console.log(`Placed blueprint ${blueprint.id} for ${recipe.label} at (${anchorQ}, ${anchorR})`);
    
    return {
      success: true,
      blueprintId
    };
  }

  /**
   * Task 3: Construction progress - pull species from footprint tiles
   * Task 8: Respects priority order (runs after organelles)
   */
  public processConstruction(deltaTime: number): void {
    // Process blueprints in creation order (FIFO - first placed gets priority)
    const sortedBlueprints = Array.from(this.blueprints.values())
      .filter(bp => bp.isActive)
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const blueprint of sortedBlueprints) {
      const recipe = CONSTRUCTION_RECIPES.getRecipe(blueprint.recipeId);
      if (!recipe) continue;

      this.processBlueprint(blueprint, recipe, deltaTime);
    }
  }

  private processBlueprint(blueprint: Blueprint, recipe: ConstructionRecipe, deltaTime: number): void {
    const footprintTiles = CONSTRUCTION_RECIPES.getFootprintAt(
      blueprint.recipeId, 
      blueprint.anchorCoord.q, 
      blueprint.anchorCoord.r
    );

    // Calculate how much we can pull this tick
    const maxPullPerTick = recipe.buildRatePerTick * (deltaTime / 1000); // convert to per-second rate

    // Try to pull each required species
    for (const [speciesId, requiredAmount] of Object.entries(recipe.buildCost) as [SpeciesId, number][]) {
      const alreadyContributed = blueprint.progress[speciesId] || 0;
      const stillNeeded = Math.max(0, requiredAmount - alreadyContributed);
      
      if (stillNeeded <= 0) continue; // This species is already complete

      // Calculate how much to try to pull for this species
      const targetPull = Math.min(stillNeeded, maxPullPerTick);
      if (targetPull <= 0) continue;

      // Pull from footprint tiles evenly
      const actualPulled = this.pullSpeciesFromFootprint(footprintTiles, speciesId, targetPull);
      
      if (actualPulled > 0) {
        blueprint.progress[speciesId] = blueprint.progress[speciesId] + actualPulled;
        blueprint.totalProgress += actualPulled;
        
        // console.log(`Blueprint ${blueprint.id} consumed ${actualPulled.toFixed(2)} ${speciesId} (${blueprint.progress[speciesId].toFixed(2)}/${requiredAmount})`);
      }
    }

    // Check if construction is complete
    this.checkCompletion(blueprint, recipe);
  }

  private pullSpeciesFromFootprint(footprintTiles: HexCoord[], speciesId: SpeciesId, totalAmount: number): number {
    if (footprintTiles.length === 0) return 0;

    const amountPerTile = totalAmount / footprintTiles.length;
    let actualPulled = 0;

    for (const tileCoord of footprintTiles) {
      const tile = this.hexGrid.getTile({ q: tileCoord.q, r: tileCoord.r });
      if (!tile) continue;

      const available = tile.concentrations[speciesId] || 0;
      const pulled = Math.min(available, amountPerTile);
      
      if (pulled > 0) {
        tile.concentrations[speciesId] = Math.max(0, available - pulled);
        actualPulled += pulled;
      }
    }

    return actualPulled;
  }

  /**
   * Task 4: Player contribution - add dropped species directly to progress
   */
  public addPlayerContribution(blueprintId: string, speciesId: SpeciesId, amount: number): boolean {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint || !blueprint.isActive) return false;

    const recipe = CONSTRUCTION_RECIPES.getRecipe(blueprint.recipeId);
    if (!recipe || !(speciesId in recipe.buildCost)) return false;

    const requiredAmount = recipe.buildCost[speciesId];
    const currentProgress = blueprint.progress[speciesId];
    const canAccept = Math.max(0, (requiredAmount || 0) - currentProgress);
    const actualContribution = Math.min(amount, canAccept);

    if (actualContribution > 0) {
      blueprint.progress[speciesId] = currentProgress + actualContribution;
      blueprint.totalProgress += actualContribution;
      
      console.log(`Player contributed ${actualContribution.toFixed(2)} ${speciesId} to ${blueprint.id}`);
      
      // TODO: Show "+X to build" toast in Task 4
      return true;
    }

    return false;
  }

  /**
   * Task 6: Check completion and spawn organelle
   */
  private checkCompletion(blueprint: Blueprint, recipe: ConstructionRecipe): void {
    // Check if ALL species requirements are met (not just total progress)
    let allRequirementsMet = true;
    for (const [speciesId, requiredAmount] of Object.entries(recipe.buildCost) as [SpeciesId, number][]) {
      const currentProgress = blueprint.progress[speciesId] || 0;
      if (currentProgress < requiredAmount) {
        allRequirementsMet = false;
        break;
      }
    }
    
    if (allRequirementsMet) {
      console.log(`Blueprint ${blueprint.id} completed! All requirements met. Spawning ${recipe.onCompleteType}`);
      
      // Spawn organelle if callback is provided and recipe specifies an organelle to create
      if (this.spawnOrganelle && recipe.onCompleteType) {
        this.spawnOrganelle(recipe.onCompleteType, blueprint.anchorCoord);
      }
      
      // Remove the blueprint
      this.removeBlueprint(blueprint.id);
      
      console.log(`✅ Construction complete: ${recipe.label} built at (${blueprint.anchorCoord.q}, ${blueprint.anchorCoord.r})`);
    }
  }

  /**
   * Task 7: Cancel/demolish blueprint
   */
  public cancelBlueprint(blueprintId: string, refundFraction: number = 0.5): boolean {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return false;

    // Calculate refund
    const footprintTiles = CONSTRUCTION_RECIPES.getFootprintAt(
      blueprint.recipeId,
      blueprint.anchorCoord.q,
      blueprint.anchorCoord.r
    );

    // Refund contributed species back to footprint tiles
    for (const speciesId of getAllSpeciesIds()) {
      const contributed = blueprint.progress[speciesId];
      if (contributed > 0) {
        const refundAmount = contributed * refundFraction;
        this.distributeRefund(footprintTiles, speciesId, refundAmount);
      }
    }

    this.removeBlueprint(blueprintId);
    console.log(`Cancelled blueprint ${blueprintId} with ${(refundFraction * 100)}% refund`);
    return true;
  }

  private distributeRefund(footprintTiles: HexCoord[], speciesId: SpeciesId, totalRefund: number): void {
    if (footprintTiles.length === 0) return;

    const refundPerTile = totalRefund / footprintTiles.length;
    
    for (const tileCoord of footprintTiles) {
      const tile = this.hexGrid.getTile({ q: tileCoord.q, r: tileCoord.r });
      if (tile) {
        tile.concentrations[speciesId] = (tile.concentrations[speciesId] || 0) + refundPerTile;
      }
    }
  }

  private removeBlueprint(blueprintId: string): void {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return;

    // Remove from tile occupation map
    const footprintTiles = CONSTRUCTION_RECIPES.getFootprintAt(
      blueprint.recipeId,
      blueprint.anchorCoord.q,
      blueprint.anchorCoord.r
    );

    for (const tile of footprintTiles) {
      const tileKey = `${tile.q},${tile.r}`;
      this.blueprintsByTile.delete(tileKey);
    }

    this.blueprints.delete(blueprintId);
  }

  // Accessors for UI and integration
  public getAllBlueprints(): Blueprint[] {
    return Array.from(this.blueprints.values());
  }

  public getBlueprint(id: string): Blueprint | undefined {
    return this.blueprints.get(id);
  }

  public getBlueprintAtTile(q: number, r: number): Blueprint | undefined {
    const tileKey = `${q},${r}`;
    return this.blueprintsByTile.get(tileKey);
  }

  public getFootprintTiles(blueprintId: string): HexCoord[] {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return [];

    return CONSTRUCTION_RECIPES.getFootprintAt(
      blueprint.recipeId,
      blueprint.anchorCoord.q,
      blueprint.anchorCoord.r
    );
  }

  /**
   * Instantly complete a blueprint construction (for F key functionality)
   */
  public instantlyComplete(blueprintId: string): { success: boolean; error?: string } {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) {
      return { success: false, error: 'Blueprint not found' };
    }

    if (!blueprint.isActive) {
      return { success: false, error: 'Blueprint is not active' };
    }

    const recipe = CONSTRUCTION_RECIPES.getRecipe(blueprint.recipeId);
    if (!recipe) {
      return { success: false, error: 'Recipe not found' };
    }

    // Fill all requirements instantly
    for (const [speciesId, requiredAmount] of Object.entries(recipe.buildCost)) {
      blueprint.progress[speciesId as SpeciesId] = requiredAmount;
      blueprint.totalProgress += requiredAmount;
    }

    // Force completion check
    this.checkCompletion(blueprint, recipe);

    return { success: true };
  }
}
