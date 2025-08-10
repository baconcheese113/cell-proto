/**
 * Membrane Exchange System - Milestone 6 Task 2
 * 
 * Manages constant-rate exchange for membrane tiles without external grid.
 * For now, assumes constant external availability for a few species.
 */

import type { HexGrid, HexCoord } from "../hex/hex-grid";

export interface MembraneTransporter {
  id: string;
  type: string; // e.g., "GLUT-test", "ROS-leak-test"
  speciesId: string;
  fluxRate: number; // concentration change per second (can be negative for outflow)
  isActive: boolean;
}

export interface MembraneExchangeStats {
  totalImports: Record<string, number>; // species ID -> total imported
  totalExports: Record<string, number>; // species ID -> total exported
}

export class MembraneExchangeSystem {
  private hexGrid: HexGrid;
  private membraneTransporters: Map<string, MembraneTransporter[]> = new Map(); // tile key -> transporters
  private stats: MembraneExchangeStats;
  
  // External concentrations (constant for now)
  private externalConcentrations: Record<string, number> = {
    'GLUCOSE': 50.0,  // High external glucose availability
    'ROS': 2.0,       // Low but constant ROS leak from outside
    'H2O': 100.0,     // Water availability
    'CO2': 10.0       // Some CO2 in environment
  };

  constructor(hexGrid: HexGrid) {
    this.hexGrid = hexGrid;
    this.stats = {
      totalImports: {},
      totalExports: {}
    };
    
    // Initialize stats for tracked species
    for (const speciesId of Object.keys(this.externalConcentrations)) {
      this.stats.totalImports[speciesId] = 0;
      this.stats.totalExports[speciesId] = 0;
    }
  }

  /**
   * Install a transporter on a membrane tile
   */
  public installTransporter(coord: HexCoord, transporter: MembraneTransporter): boolean {
    if (!this.hexGrid.isMembraneCoord(coord)) {
      console.warn(`Cannot install transporter at (${coord.q}, ${coord.r}): not a membrane tile`);
      return false;
    }

    const tileKey = `${coord.q},${coord.r}`;
    const existingTransporters = this.membraneTransporters.get(tileKey) || [];
    
    // For now, allow only one transporter per tile (Task 3 requirement)
    if (existingTransporters.length > 0) {
      console.warn(`Cannot install transporter at (${coord.q}, ${coord.r}): tile already has a transporter`);
      return false;
    }

    existingTransporters.push(transporter);
    this.membraneTransporters.set(tileKey, existingTransporters);
    
    console.log(`Installed ${transporter.type} transporter at (${coord.q}, ${coord.r})`);
    return true;
  }

  /**
   * Remove a transporter from a membrane tile
   */
  public removeTransporter(coord: HexCoord, transporterId: string): boolean {
    const tileKey = `${coord.q},${coord.r}`;
    const transporters = this.membraneTransporters.get(tileKey);
    
    if (!transporters) return false;

    const index = transporters.findIndex(t => t.id === transporterId);
    if (index === -1) return false;

    const removed = transporters.splice(index, 1)[0];
    
    if (transporters.length === 0) {
      this.membraneTransporters.delete(tileKey);
    }

    console.log(`Removed ${removed.type} transporter from (${coord.q}, ${coord.r})`);
    return true;
  }

  /**
   * Get transporters installed on a specific tile
   */
  public getTransportersAt(coord: HexCoord): MembraneTransporter[] {
    const tileKey = `${coord.q},${coord.r}`;
    return [...(this.membraneTransporters.get(tileKey) || [])];
  }

  /**
   * Task 4: Apply membrane exchange for all tiles
   * Run after organelles but before diffusion
   */
  public processExchange(deltaTime: number): void {
    const deltaSeconds = deltaTime / 1000;

    for (const [tileKey, transporters] of this.membraneTransporters) {
      const [qStr, rStr] = tileKey.split(',');
      const coord = { q: parseInt(qStr), r: parseInt(rStr) };
      const tile = this.hexGrid.getTile(coord);
      
      if (!tile) continue;

      for (const transporter of transporters) {
        if (!transporter.isActive) continue;

        this.applyTransporterFlux(tile, transporter, deltaSeconds);
      }
    }
  }

  private applyTransporterFlux(tile: any, transporter: MembraneTransporter, deltaSeconds: number): void {
    const { speciesId, fluxRate } = transporter;
    const fluxAmount = fluxRate * deltaSeconds;
    
    const currentConc = tile.concentrations[speciesId] || 0;

    let actualFlux = 0;

    if (fluxRate > 0) {
      // Influx: bring external species in
      // Simple model: flux is constant regardless of concentration gradient
      actualFlux = fluxAmount;
      tile.concentrations[speciesId] = currentConc + actualFlux;
      
      this.stats.totalImports[speciesId] = (this.stats.totalImports[speciesId] || 0) + actualFlux;
    } else {
      // Efflux: pump species out
      const maxEfflux = Math.min(-fluxAmount, currentConc); // Can't pump more than what's available
      actualFlux = -maxEfflux;
      tile.concentrations[speciesId] = Math.max(0, currentConc + actualFlux);
      
      this.stats.totalExports[speciesId] = (this.stats.totalExports[speciesId] || 0) + maxEfflux;
    }

    // Debug output (throttled)
    if (Math.random() < 0.001) {
      console.log(`${transporter.type}: ${actualFlux > 0 ? '+' : ''}${actualFlux.toFixed(3)} ${speciesId} (${currentConc.toFixed(1)} -> ${tile.concentrations[speciesId].toFixed(1)})`);
    }
  }

  /**
   * Get exchange statistics
   */
  public getStats(): MembraneExchangeStats {
    return {
      totalImports: { ...this.stats.totalImports },
      totalExports: { ...this.stats.totalExports }
    };
  }

  /**
   * Check if a tile has any transporters
   */
  public hasTransporters(coord: HexCoord): boolean {
    const tileKey = `${coord.q},${coord.r}`;
    const transporters = this.membraneTransporters.get(tileKey);
    return transporters !== undefined && transporters.length > 0;
  }

  /**
   * Get all tiles that have transporters
   */
  public getActiveTransporterTiles(): HexCoord[] {
    return Array.from(this.membraneTransporters.keys()).map(key => {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    });
  }

  /**
   * Clear all transporters (useful for debugging)
   */
  public clearAllTransporters(): void {
    this.membraneTransporters.clear();
    console.log("All membrane transporters cleared");
  }

  // Milestone 6 Task 8: Future-proofing hooks

  /**
   * Future hook: Install transporter via secretory pathway (ER → Golgi → membrane)
   * In future milestones, transporters will be created by ER/Golgi, then installed
   */
  public installFromSecretoryPathway(coord: HexCoord, _transporterData: any): boolean {
    // TODO: In Milestone 7-8, this will:
    // 1. Validate that transporter came from proper secretory pathway
    // 2. Handle protein orientation during membrane insertion
    // 3. Track transporter lifecycle and trafficking
    console.log(`Future: Secretory installation of transporter at (${coord.q}, ${coord.r})`);
    return false; // Not implemented yet
  }

  /**
   * Future hook: Exchange rates derived from external patches
   * Later, replace constant rates with rates derived from nearby outside "patches"
   */
  public updateExchangeRatesFromExternalPatches(_externalPatchData: any): void {
    // TODO: In future milestones, this will:
    // 1. Sample nearby external environment patches
    // 2. Calculate concentration gradients
    // 3. Update flux rates based on thermodynamic driving forces
    console.log(`Future: External patch-based exchange rate update`);
  }

  /**
   * Future hook: One transporter slot per membrane tile constraint
   * Currently enforced simply, but will become more sophisticated
   */
  public getAvailableMembraneSlots(coord: HexCoord): number {
    // TODO: Future membrane tiles may have multiple slots for different protein types
    const hasTransporter = this.hasTransporters(coord);
    return hasTransporter ? 0 : 1; // Simple implementation for now
  }
}
