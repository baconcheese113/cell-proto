/**
 * Membrane Exchange System - Milestone 6 Task 2
 * 
 * Manages constant-rate exchange for membrane tiles without external grid.
 * For now, assumes constant external availability for a few species.
 */

import type { HexGrid, HexCoord, HexTile } from "../hex/hex-grid";
import type { SpeciesId } from "../species/species-registry";
import { MEMBRANE_PROTEIN_REGISTRY, type MembraneProtein, type TransporterProtein, type ReceptorProtein } from "./membrane-protein-registry";
import { System } from "../systems/system";
import type { NetBus } from "../network/net-bus";

export interface MembraneTransporter {
  id: string;
  type: string; // e.g., "GLUT-test", "ROS-leak-test"
  speciesId: SpeciesId;
  fluxRate: number; // concentration change per second (can be negative for outflow)
  isActive: boolean;
}

// Milestone 6: Installed membrane protein tracking
export interface InstalledMembraneProtein {
  proteinId: string; // ID from membrane protein registry
  instanceId: string; // unique instance identifier
  isActive: boolean;
  // Milestone 8: Glycosylation status affects throughput
  glycosylationStatus?: 'complete' | 'partial'; // undefined = legacy (treated as complete)
  throughputMultiplier?: number; // cached multiplier based on glycosylation
}

export interface MembraneExchangeStats {
  totalImports: Partial<Record<SpeciesId, number>>; // species ID -> total imported
  totalExports: Partial<Record<SpeciesId, number>>; // species ID -> total exported
}

export class MembraneExchangeSystem extends System {
  private hexGrid: HexGrid;
  private membraneTransporters: Map<string, MembraneTransporter[]> = new Map(); // tile key -> transporters
  private stats: MembraneExchangeStats;
  
  // Milestone 6: Installed membrane proteins - using StateChannel for networking
  private proteinState = this.stateChannel<{ installed: Record<string, InstalledMembraneProtein> }>('proteins', { installed: {} });
  
  // External concentrations (constant for now)
  private externalConcentrations: Partial<Record<SpeciesId, number>> = {
    'GLUCOSE': 50.0,  // High external glucose availability
    'ROS': 2.0,       // Low but constant ROS leak from outside
    'H2O': 100.0,     // Water availability
    'CO2': 10.0       // Some CO2 in environment
  };

  // Milestone 6: External ligand presence (simplified)
  private externalLigands: Record<string, number> = {
    'LIGAND_GROWTH': 1.0 // Always present for now
  };

  constructor(scene: Phaser.Scene, netBus: NetBus, hexGrid: HexGrid) {
    super(scene, netBus, 'MembraneExchangeSystem', (deltaSeconds: number) => this.processExchange(deltaSeconds * 1000), { address: 'MembraneExchangeSystem' });
    
    this.hexGrid = hexGrid;
    this.stats = {
      totalImports: {},
      totalExports: {}
    };
    
    // Initialize stats for tracked species
    for (const speciesId of Object.keys(this.externalConcentrations) as SpeciesId[]) {
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

    // Process legacy transporters (existing system)
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

    // Process new membrane proteins (Milestone 6) - using StateChannel
    for (const [tileKey, installedProtein] of Object.entries(this.proteinState.installed)) {
      if (!installedProtein.isActive) continue;

      const [qStr, rStr] = tileKey.split(',');
      const coord = { q: parseInt(qStr), r: parseInt(rStr) };
      const tile = this.hexGrid.getTile(coord);
      
      if (!tile) continue;

      const protein = MEMBRANE_PROTEIN_REGISTRY.getProtein(installedProtein.proteinId);
      if (!protein) continue;

      if (protein.kind === 'transporter') {
        this.applyTransporterProtein(tile, protein, deltaSeconds, installedProtein);
      } else if (protein.kind === 'receptor') {
        this.applyReceptorProtein(tile, protein, deltaSeconds, installedProtein);
      }
    }
  }

  private applyTransporterFlux(tile: HexTile, transporter: MembraneTransporter, deltaSeconds: number): void {
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
   * Milestone 6: Apply transporter protein effect
   * Milestone 8: Include glycosylation-based throughput multiplier
   */
  private applyTransporterProtein(
    tile: HexTile, 
    protein: TransporterProtein, 
    deltaSeconds: number, 
    installedProtein: InstalledMembraneProtein
  ): void {
    const { speciesId, direction, ratePerTick } = protein;
    
    // Milestone 8: Apply throughput multiplier based on glycosylation
    const throughputMultiplier = installedProtein.throughputMultiplier ?? 1.0; // Default to 100% for legacy proteins
    const effectiveRate = ratePerTick * throughputMultiplier;
    const fluxAmount = effectiveRate * deltaSeconds;
    
    const currentConc = tile.concentrations[speciesId] || 0;
    let actualFlux = 0;

    if (direction === 'in') {
      // Influx: constant rate import from external environment
      actualFlux = fluxAmount;
      tile.concentrations[speciesId] = currentConc + actualFlux;
      this.stats.totalImports[speciesId] = (this.stats.totalImports[speciesId] || 0) + actualFlux;
    } else {
      // Efflux: pump species out, limited by available concentration
      const maxEfflux = Math.min(fluxAmount, currentConc);
      actualFlux = maxEfflux;
      tile.concentrations[speciesId] = Math.max(0, currentConc - actualFlux);
      this.stats.totalExports[speciesId] = (this.stats.totalExports[speciesId] || 0) + actualFlux;
    }

    // Debug output (much less frequent to reduce spam)
    if (Math.random() < 0.001) { // Very infrequent debug output
      const glycoStatus = installedProtein.glycosylationStatus || 'complete';
      console.log(`🚛 ${protein.label} (${glycoStatus}, ${Math.round(throughputMultiplier * 100)}%): ${direction === 'in' ? '+' : '-'}${actualFlux.toFixed(3)} ${speciesId}`);
      console.log(`   Rate: ${effectiveRate.toFixed(3)}/tick, Delta: ${deltaSeconds.toFixed(3)}s, Flux: ${fluxAmount.toFixed(3)}`);
    }
  }

  /**
   * Milestone 6: Apply receptor protein effect (Task 5)
   */
  private applyReceptorProtein(
    tile: HexTile, 
    protein: ReceptorProtein, 
    deltaSeconds: number, 
    installedProtein: InstalledMembraneProtein
  ): void {
    const { ligandId, messengerId, messengerRate } = protein;
    
    // Check if ligand is present in external environment
    const ligandPresence = this.externalLigands[ligandId] || 0;
    
    if (ligandPresence > 0) {
      // Milestone 8: Apply throughput multiplier for receptors too
      const throughputMultiplier = installedProtein.throughputMultiplier ?? 1.0;
      const effectiveRate = messengerRate * throughputMultiplier;
      
      // Produce signal proportional to ligand presence
      const signalProduction = effectiveRate * ligandPresence * deltaSeconds;
      const currentSignal = tile.concentrations[messengerId] || 0;
      
      tile.concentrations[messengerId] = currentSignal + signalProduction;
      
      // Debug output (throttled)
      if (Math.random() < 0.01) {
        const glycoStatus = installedProtein.glycosylationStatus || 'complete';
        console.log(`${protein.label} (${glycoStatus}, ${Math.round(throughputMultiplier * 100)}%): +${signalProduction.toFixed(3)} ${messengerId} (ligand: ${ligandPresence})`);
      }
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
   * Milestone 6: Install membrane protein (Task 7)
   * Note: This method is called server-side only. Networking is handled by the calling system.
   */
  public installMembraneProtein(coord: HexCoord, proteinId: string): boolean {
    return this.installMembraneProteinWithGlycosylation(coord, proteinId, 'complete');
  }

  /**
   * Milestone 8: Install membrane protein with glycosylation status (Story 8.5)
   * Note: This method is called server-side only. Networking is handled by the calling system.
   */
  public installMembraneProteinWithGlycosylation(
    coord: HexCoord, 
    proteinId: string, 
    glycosylationStatus: 'complete' | 'partial' = 'complete'
  ): boolean {
    if (!this.hexGrid.isMembraneCoord(coord)) {
      console.warn(`Cannot install protein at (${coord.q}, ${coord.r}): not a membrane tile`);
      return false;
    }

    const tileKey = `${coord.q},${coord.r}`;
    
    // Task 2: Check if tile already has a protein installed
    if (this.proteinState.installed[tileKey]) {
      console.warn(`Cannot install protein at (${coord.q}, ${coord.r}): membrane tile already occupied`);
      return false;
    }

    const protein = MEMBRANE_PROTEIN_REGISTRY.getProtein(proteinId);
    if (!protein) {
      console.warn(`Unknown protein ID: ${proteinId}`);
      return false;
    }

    // Calculate throughput multiplier based on glycosylation
    const throughputMultiplier = glycosylationStatus === 'complete' ? 1.0 : 0.5;

    const instanceId = `${proteinId}-${Date.now()}`;
    this.proteinState.installed[tileKey] = {
      proteinId,
      instanceId,
      isActive: true,
      glycosylationStatus,
      throughputMultiplier
    };

    console.log(`Installed ${protein.label} at (${coord.q}, ${coord.r}) with ${glycosylationStatus} glycosylation (${Math.round(throughputMultiplier * 100)}% throughput)`);
    return true;
  }

  /**
   * Milestone 6: Uninstall membrane protein (Task 7)
   */
  public uninstallMembraneProtein(coord: HexCoord): boolean {
    const tileKey = `${coord.q},${coord.r}`;
    const installed = this.proteinState.installed[tileKey];
    
    if (!installed) {
      console.warn(`No protein installed at (${coord.q}, ${coord.r})`);
      return false;
    }

    const protein = MEMBRANE_PROTEIN_REGISTRY.getProtein(installed.proteinId);
    delete this.proteinState.installed[tileKey];
    
    console.log(`Uninstalled ${protein?.label || 'unknown protein'} from (${coord.q}, ${coord.r})`);
    return true;
  }

  /**
   * Get installed protein at coordinate
   */
  public getInstalledProtein(coord: HexCoord): MembraneProtein | null {
    const tileKey = `${coord.q},${coord.r}`;
    const installed = this.proteinState.installed[tileKey];
    
    if (!installed) return null;
    
    const protein = MEMBRANE_PROTEIN_REGISTRY.getProtein(installed.proteinId);
    return protein || null;
  }

  /**
   * Check if membrane tile has protein installed
   */
  public hasInstalledProtein(coord: HexCoord): boolean {
    const tileKey = `${coord.q},${coord.r}`;
    return !!this.proteinState.installed[tileKey];
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
