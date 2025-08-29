import type { WorldRefs, Cargo, CargoType, ProteinId } from "../core/world-refs";
import type { OrganelleType } from "../organelles/organelle-registry";
import type { HexCoord } from "../hex/hex-grid";
import { System } from "./system";
import type { NetBus } from "../network/net-bus";
import { RunOnServer } from "../network/decorators";
import type { Organelle } from "@/organelles/organelle-system";
import { getFootprintTiles } from "../organelles/organelle-footprints";

// Cargo transformation configuration
const ORGANELLE_TRANSFORMATIONS: Record<OrganelleType, { from: CargoType; to: CargoType } | null> = {
  'nucleus': null,
  'ribosome-hub': null,
  'proto-er': { from: 'transcript', to: 'polypeptide' },
  'golgi': { from: 'polypeptide', to: 'vesicle' },
  'peroxisome': null,
  'membrane-port': null,
  'transporter': null,
  'receptor': null
};

// Unified routing result for efficient cargo routing
interface RouteResult {
  success: boolean;
  organelle?: Organelle; // Target organelle
  path?: string[]; // Node path from CytoskeletonGraph
  seatId?: string; // Reserved seat ID
  reason?: string; // Failure reason
  isDirectAdjacent?: boolean; // Flag for direct organelle-to-organelle movement
}

// State for networked cargo management
type CargoState = {
  cargo: Record<string, Cargo>;
};

/**
 * Unified cargo management system with install order processing
 */
export class CargoSystem extends System {
  private worldRefs: WorldRefs;
  private cargoState = this.stateChannel<CargoState>('cargo.map', { cargo: {} });
  private nextCargoId = 1;
  private blockedCargo = new Set<string>(); // Retry queue for blocked cargo
  private cargoFailureTimes = new Map<string, number>(); // Track when cargo last failed routing
  private graphics?: Phaser.GameObjects.Graphics; // Cargo rendering graphics
  private static readonly RETRY_COOLDOWN_MS = 5000; // Wait 5 seconds before retrying failed cargo

  constructor(scene: Phaser.Scene, netBus: NetBus, worldRefs: WorldRefs) {
    super(scene, netBus, "CargoSystem", (deltaSeconds: number) => this.update(deltaSeconds));
    this.worldRefs = worldRefs;
    
    // Initialize rendering graphics
    this.initializeGraphics();
    
    console.log('� CargoSystem initialized');
  }

  private accumulatedTime = 0;
  private processTime = 0;
  private cleanupTime = 0;
  private readonly UPDATE_INTERVAL = 1.0; // Update auto-routing every second
  private readonly PROCESS_INTERVAL = 0.5; // Process install orders every 500ms
  private readonly CLEANUP_INTERVAL = 2.0; // Cleanup expired cargo every 2 seconds

  /**
   * Main update method called by System base class
   */
  override update(deltaSeconds: number): void {
    this.accumulatedTime += deltaSeconds;
    this.processTime += deltaSeconds;
    this.cleanupTime += deltaSeconds;
    
    // Only run cargo updates on server
    if (this._netBus.isHost) {
      if (this.processTime >= this.PROCESS_INTERVAL) {
        this.processTime = 0;
        this.processInstallOrders();
      }
      
      if (this.cleanupTime >= this.CLEANUP_INTERVAL) {
        this.cleanupTime = 0;
        this.cleanupExpiredCargo();
      }
      
      if (this.accumulatedTime >= this.UPDATE_INTERVAL) {
        this.accumulatedTime = 0;
        this.updateAutoRouting();
      }
    }
  }

  private initializeGraphics(): void {
    this.graphics = this.scene.add.graphics();
    this.graphics.setDepth(2.5); // Above organelles so cargo is visible
    this.graphics.setVisible(true);
    
    // Re-parent cargo graphics to cellRoot
    this.worldRefs.cellRoot.add(this.graphics);
  }

  /**
   * Create new cargo
   */
  createCargo(proteinId: ProteinId, cargoType: CargoType, atHex?: HexCoord): Cargo {
    const cargoId = `cargo_${this.nextCargoId++}`;
    const initialHex = atHex || { q: 0, r: 0 }; // Default position if none provided
    
    const cargo: Cargo = {
      id: cargoId,
      currentType: cargoType,
      proteinId,
      atHex: initialHex,
      worldPos: this.worldRefs.hexGrid.hexToWorld(initialHex),
      destHex: initialHex,
      createdAt: Date.now(),
      ttlSecondsInitial: 120,
      ttlSecondsRemaining: 120,
      localDecayRate: 1.0,
      carriedBy: undefined,
      state: 'QUEUED',
      glycosylationState: 'none',
      currentStageDestination: undefined,
      reservedSeatId: undefined,
      targetOrganelleId: undefined,
      itinerary: {
        stages: [],
        stageIndex: 0
      },
      routeCache: [],
      processingTimer: 0,
      isNetworkControlled: false
    };

    this.cargoState.cargo[cargoId] = cargo;
    return cargo;
  }

  /**
   * Get cargo at specific tile coordinate
   */
  getCargoAtTile(coord: HexCoord) {
    const result = [];
    for (const cargo of Object.values(this.cargoState.cargo)) {
      // Only include cargo that has a valid hex position (not carried) and is at this location
      if (this.isCargoAtPosition(cargo, coord)) {
        result.push(cargo);
      }
    }
    return result;
  }

  getAllCargo(): Cargo[] {
    return Object.values(this.cargoState.cargo);
  }

  /**
   * Called when cytoskeleton graph topology changes - force immediate retry of blocked cargo
   */
  public onGraphTopologyChanged(): void {
    // Clear all failure times to allow immediate retry
    this.cargoFailureTimes.clear();
    
    // Force immediate retry of all blocked cargo
    this.retryBlockedCargo();
  }

  getCargo(cargoId: string): Cargo | undefined {
    return this.cargoState.cargo[cargoId];
  }

  createTranscript(proteinId: ProteinId): Cargo {
    const spawnHex = this.findNucleusOrganelle()?.coord || { q: 0, r: 0 };
    return this.createCargo(proteinId, 'transcript', spawnHex);
  }

  // Helper functions for type-safe cargo position handling
  private isCargoAtPosition(cargo: Cargo, coord: HexCoord): boolean {
    return cargo.atHex?.q === coord.q && cargo.atHex?.r === coord.r;
  }

  private setCargoPosition(cargo: Cargo, position: HexCoord | undefined): void {
    cargo.atHex = position;
    if (position) {
      cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(position);
    }
  }

  /**
   * Check if a hex position is occupied by another cargo or has a reserved seat
   */
  private isHexOccupiedByCargo(position: HexCoord, excludeCargoId?: string): boolean {
    // Check for actual cargo at position
    const cargoOccupied = Object.values(this.cargoState.cargo).some(cargo => {
      if (excludeCargoId && cargo.id === excludeCargoId) return false;
      if (cargo.carriedBy) return false; // Carried cargo doesn't occupy tiles
      if (!cargo.atHex) return false;
      return cargo.atHex.q === position.q && cargo.atHex.r === position.r;
    });
    
    if (cargoOccupied) return true;
    
    // Check for reserved seats at this position
    const organelleSystem = this.worldRefs.organelleSystem;
    if (organelleSystem) {
      const organelleAtPos = organelleSystem.getOrganelleAtTile(position);
      if (organelleAtPos) {
        // Check if any seats at this position are reserved
        const seatInfo = organelleSystem.getSeatInfo(organelleAtPos.id);
        if (seatInfo) {
          for (const seat of seatInfo.seats) {
            if (seat.position.q === position.q && seat.position.r === position.r) {
              // This position has a reserved seat - check if it's for excluded cargo
              if (excludeCargoId && seat.cargoId === excludeCargoId) {
                return false; // This cargo has reserved this seat
              }
              return true; // Seat is reserved for another cargo
            }
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Find a safe position for cargo placement, avoiding collisions with other cargo
   */
  private findSafeCargoPosition(preferredPos: HexCoord, cargoId: string): HexCoord {
    // First check if preferred position is available
    if (!this.isHexOccupiedByCargo(preferredPos, cargoId)) {
      return preferredPos;
    }

    // Look for organelle seats first (priority placement)
    const organelleSystem = this.worldRefs.organelleSystem;
    if (organelleSystem) {
      console.log(`🔍 CargoSystem: Preferred position (${preferredPos.q}, ${preferredPos.r}) occupied, checking organelle seats`);
      const organelleAtPos = organelleSystem.getOrganelleAtTile(preferredPos);
      if (organelleAtPos) {
        // Get the seat info to check capacity
        const seatInfo = organelleSystem.getSeatInfo(organelleAtPos.id);
        console.log(`🔍 CargoSystem: Found organelle ${organelleAtPos.id} with seat info:`, seatInfo);
        
        if (seatInfo && seatInfo.capacity > seatInfo.occupied) {
          // There are available seats, check all footprint positions
          const footprintTiles = getFootprintTiles(organelleAtPos.config.footprint, organelleAtPos.coord.q, organelleAtPos.coord.r);
          const occupiedPositions = new Set<string>();
          
          // Mark positions already taken by existing seats
          for (const seat of seatInfo.seats) {
            occupiedPositions.add(`${seat.position.q},${seat.position.r}`);
          }
          
          // Find available footprint positions
          for (const tilePos of footprintTiles) {
            const tileKey = `${tilePos.q},${tilePos.r}`;
            if (!occupiedPositions.has(tileKey) && !this.isHexOccupiedByCargo(tilePos, cargoId)) {
              console.log(`✅ CargoSystem: Found available position (${tilePos.q}, ${tilePos.r}) in organelle ${organelleAtPos.id} for cargo ${cargoId}`);
              return tilePos;
            }
          }
        }
      }
    }

    // Fall back to adjacent hexes in spiral pattern
    const directions = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];

    for (let radius = 1; radius <= 3; radius++) {
      for (let i = 0; i < 6; i++) {
        const dir = directions[i];
        const candidate = {
          q: preferredPos.q + dir.q * radius,
          r: preferredPos.r + dir.r * radius
        };
        
        if (!this.isHexOccupiedByCargo(candidate, cargoId)) {
          return candidate;
        }
      }
    }

    // If all else fails, use the preferred position anyway (shouldn't happen normally)
    console.warn(`🚫 CargoSystem: Could not find safe position for cargo ${cargoId}, using preferred position anyway`);
    return preferredPos;
  }

  /**
   * Consolidated seat management helper
   */
  private getSeatPositionForCargo(cargo: Cargo): HexCoord | null {
    if (!cargo.reservedSeatId || !cargo.targetOrganelleId) {
      return null;
    }
    return this.worldRefs.organelleSystem.getSeatPosition(cargo.targetOrganelleId, cargo.reservedSeatId);
  }

  /**
   * Position cargo at its reserved seat if available
   */
  private positionCargoAtSeat(cargo: Cargo, reason: string): boolean {
    const seatPosition = this.getSeatPositionForCargo(cargo);
    if (seatPosition) {
      console.log(`🎫 CargoSystem: Positioning cargo ${cargo.id} at seat ${cargo.reservedSeatId} at (${seatPosition.q}, ${seatPosition.r}) - ${reason}`);
      this.setCargoPosition(cargo, seatPosition);
      return true;
    }
    return false;
  }

  /**
   * Validate that cargo has valid position and seat reservation
   */
  private validateCargoForMovement(cargo: Cargo): boolean {
    if (!cargo.atHex) {
      return false;
    }

    if (!cargo.currentStageDestination) {
      return false;
    }

    if (!cargo.reservedSeatId || !cargo.targetOrganelleId) {
      return false;
    }

    return true;
  }

  /**
   * SERVER ONLY: Process pending install orders by creating transcripts
   */
  @RunOnServer()
  private processInstallOrders(): void {
    // Access InstallOrderSystem through WorldRefs (clean dependency injection)
    if (!this.worldRefs.installOrderSystem) {
      // InstallOrderSystem not yet available
      return;
    }
    
    const orders = this.worldRefs.installOrderSystem.getAllOrders();
    if (orders.length === 0) return;
    
    console.log(`🔬 CargoSystem: Processing ${orders.length} install orders`);
    
    // Find nucleus organelle once for all orders
    const nucleusOrganelle = this.findNucleusOrganelle();
    if (!nucleusOrganelle) {
      console.warn(`🔬 CargoSystem: No nucleus found, skipping all ${orders.length} orders`);
      return;
    }
    
    // Check nucleus capacity
    const hasSeats = this.worldRefs.organelleSystem.hasAvailableSeats(nucleusOrganelle.id);
    const seatsInfo = nucleusOrganelle.seats ? `${Object.keys(nucleusOrganelle.seats).length}/${nucleusOrganelle.capacity}` : 'unknown';
    console.log(`🔬 CargoSystem: Nucleus ${nucleusOrganelle.id} seats: ${seatsInfo}, available: ${hasSeats}`);
    
    if (!hasSeats) {
      console.log(`🔬 CargoSystem: Nucleus is full, will retry ${orders.length} orders later`);
      return;
    }
    
    for (const order of orders) {
      
      // Create transcript first
      const transcript = this.createTranscript(order.proteinId);
      
      // Reserve a seat for this transcript
      const seatId = this.worldRefs.organelleSystem.reserveSeat(nucleusOrganelle.id, transcript.id);
      if (!seatId) {
        console.warn(`Failed to reserve seat in nucleus for transcript ${transcript.id}`);
        this.removeCargo(transcript.id);
        continue;
      }
      
      // Get the seat position and move transcript there
      const seatPosition = this.worldRefs.organelleSystem.getSeatPosition(nucleusOrganelle.id, seatId);
      if (!seatPosition) {
        console.warn(`Failed to get seat position for transcript ${transcript.id}`);
        this.worldRefs.organelleSystem.releaseSeat(nucleusOrganelle.id, seatId);
        this.removeCargo(transcript.id);
        continue;
      }
      
      // Position transcript and set up for processing
      this.setCargoPosition(transcript, seatPosition);
      transcript.destHex = order.destHex;
      transcript.reservedSeatId = seatId;
      transcript.targetOrganelleId = nucleusOrganelle.id;
      transcript.itinerary = order.itinerary;
      
      // Trigger stage arrival processing for the nucleus stage
      console.log(`🎬 CargoSystem: Starting nucleus processing for transcript ${transcript.id}`);
      this.handleStageArrival(transcript);
      
      // Remove processed order
      this.worldRefs.installOrderSystem.removeProcessedOrder(order.id);
    }
  }

  /**
   * Unified routing: Find closest available organelle + path + reserve seat
   */
  @RunOnServer()
  private findBestRouteToOrganelleType(cargo: Cargo, organelleType: OrganelleType): RouteResult {
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    const graph = this.worldRefs.cytoskeletonSystem.graph;
    
    // Filter organelles by type
    const candidateOrganelles = organelles.filter(org => org.type === organelleType);

    if (candidateOrganelles.length === 0) {
      return { success: false, reason: `No ${organelleType} organelles found` };
    }
    const { atHex } = cargo;

    // Simple teleport-based routing: cargo can teleport to any adjacent organelle with seats
    if (!atHex) {
      return { success: false, reason: 'Cargo has no position' };
    }

    const currentOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(atHex);
    if (currentOrganelle) {
      for (const candidate of candidateOrganelles) {
        if (this.worldRefs.organelleSystem.areOrganellesAdjacent(currentOrganelle, candidate)) {
          // Step 1: Check if path exists to organelle
          // (For adjacent organelles, path always exists)
          
          // Step 2: Check seat availability in target organelle
          const hasSeats = this.worldRefs.organelleSystem.hasAvailableSeats(candidate.id);
          if (hasSeats) {
            // Step 3: Try to reserve new seat first
            const seatId = this.worldRefs.organelleSystem.reserveSeat(candidate.id, cargo.id);
            if (seatId) {
              // Successfully reserved new seat, now release old seat
              this.releaseSeatReservation(cargo, `Routing to adjacent organelle ${candidate.type}`);
              return {
                success: true,
                organelle: candidate,
                path: ['TELEPORT'], // Simple teleport movement
                seatId,
                isDirectAdjacent: true
              };
            }
          }
        }
      }
    }

    // Fallback to cytoskeleton routing if no adjacent organelles available
    // Try each organelle, starting with closest
    const organelleResults = candidateOrganelles.map(organelle => {
      // Check if path exists
      const pathResult = graph.findPath(atHex, organelle.coord, cargo.currentType);
      if (!pathResult.success) {
        return { organelle, distance: Infinity, pathResult, hasSeats: false };
      }

      // Check seat availability
      const hasSeats = this.worldRefs.organelleSystem.hasAvailableSeats(organelle.id);
      
      // Calculate distance (path length as proxy)
      const distance = pathResult.path ? pathResult.path.length : Infinity;
      
      return { organelle, distance, pathResult, hasSeats };
    });

    // Sort by: has seats first, then by distance
    organelleResults.sort((a, b) => {
      if (a.hasSeats && !b.hasSeats) return -1;
      if (!a.hasSeats && b.hasSeats) return 1;
      return a.distance - b.distance;
    });

    // Try to reserve seat in the best available organelle
    for (const result of organelleResults) {
      if (result.hasSeats && result.pathResult.success) {
        // Try to reserve new seat first
        const seatId = this.worldRefs.organelleSystem.reserveSeat(result.organelle.id, cargo.id);
        if (seatId) {
          // Successfully reserved new seat, now release old seat
          this.releaseSeatReservation(cargo, `Routing to organelle ${result.organelle.type} via cytoskeleton`);
          return {
            success: true,
            organelle: result.organelle,
            path: result.pathResult.path,
            seatId
          };
        }
      }
    }

    return { success: false, reason: 'No available seats or paths' };
  }

  /**
   * Find a nucleus organelle for spawning transcripts
   */
  private findNucleusOrganelle(): Organelle | null {    
    // Look for nucleus organelles
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    for (const organelle of organelles) {
      if (organelle.type === 'nucleus') {
        return organelle;
      }
    }
    
    return null;
  }

  /**
   * SERVER ONLY: Clean up expired cargo and release their seats
   */
  @RunOnServer()
  private cleanupExpiredCargo(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    
    for (const [cargoId, cargo] of Object.entries(this.cargoState.cargo)) {
      // Calculate remaining TTL
      const elapsedMs = now - cargo.createdAt;
      const elapsedSeconds = elapsedMs / 1000;
      const remainingTtl = cargo.ttlSecondsInitial - elapsedSeconds;
      
      if (remainingTtl <= 0) {
        // Don't expire cargo that's currently being processed
        if (cargo.state === 'TRANSFORMING' && cargo.processingTimer && cargo.processingTimer > 0) {
          console.log(`⏰ CargoSystem: Cargo ${cargoId} expired but still processing, extending TTL`);
          // Extend TTL by processing time
          cargo.ttlSecondsRemaining = Math.max(5, cargo.processingTimer / 1000);
          continue;
        }
        
        console.log(`⏰ CargoSystem: Cargo ${cargoId} expired, cleaning up`);
        
        // Release any reserved seat
        this.releaseSeatReservation(cargo, `Expired cargo cleanup`);
        
        toRemove.push(cargoId);
      } else {
        // Update remaining TTL for live display
        cargo.ttlSecondsRemaining = remainingTtl;
      }
    }
    
    // Remove expired cargo
    for (const cargoId of toRemove) {
      delete this.cargoState.cargo[cargoId];
    }
    
    if (toRemove.length > 0) {
      console.log(`🧹 CargoSystem: Cleaned up ${toRemove.length} expired cargo items`);
    }
  }

  /**
   * Remove specific cargo and clean up its seat
   */
  removeCargo(cargoId: string): boolean {
    const cargo = this.cargoState.cargo[cargoId];
    if (!cargo) return false;
    
    // Release any reserved seat
    this.releaseSeatReservation(cargo, `Explicit removal of cargo ${cargoId}`);
    
    delete this.cargoState.cargo[cargoId];
    console.log(`🗑️ CargoSystem: Removed cargo ${cargoId}`);
    return true;
  }

  getMyPlayerInventory(): Cargo[] {
    return this.getPlayerInventory(this._netBus.localId);
  }

  /**
   * Methods for player interaction and UI
   */
  private getPlayerInventory(playerId: string): Cargo[] {
    return Array.from(Object.values(this.cargoState.cargo)).filter(cargo => cargo.carriedBy === playerId);
  }

  @RunOnServer()
  pickup(hex: HexCoord, playerId: string): boolean {
    console.log(`🎯 Debug pickup: hex=(${hex.q},${hex.r}), playerId=${playerId}`);
    
    // Find cargo at hex that has a valid position (not carried)
    for (const cargo of Object.values(this.cargoState.cargo)) {
      if (this.isCargoAtPosition(cargo, hex)) {
        console.log(`🎯 Debug pickup: Found cargo ${cargo.id} at hex, carriedBy=${cargo.carriedBy}`);
        
        // Release any reserved seat when cargo is picked up
        this.releaseSeatReservation(cargo, `Picked up by player ${playerId}`);
        
        cargo.carriedBy = playerId;
        // Clear hex position when picked up - carried cargo doesn't have a meaningful hex location
        this.setCargoPosition(cargo, undefined);
        console.log(`🎯 Debug pickup: Successfully picked up cargo ${cargo.id} by player ${playerId}`);
        return true;
      }
    }
    console.log(`🎯 Debug pickup: No cargo found at hex (${hex.q},${hex.r})`);
    return false;
  }

  @RunOnServer()
  drop(hex: HexCoord, playerId: string): boolean {
    // Find carried cargo and drop it
    for (const cargo of Object.values(this.cargoState.cargo)) {
      if (cargo.carriedBy === playerId) {
        // Find a safe position to avoid cargo collisions
        const safePosition = this.findSafeCargoPosition(hex, cargo.id);
        
        cargo.carriedBy = undefined;
        this.setCargoPosition(cargo, safePosition);
        
        if (safePosition.q !== hex.q || safePosition.r !== hex.r) {
          console.log(`🎯 Cargo ${cargo.id} dropped at safe position (${safePosition.q}, ${safePosition.r}) instead of (${hex.q}, ${hex.r}) to avoid collision`);
        }
        
        // Attempt auto-routing when cargo is dropped
        this.tryStartAutoRouting(cargo);
        
        // If auto-routing assigned a seat, move cargo to seat position immediately
        if (cargo.reservedSeatId && cargo.targetOrganelleId) {
          this.positionCargoAtSeat(cargo, `Dropped cargo auto-positioning`);
          
          // Check if the cargo is now at the correct organelle for its current stage
          const targetOrganelle = this.worldRefs.organelleSystem.getOrganelle(cargo.targetOrganelleId);
          const currentStage = cargo.itinerary?.stages[cargo.itinerary.stageIndex];
          
          if (targetOrganelle && currentStage && targetOrganelle.type === currentStage.kind) {
            // Cargo has arrived at the correct organelle, trigger arrival processing
            console.log(`📦 CargoSystem: Dropped cargo ${cargo.id} arrived at correct organelle ${currentStage.kind}, starting processing`);
            this.handleStageArrival(cargo);
          }
        }
        
        return true;
      }
    }
    return false;
  }

  @RunOnServer()
  startCargoTransit(cargoId: string, playerId?: string): boolean {
    const cargo = this.cargoState.cargo[cargoId];
    if (!cargo) {
      console.warn(`🎯 Cargo ${cargoId} not found for transit`);
      return false;
    }
    
    // If playerId is provided, validate that the player is actually carrying this cargo
    if (playerId) {
      if (cargo.carriedBy !== playerId) {
        // Try to find cargo in player's inventory as fallback
        const playerInventory = this.getPlayerInventory(playerId);
        const cargoInInventory = playerInventory.find(c => c.id === cargoId);
        
        if (!cargoInInventory) {
          console.warn(`🎯 Player ${playerId} is not carrying cargo ${cargoId} (cargo.carriedBy=${cargo.carriedBy}, not found in inventory)`);
          return false;
        }
      }
    }
    
    // Clear carried state and mark as thrown
    cargo.carriedBy = undefined;
    cargo.isThrown = true;
    return true;
  }

  @RunOnServer()
  endCargoTransit(cargoId: string, landingPos: HexCoord): boolean {
    const cargo = this.cargoState.cargo[cargoId];
    if (!cargo) {
      console.warn(`🎯 Cargo ${cargoId} not found for landing`);
      return false;
    }
    
    // Find a safe position to avoid cargo collisions
    const safePosition = this.findSafeCargoPosition(landingPos, cargoId);
    
    cargo.isThrown = false;
    this.setCargoPosition(cargo, safePosition);
    
    if (safePosition.q !== landingPos.q || safePosition.r !== landingPos.r) {
      console.log(`🎯 Cargo ${cargoId} redirected from (${landingPos.q}, ${landingPos.r}) to safe position (${safePosition.q}, ${safePosition.r}) to avoid collision`);
    }
    
    // Attempt auto-routing when cargo lands
    this.tryStartAutoRouting(cargo);
    
    // If auto-routing assigned a seat, move cargo to seat position immediately
    if (cargo.reservedSeatId && cargo.targetOrganelleId) {
      this.positionCargoAtSeat(cargo, `Thrown cargo auto-positioning`);
      
      // Check if the cargo is now at the correct organelle for its current stage
      const targetOrganelle = this.worldRefs.organelleSystem.getOrganelle(cargo.targetOrganelleId);
      const currentStage = cargo.itinerary?.stages[cargo.itinerary.stageIndex];
      
      if (targetOrganelle && currentStage && targetOrganelle.type === currentStage.kind) {
        // Cargo has arrived at the correct organelle, trigger arrival processing
        console.log(`🎯 CargoSystem: Thrown cargo ${cargo.id} arrived at correct organelle ${currentStage.kind}, starting processing`);
        this.handleStageArrival(cargo);
      }
    }
    
    return true;
  }

  renderCargo(): void {
    if (!this.graphics) return; // Graphics not initialized yet
    
    this.graphics.clear();
    
    for (const cargo of Object.values(this.cargoState.cargo)) {
      // Skip cargo that is carried by a player (but not thrown cargo)
      if (cargo.carriedBy && !cargo.isNetworkControlled && !cargo.isThrown) continue;
      
      // For thrown cargo, render at worldPos even if atHex is undefined
      // For regular cargo, skip if no valid hex position
      if (!cargo.isThrown && !cargo.atHex) continue;

      // Different colors for different cargo types
      let color: number;
      let size: number = 6;
      
      switch (cargo.currentType) {
        case 'transcript':
          color = 0x8888ff; // Light blue for transcripts
          size = 4;
          break;
        case 'polypeptide':
          color = 0xff8888; // Light red for polypeptides
          size = 5;
          break;
        case 'vesicle':
          color = 0x00ff00; // Green for vesicles
          size = 6;
          break;
        default:
          color = 0x0066cc; // Default blue
          size = 6;
      }
      
      this.graphics.fillStyle(color, 0.8);
      this.graphics.fillCircle(cargo.worldPos.x, cargo.worldPos.y, size);
    }
  }

  /**
   * Auto-routing system for cargo movement
   */
  @RunOnServer()
  private updateAutoRouting(): void {
    // Update cargo movement via CytoskeletonGraph
    this.updateCargoMovement();
    
    // Update processing timers for TRANSFORMING cargo
    this.updateProcessingTimers();
    
    // Clean up phantom seat reservations
    // this.cleanupPhantomSeatReservations();
    
    // Retry blocked cargo
    this.retryBlockedCargo();
    
    // Check for idle cargo that should be routing
    for (const cargo of Object.values(this.cargoState.cargo)) {
      if (cargo.state === 'QUEUED' && !cargo.carriedBy && cargo.itinerary) {
        this.tryStartAutoRouting(cargo);
      }
    }
  }

  @RunOnServer()
  private validateCurrentDestination(cargo: Cargo): boolean {        
    if (!this.validateCargoForMovement(cargo)) {
      return false;
    }

    // Validate the destination organelle exists and seat is still reserved
    const targetOrganelle = this.worldRefs.organelleSystem.getOrganelle(cargo.targetOrganelleId!);
    if (!targetOrganelle) {
      return false;
    }

    // Get the actual seat position for validation
    const seatPosition = this.getSeatPositionForCargo(cargo);
    if (!seatPosition) {
      return false;
    }

    // Validate destination matches the seat position for all organelles (including transporters)
    if (cargo.currentStageDestination!.q !== seatPosition.q || cargo.currentStageDestination!.r !== seatPosition.r) {
      return false;
    }

    return true;
  }

  @RunOnServer()
  private updateProcessingTimers(): void {
    // Processing timers are now handled by setTimeout in handleStageArrival
    // This method is kept for compatibility but no longer manages processing completion
    
    // We could add visual timer updates here if needed for UI feedback
    // const deltaMs = 1000; // Called every 1000ms from updateAutoRouting
    
    // for (const cargo of Object.values(this.cargoState.cargo)) {
    //   if (cargo.state === 'TRANSFORMING' && cargo.processingTimer > 0) {
    //     cargo.processingTimer -= deltaMs;
    //     // Note: Do NOT change cargo.state here - let setTimeout handle completion
    //   }
    // }
  }

  @RunOnServer()
  private updateCargoMovement(): void {
    if (!this.worldRefs.cytoskeletonSystem) return;
    
    const graph = this.worldRefs.cytoskeletonSystem.graph;
    
    for (const cargo of Object.values(this.cargoState.cargo)) {
      if (cargo.state === 'MOVING' && cargo.segmentState && !cargo.carriedBy) {
        
        // Re-evaluate if destination is still valid before each movement step
        if (!this.validateCurrentDestination(cargo)) {
          cargo.state = 'BLOCKED';
          cargo.segmentState = undefined;
          this.blockedCargo.add(cargo.id);
          continue;
        }
        
        const completed = graph.moveCargo(cargo, 1.0, false); // Use 1 second delta
        
        if (completed && cargo.atHex) {
          // Movement completed, handle arrival
          this.onMovementComplete(cargo.id, cargo.atHex);
        }
      }
    }
  }

  @RunOnServer()
  private releaseSeatReservation(cargo: Cargo, reason: string): void {
    if (cargo.reservedSeatId && cargo.targetOrganelleId) {
      console.log(`🎫 CargoSystem: Releasing seat ${cargo.reservedSeatId} from organelle ${cargo.targetOrganelleId} for cargo ${cargo.id}\nREASON: ${reason}`);
      this.worldRefs.organelleSystem.releaseSeat(cargo.targetOrganelleId, cargo.reservedSeatId);
      cargo.reservedSeatId = undefined;
      cargo.targetOrganelleId = undefined;
    }
  }

  @RunOnServer()
  private tryStartAutoRouting(cargo: Cargo): void {
    if (!cargo.itinerary || cargo.carriedBy) return;
    
    // Check if this cargo recently failed and is in cooldown
    const lastFailureTime = this.cargoFailureTimes.get(cargo.id);
    const now = Date.now();
    if (lastFailureTime && (now - lastFailureTime) < CargoSystem.RETRY_COOLDOWN_MS) {
      // Silently skip retry during cooldown
      return;
    }
    
    const destination = this.determineNextStageDestination(cargo);
    if (!destination) {
      cargo.state = 'BLOCKED'; // Set cargo state to blocked when pathfinding fails
      cargo.currentStageDestination = undefined; // Clear stale destination
      this.blockedCargo.add(cargo.id); // Add to retry queue
      this.cargoFailureTimes.set(cargo.id, now); // Record failure time
      return;
    }
    
    // Set the destination for this cargo before attempting movement
    cargo.currentStageDestination = destination;
    
    // Validation: Check if cargo is trying to move to its current position
    if (cargo.atHex && cargo.atHex.q === destination.q && cargo.atHex.r === destination.r) {
      console.warn(`⚠️ CargoSystem: Cargo ${cargo.id} trying to move to current position (${destination.q}, ${destination.r}) - this suggests a logic error`);
      // Don't attempt movement in this case
      cargo.state = 'BLOCKED';
      this.blockedCargo.add(cargo.id);
      return;
    }
    
    // Cargo will be set to MOVING or BLOCKED by attemptMovement
    if (this.attemptMovement(cargo)) {
      cargo.state = 'MOVING';
      // Clear failure time on successful movement
      this.cargoFailureTimes.delete(cargo.id);
      console.log(`🚛 CargoSystem: Started movement for cargo ${cargo.id} to (${destination.q}, ${destination.r})`);
    } else {
      cargo.state = 'BLOCKED'; // Update UI state to reflect blocked status
      this.blockedCargo.add(cargo.id);
      this.cargoFailureTimes.set(cargo.id, Date.now()); // Record failure time
    }
  }

  @RunOnServer()
  private determineNextStageDestination(cargo: Cargo): { q: number; r: number } | null {
    if (!cargo.itinerary) return null;
    
    let currentStage = cargo.itinerary.stages[cargo.itinerary.stageIndex];
    if (!currentStage) return null; // No more stages
    
    // Check if we need to advance to the next stage
    // Only advance if cargo has completed processing in the current stage
    if (cargo.atHex && cargo.processingTimer <= 0) {
      const currentOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(cargo.atHex);
      if (currentOrganelle && currentOrganelle.type === currentStage.kind) {
        // We're in the right organelle and processing is complete, advance to next stage
        cargo.itinerary.stageIndex++;
        const nextStage = cargo.itinerary.stages[cargo.itinerary.stageIndex];
        if (!nextStage) {
          return null; // Completed all stages
        }
        // Update currentStage to the new stage for routing
        currentStage = nextStage;
      }
    }
    
    // For organelle stages, use unified routing to find best available organelle
    const routeResult = this.findBestRouteToOrganelleType(cargo, currentStage.kind);
    if (routeResult.success && routeResult.organelle && routeResult.seatId) {
      // Store the seat reservation info for this cargo
      cargo.reservedSeatId = routeResult.seatId;
      cargo.targetOrganelleId = routeResult.organelle.id;
      
      // Get the actual seat position - this should always work since we just reserved it
      const seatPosition = this.getSeatPositionForCargo(cargo);
      if (seatPosition) {
        // Validate destination is different from current position
        if (cargo.atHex && seatPosition.q === cargo.atHex.q && seatPosition.r === cargo.atHex.r) {
          return null;
        }
        return seatPosition;
      }
      
      // Fallback to organelle center if seat position lookup fails (shouldn't happen)
      return routeResult.organelle.coord;
    }
    
    return null;
  }

  @RunOnServer()
  private attemptMovement(cargo: Cargo): boolean {
    if(!this.validateCurrentDestination(cargo)) {
      return false;
    }

    const seatPosition = cargo.currentStageDestination!;
    
    // Check if this is a direct adjacent teleport by looking at current and target organelles
    if (cargo.atHex && cargo.targetOrganelleId) {
      const currentOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(cargo.atHex);
      const targetOrganelle = this.worldRefs.organelleSystem.getOrganelle(cargo.targetOrganelleId);
      
      if (currentOrganelle && targetOrganelle && 
          currentOrganelle.id !== targetOrganelle.id && // Prevent same-organelle "teleport"
          this.worldRefs.organelleSystem.areOrganellesAdjacent(currentOrganelle, targetOrganelle)) {
        
        // Direct teleport for adjacent organelles - cargo has already reserved the seat
        this.setCargoPosition(cargo, seatPosition);
        
        // Immediately trigger arrival
        this.onMovementComplete(cargo.id, seatPosition);
        
        return true;
      }
    }
    
    // Fallback to cytoskeleton pathfinding for non-adjacent movement
    const graph = this.worldRefs.cytoskeletonSystem.graph;
    
    // Check if path exists to current destination
    const pathResult = graph.findPath(cargo.atHex!, seatPosition, cargo.currentType);
    if (!pathResult.success) {
      cargo.state = 'BLOCKED'; // Set blocked state when pathfinding fails
      this.blockedCargo.add(cargo.id); // Add to retry queue
      this.cargoFailureTimes.set(cargo.id, Date.now()); // Record failure time
      return false;
    }
    
    // Start movement via CytoskeletonGraph
    cargo.segmentState = {
      nodeId: pathResult.path[0],
      plannedPath: pathResult.path,
      pathIndex: 0
    };
    
    return true;
  }

  @RunOnServer()
  private retryBlockedCargo(): void {
    const toRetry = Array.from(this.blockedCargo);
    const now = Date.now();
    
    for (const cargoId of toRetry) {
      const cargo = this.cargoState.cargo[cargoId];
      if (!cargo || cargo.carriedBy) {
        this.blockedCargo.delete(cargoId);
        this.cargoFailureTimes.delete(cargoId);
        continue;
      }
      
      // Check if cargo is still in cooldown
      const lastFailureTime = this.cargoFailureTimes.get(cargoId);
      if (lastFailureTime && (now - lastFailureTime) < CargoSystem.RETRY_COOLDOWN_MS) {
        continue; // Skip retry during cooldown
      }
      
      if (cargo.state === 'BLOCKED') {
        // Try to re-route the cargo first to establish a destination
        this.tryStartAutoRouting(cargo);
        
        // If routing succeeded, cargo state should change from BLOCKED
        if (cargo.state !== 'BLOCKED') {
          this.blockedCargo.delete(cargoId);
          this.cargoFailureTimes.delete(cargoId); // Clear failure time on success
        } else {
          // Update failure time if it failed again
          this.cargoFailureTimes.set(cargoId, now);
        }
      } else {
        // Cargo is no longer blocked, remove from retry queue
        this.blockedCargo.delete(cargoId);
        this.cargoFailureTimes.delete(cargoId);
      }
    }
  }
  
  // Called when teleport movement completes
  @RunOnServer()
  onMovementComplete(cargoId: string, arrivedAt: { q: number; r: number }): void {
    if (!this._netBus.isHost) return;
    
    const cargo = this.cargoState.cargo[cargoId];
    if (!cargo) return;
    
    // Check if the arrival position is blocked by another cargo or reserved seat
    if (this.isHexOccupiedByCargo(arrivedAt, cargoId)) {
      console.log(`🚫 CargoSystem: Cargo ${cargoId} blocked at arrival position (${arrivedAt.q}, ${arrivedAt.r}) - position occupied`);
      cargo.state = 'BLOCKED';
      this.blockedCargo.add(cargoId);
      this.cargoFailureTimes.set(cargoId, Date.now());
      return;
    }
    
    cargo.segmentState = undefined;
    this.setCargoPosition(cargo, arrivedAt);
    
    console.log(`🎯 CargoSystem: Cargo ${cargoId} arrived at (${arrivedAt.q}, ${arrivedAt.r})`);
    
    // Handle stage completion and progression
    this.handleStageArrival(cargo);
  }

  @RunOnServer()
  private handleStageArrival(cargo: Cargo): void {
    if (!cargo.itinerary) return;
    
    const currentStage = cargo.itinerary.stages[cargo.itinerary.stageIndex];
    if (!currentStage) return;
    
    console.log(`🎬 CargoSystem: Cargo ${cargo.id} arrived at stage ${cargo.itinerary.stageIndex} (${currentStage.kind}), starting ${currentStage.processMs}ms processing`);
    
    // If cargo has a reserved seat, position it at the seat location instead of organelle coordinate
    this.positionCargoAtSeat(cargo, `Stage ${cargo.itinerary.stageIndex} arrival`);
    
    // Start processing at current stage
    cargo.state = 'TRANSFORMING'; // Visual indicator for processing
    cargo.processingTimer = currentStage.processMs;
    
    // Implement actual stage processing with cargo type transformation
    setTimeout(() => {
      // Transform cargo type based on organelle configuration
      const currentOrganelle = this.worldRefs.organelleSystem.getOrganelle(cargo.targetOrganelleId!);
      if (currentOrganelle) {
        const transformation = ORGANELLE_TRANSFORMATIONS[currentOrganelle.type];
        if (transformation && cargo.currentType === transformation.from) {
          cargo.currentType = transformation.to;
          console.log(`🔄 CargoSystem: Cargo ${cargo.id} transformed from ${transformation.from} to ${transformation.to} at Golgi`);
        }
      }
      
      cargo.state = 'QUEUED'; // Reset to queued for next routing
      
      // Check if there are more stages to process
      if (cargo.itinerary && cargo.itinerary.stageIndex < cargo.itinerary.stages.length - 1) {
        cargo.itinerary.stageIndex++;
        console.log(`⏭️ CargoSystem: Cargo ${cargo.id} completed stage processing, advanced to stage ${cargo.itinerary.stageIndex} (${cargo.itinerary.stages[cargo.itinerary.stageIndex]?.kind || 'unknown'})`);
        
        this.tryStartAutoRouting(cargo);
      } else {
        // This is the final stage - check if it's a transporter stage that needs final processing
        if (cargo.itinerary) {
          const finalStage = cargo.itinerary.stages[cargo.itinerary.stageIndex];
          if (finalStage.kind === 'transporter') {
            console.log(`🏭 CargoSystem: Cargo ${cargo.id} starting final transporter processing (${finalStage.processMs}ms) before installation`);
            // Set cargo state to show it's processing
            cargo.state = 'TRANSFORMING';
            cargo.processingTimer = finalStage.processMs;
            
            // Set up final processing at transporter before installation
            setTimeout(() => {
              cargo.state = 'QUEUED'; // Reset state before installation
              console.log(`🏁 CargoSystem: Cargo ${cargo.id} completed all stages including final transporter processing`);
              this.performProteinInstallation(cargo);
            }, finalStage.processMs);
          } else {
            console.log(`🏁 CargoSystem: Cargo ${cargo.id} completed all stages`);
            this.performProteinInstallation(cargo);
          }
        } else {
          console.log(`🏁 CargoSystem: Cargo ${cargo.id} completed all stages`);
          this.performProteinInstallation(cargo);
        }
      }
    }, currentStage.processMs);
  }

  @RunOnServer()
  private performProteinInstallation(cargo: Cargo): void {
    console.log(`🔧 CargoSystem: Installing protein ${cargo.proteinId} from cargo ${cargo.id}`);
    
    // Try to get the target organelle from the stored ID first
    let targetOrganelle = cargo.targetOrganelleId ? 
      this.worldRefs.organelleSystem.getOrganelle(cargo.targetOrganelleId) : null;
    
    // If targetOrganelleId is missing or invalid, try to find organelle at cargo's current position
    if (!targetOrganelle && cargo.atHex) {
      targetOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(cargo.atHex);
      if (targetOrganelle) {
        console.log(`🔧 CargoSystem: Found target organelle ${targetOrganelle.id} at cargo position (${cargo.atHex.q}, ${cargo.atHex.r})`);
      }
    }
    
    if (!targetOrganelle) {
      console.error(`❌ CargoSystem: No target organelle found for protein installation (targetOrganelleId=${cargo.targetOrganelleId}, atHex=${cargo.atHex?.q},${cargo.atHex?.r})`);
      this.removeCargo(cargo.id);
      return;
    }

    // Install the protein at the organelle location
    try {
      // For transporter organelles, install the protein as a membrane transporter
      if (targetOrganelle.type === 'transporter') {
        const installSuccess = this.findAndInstallMembraneProtein(cargo.proteinId, targetOrganelle);
        if (!installSuccess) {
          console.error(`❌ CargoSystem: Could not find available membrane position for ${cargo.proteinId} near ${targetOrganelle.id}`);
          this.removeCargo(cargo.id);
          return;
        }
        console.log(`✅ CargoSystem: Successfully installed ${cargo.proteinId} into ${targetOrganelle.type} ${targetOrganelle.id}`);
      } else {
        // For other organelle types, just log that installation isn't implemented yet
        console.log(`🚧 CargoSystem: Protein installation for ${targetOrganelle.type} organelles not yet implemented - treating as completed for now`);
        console.log(`✅ CargoSystem: Cargo delivery completed for ${cargo.proteinId} to ${targetOrganelle.type} ${targetOrganelle.id} (installation logic pending)`);
      }
    } catch (error) {
      console.error(`❌ CargoSystem: Failed to install protein ${cargo.proteinId}:`, error);
    }

    // Clean up the cargo - release seat and remove from system
    this.removeCargo(cargo.id);
  }

  @RunOnServer()
  private findAndInstallMembraneProtein(proteinId: ProteinId, organelle: Organelle): boolean {
    // Get all membrane coordinates around the organelle footprint
    const membraneCoords: HexCoord[] = [];
    
    // For single-tile organelles, check the organelle position itself
    if (this.worldRefs.hexGrid.isMembraneCoord(organelle.coord)) {
      membraneCoords.push(organelle.coord);
    }
    
    // Also check adjacent membrane coordinates
    const directions = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];
    
    for (const dir of directions) {
      const adjacentCoord = {
        q: organelle.coord.q + dir.q,
        r: organelle.coord.r + dir.r
      };
      
      if (this.worldRefs.hexGrid.isMembraneCoord(adjacentCoord)) {
        membraneCoords.push(adjacentCoord);
      }
    }
    
    // Try to install at each membrane coordinate until one succeeds
    for (const coord of membraneCoords) {
      console.log(`🧬 CargoSystem: Attempting to install ${proteinId} at (${coord.q}, ${coord.r}) - delegating to MembraneExchangeSystem`);
      const success = this.worldRefs.membraneExchangeSystem.installMembraneProtein(coord, proteinId);
      if (success) {
        console.log(`🧬 CargoSystem: Successfully installed ${proteinId} at membrane position (${coord.q}, ${coord.r}) near ${organelle.id}`);
        return true;
      } else {
      console.warn(`❌ CargoSystem: Failed to install ${proteinId} at (${coord.q}, ${coord.r})`);
    }
    }
    
    return false;
  }

  override destroy() {
    this.cargoState.cargo = {};
    
    // Clean up graphics
    if (this.graphics) {
      this.graphics.destroy();
      this.graphics = undefined;
    }
  }
}
