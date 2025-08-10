/**
 * Organelle System - Milestone 3 Task 1
 * 
 * Manages placement and basic properties of cellular organelles that act as
 * localized sources and sinks for species.
 */

import type { HexCoord } from "../hex/hex-grid";
import { HexGrid } from "../hex/hex-grid";
import { ORGANELLE_FOOTPRINTS, getFootprintTiles, type OrganelleFootprint } from "./organelle-footprints";
import { getOrganelleIOProfile, type OrganelleIOProfile } from "./organelle-io-profiles";

export interface OrganelleConfig {
  // Basic properties
  id: string;
  type: string;
  label: string;
  
  // Visual properties
  color: number;
  size: number;
  
  // Multi-hex properties
  footprint: OrganelleFootprint;
  
  // Functional properties (will be expanded in later tasks)
  throughputCap: number;
  priority: number;
}

export interface Organelle {
  id: string;
  type: string;
  coord: HexCoord;  // Primary/center coordinate
  config: OrganelleConfig;
  
  // Runtime state (for later tasks)
  currentThroughput: number;
  isActive: boolean;
}

export class OrganelleSystem {
  private hexGrid: HexGrid;
  private organelles: Map<string, Organelle> = new Map();
  private organellesByTile: Map<string, Organelle> = new Map();
  
  // Processing state
  private processingThisTick: Map<string, number> = new Map(); // organelle ID -> units processed
  private tileChanges: Map<string, Map<string, number>> = new Map(); // tile key -> species changes

  constructor(hexGrid: HexGrid) {
    this.hexGrid = hexGrid;
    this.initializeStarterOrganelles();
  }

  /**
   * Initialize the starter set of organelles at fixed positions
   */
  private initializeStarterOrganelles(): void {
    // Nucleus - central command, near center (large multi-hex footprint)
    this.addOrganelle({
      id: 'nucleus-1',
      type: 'nucleus',
      coord: { q: -2, r: 1 }, // Slightly off-center
      config: {
        id: 'nucleus',
        type: 'nucleus',
        label: 'Nucleus',
        color: 0x3779c2,
        size: 1.2,
        footprint: ORGANELLE_FOOTPRINTS['NUCLEUS_LARGE_DISK'],
        throughputCap: 5,
        priority: 1 // Highest priority
      }
    });

    // Free-ribosome hub - protein synthesis (small cluster)
    this.addOrganelle({
      id: 'ribosome-hub-1',
      type: 'ribosome-hub',
      coord: { q: 2, r: -1 }, // Right side
      config: {
        id: 'ribosome-hub',
        type: 'ribosome-hub',
        label: 'Ribosome Hub',
        color: 0x39b3a6,
        size: 1.0,
        footprint: ORGANELLE_FOOTPRINTS['RIBOSOME_HUB_SMALL'],
        throughputCap: 3,
        priority: 2
      }
    });

    // Proto-ER patch - cargo processing (elongated blob)
    this.addOrganelle({
      id: 'proto-er-1',
      type: 'proto-er',
      coord: { q: -1, r: 3 }, // Lower left
      config: {
        id: 'proto-er',
        type: 'proto-er',
        label: 'Proto-ER',
        color: 0xd07de0,
        size: 0.8,
        footprint: ORGANELLE_FOOTPRINTS['PROTO_ER_BLOB'],
        throughputCap: 2,
        priority: 3 // Lowest priority
      }
    });

    console.log(`Organelle system initialized with ${this.organelles.size} starter organelles`);
    this.logOrganellePlacements();
    
    // Add some initial test species near organelles for demonstration
    this.addTestSpecies();
  }

  /**
   * Add test species near organelles for demonstration
   */
  private addTestSpecies(): void {
    console.log('Adding test species near organelles...');
    
    // Add nucleotides near nucleus for transcription
    const nucleusCoord = { q: -2, r: 1 };
    this.hexGrid.addConcentration(nucleusCoord, 'NT', 50);
    this.hexGrid.addConcentration({ q: -3, r: 1 }, 'NT', 30);
    this.hexGrid.addConcentration({ q: -2, r: 2 }, 'NT', 30);
    
    // Add amino acids near ribosome hub for translation
    const ribosomeCoord = { q: 2, r: -1 };
    this.hexGrid.addConcentration(ribosomeCoord, 'AA', 40);
    this.hexGrid.addConcentration({ q: 3, r: -1 }, 'AA', 25);
    this.hexGrid.addConcentration({ q: 2, r: 0 }, 'AA', 25);
    
    console.log('Test species added successfully');
  }

  /**
   * Add an organelle to the system
   */
  private addOrganelle(organelleData: Omit<Organelle, 'currentThroughput' | 'isActive'>): void {
    const organelle: Organelle = {
      ...organelleData,
      currentThroughput: 0,
      isActive: true
    };

    // Get all tiles this organelle will occupy
    const footprintTiles = getFootprintTiles(
      organelle.config.footprint, 
      organelle.coord.q, 
      organelle.coord.r
    );

    // Check if all tiles exist in grid and are unoccupied
    for (const tileCoord of footprintTiles) {
      const tile = this.hexGrid.getTile(tileCoord);
      if (!tile) {
        console.warn(`Cannot place organelle ${organelle.id}: invalid coordinate (${tileCoord.q}, ${tileCoord.r})`);
        return;
      }
      
      const existingOrganelle = this.organellesByTile.get(this.coordToKey(tileCoord));
      if (existingOrganelle) {
        console.warn(`Cannot place organelle ${organelle.id}: tile (${tileCoord.q}, ${tileCoord.r}) already occupied by ${existingOrganelle.id}`);
        return;
      }
    }

    // Place organelle on all tiles in its footprint
    this.organelles.set(organelle.id, organelle);
    for (const tileCoord of footprintTiles) {
      this.organellesByTile.set(this.coordToKey(tileCoord), organelle);
    }
    
    console.log(`Placed ${organelle.config.label} at (${organelle.coord.q}, ${organelle.coord.r}) with ${footprintTiles.length} tiles`);
  }

  /**
   * Get organelle at specific tile coordinate
   */
  public getOrganelleAtTile(coord: HexCoord): Organelle | undefined {
    return this.organellesByTile.get(this.coordToKey(coord));
  }

  /**
   * Get organelle by ID
   */
  public getOrganelle(id: string): Organelle | undefined {
    return this.organelles.get(id);
  }

  /**
   * Get all organelles
   */
  public getAllOrganelles(): Organelle[] {
    return Array.from(this.organelles.values());
  }

  /**
   * Get organelles by type
   */
  public getOrganellesByType(type: string): Organelle[] {
    return Array.from(this.organelles.values()).filter(org => org.type === type);
  }

  /**
   * Check if a tile has an organelle
   */
  public hasTileOrganelle(coord: HexCoord): boolean {
    return this.organellesByTile.has(this.coordToKey(coord));
  }

  /**
   * Update organelle processing for one simulation tick
   * Called before diffusion, after passive effects
   */
  public update(_dt: number): void {
    // Reset processing state for this tick
    this.processingThisTick.clear();
    this.tileChanges.clear();

    // Get all organelles sorted by priority (lower number = higher priority)
    const organellesByPriority = Array.from(this.organelles.values())
      .filter(org => org.isActive)
      .sort((a, b) => a.config.priority - b.config.priority);

    // Process each organelle in priority order
    for (const organelle of organellesByPriority) {
      this.processOrganelle(organelle);
    }

    // Apply all accumulated changes to the hex grid
    this.applyTileChanges();
  }

  /**
   * Process a single organelle this tick
   */
  private processOrganelle(organelle: Organelle): void {
    const ioProfile = getOrganelleIOProfile(organelle.type);
    if (!ioProfile) return; // No I/O profile defined

    const footprintTiles = getFootprintTiles(
      organelle.config.footprint,
      organelle.coord.q,
      organelle.coord.r
    );

    let processedSoFar = this.processingThisTick.get(organelle.id) || 0;
    
    // Process each tile in the footprint
    for (const tileCoord of footprintTiles) {
      if (processedSoFar >= ioProfile.capPerTick) break; // Hit cap

      const tile = this.hexGrid.getTile(tileCoord);
      if (!tile) continue;

      // Calculate how many units we can process on this tile
      const capLeft = ioProfile.capPerTick - processedSoFar;
      const unitsToProcess = this.calculateProcessableUnits(tile, ioProfile, capLeft);

      if (unitsToProcess <= 0) continue;

      // Apply consumption and production
      this.applyIOToTile(tileCoord, ioProfile, unitsToProcess, organelle);
      
      processedSoFar += unitsToProcess;
      this.processingThisTick.set(organelle.id, processedSoFar);
    }

    // Update organelle throughput for display
    organelle.currentThroughput = processedSoFar;
  }

  /**
   * Calculate how many processing units can be handled on this tile
   */
  private calculateProcessableUnits(tile: any, ioProfile: OrganelleIOProfile, capLeft: number): number {
    if (capLeft <= 0) return 0;

    let maxUnits = capLeft;

    // Check input limitations
    for (const input of ioProfile.inputs) {
      const available = tile.concentrations[input.id] || 0;
      const maxFromThisInput = available / input.rate;
      maxUnits = Math.min(maxUnits, maxFromThisInput);
    }

    return Math.max(0, maxUnits);
  }

  /**
   * Apply consumption and production to a tile
   */
  private applyIOToTile(tileCoord: HexCoord, ioProfile: OrganelleIOProfile, units: number, organelle: Organelle): void {
    const tileKey = this.coordToKey(tileCoord);
    
    // Ensure we have a change map for this tile
    if (!this.tileChanges.has(tileKey)) {
      this.tileChanges.set(tileKey, new Map());
    }
    const changes = this.tileChanges.get(tileKey)!;

    // Apply consumption (negative changes)
    for (const input of ioProfile.inputs) {
      const consumption = units * input.rate;
      const current = changes.get(input.id) || 0;
      changes.set(input.id, current - consumption);
    }

    // Apply production (positive changes)
    for (const output of ioProfile.outputs) {
      const production = units * output.rate;
      const current = changes.get(output.id) || 0;
      changes.set(output.id, current + production);
    }

    // Debug logging for limiting factors
    if (units < ioProfile.capPerTick) {
      for (const input of ioProfile.inputs) {
        const tile = this.hexGrid.getTile(tileCoord);
        if (tile) {
          const available = tile.concentrations[input.id] || 0;
          const needed = units * input.rate;
          if (available < needed + 0.001) { // Small epsilon for floating point
            console.log(`${organelle.config.label} limited by ${input.id} on tile (${tileCoord.q},${tileCoord.r})`);
          }
        }
      }
    }
  }

  /**
   * Apply all accumulated tile changes to the hex grid
   */
  private applyTileChanges(): void {
    for (const [tileKey, changes] of this.tileChanges) {
      const [q, r] = tileKey.split(',').map(Number);
      const tile = this.hexGrid.getTile({ q, r });
      if (!tile) continue;

      for (const [speciesId, delta] of changes) {
        const current = tile.concentrations[speciesId] || 0;
        const newValue = Math.max(0, current + delta); // Clamp to 0 minimum
        tile.concentrations[speciesId] = newValue;
      }
    }
  }

  /**
   * Log organelle placements for debugging
   */
  private logOrganellePlacements(): void {
    console.log('=== ORGANELLE PLACEMENTS ===');
    for (const organelle of this.organelles.values()) {
      console.log(`${organelle.config.label}: (${organelle.coord.q}, ${organelle.coord.r}) - Cap: ${organelle.config.throughputCap}, Priority: ${organelle.config.priority}`);
    }
  }

  /**
   * Get organelle info for debugging
   */
  public getOrganelleInfo(coord: HexCoord): string[] {
    const organelle = this.getOrganelleAtTile(coord);
    if (!organelle) return [];

    const ioProfile = getOrganelleIOProfile(organelle.type);
    const info = [
      `=== ${organelle.config.label.toUpperCase()} ===`,
      `Type: ${organelle.type}`,
      `Status: ${organelle.isActive ? 'Active' : 'Inactive'}`
    ];

    if (ioProfile) {
      const throughputPct = ((organelle.currentThroughput / ioProfile.capPerTick) * 100).toFixed(1);
      info.push(`Throughput: ${organelle.currentThroughput.toFixed(2)}/${ioProfile.capPerTick} (${throughputPct}%)`);
      info.push(`Priority: ${ioProfile.priority}`);
      
      // Show current processing state
      if (organelle.currentThroughput > 0) {
        info.push("=== CURRENT PROCESSING ===");
        for (const input of ioProfile.inputs) {
          const consumed = organelle.currentThroughput * input.rate;
          info.push(`Consuming ${input.id}: ${consumed.toFixed(3)}/tick`);
        }
        for (const output of ioProfile.outputs) {
          const produced = organelle.currentThroughput * output.rate;
          info.push(`Producing ${output.id}: ${produced.toFixed(3)}/tick`);
        }
      } else {
        info.push("=== NOT PROCESSING ===");
        info.push("Check input availability");
      }
      
      info.push("=== I/O RATES ===");
      if (ioProfile.inputs.length > 0) {
        info.push("Inputs (per unit):");
        for (const input of ioProfile.inputs) {
          info.push(`  ${input.id}: ${input.rate}`);
        }
      }
      
      if (ioProfile.outputs.length > 0) {
        info.push("Outputs (per unit):");
        for (const output of ioProfile.outputs) {
          info.push(`  ${output.id}: ${output.rate}`);
        }
      }
      
      // Show local concentrations on this tile
      const tile = this.hexGrid.getTile(coord);
      if (tile) {
        info.push("=== LOCAL CONCENTRATIONS ===");
        for (const input of ioProfile.inputs) {
          const amount = tile.concentrations[input.id] || 0;
          info.push(`${input.id}: ${amount.toFixed(2)}`);
        }
        for (const output of ioProfile.outputs) {
          const amount = tile.concentrations[output.id] || 0;
          info.push(`${output.id}: ${amount.toFixed(2)}`);
        }
      }
    } else {
      info.push("No I/O profile defined");
    }

    return info;
  }

  /**
   * Convert coordinate to string key
   */
  private coordToKey(coord: HexCoord): string {
    return `${coord.q},${coord.r}`;
  }
}
