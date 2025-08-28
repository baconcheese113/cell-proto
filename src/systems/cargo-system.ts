import type { WorldRefs, Cargo, CargoType, ProteinId } from "../core/world-refs";
import type { OrganelleType } from "../organelles/organelle-registry";
import type { HexCoord } from "../hex/hex-grid";
import { System } from "./system";
import type { NetBus } from "../network/net-bus";
import { RunOnServer } from "../network/decorators";
import type { Organelle } from "@/organelles/organelle-system";

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
  organelle?: any; // Target organelle
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

  createTranscript(proteinId: ProteinId, atHex?: HexCoord): Cargo {
    // Spawn in nucleus footprint if available, otherwise default position
    const spawnHex = atHex || this.findNucleusOrganelle()?.coord || { q: 0, r: 0 };
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
      console.log(`🚫 CargoSystem: Cargo ${cargo.id} has no position (carried), cannot move`);
      return false;
    }

    if (!cargo.currentStageDestination) {
      console.log(`🚫 CargoSystem: No destination set for cargo ${cargo.id}`);
      return false;
    }

    if (!cargo.reservedSeatId || !cargo.targetOrganelleId) {
      console.log(`🚫 CargoSystem: No seat reservation for cargo ${cargo.id}`);
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
      
      // Reserve a seat in the nucleus for the transcript
      const transcriptId = `transcript_${this.nextCargoId}`;
      const seatId = this.worldRefs.organelleSystem.reserveSeat(nucleusOrganelle.id, transcriptId);
      if (!seatId) {
        console.warn(`🔬 CargoSystem: Failed to reserve seat in nucleus ${nucleusOrganelle.id} for order ${order.id}`);
        continue;
      }
      
      // Get the assigned seat position
      const seatPosition = this.worldRefs.organelleSystem.getSeatPosition(nucleusOrganelle.id, seatId);
      if (!seatPosition) {
        console.warn(`🔬 CargoSystem: Failed to get seat position for ${seatId} in nucleus ${nucleusOrganelle.id}`);
        // Release the seat we just reserved
        this.worldRefs.organelleSystem.releaseSeat(nucleusOrganelle.id, seatId);
        continue;
      }
      
      // Create transcript at the reserved seat position
      console.log(`🔬 CargoSystem: Creating transcript for ${order.proteinId} at nucleus seat (${seatPosition.q}, ${seatPosition.r})`);
      const transcript = this.createTranscript(order.proteinId, seatPosition);
      
      // Set destination and seat information for the transcript
      transcript.destHex = order.destHex;
      transcript.state = 'QUEUED';
      transcript.reservedSeatId = seatId; // Store seat ID for cleanup when transcript moves/expires
      transcript.targetOrganelleId = nucleusOrganelle.id;
      
      // Use itinerary from the install order
      transcript.itinerary = order.itinerary;
      
      console.log(`✅ CargoSystem: Created transcript ${transcript.id} for order ${order.id} with seat ${seatId} and ${transcript.itinerary?.stages.length || 0} stages`);
      
      // Remove processed order
      this.worldRefs.installOrderSystem.removeProcessedOrder(order.id);
    }
  }

  /**
   * Unified routing: Find closest available organelle + path + reserve seat
   */
  @RunOnServer()
  private findBestRouteToOrganelleType(cargo: Cargo, organelleType: OrganelleType): RouteResult {
    console.log(`🎯 findBestRouteToOrganelleType: cargo ${cargo.id} trying to route to ${organelleType}`);

    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    const graph = this.worldRefs.cytoskeletonSystem.graph;
    
    // Filter organelles by type
    const candidateOrganelles = organelles.filter(org => org.type === organelleType);

    console.log(`🎯 Found ${candidateOrganelles.length} organelles of type ${organelleType}`);

    if (candidateOrganelles.length === 0) {
      return { success: false, reason: `No ${organelleType} organelles found` };
    }
    const { atHex } = cargo;

    // Simple teleport-based routing: cargo can teleport to any adjacent organelle with seats
    if (!atHex) {
      console.log(`🔍 Cargo ${cargo.id} has no position (carried), skipping routing`);
      return { success: false, reason: 'Cargo has no position' };
    }

    const currentOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(atHex);
    if (currentOrganelle) {
      console.log(`🔍 Cargo ${cargo.id} in organelle ${currentOrganelle.type}, checking ${candidateOrganelles.length} candidates`);
      for (const candidate of candidateOrganelles) {
        if (this.worldRefs.organelleSystem.areOrganellesAdjacent(currentOrganelle, candidate)) {
          // Check seat availability
          const hasSeats = this.worldRefs.organelleSystem.hasAvailableSeats(candidate.id);
          if (hasSeats) {
            // Release any existing seat before reserving new one (transactional)
            this.releaseSeatReservation(cargo, `Routing to adjacent organelle ${candidate.type}`);
            const seatId = this.worldRefs.organelleSystem.reserveSeat(candidate.id, cargo.id);
            if (seatId) {
              console.log(`🚀 Simple teleport routing: ${cargo.id} from ${currentOrganelle.type} to ${candidate.type}`);
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
        this.releaseSeatReservation(cargo, `Routing to organelle ${result.organelle.type} via cytoskeleton`);
        const seatId = this.worldRefs.organelleSystem.reserveSeat(result.organelle.id, cargo.id);
        if (seatId) {
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
    const inventory = this.getPlayerInventory(this._netBus.localId);
    const showLogs = Math.random() < 0.001; // don't Log more frequently for debugging
    if (showLogs)
      console.log(`🎯 Debug getMyPlayerInventory: localId=${this._netBus.localId}, inventory.length=${inventory.length}`);
    if (inventory.length > 0 && showLogs) {
      console.log(`🎯 Debug inventory cargo: ${inventory.map(c => `${c.id}(carriedBy=${c.carriedBy})`).join(', ')}`);
    }
    return inventory;
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
        cargo.carriedBy = undefined;
        this.setCargoPosition(cargo, hex);
        
        // Attempt auto-routing when cargo is dropped
        this.tryStartAutoRouting(cargo);
        
        // If auto-routing assigned a seat, move cargo to seat position immediately
        if (cargo.reservedSeatId && cargo.targetOrganelleId) {
          this.positionCargoAtSeat(cargo, `Dropped cargo auto-positioning`);
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
    
    console.log(`🎯 Debug startCargoTransit: cargoId=${cargoId}, playerId=${playerId}, cargo.carriedBy=${cargo.carriedBy}`);
    
    // If playerId is provided, validate that the player is actually carrying this cargo
    if (playerId) {
      if (cargo.carriedBy !== playerId) {
        // Try to find cargo in player's inventory as fallback
        const playerInventory = this.getPlayerInventory(playerId);
        const cargoInInventory = playerInventory.find(c => c.id === cargoId);
        
        if (!cargoInInventory) {
          console.warn(`🎯 Player ${playerId} is not carrying cargo ${cargoId} (cargo.carriedBy=${cargo.carriedBy}, not found in inventory)`);
          return false;
        } else {
          console.log(`🎯 Found cargo ${cargoId} in player ${playerId} inventory despite carriedBy mismatch`);
        }
      }
    }
    
    // Clear carried state and mark as thrown
    cargo.carriedBy = undefined;
    cargo.isThrown = true;
    console.log(`🎯 Started cargo transit: ${cargoId} is now thrown and no longer carried`);
    return true;
  }

  @RunOnServer()
  endCargoTransit(cargoId: string, landingPos: HexCoord): boolean {
    const cargo = this.cargoState.cargo[cargoId];
    if (!cargo) {
      console.warn(`🎯 Cargo ${cargoId} not found for landing`);
      return false;
    }
    
    cargo.isThrown = false;
    this.setCargoPosition(cargo, landingPos);
    console.log(`🎯 Ended cargo transit: ${cargoId} landed at (${landingPos.q}, ${landingPos.r})`);
    
    // Attempt auto-routing when cargo lands
    this.tryStartAutoRouting(cargo);
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

      const color = cargo.currentType === 'vesicle' ? 0x00ff00 : 0x0066cc;
      this.graphics.fillStyle(color, 0.8);
      this.graphics.fillCircle(cargo.worldPos.x, cargo.worldPos.y, 6);
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
      console.log(`🚫 CargoSystem: Target organelle ${cargo.targetOrganelleId} not found for cargo ${cargo.id}`);
      return false;
    }

    // Get the actual seat position for validation
    const seatPosition = this.getSeatPositionForCargo(cargo);
    if (!seatPosition) {
      console.log(`🚫 CargoSystem: Seat position not found for cargo ${cargo.id}`);
      return false;
    }

    // Validate destination matches the seat position for all organelles (including transporters)
    if (cargo.currentStageDestination!.q !== seatPosition.q || cargo.currentStageDestination!.r !== seatPosition.r) {
      console.log(`🚫 CargoSystem: Destination mismatch for cargo ${cargo.id}: destination (${cargo.currentStageDestination!.q},${cargo.currentStageDestination!.r}) vs seat (${seatPosition.q},${seatPosition.r})`);
      return false;
    }

    
    return true;
  }

  @RunOnServer()
  private updateProcessingTimers(): void {
    const deltaMs = 1000; // Called every 1000ms from updateAutoRouting
    
    for (const cargo of Object.values(this.cargoState.cargo)) {
      if (cargo.state === 'TRANSFORMING' && cargo.processingTimer > 0) {
        cargo.processingTimer -= deltaMs;
        
        // Ensure timer doesn't go negative
        if (cargo.processingTimer <= 0) {
          cargo.processingTimer = 0;
        }
      }
    }
  }

  @RunOnServer()
  private updateCargoMovement(): void {
    if (!this.worldRefs.cytoskeletonSystem) return;
    
    const graph = this.worldRefs.cytoskeletonSystem.graph;
    
    for (const cargo of Object.values(this.cargoState.cargo)) {
      if (cargo.state === 'MOVING' && cargo.segmentState && !cargo.carriedBy) {
        
        // Re-evaluate if destination is still valid before each movement step
        if (!this.validateCurrentDestination(cargo)) {
          console.log(`🔄 CargoSystem: Destination no longer valid for cargo ${cargo.id}, rerouting`);
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
    
    console.log(`🚛 CargoSystem: tryStartAutoRouting for cargo ${cargo.id}, current stage: ${cargo.itinerary.stageIndex}/${cargo.itinerary.stages.length-1}`);
    console.log(`🚛 Stages: ${cargo.itinerary.stages.map((s, i) => `${i}: ${s.kind}`).join(', ')}`);
    
    const destination = this.determineNextStageDestination(cargo);
    if (!destination) {
      console.log(`🚫 CargoSystem: No destination found for cargo ${cargo.id} - setting state to BLOCKED`);
      cargo.state = 'BLOCKED'; // Set cargo state to blocked when pathfinding fails
      cargo.targetOrganelleId = undefined; // Clear stale target when routing fails
      cargo.currentStageDestination = undefined; // Clear stale destination
      this.blockedCargo.add(cargo.id); // Add to retry queue
      this.cargoFailureTimes.set(cargo.id, now); // Record failure time
      return;
    }
    
    cargo.currentStageDestination = destination;
    
    // Check if cargo is already at the destination (same organelle processing)
    if (this.isCargoAtPosition(cargo, destination)) {
      console.log(`🎯 CargoSystem: Cargo ${cargo.id} already at destination (${destination.q}, ${destination.r}), proceeding directly to stage arrival`);
      this.handleStageArrival(cargo);
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
      console.log(`🚫 CargoSystem: Cargo ${cargo.id} blocked, added to retry queue`);
    }
  }

  @RunOnServer()
  private determineNextStageDestination(cargo: Cargo): { q: number; r: number } | null {
    if (!cargo.itinerary) return null;
    
    const currentStage = cargo.itinerary.stages[cargo.itinerary.stageIndex];
    if (!currentStage) return null; // No more stages
    
    console.log(`🎯 determineNextStageDestination: cargo ${cargo.id} stage ${cargo.itinerary.stageIndex}/${cargo.itinerary.stages.length-1} -> ${currentStage.kind}`);
    console.log(`🎯 Full itinerary:`, cargo.itinerary.stages.map((stage, i) => `${i}: ${stage.kind}`));
    console.log(`🎯 About to call findBestRouteToOrganelleType with organelleType: "${currentStage.kind}"`);
    
    // Check if cargo is already in the target organelle type - if so, skip routing
    if (cargo.atHex) {
      const currentOrganelle = this.worldRefs.organelleSystem.getOrganelleAtTile(cargo.atHex);
      if (currentOrganelle && currentOrganelle.type === currentStage.kind) {
        console.log(`🎯 CargoSystem: Cargo ${cargo.id} already in target organelle ${currentOrganelle.type} (${currentOrganelle.id}), staying put`);
        // Update targetOrganelleId to match current location since we're staying
        cargo.targetOrganelleId = currentOrganelle.id;
        return cargo.atHex; // Stay at current position, no routing needed
      }
    }
    
    // For organelle stages, use unified routing to find best available organelle
    const routeResult = this.findBestRouteToOrganelleType(cargo, currentStage.kind);
    if (routeResult.success && routeResult.organelle) {
      // Store the seat reservation info for this cargo
      if (routeResult.seatId) {
        cargo.reservedSeatId = routeResult.seatId;
        cargo.targetOrganelleId = routeResult.organelle.id;
      }
      
      // Return the seat position, not the organelle center
      if (this.validateCargoForMovement(cargo)) {
        const seatPosition = this.getSeatPositionForCargo(cargo);
        if (seatPosition) {
          return seatPosition;
        }
      }
      
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
        // Direct teleport for adjacent organelles
        console.log(`🚀 CargoSystem: Direct teleport for cargo ${cargo.id} from ${currentOrganelle.type} to ${targetOrganelle.type} at (${seatPosition.q}, ${seatPosition.r})`);
        
        // Move cargo directly to the seat position
        this.setCargoPosition(cargo, seatPosition);
        
        // Immediately trigger arrival
        this.onMovementComplete(cargo.id, seatPosition);
        
        return true;
      }
    }
    
    // Fallback to cytoskeleton pathfinding for non-adjacent movement
    console.log(`🚀 CargoSystem: Cytoskeleton movement for cargo ${cargo.id} to seat at (${seatPosition.q}, ${seatPosition.r})`);
    
    const graph = this.worldRefs.cytoskeletonSystem.graph;
    
    // Check if path exists to current destination
    const pathResult = graph.findPath(cargo.atHex!, seatPosition, cargo.currentType);
    if (!pathResult.success) {
      console.log(`🚫 CargoSystem: No path found for cargo ${cargo.id}: ${pathResult.reason}`);
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
          console.log(`✅ CargoSystem: Unblocked cargo ${cargoId}`);
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
        console.log(`🏁 CargoSystem: Cargo ${cargo.id} completed all stages`);
        this.performProteinInstallation(cargo);
      }
    }, currentStage.processMs);
  }

  @RunOnServer()
  private performProteinInstallation(cargo: Cargo): void {
    console.log(`🔧 CargoSystem: Installing protein ${cargo.proteinId} from cargo ${cargo.id}`);
    
    // Get the target organelle where the protein should be installed
    const targetOrganelle = this.worldRefs.organelleSystem.getOrganelle(cargo.targetOrganelleId!);
    if (!targetOrganelle) {
      console.error(`❌ CargoSystem: Target organelle ${cargo.targetOrganelleId} not found for protein installation`);
      this.removeCargo(cargo.id);
      return;
    }

    // Install the protein at the organelle location
    try {
      // For transporter organelles, install the protein as a membrane transporter
      if (targetOrganelle.type === 'transporter') {
        this.installMembraneProtein(cargo.proteinId, targetOrganelle.coord);
      } else {
        console.warn(`🚧 CargoSystem: Protein installation for ${targetOrganelle.type} organelles not yet implemented`);
      }
      
      console.log(`✅ CargoSystem: Successfully installed ${cargo.proteinId} into ${targetOrganelle.type} ${targetOrganelle.id}`);
    } catch (error) {
      console.error(`❌ CargoSystem: Failed to install protein ${cargo.proteinId}:`, error);
    }

    // Clean up the cargo - release seat and remove from system
    this.releaseSeatReservation(cargo, 'Protein installation completed');
    this.removeCargo(cargo.id);
  }

  @RunOnServer()
  private installMembraneProtein(proteinId: ProteinId, coord: HexCoord): boolean {
    // Use the membrane exchange system's proper protein installation method
    // This will populate the installedProteins map and show in tile info
    const success = this.worldRefs.membraneExchangeSystem.installMembraneProtein(coord, proteinId);
    
    if (success) {
      console.log(`🧬 CargoSystem: Installed ${proteinId} at (${coord.q}, ${coord.r})`);
    } else {
      console.error(`❌ CargoSystem: Failed to install ${proteinId} at (${coord.q}, ${coord.r})`);
    }
    
    return success;
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
