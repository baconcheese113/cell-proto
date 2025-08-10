/**
 * Diffusion System - Milestone 2 Task 3
 * 
 * Handles species diffusion between neighboring hex tiles using a stable
 * two-buffer approach to avoid order bias.
 */

import { HexGrid } from "../hex/hex-grid";
import type { HexCoord } from "../hex/hex-grid";
import { getSpecies, getAllSpeciesIds } from "../species/species-registry";

export class DiffusionSystem {
  private hexGrid: HexGrid;
  private bufferA: Map<string, Record<string, number>> = new Map();
  private bufferB: Map<string, Record<string, number>> = new Map();
  private currentBuffer: Map<string, Record<string, number>>;
  private nextBuffer: Map<string, Record<string, number>>;

  constructor(hexGrid: HexGrid) {
    this.hexGrid = hexGrid;
    this.currentBuffer = this.bufferA;
    this.nextBuffer = this.bufferB;
    this.initializeBuffers();
  }

  /**
   * Initialize both buffers with current grid state
   */
  private initializeBuffers(): void {
    const allTiles = this.hexGrid.getAllTiles();
    
    this.bufferA.clear();
    this.bufferB.clear();
    
    for (const tile of allTiles) {
      const key = this.coordToKey(tile.coord);
      this.bufferA.set(key, { ...tile.concentrations });
      this.bufferB.set(key, { ...tile.concentrations });
    }
  }

  /**
   * Perform one diffusion step across all tiles and species
   */
  public step(): void {
    // Copy current grid state to read buffer
    this.copyGridToBuffer(this.currentBuffer);
    
    // Clear the write buffer
    this.clearBuffer(this.nextBuffer);
    
    // Perform diffusion for each tile
    const allTiles = this.hexGrid.getAllTiles();
    
    for (const tile of allTiles) {
      this.diffuseTile(tile.coord);
    }
    
    // Apply results back to grid
    this.copyBufferToGrid(this.nextBuffer);
    
    // Swap buffers for next iteration
    [this.currentBuffer, this.nextBuffer] = [this.nextBuffer, this.currentBuffer];
  }

  /**
   * Diffuse species for a single tile
   */
  private diffuseTile(coord: HexCoord): void {
    const tile = this.hexGrid.getTile(coord);
    if (!tile) return;
    
    const tileKey = this.coordToKey(coord);
    const neighbors = this.hexGrid.getNeighbors(coord);
    const currentConcentrations = this.currentBuffer.get(tileKey);
    const nextConcentrations = this.nextBuffer.get(tileKey);
    
    if (!currentConcentrations || !nextConcentrations) return;
    
    // Start with current concentrations
    for (const speciesId of getAllSpeciesIds()) {
      nextConcentrations[speciesId] = currentConcentrations[speciesId];
    }
    
    // Apply diffusion for each species
    for (const speciesId of getAllSpeciesIds()) {
      const species = getSpecies(speciesId);
      if (!species) continue;
      
      const diffusionRate = species.diffusionCoefficient;
      const currentConcentration = currentConcentrations[speciesId];
      
      if (neighbors.length === 0) continue;
      
      let netFlux = 0;
      
      // Calculate net flux with all neighbors
      for (const neighbor of neighbors) {
        const neighborKey = this.coordToKey(neighbor.coord);
        const neighborConcentrations = this.currentBuffer.get(neighborKey);
        if (!neighborConcentrations) continue;
        
        const neighborConcentration = neighborConcentrations[speciesId];
        const concentrationDiff = neighborConcentration - currentConcentration; // Note: neighbor - current
        
        // Flux flows from high to low concentration
        // Positive flux means flow INTO this tile, negative means flow OUT
        const flux = concentrationDiff * diffusionRate / neighbors.length;
        netFlux += flux;
      }
      
      // Apply net flux to tile
      const newConcentration = currentConcentration + netFlux;
      nextConcentrations[speciesId] = Math.max(0, newConcentration);
      
      // Apply species constraints
      if (species.maxConcentration !== undefined) {
        nextConcentrations[speciesId] = Math.min(species.maxConcentration, nextConcentrations[speciesId]);
      }
      if (species.minConcentration !== undefined) {
        nextConcentrations[speciesId] = Math.max(species.minConcentration, nextConcentrations[speciesId]);
      }
    }
  }

  /**
   * Copy current grid concentrations to buffer
   */
  private copyGridToBuffer(buffer: Map<string, Record<string, number>>): void {
    const allTiles = this.hexGrid.getAllTiles();
    
    for (const tile of allTiles) {
      const key = this.coordToKey(tile.coord);
      const bufferEntry = buffer.get(key);
      if (bufferEntry) {
        for (const speciesId in tile.concentrations) {
          bufferEntry[speciesId] = tile.concentrations[speciesId];
        }
      }
    }
  }

  /**
   * Copy buffer concentrations back to grid
   */
  private copyBufferToGrid(buffer: Map<string, Record<string, number>>): void {
    const allTiles = this.hexGrid.getAllTiles();
    
    for (const tile of allTiles) {
      const key = this.coordToKey(tile.coord);
      const bufferEntry = buffer.get(key);
      if (bufferEntry) {
        for (const speciesId in tile.concentrations) {
          tile.concentrations[speciesId] = bufferEntry[speciesId];
        }
      }
    }
  }

  /**
   * Clear all concentrations in buffer
   */
  private clearBuffer(buffer: Map<string, Record<string, number>>): void {
    for (const concentrations of buffer.values()) {
      for (const speciesId in concentrations) {
        concentrations[speciesId] = 0;
      }
    }
  }

  /**
   * Reinitialize buffers (call when grid changes)
   */
  public reinitialize(): void {
    this.initializeBuffers();
  }

  /**
   * Helper to convert coordinate to string key
   */
  private coordToKey(coord: HexCoord): string {
    return `${coord.q},${coord.r}`;
  }
}
