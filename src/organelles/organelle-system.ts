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
import { getStarterOrganelleDefinitions, definitionToConfig, type OrganelleType } from "./organelle-registry";
import type { SpeciesId } from "../species/species-registry";

export interface OrganelleConfig {
  // Basic properties
  id: string;
  type: OrganelleType;
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

// Simple seat info for vesicle capacity tracking
interface SeatInfo {
  vesicleId: string;
  reservedAt: number;
  expectedArrival?: number;
  position: HexCoord; // Specific hex coordinate within organelle footprint
}

export interface Organelle {
  id: string;
  type: OrganelleType;
  coord: HexCoord;  // Primary/center coordinate
  config: OrganelleConfig;
  
  // Runtime state (for later tasks)
  currentThroughput: number;
  isActive: boolean;
  
  // Milestone 13: Seat-based capacity management
  seats: Map<string, SeatInfo>; // seatId -> seat info
  capacity: number; // Max concurrent vesicles (defaults to 1)
}

export class OrganelleSystem {
  private hexGrid: HexGrid;
  private organelles: Map<string, Organelle> = new Map();
  private organellesByTile: Map<string, Organelle> = new Map();
  
  // Processing state
  private processingThisTick: Map<string, number> = new Map(); // organelle ID -> units processed
  
  // UI info caching to prevent rapid flickering
  private infoCache: Map<string, { info: string[], lastUpdate: number }> = new Map();
  private readonly INFO_CACHE_DURATION = 250; // Cache for 250ms (4 updates per second max)
  // Task 8: Batch tile changes to avoid intermediate state inconsistency
  private tileChanges: Map<string, Map<SpeciesId, number>> = new Map(); // tile key -> species changes
  
  // Milestone 13: Seat reservation events
  private seatEventListeners: Set<(event: 'seatReserved' | 'seatReleased', organelleId: string, seatId: string) => void> = new Set();

  constructor(hexGrid: HexGrid) {
    this.hexGrid = hexGrid;
    this.initializeStarterOrganelles();
  }

  /**
   * Initialize the starter set of organelles at fixed positions
   */
  private initializeStarterOrganelles(): void {
    // Use centralized organelle registry for starter organelles
    const starterDefinitions = getStarterOrganelleDefinitions();
    
    for (const definition of starterDefinitions) {
      if (definition.starterPlacement) {
        const config = definitionToConfig(definition, definition.starterPlacement.instanceId);
        // Convert footprint string to actual footprint object for addOrganelle
        const fullConfig = {
          ...config,
          footprint: ORGANELLE_FOOTPRINTS[definition.footprint]
        };
        
        this.addOrganelle({
          id: definition.starterPlacement.instanceId,
          type: definition.type,
          coord: definition.starterPlacement.coord,
          config: fullConfig,
          seats: new Map(),
          capacity: ORGANELLE_FOOTPRINTS[definition.footprint].tiles.length // Use footprint size as capacity
        });
      }
    }

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
    
    // Clear info cache for this organelle since it's new
    this.clearInfoCache(organelle.coord);
    
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
   * Get set of all occupied tile keys (for blueprint placement validation)
   */
  public getOccupiedTiles(): Set<string> {
    return new Set(this.organellesByTile.keys());
  }

  /**
   * Create and place a new organelle dynamically (for blueprint completion)
   */
  public createOrganelle(config: Omit<OrganelleConfig, 'footprint'> & { footprint: string }, coord: HexCoord): boolean {
    console.log(`🏭 OrganelleSystem.createOrganelle called: type="${config.type}", coord=(${coord.q}, ${coord.r}), footprint="${config.footprint}"`);
    
    // Convert footprint string to actual footprint object
    const footprint = (ORGANELLE_FOOTPRINTS as any)[config.footprint];
    if (!footprint) {
      console.warn(`Unknown footprint type: ${config.footprint}`);
      return false;
    }

    const fullConfig: OrganelleConfig = {
      ...config,
      footprint
    };

    const organelleData = {
      id: config.id,
      type: config.type,
      coord,
      config: fullConfig,
      seats: new Map(),
      capacity: footprint.tiles.length // Use footprint size as capacity
    };

    console.log(`🔧 About to call addOrganelle with:`, organelleData);
    this.addOrganelle(organelleData);
    
    // Verify the organelle was actually added
    const verifyOrganelle = this.getOrganelleAtTile(coord);
    console.log(`🔍 Verification - organelle at (${coord.q}, ${coord.r}):`, verifyOrganelle ? verifyOrganelle.config.label : 'NOT FOUND');
    
    return true;
  }

  /**
   * Get organelles by type
   */
  public getOrganellesByType(type: OrganelleType): Organelle[] {
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
  private applyIOToTile(tileCoord: HexCoord, ioProfile: OrganelleIOProfile, units: number, _organelle: Organelle): void {
    const tileKey = this.coordToKey(tileCoord);
    
    // Ensure we have a change map for this tile
    if (!this.tileChanges.has(tileKey)) {
      this.tileChanges.set(tileKey, new Map<SpeciesId, number>());
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

    // Milestone 6: Apply signal-driven bonus production
    if (ioProfile.signalBonus) {
      const tile = this.hexGrid.getTile(tileCoord);
      if (tile) {
        const signalLevel = tile.concentrations[ioProfile.signalBonus.signalSpecies] || 0;
        const bonusMultiplier = Math.min(
          signalLevel * ioProfile.signalBonus.coefficient,
          ioProfile.signalBonus.maxBonus
        );
        
        if (bonusMultiplier > 0) {
          for (const bonusOutput of ioProfile.signalBonus.bonusOutputs) {
            const bonusProduction = units * bonusOutput.rate * bonusMultiplier;
            const current = changes.get(bonusOutput.id) || 0;
            changes.set(bonusOutput.id, current + bonusProduction);
          }
        }
      }
    }

    // Debug logging for limiting factors
    if (units < ioProfile.capPerTick) {
      for (const input of ioProfile.inputs) {
        const tile = this.hexGrid.getTile(tileCoord);
        if (tile) {
          const available = tile.concentrations[input.id] || 0;
          const needed = units * input.rate;
          if (available < needed + 0.001) { // Small epsilon for floating point
            // console.log(`${organelle.config.label} limited by ${input.id} on tile (${tileCoord.q},${tileCoord.r})`);
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
   * Get organelle info for debugging (with caching to prevent UI flickering)
   */
  public getOrganelleInfo(coord: HexCoord): string[] {
    const coordKey = this.coordToKey(coord);
    const now = Date.now();
    
    // Check if we have a recent cached version
    const cached = this.infoCache.get(coordKey);
    if (cached && (now - cached.lastUpdate) < this.INFO_CACHE_DURATION) {
      return cached.info;
    }
    
    // Generate fresh info
    const organelle = this.getOrganelleAtTile(coord);
    if (!organelle) {
      this.infoCache.delete(coordKey); // Clear cache if no organelle
      return [];
    }

    const ioProfile = getOrganelleIOProfile(organelle.type);
    const info = [
      `=== ${organelle.config.label.toUpperCase()} ===`,
      `Type: ${organelle.type}`,
      `Status: ${organelle.isActive ? 'Active' : 'Inactive'}`
    ];

    // Milestone 13: Add seat usage and queue information
    const seatInfo = this.getSeatInfo(organelle.id);
    if (seatInfo) {
      info.push(`Seats: ${seatInfo.occupied}/${seatInfo.capacity}`);
      
      // Check for queued cargo at rim (simplified check)
      // Note: Full queue implementation would require checking rail system
      const hasQueuedCargo = this.hasQueuedCargoAtRim(organelle);
      if (hasQueuedCargo > 0) {
        info.push(`Queue at rim: ${hasQueuedCargo}`);
      }
    }

    if (ioProfile) {
      const throughputPct = ((organelle.currentThroughput / ioProfile.capPerTick) * 100).toFixed(1);
      info.push(`Throughput: ${organelle.currentThroughput.toFixed(2)}/${ioProfile.capPerTick} (${throughputPct}%)`);
      info.push(`Priority: ${ioProfile.priority}`);
      
      // Show current processing state
      if (organelle.currentThroughput > 0) {
        info.push("=== PROCESSING SPEED ===");
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
      
      // Show local concentrations on this tile (rounded to reduce flicker)
      const tile = this.hexGrid.getTile(coord);
      if (tile) {
        info.push("=== LOCAL CONCENTRATIONS ===");
        for (const input of ioProfile.inputs) {
          const amount = tile.concentrations[input.id] || 0;
          info.push(`${input.id}: ${amount.toFixed(1)}`); // Reduced precision to minimize flicker
        }
        for (const output of ioProfile.outputs) {
          const amount = tile.concentrations[output.id] || 0;
          info.push(`${output.id}: ${amount.toFixed(1)}`); // Reduced precision to minimize flicker
        }
      }
    } else {
      info.push("No I/O profile defined");
    }

    // Cache the result
    this.infoCache.set(coordKey, { info, lastUpdate: now });
    
    return info;
  }

  /**
   * Clear info cache for a specific organelle (call when organelle state changes significantly)
   */
  public clearInfoCache(coord?: HexCoord): void {
    if (coord) {
      this.infoCache.delete(this.coordToKey(coord));
    } else {
      this.infoCache.clear(); // Clear all cache
    }
  }

  /**
   * Convert coordinate to string key
   */
  private coordToKey(coord: HexCoord): string {
    return `${coord.q},${coord.r}`;
  }

  // === Milestone 13: Seat-based capacity management ===

  /**
   * Add a listener for seat events
   */
  public addSeatEventListener(listener: (event: 'seatReserved' | 'seatReleased', organelleId: string, seatId: string) => void): void {
    this.seatEventListeners.add(listener);
  }

  /**
   * Remove a listener for seat events
   */
  public removeSeatEventListener(listener: (event: 'seatReserved' | 'seatReleased', organelleId: string, seatId: string) => void): void {
    this.seatEventListeners.delete(listener);
  }

  /**
   * Emit seat events to all listeners
   */
  private emitSeatEvent(event: 'seatReserved' | 'seatReleased', organelleId: string, seatId: string): void {
    for (const listener of this.seatEventListeners) {
      listener(event, organelleId, seatId);
    }
  }

  /**
   * Get a free seat in an organelle (without reserving it)
   * @param organelleId The organelle to check
   * @returns available seat position or null if full
   */
  public getFreeSeat(organelleId: string): HexCoord | null {
    const organelle = this.organelles.get(organelleId);
    if (!organelle) {
      return null;
    }

    // Check capacity
    if (organelle.seats.size >= organelle.capacity) {
      return null;
    }

    // Find an available position within the footprint
    const footprintTiles = getFootprintTiles(organelle.config.footprint, organelle.coord.q, organelle.coord.r);
    const occupiedPositions = new Set<string>();
    
    // Mark positions already taken by other seats
    for (const existingSeat of organelle.seats.values()) {
      occupiedPositions.add(`${existingSeat.position.q},${existingSeat.position.r}`);
    }
    
    // Find first available footprint position
    for (const tile of footprintTiles) {
      const tileKey = `${tile.q},${tile.r}`;
      if (!occupiedPositions.has(tileKey)) {
        return tile;
      }
    }
    
    return null;
  }

  /**
   * Reserve a seat in an organelle for an incoming vesicle
   * @param organelleId The organelle to reserve a seat in
   * @param vesicleId The vesicle that needs the seat
   * @param expectedArrival Optional expected arrival time
   * @returns seat ID if successful, null if organelle is full
   */
  public reserveSeat(organelleId: string, vesicleId: string, expectedArrival?: number): string | null {
    const organelle = this.organelles.get(organelleId);
    if (!organelle) {
      console.warn(`Cannot reserve seat: organelle ${organelleId} not found`);
      return null;
    }

    console.log(`🔍 SEAT DEBUG: Attempting to reserve seat in ${organelleId} for vesicle ${vesicleId}`);
    console.log(`🔍 SEAT DEBUG: Current seats: ${organelle.seats.size}, Capacity: ${organelle.capacity}`);

    // Check capacity
    if (organelle.seats.size >= organelle.capacity) {
      // Organelle is full
      console.log(`🔍 SEAT DEBUG: Organelle ${organelleId} is full (${organelle.seats.size}/${organelle.capacity})`);
      return null;
    }

    // Find an available position within the footprint
    const footprintTiles = getFootprintTiles(organelle.config.footprint, organelle.coord.q, organelle.coord.r);
    console.log(`🔍 SEAT DEBUG: Footprint has ${footprintTiles.length} tiles`);
    
    const occupiedPositions = new Set<string>();
    
    // Mark positions already taken by other seats
    for (const existingSeat of organelle.seats.values()) {
      occupiedPositions.add(`${existingSeat.position.q},${existingSeat.position.r}`);
    }
    
    console.log(`🔍 SEAT DEBUG: Occupied positions: ${Array.from(occupiedPositions).join(', ')}`);
    
    // Find first available footprint position
    let availablePosition: HexCoord | null = null;
    for (const tile of footprintTiles) {
      const tileKey = `${tile.q},${tile.r}`;
      if (!occupiedPositions.has(tileKey)) {
        availablePosition = tile;
        console.log(`🔍 SEAT DEBUG: Found available position: (${tile.q},${tile.r})`);
        break;
      }
    }
    
    if (!availablePosition) {
      console.warn(`Cannot reserve seat: no available positions in organelle ${organelleId}`);
      return null;
    }

    // Assert that position is truly free (guards against stacking)
    const positionKey = `${availablePosition.q},${availablePosition.r}`;
    if (occupiedPositions.has(positionKey)) {
      console.error(`ASSERTION FAILED: Attempted to reserve already occupied position ${positionKey} in organelle ${organelleId}`);
      return null;
    }

    // Milestone 13: Additional validation for seat management
    if (organelle.seats.size >= organelle.capacity) {
      console.error(`VALIDATION FAILED: Attempted to reserve seat when organelle ${organelleId} is at capacity (${organelle.seats.size}/${organelle.capacity})`);
      return null;
    }

    // Generate unique seat ID
    const seatId = `seat_${organelleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const seat: SeatInfo = {
      vesicleId,
      reservedAt: Date.now(),
      expectedArrival,
      position: availablePosition
    };

    organelle.seats.set(seatId, seat);
    console.log(`🎫 Reserved seat ${seatId} for vesicle ${vesicleId} in organelle ${organelleId} at position (${availablePosition.q},${availablePosition.r})`);
    
    // Emit seat reserved event
    this.emitSeatEvent('seatReserved', organelleId, seatId);
    
    return seatId;
  }

  /**
   * Release a seat in an organelle
   * @param organelleId The organelle containing the seat
   * @param seatId The seat to release
   * @returns true if seat was released, false if not found
   */
  public releaseSeat(organelleId: string, seatId: string): boolean {
    const organelle = this.organelles.get(organelleId);
    if (!organelle) {
      console.warn(`Cannot release seat: organelle ${organelleId} not found`);
      return false;
    }

    const released = organelle.seats.delete(seatId);
    if (released) {
      console.log(`🎫 Released seat ${seatId} in organelle ${organelleId}`);
      // Emit seat released event
      this.emitSeatEvent('seatReleased', organelleId, seatId);
    }
    
    return released;
  }

  /**
   * Check if an organelle has available capacity
   * @param organelleId The organelle to check
   * @returns true if seats are available, false if full or not found
   */
  public hasAvailableSeats(organelleId: string): boolean {
    const organelle = this.organelles.get(organelleId);
    if (!organelle) {
      return false;
    }
    
    return organelle.seats.size < organelle.capacity;
  }

  /**
   * Get the position assigned to a specific seat
   * @param organelleId The organelle containing the seat
   * @param seatId The seat to get position for
   * @returns hex coordinate of the seat, or null if not found
   */
  public getSeatPosition(organelleId: string, seatId: string): HexCoord | null {
    const organelle = this.organelles.get(organelleId);
    if (!organelle) {
      return null;
    }
    
    const seat = organelle.seats.get(seatId);
    return seat ? seat.position : null;
  }

  /**
   * Get seat information for an organelle
   * @param organelleId The organelle to check
   * @returns seat occupancy info or null if organelle not found
   */
  public getSeatInfo(organelleId: string): { occupied: number; capacity: number; seats: SeatInfo[] } | null {
    const organelle = this.organelles.get(organelleId);
    if (!organelle) {
      return null;
    }
    
    return {
      occupied: organelle.seats.size,
      capacity: organelle.capacity,
      seats: Array.from(organelle.seats.values())
    };
  }

  /**
   * Check for queued cargo at organelle rim
   * Simplified implementation - in full system would check cytoskeleton graph
   * @param _organelle The organelle to check (unused in simplified implementation)
   * @returns number of cargo items queued at rim
   */
  private hasQueuedCargoAtRim(_organelle: Organelle): number {
    // Simplified check - in full implementation this would check 
    // the cytoskeleton graph for cargo with handoffKind='actin-end-dwell'
    // near this organelle's rim coordinates
    return 0; // Placeholder - would need integration with cytoskeleton system
  }
}
