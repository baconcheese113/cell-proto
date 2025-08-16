/**
 * Entity Replicator - Manages entity replication for multiplayer
 * 
 * Handles serialization, ID management, and delta compression for:
 * - Cargo (transcripts, vesicles)
 * - Seats/queues 
 * - Rails
 * - Builds/upgrades
 * - Membrane installs
 */

import type { WorldRefs, Transcript, Vesicle, InstallOrder } from "../core/world-refs";
import type { 
  NetworkCargo, 
  NetworkSeat, 
  NetworkRail, 
  NetworkBuild, 
  NetworkInstall,
  NetworkOrganelle,
  NetworkBlueprint,
  NetworkSpecies,
  NetworkMembraneProtein,
  NetworkEntityManager
} from "./schema";
import type { HexCoord } from "../hex/hex-grid";
import { getOrganelleDefinition, definitionToConfig } from "../organelles/organelle-registry";

// Debug flags - Set to true to enable specific logging categories
const DEBUG_RAILS = false; // Set to true to see detailed rail replication logs
const DEBUG_SPECIES = false; // Set to true to see species replication logs
const DEBUG_CARGO = true; // Set to true to see cargo replication logs - ENABLED to debug membrane proteins
const DEBUG_SEATS = false; // Set to true to see seat replication logs
const DEBUG_ORGANELLES = false; // Set to true to see organelle replication logs
const DEBUG_BLUEPRINTS = false; // Set to true to see blueprint replication logs

// Helper function to get short timestamp for debugging
function getTimestamp(): string {
  const now = new Date();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
  return `${minutes}:${seconds}.${milliseconds}`;
}

export class EntityReplicator implements NetworkEntityManager {
  private lastCargoSnapshot = new Map<string, NetworkCargo>();
  private lastSeatSnapshot = new Map<string, NetworkSeat>();
  // TODO: Implement rail/build/install delta compression
  // private lastRailSnapshot = new Map<string, NetworkRail>();
  // private lastBuildSnapshot = new Map<string, NetworkBuild>();
  // private lastInstallSnapshot = new Map<string, NetworkInstall>();
  
  constructor(private worldRefs: WorldRefs) {}
  
  // ============================================================================
  // Entity ID Management
  // ============================================================================
  
  getPlayerId(player: any): string {
    return player.id || 'unknown';
  }
  
  getCargoId(cargo: Transcript | Vesicle): string {
    return cargo.id;
  }
  
  getOrganelleId(organelle: any): string {
    return organelle.id || 'unknown';
  }
  
  getFilamentId(filament: any): string {
    return filament.id || 'unknown';
  }
  
  getBuildId(build: any): string {
    return build.id || 'unknown';
  }
  
  getInstallId(install: InstallOrder): string {
    return install.id;
  }
  
  // ============================================================================
  // Entity Serialization
  // ============================================================================
  
  /**
   * Serialize all cargo entities (transcripts + vesicles)
   */
  serializeCargo(): NetworkCargo[] {
    const cargo: NetworkCargo[] = [];
    
    // Serialize transcripts
    for (const transcript of this.worldRefs.transcripts.values()) {
      cargo.push(this.serializeTranscript(transcript));
    }
    
    // Serialize carried transcripts
    for (const transcript of this.worldRefs.carriedTranscripts) {
      cargo.push(this.serializeTranscript(transcript));
    }
    
    // Serialize vesicles
    for (const vesicle of this.worldRefs.vesicles.values()) {
      cargo.push(this.serializeVesicle(vesicle));
    }
    
    // Serialize carried vesicles
    for (const vesicle of this.worldRefs.carriedVesicles) {
      cargo.push(this.serializeVesicle(vesicle));
    }
    
    // Debug logging for entity counts (throttled to reduce spam)
    if (cargo.length > 0) {
      if (DEBUG_CARGO && Math.random() < 0.01) { // Only log 1% of the time
        console.log(`🔄 Serializing ${cargo.length} cargo entities (${this.worldRefs.transcripts.size} transcripts, ${this.worldRefs.vesicles.size} vesicles)`);
      }
    }

    return cargo;
    
    return cargo;
  }
  
  private serializeTranscript(transcript: Transcript): NetworkCargo {
    let state: NetworkCargo['state'] = 'free';
    if (transcript.isThrown) state = 'thrown';
    else if (transcript.isCarried) state = 'carried';
    else if (transcript.state === 'processing_at_er') state = 'processing';
    
    return {
      id: transcript.id,
      type: `transcript:${transcript.proteinId}`,
      pos: { x: transcript.worldPos.x, y: transcript.worldPos.y },
      state,
      ttl: transcript.ttlSeconds,
      progress: transcript.processingTimer
    };
  }
  
  private serializeVesicle(vesicle: Vesicle): NetworkCargo {
    let state: NetworkCargo['state'] = 'free';
    if (vesicle.isThrown) state = 'thrown';
    else if (vesicle.isCarried) state = 'carried';
    else if (vesicle.state === 'QUEUED_ER' || vesicle.state === 'QUEUED_GOLGI') state = 'seat';
    else if (vesicle.state === 'EN_ROUTE_GOLGI' || vesicle.state === 'EN_ROUTE_MEMBRANE') state = 'rail';
    else if (vesicle.state === 'INSTALLING') state = 'processing';
    else if (vesicle.state === 'BLOCKED') state = 'blocked'; // Add proper BLOCKED state mapping
    
    return {
      id: vesicle.id,
      type: `vesicle:${vesicle.proteinId}:${vesicle.glyco}`,
      pos: { x: vesicle.worldPos.x, y: vesicle.worldPos.y },
      state,
      routeStageIndex: vesicle.itinerary?.stageIndex,
      destHex: vesicle.destHex ? { ...vesicle.destHex } : undefined,
      ttl: vesicle.ttlMs / 1000, // Convert to seconds
      progress: vesicle.processingTimer
    };
  }
  
  /**
   * Serialize seat/queue information for all organelles
   */
  serializeSeats(): NetworkSeat[] {
    const seats: NetworkSeat[] = [];
    
    // Get seat information from organelle system
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    for (const organelle of organelles) {
      const seatInfo = this.worldRefs.organelleSystem.getSeatInfo(organelle.id);
      if (seatInfo) {
        seats.push({
          organelleId: organelle.id,
          used: seatInfo.occupied,
          total: seatInfo.capacity,
          queuedIds: this.getQueuedCargoForOrganelle(organelle.id)
        });
      }
    }
    
    return seats;
  }
  
  private getQueuedCargoForOrganelle(organelleId: string): string[] {
    const queuedIds: string[] = [];
    
    // Check vesicles queued at this organelle
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if ((vesicle.state === 'QUEUED_ER' || vesicle.state === 'QUEUED_GOLGI') &&
          vesicle.railState?.nodeId === organelleId) {
        queuedIds.push(vesicle.id);
      }
    }
    
    return queuedIds;
  }
  
  /**
   * Serialize rail/cytoskeleton utilization
   */
  serializeRails(): NetworkRail[] {
    const rails: NetworkRail[] = [];
    
    // Get rail utilization from cytoskeleton system
    if (this.worldRefs.cytoskeletonGraph && this.worldRefs.cytoskeletonSystem) {
      const edges = this.worldRefs.cytoskeletonGraph.getAllEdges?.() || [];
      
      for (const edge of edges) {
        // Get the corresponding segment for full data
        // Edge IDs have "edge_" prefix, but segment IDs don't
        const segmentId = edge.id.startsWith('edge_') ? edge.id.substring(5) : edge.id;
        const segment = this.worldRefs.cytoskeletonSystem.getSegment?.(segmentId);
        
        const rail: NetworkRail = {
          segmentId: edge.id,
          utilization: edge.utilization || 0,
          active: edge.active !== false
        };
        
        // Include full segment data for proper replication
        if (segment) {
          rail.segmentData = {
            type: segment.type as 'actin' | 'microtubule',
            fromHex: { ...segment.fromHex },
            toHex: { ...segment.toHex },
            capacity: segment.capacity,
            speed: segment.speed,
            currentLoad: segment.currentLoad,
            buildCost: { ...segment.buildCost },
            upkeepCost: segment.upkeepCost
          };
        }
        
        rails.push(rail);
      }
      
      // Only log when there are rails to serialize and occasionally for debugging
      if (rails.length > 0 && DEBUG_RAILS) {
        console.log(`🚄 [HOST] Serializing ${rails.length} rail segments`);
        // Debug: Show first few rails
        console.log(`🚄 [HOST] Sample rails:`, rails.slice(0, 3).map(r => `${r.segmentId}(${r.utilization.toFixed(2)}, active:${r.active})`));
        
        // Debug: Check if segment data is being included occasionally
        if (Math.random() < 0.1) {
          const railsWithData = rails.filter(r => r.segmentData);
          console.log(`🚄 [HOST] ${railsWithData.length}/${rails.length} rails have segmentData`);
          if (railsWithData.length > 0) {
            console.log(`🚄 [HOST] Sample segmentData:`, railsWithData.slice(0, 2).map(r => `${r.segmentId}: ${r.segmentData!.type} (${r.segmentData!.fromHex.q},${r.segmentData!.fromHex.r})->(${r.segmentData!.toHex.q},${r.segmentData!.toHex.r})`));
          }
        }
      } else if (rails.length === 0 && DEBUG_RAILS) {
        // Debug: Check if the cytoskeleton system has segments but graph doesn't
        const allSegments = this.worldRefs.cytoskeletonSystem?.allSegments;
        const segmentCount = allSegments ? allSegments.size : 0;
        
        // Only log the "0 edges" message occasionally to avoid spam, but include segment count
        if (Math.random() < 0.05) {
          console.log(`🚄 [HOST] Found cytoskeletonGraph with ${edges.length} edges, but cytoskeletonSystem has ${segmentCount} segments`);
          
          // If there are segments but no edges, there might be a timing or reference issue
          if (segmentCount > 0 && edges.length === 0) {
            console.warn(`🚄 [HOST] WARNING: CytoskeletonSystem has ${segmentCount} segments but graph has 0 edges - possible timing issue!`);
          }
        }
      }
    } else {
      // Only warn occasionally about missing cytoskeletonGraph
      if (Math.random() < 0.01) {
        console.warn(`🚄 [HOST] No cytoskeletonGraph found in worldRefs!`);
      }
    }
    
    return rails;
  }
  
  /**
   * Serialize build/upgrade orders
   */
  serializeBuilds(): NetworkBuild[] {
    const builds: NetworkBuild[] = [];
    
    // Get builds from blueprint system - simplified for now
    // TODO: Implement proper blueprint type and progress tracking
    const blueprints = this.worldRefs.blueprintSystem.getAllBlueprints?.() || [];
    for (const blueprint of blueprints) {
      builds.push({
        id: blueprint.id,
        type: 'organelle', // Default type for now
        hex: { q: 0, r: 0 }, // TODO: Get actual hex from blueprint
        progress: 0, // TODO: Track build progress
        playerId: undefined // TODO: Track player who initiated build
      });
    }
    
    return builds;
  }
  
  /**
   * Serialize membrane install orders
   */
  serializeInstalls(): NetworkInstall[] {
    const installs: NetworkInstall[] = [];
    
    for (const install of this.worldRefs.installOrders.values()) {
      installs.push({
        id: install.id,
        proteinId: install.proteinId,
        destHex: install.destHex,
        progress: this.getInstallProgress(install.id),
        playerId: this.getInstallPlayerId(install.id)
      });
    }
    
    return installs;
  }
  
  private getInstallProgress(installId: string): number {
    // Get the install order to find the vesicle working on it
    const installOrder = this.worldRefs.installOrders.get(installId);
    if (!installOrder) return 0;
    
    // Check if vesicle is currently installing this order (match by destHex and proteinId)
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (vesicle.state === 'INSTALLING' && 
          vesicle.proteinId === installOrder.proteinId &&
          vesicle.destHex.q === installOrder.destHex.q &&
          vesicle.destHex.r === installOrder.destHex.r) {
        return 1.0 - (vesicle.processingTimer / 2.5); // 2.5s install time based on vesicle-system.ts
      }
    }
    return 0;
  }
  
  private getInstallPlayerId(_installId: string): string | undefined {
    // This would need to be tracked separately in practice
    return undefined;
  }
  
  // ============================================================================
  // Delta Compression
  // ============================================================================
  
  /**
   * Get cargo delta since last snapshot
   */
  getCargoDelta(): { added: NetworkCargo[], removed: string[], updated: NetworkCargo[] } {
    const current = new Map<string, NetworkCargo>();
    const serialized = this.serializeCargo();
    
    for (const cargo of serialized) {
      current.set(cargo.id, cargo);
    }
    
    const added: NetworkCargo[] = [];
    const updated: NetworkCargo[] = [];
    const removed: string[] = [];
    
    // Find added and updated
    for (const [id, cargo] of current) {
      const last = this.lastCargoSnapshot.get(id);
      if (!last) {
        added.push(cargo);
      } else if (this.hasCargoChanged(last, cargo)) {
        updated.push(cargo);
      }
    }
    
    // Find removed
    for (const id of this.lastCargoSnapshot.keys()) {
      if (!current.has(id)) {
        removed.push(id);
      }
    }
    
    // Update snapshot for next comparison
    this.lastCargoSnapshot = current;
    
    return { added, removed, updated };
  }
  
  private hasCargoChanged(last: NetworkCargo, current: NetworkCargo): boolean {
    return (
      last.pos.x !== current.pos.x ||
      last.pos.y !== current.pos.y ||
      last.state !== current.state ||
      last.routeStageIndex !== current.routeStageIndex ||
      Math.abs((last.ttl || 0) - (current.ttl || 0)) > 0.1 ||
      Math.abs((last.progress || 0) - (current.progress || 0)) > 0.01
    );
  }
  
  /**
   * Get seat delta since last snapshot
   */
  getSeatsDelta(): { added: NetworkSeat[], removed: string[], updated: NetworkSeat[] } {
    const current = new Map<string, NetworkSeat>();
    const serialized = this.serializeSeats();
    
    for (const seat of serialized) {
      current.set(seat.organelleId, seat);
    }
    
    const added: NetworkSeat[] = [];
    const updated: NetworkSeat[] = [];
    const removed: string[] = [];
    
    // Find added and updated
    for (const [id, seat] of current) {
      const last = this.lastSeatSnapshot.get(id);
      if (!last) {
        added.push(seat);
      } else if (this.hasSeatChanged(last, seat)) {
        updated.push(seat);
      }
    }
    
    // Find removed
    for (const id of this.lastSeatSnapshot.keys()) {
      if (!current.has(id)) {
        removed.push(id);
      }
    }
    
    // Update snapshot for next comparison
    this.lastSeatSnapshot = current;
    
    return { added, removed, updated };
  }
  
  private hasSeatChanged(last: NetworkSeat, current: NetworkSeat): boolean {
    return (
      last.used !== current.used ||
      last.total !== current.total ||
      JSON.stringify(last.queuedIds) !== JSON.stringify(current.queuedIds)
    );
  }
  
  // ============================================================================
  // Entity Application (Client-side)
  // ============================================================================
  
  /**
   * Apply cargo updates to local game state (client only)
   */
  applyCargo(cargo: NetworkCargo[]): void {
    if (cargo.length > 0) {
      // Only log occasionally to reduce spam (every ~50th application)
      if (DEBUG_CARGO && Math.random() < 0.02) {
        console.log(`📥 Applying ${cargo.length} cargo entities from network`);
      }
    }
    
    for (const networkCargo of cargo) {
      this.applyCargoEntity(networkCargo);
    }
  }
  
  private applyCargoEntity(networkCargo: NetworkCargo): void {
    const [type, ...parts] = networkCargo.type.split(':');
    
    if (type === 'transcript') {
      const proteinId = parts[0] as any;
      let transcript = this.worldRefs.transcripts.get(networkCargo.id);
      
      if (!transcript) {
        // Create new transcript
        transcript = {
          id: networkCargo.id,
          proteinId,
          atHex: { q: 0, r: 0 }, // Will be updated from worldPos
          ttlSeconds: networkCargo.ttl || 60,
          worldPos: new Phaser.Math.Vector2(networkCargo.pos.x, networkCargo.pos.y),
          isCarried: networkCargo.state === 'carried',
          isThrown: networkCargo.state === 'thrown',
          moveAccumulator: 0,
          state: networkCargo.state === 'processing' ? 'processing_at_er' : 'traveling',
          processingTimer: networkCargo.progress || 0,
          glycosylationState: 'none',
          isNetworkControlled: true // Mark as network-controlled to prevent local system interference
        };
        
        this.worldRefs.transcripts.set(networkCargo.id, transcript);
        
        if (DEBUG_CARGO) {
          console.log(`🔧 Created new transcript ${transcript.id} with isNetworkControlled: ${transcript.isNetworkControlled}, state: ${networkCargo.state}`);
        }
        
        // Manage carried arrays for visual rendering
        this.updateCarriedArrays(transcript, networkCargo.state, 'transcript');
      } else {
        // Update existing transcript
        transcript.worldPos.set(networkCargo.pos.x, networkCargo.pos.y);
        transcript.atHex = this.worldRefs.hexGrid.worldToHex(networkCargo.pos.x, networkCargo.pos.y);
        transcript.isCarried = networkCargo.state === 'carried';
        transcript.isThrown = networkCargo.state === 'thrown';
        transcript.ttlSeconds = networkCargo.ttl || transcript.ttlSeconds;
        transcript.processingTimer = networkCargo.progress || 0;
        transcript.isNetworkControlled = true; // Mark as network-controlled
        
        if (DEBUG_CARGO) {
          console.log(`🔧 Updated transcript ${transcript.id} with isNetworkControlled: ${transcript.isNetworkControlled}, state: ${networkCargo.state}`);
        }
        
        // Manage carried arrays for visual rendering
        this.updateCarriedArrays(transcript, networkCargo.state, 'transcript');
      }
    } else if (type === 'vesicle') {
      const proteinId = parts[0] as any;
      const glyco = parts[1] as any;
      let vesicle = this.worldRefs.vesicles.get(networkCargo.id);
      
      if (!vesicle) {
        // Create new vesicle
        vesicle = {
          id: networkCargo.id,
          proteinId,
          atHex: { q: 0, r: 0 }, // Will be updated from worldPos
          ttlMs: (networkCargo.ttl || 60) * 1000,
          worldPos: new Phaser.Math.Vector2(networkCargo.pos.x, networkCargo.pos.y),
          isCarried: networkCargo.state === 'carried',
          isThrown: networkCargo.state === 'thrown',
          destHex: networkCargo.destHex || { q: 0, r: 0 },
          state: this.networkStateToVesicleState(networkCargo.state, undefined, networkCargo.destHex),
          glyco,
          processingTimer: networkCargo.progress || 0,
          retryCounter: 0,
          isNetworkControlled: true // Mark as network-controlled to prevent local system interference
        };
        
        this.worldRefs.vesicles.set(networkCargo.id, vesicle);
        
        if (DEBUG_CARGO) {
          console.log(`🔧 Created new vesicle ${vesicle.id} with isNetworkControlled: ${vesicle.isNetworkControlled}, state: ${networkCargo.state}`);
        }
        
        // Manage carried arrays for visual rendering
        this.updateCarriedArrays(vesicle, networkCargo.state, 'vesicle');
      } else {
        // Update existing vesicle
        vesicle.worldPos.set(networkCargo.pos.x, networkCargo.pos.y);
        vesicle.atHex = this.worldRefs.hexGrid.worldToHex(networkCargo.pos.x, networkCargo.pos.y);
        vesicle.isCarried = networkCargo.state === 'carried';
        vesicle.isThrown = networkCargo.state === 'thrown';
        vesicle.ttlMs = (networkCargo.ttl || vesicle.ttlMs / 1000) * 1000;
        vesicle.state = this.networkStateToVesicleState(networkCargo.state, vesicle, networkCargo.destHex);
        vesicle.processingTimer = networkCargo.progress || 0;
        vesicle.isNetworkControlled = true; // Mark as network-controlled
        
        // Update destination if provided
        if (networkCargo.destHex) {
          vesicle.destHex = { ...networkCargo.destHex };
        }
        
        if (networkCargo.routeStageIndex !== undefined && vesicle.itinerary) {
          vesicle.itinerary.stageIndex = networkCargo.routeStageIndex;
        }
        
        if (DEBUG_CARGO) {
          console.log(`🔧 Updated vesicle ${vesicle.id} with isNetworkControlled: ${vesicle.isNetworkControlled}, state: ${networkCargo.state}`);
        }
        
        // Manage carried arrays for visual rendering
        this.updateCarriedArrays(vesicle, networkCargo.state, 'vesicle');
      }
    }
  }
  
  private networkStateToVesicleState(networkState: NetworkCargo['state'], vesicle?: Vesicle, destHex?: HexCoord): any {
    switch (networkState) {
      case 'free': 
        // Use destination information if available to determine route
        if (destHex && this.isMembraneLocation(destHex)) return 'EN_ROUTE_MEMBRANE';
        if (vesicle?.state === 'EN_ROUTE_MEMBRANE') return 'EN_ROUTE_MEMBRANE';
        return 'EN_ROUTE_GOLGI';
      case 'carried': 
        // When carried, the underlying state should be preserved
        if (destHex && this.isMembraneLocation(destHex)) return 'EN_ROUTE_MEMBRANE';
        if (vesicle?.state === 'EN_ROUTE_MEMBRANE') return 'EN_ROUTE_MEMBRANE';
        return 'EN_ROUTE_GOLGI';
      case 'rail': 
        // For rail state, use destination to determine correct EN_ROUTE state
        if (destHex && this.isMembraneLocation(destHex)) return 'EN_ROUTE_MEMBRANE';
        if (vesicle?.state === 'EN_ROUTE_MEMBRANE') return 'EN_ROUTE_MEMBRANE';
        return 'EN_ROUTE_GOLGI';
      case 'seat': return 'QUEUED_GOLGI';
      case 'processing': return 'INSTALLING';
      case 'blocked': return 'BLOCKED';
      default: return 'EN_ROUTE_GOLGI';
    }
  }

  private isMembraneLocation(hex: HexCoord): boolean {
    // Check if the destination is a membrane location by looking for transporters
    const organelle = this.worldRefs.organelleSystem.getOrganelleAtTile(hex);
    return organelle?.type === 'transporter';
  }
  
  /**
   * Apply seat updates to local game state (client only)
   */
  applySeats(seats: NetworkSeat[]): void {
    // Only log when there are actually seat changes, not every empty update
    if (seats.length > 0) {
      // Use probabilistic logging to reduce spam - only log 5% of the time
      if (Math.random() < 0.05) {
      if (DEBUG_SEATS) {
        console.log(`🪑 Applying ${seats.length} seat updates from network`);
      }
      }
    }
    
    let hasChanges = false;
    for (const networkSeat of seats) {
      const result = this.applySeatEntity(networkSeat);
      if (result) hasChanges = true;
    }
    
    // Trigger visual update if seats changed (queue badges)
    if (hasChanges && this.worldRefs.cellOverlays) {
      // Check if render method exists before calling it
      if (typeof this.worldRefs.cellOverlays.render === 'function') {
        this.worldRefs.cellOverlays.render();
        // Only log visual updates occasionally
        if (Math.random() < 0.1) {
          if (DEBUG_SEATS) {
            console.log(`🪑 🎨 Updated cell overlays after seat sync`);
          }
        }
      } else {
        // Fallback: try update method if render doesn't exist
        if (typeof this.worldRefs.cellOverlays.update === 'function') {
          this.worldRefs.cellOverlays.update();
        } else {
          console.warn(`🪑 ⚠️ CellOverlays exists but has no render() or update() method`);
        }
      }
    } else if (!this.worldRefs.cellOverlays) {
      // Only warn occasionally about missing cellOverlays to avoid spam
      if (Math.random() < 0.01) {
        console.warn(`🪑 ⚠️ No cellOverlays system available for visual updates`);
      }
    }
  }
  
  private applySeatEntity(networkSeat: NetworkSeat): boolean {
    const organelleSystem = this.worldRefs.organelleSystem;
    const organelle = organelleSystem.getOrganelle(networkSeat.organelleId);
    
    if (!organelle) {
      console.warn(`🪑 Organelle not found for seat update: ${networkSeat.organelleId}`);
      return false;
    }
    
    // Update organelle capacity to match network
    if (organelle.capacity !== networkSeat.total) {
      organelle.capacity = networkSeat.total;
    }
    
    // Clear existing seats and rebuild from network data
    organelle.seats.clear();
    
    // Create seat entries for queued items
    for (let i = 0; i < networkSeat.queuedIds.length; i++) {
      const vesicleId = networkSeat.queuedIds[i];
      const seatId = `${networkSeat.organelleId}-seat-${i}`;
      
      organelle.seats.set(seatId, {
        vesicleId: vesicleId,
        reservedAt: Date.now(),
        position: organelle.coord // Use organelle center for simplicity
      });
    }
    
    // Only log seat details occasionally to reduce spam
    if (Math.random() < 0.01) {
    if (DEBUG_SEATS) {
      console.log(`🪑 Updated seats for ${networkSeat.organelleId}: ${networkSeat.used}/${networkSeat.total} (${networkSeat.queuedIds.length} queued)`);
    }
    }
    return true; // Indicate changes were made
  }
  
  /**
   * Remove entities that no longer exist (including cargo destroyed during installation)
   */
  removeCargoEntities(removedIds: string[]): void {
    let removeCount = 0;
    
    for (const id of removedIds) {
      // Remove from main collections
      const hadTranscript = this.worldRefs.transcripts.delete(id);
      const hadVesicle = this.worldRefs.vesicles.delete(id);
      
      if (hadTranscript || hadVesicle) {
        removeCount++;
        if (DEBUG_CARGO && Math.random() < 0.1) {
          console.log(`🧪 [CLIENT@${getTimestamp()}] Removed ${hadTranscript ? 'transcript' : 'vesicle'} ${id} (installation complete or expired)`);
        }
      }
      
      // Remove from carried lists
      const transcriptIndex = this.worldRefs.carriedTranscripts.findIndex(t => t.id === id);
      if (transcriptIndex !== -1) {
        this.worldRefs.carriedTranscripts.splice(transcriptIndex, 1);
      }
      
      const vesicleIndex = this.worldRefs.carriedVesicles.findIndex(v => v.id === id);
      if (vesicleIndex !== -1) {
        this.worldRefs.carriedVesicles.splice(vesicleIndex, 1);
      }
    }
    
    // Also check for install order completion - remove completed install orders
    this.removeCompletedInstallOrders();
    
    if (DEBUG_CARGO && removeCount > 0) {
      console.log(`🧪 [CLIENT@${getTimestamp()}] Removed ${removeCount} cargo entities from replication`);
    }
  }
  
  /**
   * Remove install orders that have been completed (no longer in host snapshot)
   */
  private removeCompletedInstallOrders(): void {
    // This will be called when we detect missing install orders in the snapshot
    // For now, we'll let the install delta system handle this
  }

  /**
   * Serialize placed organelles
   */
  serializeOrganelles(): NetworkOrganelle[] {
    const organelles: NetworkOrganelle[] = [];
    
    // Get organelles from organelle system
    const organelleInstances = this.worldRefs.organelleSystem.getAllOrganelles();
    for (const organelle of organelleInstances) {
      organelles.push({
        id: organelle.id,
        type: organelle.type,
        hex: organelle.coord,
        health: 100, // TODO: Add health to Organelle interface
        tier: 1 // TODO: Add tier to Organelle interface
      });
    }
    
    return organelles;
  }

  /**
   * Serialize installed membrane proteins
   */
  serializeMembraneProteins(): NetworkMembraneProtein[] {
    const membraneProteins: NetworkMembraneProtein[] = [];
    
    // Get installed proteins from membrane exchange system
    if (this.worldRefs.membraneExchangeSystem) {
      const installedProteins = (this.worldRefs.membraneExchangeSystem as any).installedProteins;
      if (installedProteins) {
        for (const [tileKey, installed] of installedProteins.entries()) {
          const [q, r] = tileKey.split(',').map(Number);
          
          membraneProteins.push({
            hex: { q, r },
            proteinId: installed.proteinId,
            instanceId: installed.instanceId,
            isActive: installed.isActive,
            glycosylationStatus: installed.glycosylationStatus || 'complete',
            throughputMultiplier: installed.throughputMultiplier || 1.0
          });
        }
      }
    }
    
    // Debug logging occasionally
    if (membraneProteins.length > 0 && DEBUG_CARGO && Math.random() < 0.1) {
      console.log(`🧪 [HOST@${getTimestamp()}] Serializing ${membraneProteins.length} installed membrane proteins`);
    }
    
    return membraneProteins;
  }
  serializeBlueprints(): NetworkBlueprint[] {
    const blueprints: NetworkBlueprint[] = [];
    
    // Safety check: Ensure blueprintSystem is initialized
    if (!this.worldRefs.blueprintSystem) {
      console.warn(`🏗️ [HOST] BlueprintSystem not initialized yet, skipping blueprint serialization`);
      return blueprints;
    }
    
    // Get organelle blueprints from blueprint system
    const blueprintInstances = this.worldRefs.blueprintSystem.getAllBlueprints();
    for (const blueprint of blueprintInstances) {
      blueprints.push({
        id: blueprint.id,
        type: 'organelle',
        recipeId: blueprint.recipeId,
        hex: blueprint.anchorCoord,
        progress: blueprint.progress,
        totalProgress: blueprint.totalProgress,
        completed: blueprint.totalProgress >= this.getBlueprintRequiredProgress()
      });
    }
    
    // Get cytoskeleton blueprints from cytoskeleton system
    if (this.worldRefs.cytoskeletonSystem) {
      const cytoskeletonBlueprints = this.worldRefs.cytoskeletonSystem.getActiveBlueprints();
      if (cytoskeletonBlueprints.length > 0) {
      if (DEBUG_BLUEPRINTS) {
        console.log(`🏗️ [HOST] Serializing ${cytoskeletonBlueprints.length} cytoskeleton blueprints`);
      }
      }
      for (const blueprint of cytoskeletonBlueprints) {
        blueprints.push({
          id: blueprint.id,
          type: 'cytoskeleton',
          recipeId: `${blueprint.type}_filament`, // Generate a recipe ID for cytoskeleton
          hex: blueprint.fromHex, // Use fromHex as the anchor point
          progress: {
            AA: blueprint.progress.AA,
            PROTEIN: blueprint.progress.PROTEIN
          },
          totalProgress: blueprint.progress.AA + blueprint.progress.PROTEIN,
          completed: (blueprint.progress.AA >= blueprint.required.AA && 
                     blueprint.progress.PROTEIN >= blueprint.required.PROTEIN),
          cytoskeletonData: {
            filamentType: blueprint.type,
            fromHex: blueprint.fromHex,
            toHex: blueprint.toHex,
            required: {
              AA: blueprint.required.AA,
              PROTEIN: blueprint.required.PROTEIN
            }
          }
        });
      }
    } else {
      // Only warn occasionally if cytoskeleton system is missing to avoid spam
      if (Math.random() < 0.01) {
        console.warn(`🏗️ [HOST] CytoskeletonSystem not initialized yet, skipping cytoskeleton blueprint serialization`);
      }
    }
    
    return blueprints;
  }

  /**
   * Get required progress for blueprint completion
   */
  private getBlueprintRequiredProgress(): number {
    // Simplified - return a reasonable default
    // TODO: Get actual requirement from construction recipe
    return 100;
  }

  /**
   * Serialize species distribution (key tiles only for performance)
   */
  serializeSpecies(): NetworkSpecies {
    const species: NetworkSpecies = {
      tiles: []
    };
    
    // Get species data from diffusion system - sample key tiles only
    if (this.worldRefs.diffusionSystem) {
      // For now, serialize species around organelles and player
      const keyTiles = this.getKeyTilesForSpeciesSync();
      
      for (const hex of keyTiles) {
        // Get species data using hex grid
        const tile = this.worldRefs.hexGrid.getTile(hex);
        if (tile && tile.concentrations && Object.keys(tile.concentrations).length > 0) {
          // Check for significant concentrations to log more frequently
          const significantConcentrations = Object.entries(tile.concentrations)
            .filter(([_, concentration]) => concentration > 1.0);
          
          // Log more frequently for significant concentrations (helps debug injections)
          const shouldLog = DEBUG_SPECIES && (significantConcentrations.length > 0 ? Math.random() < 0.1 : Math.random() < 0.005);
          
          if (shouldLog) {
            console.log(`🧬 [HOST@${getTimestamp()}] Serializing species at hex (${hex.q},${hex.r}) world pos: ${tile.worldPos?.x?.toFixed(1)}, ${tile.worldPos?.y?.toFixed(1)}`);
            
            // Show significant species concentrations
            if (significantConcentrations.length > 0) {
              const speciesList = significantConcentrations
                .map(([species, concentration]) => `${species}:${concentration.toFixed(2)}`)
                .join(', ');
              console.log(`🧬 [HOST@${getTimestamp()}] Significant species at (${hex.q},${hex.r}): ${speciesList}`);
            }
          }
          
          species.tiles.push({
            hex,
            species: tile.concentrations
          });
        }
      }
    }
    
    return species;
  }

  /**
   * Get key tiles that need species synchronization - now includes ALL tiles in the cell
   */
  private getKeyTilesForSpeciesSync(): HexCoord[] {
    const keyTiles: HexCoord[] = [];
    const tileSet = new Set<string>(); // Use set to avoid duplicates
    
    // Get ALL tiles in the cell from the hex grid
    if (this.worldRefs.hexGrid) {
      const allTiles = this.worldRefs.hexGrid.getAllTiles();
      
      for (const tile of allTiles) {
        if (tile.coord) {
          const key = `${tile.coord.q},${tile.coord.r}`;
          if (!tileSet.has(key)) {
            keyTiles.push(tile.coord);
            tileSet.add(key);
          }
        }
      }
      
      // Debug: Log total cell coverage occasionally
      if (DEBUG_SPECIES && Math.random() < 0.01) {
        console.log(`🧬 [HOST] Syncing species for ALL ${keyTiles.length} tiles in the cell`);
        
        if (this.worldRefs.player) {
          const playerCoord = this.worldRefs.player.getHexCoord();
          const playerWorldPos = this.worldRefs.player.getWorldPosition();
          if (playerCoord) {
            console.log(`🧬 [HOST] Player at hex (${playerCoord.q},${playerCoord.r}) world pos: ${playerWorldPos.x}, ${playerWorldPos.y}`);
          }
        }
      }
    } else {
      // Fallback: If no hex grid available, use the old method
      console.warn(`🧬 [HOST] No hex grid available, falling back to limited area sync`);
      
      // Add organelle tiles
      const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
      for (const organelle of organelles) {
        const key = `${organelle.coord.q},${organelle.coord.r}`;
        if (!tileSet.has(key)) {
          keyTiles.push(organelle.coord);
          tileSet.add(key);
        }
      }
      
      // Add large area around player if available
      if (this.worldRefs.player) {
        const playerCoord = this.worldRefs.player.getHexCoord();
        if (playerCoord) {
          // Add player tile
          const playerKey = `${playerCoord.q},${playerCoord.r}`;
          if (!tileSet.has(playerKey)) {
            keyTiles.push(playerCoord);
            tileSet.add(playerKey);
          }
          
          // Add very large radius around player to ensure full coverage (20x20 area)
          for (let dq = -10; dq <= 10; dq++) {
            for (let dr = -10; dr <= 10; dr++) {
              if (dq === 0 && dr === 0) continue; // Skip center (already added)
              
              const neighborCoord = { 
                q: playerCoord.q + dq, 
                r: playerCoord.r + dr 
              };
              const neighborKey = `${neighborCoord.q},${neighborCoord.r}`;
              
              if (!tileSet.has(neighborKey)) {
                keyTiles.push(neighborCoord);
                tileSet.add(neighborKey);
              }
            }
          }
        }
      }
    }
    
    return keyTiles;
  }

  /**
   * Apply organelles from network snapshot
   */
  applyOrganelles(networkOrganelles: NetworkOrganelle[]): void {
    // Only log when there are changes, not every empty update
    if (networkOrganelles.length > 0) {
      // Use probabilistic logging to reduce spam - only log 5% of the time
      if (Math.random() < 0.05) {
      if (DEBUG_ORGANELLES) {
        console.log(`📍 Applying ${networkOrganelles.length} organelles from network`);
      }
      }
    }
    
    let hasChanges = false;
    for (const networkOrganelle of networkOrganelles) {
      const result = this.applyOrganelleEntity(networkOrganelle);
      if (result) hasChanges = true;
    }
    
    // Trigger visual update after all organelles are processed
    if (hasChanges && this.worldRefs.organelleRenderer) {
      // Check if update method exists before calling it
      if (typeof this.worldRefs.organelleRenderer.update === 'function') {
        this.worldRefs.organelleRenderer.update();
        // Only log visual updates occasionally
        if (Math.random() < 0.1) {
          if (DEBUG_ORGANELLES) {
            console.log(`📍 🎨 Updated organelle renderer after network sync`);
          }
        }
      } else if (typeof this.worldRefs.organelleRenderer.render === 'function') {
        // Fallback: try render method if update doesn't exist
        this.worldRefs.organelleRenderer.render();
      } else {
        console.warn(`📍 ⚠️ OrganelleRenderer exists but has no update() or render() method`);
      }
    } else if (!this.worldRefs.organelleRenderer) {
      // Only warn occasionally about missing organelleRenderer to avoid spam
      if (Math.random() < 0.01) {
        console.warn(`📍 ⚠️ No organelleRenderer system available for visual updates`);
      }
    }
  }
  
  private applyOrganelleEntity(networkOrganelle: NetworkOrganelle): boolean {
    const organelleSystem = this.worldRefs.organelleSystem;
    const hex = { q: networkOrganelle.hex.q, r: networkOrganelle.hex.r };
    
    // Check if organelle already exists at this hex
    const existing = organelleSystem.getOrganelleAtTile(hex);
    
    if (!existing) {
      // Create the organelle on the client
      try {
        // Get the organelle definition
        const definition = getOrganelleDefinition(networkOrganelle.type as any);
        if (!definition) {
          console.warn(`Unknown organelle type: ${networkOrganelle.type}`);
          return false;
        }
        
        // Convert definition to config
        const config = definitionToConfig(definition, networkOrganelle.id);
        
        // Create the organelle
        const success = organelleSystem.createOrganelle(config, hex);
        if (success) {
          // Only log creations occasionally to reduce spam
          if (Math.random() < 0.2) {
          if (DEBUG_ORGANELLES) {
            console.log(`📍 ✅ Created organelle: ${networkOrganelle.type} at (${hex.q},${hex.r})`);
          }
          }
          return true; // Indicate that changes were made
        } else {
          console.warn(`📍 ❌ Failed to create organelle: ${networkOrganelle.type} at (${hex.q},${hex.r})`);
          return false;
        }
      } catch (error) {
        console.warn(`📍 ❌ Error creating organelle ${networkOrganelle.type} at (${hex.q},${hex.r}):`, error);
        return false;
      }
    } else {
      // Organelle exists, just sync silently - no need to log every routine sync
      if (Math.random() < 0.01) {
      if (DEBUG_ORGANELLES) {
        console.log(`📍 ✅ Synced organelle: ${networkOrganelle.type} at (${hex.q},${hex.r})`);
      }
      }
      return false; // No changes made
    }
  }

  /**
   * Apply blueprints from network snapshot
   */
  applyBlueprints(networkBlueprints: NetworkBlueprint[]): void {
    if (networkBlueprints.length > 0) {
    if (DEBUG_BLUEPRINTS) {
      console.log(`🏗️ Applying ${networkBlueprints.length} blueprints from network`);
    }
    }
    
    // Separate organelle and cytoskeleton blueprints
    const organelleBlueprints = networkBlueprints.filter(bp => bp.type !== 'cytoskeleton');
    const cytoskeletonBlueprints = networkBlueprints.filter(bp => bp.type === 'cytoskeleton');
    
    // Handle organelle blueprints (existing logic)
    this.applyOrganelleBlueprints(organelleBlueprints);
    
    // Handle cytoskeleton blueprints (new logic)
    this.applyCytoskeletonBlueprints(cytoskeletonBlueprints);
  }
  
  private applyOrganelleBlueprints(networkBlueprints: NetworkBlueprint[]): void {
    // Safety check: Ensure blueprintSystem is initialized
    if (!this.worldRefs.blueprintSystem) {
      console.warn(`🏗️ [CLIENT] BlueprintSystem not initialized yet, skipping organelle blueprint application`);
      return;
    }
    
    // Track which blueprints we received from the network
    const receivedBlueprintIds = new Set(networkBlueprints.map(bp => bp.id));
    
    // Remove any local blueprints that are no longer on the host
    const allLocalBlueprints = this.worldRefs.blueprintSystem.getAllBlueprints();
    for (const localBlueprint of allLocalBlueprints) {
      if (!receivedBlueprintIds.has(localBlueprint.id)) {
        console.log(`🏗️ 🗑️ Removing completed organelle blueprint: ${localBlueprint.recipeId} at (${localBlueprint.anchorCoord.q},${localBlueprint.anchorCoord.r})`);
        this.worldRefs.blueprintSystem.cancelBlueprint(localBlueprint.id, 0); // No refund for network sync
      }
    }
    
    let hasChanges = false;
    for (const networkBlueprint of networkBlueprints) {
      const result = this.applyOrganelleBlueprintEntity(networkBlueprint);
      if (result) hasChanges = true;
    }
    
    // Always update renderer if we had removals or changes
    if (hasChanges || allLocalBlueprints.length !== networkBlueprints.length) {
      if (this.worldRefs.blueprintRenderer) {
        if (typeof this.worldRefs.blueprintRenderer.render === 'function') {
          this.worldRefs.blueprintRenderer.render();
          console.log(`🏗️ 🎨 Updated organelle blueprint renderer after network sync`);
        } else if (typeof this.worldRefs.blueprintRenderer.update === 'function') {
          this.worldRefs.blueprintRenderer.update();
          console.log(`🏗️ 🎨 Updated organelle blueprint renderer via update after network sync`);
        } else {
          console.warn(`🏗️ ⚠️ BlueprintRenderer has no render() or update() method`);
        }
      } else {
        console.warn(`🏗️ ⚠️ No blueprintRenderer available for visual updates`);
      }
    }
  }
  
  private applyCytoskeletonBlueprints(networkBlueprints: NetworkBlueprint[]): void {
    if (!this.worldRefs.cytoskeletonSystem) return;
    
    // Track which blueprints we received from the network
    const receivedBlueprintIds = new Set(networkBlueprints.map(bp => bp.id));
    
    // Get current local cytoskeleton blueprints
    const allLocalBlueprints = this.worldRefs.cytoskeletonSystem.getActiveBlueprints();
    
    // Remove any local blueprints that are no longer on the host
    for (const localBlueprint of allLocalBlueprints) {
      if (!receivedBlueprintIds.has(localBlueprint.id)) {
        console.log(`🏗️ 🗑️ Removing completed cytoskeleton blueprint: ${localBlueprint.type} at (${localBlueprint.fromHex.q},${localBlueprint.fromHex.r})`);
        // Note: We would need a method to remove blueprints from cytoskeleton system
        // For now, we'll let them complete naturally
      }
    }
    
    let hasChanges = false;
    for (const networkBlueprint of networkBlueprints) {
      const result = this.applyCytoskeletonBlueprintEntity(networkBlueprint);
      if (result) hasChanges = true;
    }
    
    // Update cytoskeleton renderer if we had changes
    if (hasChanges) {
      if (this.worldRefs.cytoskeletonRenderer) {
        if (typeof this.worldRefs.cytoskeletonRenderer.forceRedraw === 'function') {
          this.worldRefs.cytoskeletonRenderer.forceRedraw();
          console.log(`🏗️ 🎨 Updated cytoskeleton renderer after blueprint sync`);
        } else if (typeof this.worldRefs.cytoskeletonRenderer.render === 'function') {
          this.worldRefs.cytoskeletonRenderer.render();
          console.log(`🏗️ 🎨 Updated cytoskeleton renderer via render after blueprint sync`);
        } else {
          console.warn(`🏗️ ⚠️ CytoskeletonRenderer has no forceRedraw() or render() method`);
        }
      } else {
        console.warn(`🏗️ ⚠️ No cytoskeletonRenderer available for visual updates`);
      }
    }
  }
  
  private applyOrganelleBlueprintEntity(networkBlueprint: NetworkBlueprint): boolean {
    const blueprintSystem = this.worldRefs.blueprintSystem;
    
    // Safety check: Ensure blueprintSystem is initialized
    if (!blueprintSystem) {
      console.warn(`🏗️ [CLIENT] BlueprintSystem not initialized, cannot apply organelle blueprint: ${networkBlueprint.recipeId}`);
      return false;
    }
    
    const hex = { q: networkBlueprint.hex.q, r: networkBlueprint.hex.r };
    
    // Check if blueprint already exists at this hex
    const existing = blueprintSystem.getBlueprintAtTile(hex.q, hex.r);
    
    if (!existing) {
      // Create the blueprint on the client
      try {
        const result = blueprintSystem.placeBlueprint(
          networkBlueprint.recipeId as any, 
          hex.q, 
          hex.r
        );
        
        if (result.success) {
          console.log(`🏗️ ✅ Created blueprint: ${networkBlueprint.recipeId} at (${hex.q},${hex.r}) progress: ${Math.round(networkBlueprint.totalProgress * 100)}%`);
          return true; // Indicate that changes were made
        } else {
          console.warn(`🏗️ ❌ Failed to create blueprint: ${networkBlueprint.recipeId} at (${hex.q},${hex.r}) - ${result.error}`);
          return false;
        }
      } catch (error) {
        console.warn(`🏗️ ❌ Error creating blueprint ${networkBlueprint.recipeId} at (${hex.q},${hex.r}):`, error);
        return false;
      }
    } else {
      // Blueprint exists, update progress if different
      if (Math.abs(existing.totalProgress - networkBlueprint.totalProgress) > 0.01) {
        existing.totalProgress = networkBlueprint.totalProgress;
        existing.progress = networkBlueprint.progress;
        console.log(`🏗️ ✅ Updated blueprint progress: ${networkBlueprint.recipeId} at (${hex.q},${hex.r}) progress: ${Math.round(networkBlueprint.totalProgress * 100)}%`);
        return true; // Progress changed, need visual update
      } else {
        console.log(`🏗️ ✅ Synced blueprint: ${networkBlueprint.recipeId} at (${hex.q},${hex.r}) progress: ${Math.round(networkBlueprint.totalProgress * 100)}%`);
        return false; // No changes made
      }
    }
  }
  
  private applyCytoskeletonBlueprintEntity(networkBlueprint: NetworkBlueprint): boolean {
    if (!this.worldRefs.cytoskeletonSystem || !networkBlueprint.cytoskeletonData) {
      return false;
    }
    
    // Check if this blueprint already exists locally
    const localBlueprints = this.worldRefs.cytoskeletonSystem.getActiveBlueprints();
    const existing = localBlueprints.find(bp => bp.id === networkBlueprint.id);
    
    if (!existing) {
      // Create the cytoskeleton blueprint on the client
      try {
        const blueprintId = this.worldRefs.cytoskeletonSystem.createFilamentBlueprint(
          networkBlueprint.cytoskeletonData.filamentType,
          networkBlueprint.cytoskeletonData.fromHex,
          networkBlueprint.cytoskeletonData.toHex
        );
        
        if (blueprintId) {
          // Update the blueprint ID to match the network
          const createdBlueprint = localBlueprints.find(bp => bp.id === blueprintId);
          if (createdBlueprint) {
            createdBlueprint.id = networkBlueprint.id; // Sync IDs
            // Update progress to match network
            createdBlueprint.progress.AA = networkBlueprint.progress['AA'] || 0;
            createdBlueprint.progress.PROTEIN = networkBlueprint.progress['PROTEIN'] || 0;
          }
          
          console.log(`🏗️ ✅ Created cytoskeleton blueprint: ${networkBlueprint.cytoskeletonData.filamentType} at (${networkBlueprint.cytoskeletonData.fromHex.q},${networkBlueprint.cytoskeletonData.fromHex.r}) progress: ${Math.round(networkBlueprint.totalProgress * 100)}%`);
          return true;
        } else {
          console.warn(`🏗️ ❌ Failed to create cytoskeleton blueprint: ${networkBlueprint.cytoskeletonData.filamentType}`);
          return false;
        }
      } catch (error) {
        console.warn(`🏗️ ❌ Error creating cytoskeleton blueprint:`, error);
        return false;
      }
    } else {
      // Blueprint exists, update progress if different
      const totalNetworkProgress = (networkBlueprint.progress['AA'] || 0) + (networkBlueprint.progress['PROTEIN'] || 0);
      const totalLocalProgress = existing.progress.AA + existing.progress.PROTEIN;
      
      if (Math.abs(totalLocalProgress - totalNetworkProgress) > 0.01) {
        existing.progress.AA = networkBlueprint.progress['AA'] || 0;
        existing.progress.PROTEIN = networkBlueprint.progress['PROTEIN'] || 0;
        console.log(`🏗️ ✅ Updated cytoskeleton blueprint progress: ${existing.type} at (${existing.fromHex.q},${existing.fromHex.r}) progress: ${Math.round(totalNetworkProgress * 100)}%`);
        return true; // Progress changed, need visual update
      } else {
        console.log(`🏗️ ✅ Synced cytoskeleton blueprint: ${existing.type} at (${existing.fromHex.q},${existing.fromHex.r}) progress: ${Math.round(totalNetworkProgress * 100)}%`);
        return false; // No changes made
      }
    }
  }

  /**
   * Apply membrane proteins from network snapshot
   */
  applyMembraneProteins(networkMembraneProteins: NetworkMembraneProtein[]): void {
    if (networkMembraneProteins.length > 0 && DEBUG_CARGO && Math.random() < 0.1) {
      console.log(`🧪 [CLIENT@${getTimestamp()}] Applying ${networkMembraneProteins.length} membrane proteins from network`);
    }
    
    // Get current installed proteins to compare
    const membraneExchangeSystem = this.worldRefs.membraneExchangeSystem;
    if (!membraneExchangeSystem) {
      console.warn(`🧪 [CLIENT] No membrane exchange system available for protein replication`);
      return;
    }
    
    const installedProteins = (membraneExchangeSystem as any).installedProteins;
    if (!installedProteins) {
      console.warn(`🧪 [CLIENT] No installedProteins map found in membrane exchange system`);
      return;
    }
    
    // Track if we made any changes for visual updates
    let hasChanges = false;
    
    // Clear existing proteins that aren't in the network snapshot
    const networkTileKeys = new Set(networkMembraneProteins.map(p => `${p.hex.q},${p.hex.r}`));
    for (const [tileKey] of installedProteins.entries()) {
      if (!networkTileKeys.has(tileKey)) {
        installedProteins.delete(tileKey);
        hasChanges = true;
        if (DEBUG_CARGO && Math.random() < 0.1) {
          console.log(`🧪 [CLIENT@${getTimestamp()}] Removed membrane protein at ${tileKey}`);
        }
      }
    }
    
    // Apply/update proteins from network
    for (const networkProtein of networkMembraneProteins) {
      const tileKey = `${networkProtein.hex.q},${networkProtein.hex.r}`;
      
      // Check if this is a new installation or update
      const existing = installedProteins.get(tileKey);
      if (!existing || 
          existing.proteinId !== networkProtein.proteinId ||
          existing.isActive !== networkProtein.isActive ||
          existing.glycosylationStatus !== networkProtein.glycosylationStatus) {
        hasChanges = true;
      }
      
      installedProteins.set(tileKey, {
        proteinId: networkProtein.proteinId,
        instanceId: networkProtein.instanceId,
        isActive: networkProtein.isActive,
        glycosylationStatus: networkProtein.glycosylationStatus,
        throughputMultiplier: networkProtein.throughputMultiplier
      });
      
      // Debug log installation occasionally
      if (DEBUG_CARGO && Math.random() < 0.05) {
        console.log(`🧪 [CLIENT@${getTimestamp()}] Applied membrane protein ${networkProtein.proteinId} at (${networkProtein.hex.q},${networkProtein.hex.r}) with ${networkProtein.glycosylationStatus} glycosylation`);
      }
    }
    
    // Trigger visual updates if membrane proteins changed
    if (hasChanges) {
      console.log(`🧪 [CLIENT@${getTimestamp()}] Membrane proteins changed, forcing visual updates...`);
      
      // 1. Update organelle renderer to show installed proteins
      if (this.worldRefs.organelleRenderer) {
        if (typeof this.worldRefs.organelleRenderer.update === 'function') {
          this.worldRefs.organelleRenderer.update();
          console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Updated organelle renderer`);
        } else if (typeof this.worldRefs.organelleRenderer.render === 'function') {
          this.worldRefs.organelleRenderer.render();
          console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Updated organelle renderer via render`);
        } else {
          console.warn(`🧪 [CLIENT@${getTimestamp()}] ❌ OrganelleRenderer has no update() or render() method`);
        }
      } else {
        console.warn(`🧪 [CLIENT@${getTimestamp()}] ❌ No organelle renderer found`);
      }
      
      // 2. Update cell overlays in case they show protein status
      if (this.worldRefs.cellOverlays) {
        if (typeof this.worldRefs.cellOverlays.render === 'function') {
          this.worldRefs.cellOverlays.render();
          console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Updated cell overlays`);
        } else if (typeof this.worldRefs.cellOverlays.update === 'function') {
          this.worldRefs.cellOverlays.update();
          console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Updated cell overlays via update`);
        } else {
          console.log(`🧪 [CLIENT@${getTimestamp()}] ⚠️ CellOverlays has no render() or update() method`);
        }
      } else {
        console.warn(`🧪 [CLIENT@${getTimestamp()}] ❌ No cell overlays found`);
      }
      
      // 3. Force a render update for any protein-specific visuals
      if (this.worldRefs.membraneExchangeSystem && (this.worldRefs.membraneExchangeSystem as any).forceRender) {
        (this.worldRefs.membraneExchangeSystem as any).forceRender();
        console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Updated membrane exchange system`);
      } else {
        console.log(`🧪 [CLIENT@${getTimestamp()}] ⚠️ No forceRender method on membrane exchange system`);
      }
      
      // 4. Try to force a complete visual refresh by updating the organelle at the specific hex
      for (const networkProtein of networkMembraneProteins) {
        const organelle = this.worldRefs.organelleSystem.getOrganelleAtTile(networkProtein.hex);
        if (organelle && organelle.type === 'transporter') {
          console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Found transporter at (${networkProtein.hex.q},${networkProtein.hex.r}), forcing organelle refresh`);
          
          // Try to trigger organelle-specific visual update
          if (this.worldRefs.organelleRenderer && (this.worldRefs.organelleRenderer as any).updateOrganelle) {
            (this.worldRefs.organelleRenderer as any).updateOrganelle(organelle);
            console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Updated specific organelle via updateOrganelle`);
          }
          
          // Try to invalidate/recreate the organelle sprite
          if (this.worldRefs.organelleRenderer) {
            const renderer = this.worldRefs.organelleRenderer as any;
            
            // Method 1: Try to remove and recreate the organelle sprite
            if (renderer.removeOrganelleSprite && renderer.createOrganelleSprite) {
              renderer.removeOrganelleSprite(organelle);
              renderer.createOrganelleSprite(organelle);
              console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Recreated organelle sprite`);
            }
            
            // Method 2: Try to refresh specific organelle
            if (renderer.refreshOrganelle) {
              renderer.refreshOrganelle(organelle);
              console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Refreshed organelle via refreshOrganelle`);
            }
            
            // Method 3: Try to invalidate organelle cache
            if (renderer.invalidateOrganelle) {
              renderer.invalidateOrganelle(organelle);
              console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Invalidated organelle cache`);
            }
            
            // Method 4: Try to force complete re-render
            if (renderer.forceUpdate) {
              renderer.forceUpdate();
              console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Forced renderer update`);
            }
            
            // Method 5: Try to clear and rebuild all organelles
            if (renderer.rebuild) {
              renderer.rebuild();
              console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Rebuilt renderer`);
            }
            
            // Method 6: Try to mark organelle as dirty for next render
            if (organelle && typeof organelle === 'object') {
              (organelle as any).needsVisualUpdate = true;
              (organelle as any).dirty = true;
              (organelle as any).invalidated = true;
              console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Marked organelle as dirty`);
            }
          }
          
          // Force a complete re-render of the organelle system
          if (this.worldRefs.organelleSystem && (this.worldRefs.organelleSystem as any).notifyVisualUpdate) {
            (this.worldRefs.organelleSystem as any).notifyVisualUpdate(organelle);
            console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Notified organelle system of visual update`);
          }
          
          // CRITICAL: Refresh membrane graphics via game scene
          console.log(`🧪 [CLIENT@${getTimestamp()}] 🔍 Checking scene reference:`, !!this.worldRefs.scene);
          if (this.worldRefs.scene) {
            console.log(`🧪 [CLIENT@${getTimestamp()}] 🔍 Scene has refreshMembraneVisuals:`, !!(this.worldRefs.scene as any).refreshMembraneVisuals);
            if ((this.worldRefs.scene as any).refreshMembraneVisuals) {
              (this.worldRefs.scene as any).refreshMembraneVisuals();
              console.log(`🧪 [CLIENT@${getTimestamp()}] ✅ Refreshed membrane graphics via scene`);
            } else {
              console.log(`🧪 [CLIENT@${getTimestamp()}] ❌ Scene missing refreshMembraneVisuals method`);
            }
          } else {
            console.log(`🧪 [CLIENT@${getTimestamp()}] ❌ No scene reference in worldRefs`);
          }
        }
      }
      
      console.log(`🧪 [CLIENT@${getTimestamp()}] 🎨 Completed all visual update attempts for membrane protein changes`);
    }
  }

  /**
   * Apply species from network snapshot
   */
  applySpecies(networkSpecies: NetworkSpecies): void {
    if (networkSpecies.tiles.length > 0) {
      // Only log species application occasionally to reduce spam
      if (DEBUG_SPECIES && Math.random() < 0.05) {
        console.log(`🧪 Applying species data for ${networkSpecies.tiles.length} tiles from network`);
        
        // Debug: Show client player position for comparison
        if (this.worldRefs.player) {
          const clientPlayerCoord = this.worldRefs.player.getHexCoord();
          const clientPlayerWorldPos = this.worldRefs.player.getWorldPosition();
          if (clientPlayerCoord) {
            console.log(`🧪 [CLIENT] Player at hex (${clientPlayerCoord.q},${clientPlayerCoord.r}) world pos: ${clientPlayerWorldPos.x}, ${clientPlayerWorldPos.y}`);
          }
        }
      }
      
      // Apply each tile's species concentrations to the hex grid
      for (const tileData of networkSpecies.tiles) {
        const speciesCount = Object.keys(tileData.species).length;
        if (speciesCount > 0) {
          // Get some concentration values for debugging
          const significantConcentrations = Object.entries(tileData.species)
            .filter(([_, concentration]) => concentration > 1.0)
            .map(([id, concentration]) => `${id}:${concentration.toFixed(1)}`);
          
          // Log more frequently for significant concentrations to help debug
          if (DEBUG_SPECIES && significantConcentrations.length > 0 && Math.random() < 0.1) {
            console.log(`🧪 [CLIENT@${getTimestamp()}] Applying significant species to tile (${tileData.hex.q},${tileData.hex.r}): ${significantConcentrations.join(', ')}`);
            
            // Check if tile exists and log world position
            const tile = this.worldRefs.hexGrid.getTile(tileData.hex);
            if (tile && tile.worldPos) {
              console.log(`🗺️  [CLIENT] Tile (${tileData.hex.q},${tileData.hex.r}) maps to world pos: ${tile.worldPos.x.toFixed(1)}, ${tile.worldPos.y.toFixed(1)}`);
            } else {
              console.warn(`⚠️  [CLIENT] Tile (${tileData.hex.q},${tileData.hex.r}) not found in hex grid!`);
            }
          }
          
          // Apply each species concentration to the hex grid
          for (const [speciesId, concentration] of Object.entries(tileData.species)) {
            this.worldRefs.hexGrid.setConcentration(
              tileData.hex,
              speciesId as any, // SpeciesId type
              concentration
            );
            
            // Log significant concentration changes to help debug
            if (concentration > 5.0 && Math.random() < 0.05) {
              console.log(`🧪 [CLIENT@${getTimestamp()}] Set ${speciesId}=${concentration.toFixed(3)} at hex (${tileData.hex.q},${tileData.hex.r})`);
            }
          }
        }
      }
      
      // Trigger visual update for species heatmap
      if (this.worldRefs.heatmapSystem) {
        if (typeof this.worldRefs.heatmapSystem.render === 'function') {
          this.worldRefs.heatmapSystem.render();
        } else if (typeof this.worldRefs.heatmapSystem.update === 'function') {
          this.worldRefs.heatmapSystem.update();
        } else {
          // Only warn occasionally to avoid spam
          if (Math.random() < 0.01) {
            console.warn(`🧪 HeatmapSystem has no render() or update() method`);
          }
        }
      } else {
        // Only warn occasionally about missing heatmap system
        if (Math.random() < 0.01) {
          console.warn(`🧪 No heatmapSystem available for visual updates`);
        }
      }
      
      // Debug: Only log completion occasionally to reduce spam
      if (DEBUG_SPECIES && Math.random() < 0.05) {
        console.log(`🧪 Applied species data for ${networkSpecies.tiles.length} tiles, triggered heatmap render`);
      }
    }
  }
  
  /**
   * Apply rail/cytoskeleton utilization from network snapshot
   */
  applyRails(railsDelta: { added: NetworkRail[], removed: string[], updated: NetworkRail[] }): void {
    if (railsDelta.added.length > 0 || railsDelta.removed.length > 0 || railsDelta.updated.length > 0) {
      if (DEBUG_RAILS) {
        console.log(`🚄 Applying rail updates: ${railsDelta.added.length} added, ${railsDelta.removed.length} removed, ${railsDelta.updated.length} updated`);
        
        // Debug: Log some details about the rails being applied (occasionally)
        if (railsDelta.added.length > 0 && Math.random() < 0.1) {
          console.log(`🚄 Added rails:`, railsDelta.added.slice(0, 3).map(r => `${r.segmentId}(${r.utilization.toFixed(2)})`));
        }
      }
      
      // Apply rail utilization to cytoskeleton system
      if (this.worldRefs.cytoskeletonGraph) {
        if (DEBUG_RAILS) {
          console.log(`🚄 Found cytoskeletonGraph, applying rail data...`);
        }
        
        // Check if graph needs to be rebuilt (no edges but we have rail data)
        const currentEdges = this.worldRefs.cytoskeletonGraph.getAllEdges?.() || [];
        if (currentEdges.length === 0 && railsDelta.added.length > 0) {
          console.log(`🚄 Graph has 0 edges but received ${railsDelta.added.length} rails - triggering rebuild`);
          this.worldRefs.cytoskeletonGraph.rebuildGraph?.();
        }
        
        let appliedCount = 0;
        let createdCount = 0;
        
        // Update added/existing rails
        for (const rail of [...railsDelta.added, ...railsDelta.updated]) {
          // Check if segment exists on client side (only for actual segment edges, not junctions/access)
          if (this.worldRefs.cytoskeletonSystem && rail.segmentData && rail.segmentId.startsWith('edge_')) {
            const segmentId = rail.segmentId.substring(5); // Remove "edge_" prefix
            const existingSegment = this.worldRefs.cytoskeletonSystem.getSegment?.(segmentId);
            if (!existingSegment) {
              // Create the segment on client side using the replicated data
              console.log(`🚄 Creating missing segment: ${segmentId} (${rail.segmentData.type}) from ${rail.segmentData.fromHex.q},${rail.segmentData.fromHex.r} to ${rail.segmentData.toHex.q},${rail.segmentData.toHex.r}`);
              this.worldRefs.cytoskeletonSystem.createFilamentSegment?.(
                rail.segmentData.type,
                rail.segmentData.fromHex,
                rail.segmentData.toHex
              );
              createdCount++;
            }
          } else if (rail.segmentData && !rail.segmentId.startsWith('edge_')) {
            console.log(`🚄 Rail ${rail.segmentId} has segmentData but is not a segment edge (junction/access) - skipping creation`);
          } else if (rail.segmentData) {
            console.log(`🚄 Rail ${rail.segmentId} has segmentData but no cytoskeletonSystem available`);
          } else if (rail.segmentId.startsWith('edge_')) {
            console.log(`🚄 Rail ${rail.segmentId} is a segment edge but has no segmentData - cannot create missing segment`);
          }
          
          const edge = this.worldRefs.cytoskeletonGraph.getEdge?.(rail.segmentId);
          if (edge) {
            edge.utilization = rail.utilization;
            edge.active = rail.active;
            appliedCount++;
          } else if (rail.segmentId.startsWith('edge_')) {
            console.log(`🚄 No edge found for segment rail ${rail.segmentId} - graph may need rebuild`);
          }
        }
        
        // If we created new segments, rebuild the graph
        if (createdCount > 0 && DEBUG_RAILS) {
          console.log(`🚄 Created ${createdCount} new segments, rebuilding graph...`);
          this.worldRefs.cytoskeletonGraph.rebuildGraph?.();
        } else if (createdCount > 0) {
          // Still rebuild the graph, just don't log
          this.worldRefs.cytoskeletonGraph.rebuildGraph?.();
        }
        
        if (DEBUG_RAILS) {
          console.log(`🚄 Applied ${appliedCount} rail updates to cytoskeleton graph`);
        }
        
        // Remove rails
        for (const segmentId of railsDelta.removed) {
          const edge = this.worldRefs.cytoskeletonGraph.getEdge?.(segmentId);
          if (edge) {
            edge.active = false;
            edge.utilization = 0;
          }
        }
        
        // Trigger visual update for cytoskeleton renderer
        if (this.worldRefs.cytoskeletonRenderer) {
          if (typeof this.worldRefs.cytoskeletonRenderer.forceRedraw === 'function') {
            if (DEBUG_RAILS) {
              console.log(`🚄 Triggering cytoskeletonRenderer.forceRedraw()`);
            }
            this.worldRefs.cytoskeletonRenderer.forceRedraw();
          } else if (typeof this.worldRefs.cytoskeletonRenderer.render === 'function') {
            if (DEBUG_RAILS) {
              console.log(`🚄 Triggering cytoskeletonRenderer.render()`);
            }
            this.worldRefs.cytoskeletonRenderer.render();
          } else {
            console.warn(`🚄 ⚠️ CytoskeletonRenderer has no forceRedraw() or render() method`);
          }
        } else if (DEBUG_RAILS) {
          console.warn(`🚄 No cytoskeletonRenderer found in worldRefs!`);
        }
      }
    }
  }

  /**
   * Manage carried arrays for visual rendering of remote player cargo
   */
  private updateCarriedArrays(
    entity: Transcript | Vesicle, 
    networkState: NetworkCargo['state'], 
    type: 'transcript' | 'vesicle'
  ): void {
    if (DEBUG_CARGO) {
      console.log(`🔧 updateCarriedArrays: ${type} ${entity.id}, networkState: ${networkState}, isNetworkControlled: ${entity.isNetworkControlled}`);
    }
    
    if (type === 'transcript') {
      const transcript = entity as Transcript;
      const isInCarriedArray = this.worldRefs.carriedTranscripts.some(t => t.id === transcript.id);
      
      if (networkState === 'carried' && !isInCarriedArray) {
        // Add to carried array if not already there
        this.worldRefs.carriedTranscripts.push(transcript);
        if (DEBUG_CARGO) {
          console.log(`📦 Added transcript ${transcript.id} to carried array (network: ${networkState})`);
        }
      } else if (networkState !== 'carried' && isInCarriedArray) {
        // Remove from carried array if no longer carried
        const index = this.worldRefs.carriedTranscripts.findIndex(t => t.id === transcript.id);
        if (index !== -1) {
          this.worldRefs.carriedTranscripts.splice(index, 1);
          if (DEBUG_CARGO) {
            console.log(`📦 Removed transcript ${transcript.id} from carried array (network: ${networkState})`);
          }
        }
      }
    } else {
      const vesicle = entity as Vesicle;
      const isInCarriedArray = this.worldRefs.carriedVesicles.some(v => v.id === vesicle.id);
      
      if (networkState === 'carried' && !isInCarriedArray) {
        // Add to carried array if not already there
        this.worldRefs.carriedVesicles.push(vesicle);
        if (DEBUG_CARGO) {
          console.log(`📦 Added vesicle ${vesicle.id} to carried array (network: ${networkState})`);
        }
      } else if (networkState !== 'carried' && isInCarriedArray) {
        // Remove from carried array if no longer carried
        const index = this.worldRefs.carriedVesicles.findIndex(v => v.id === vesicle.id);
        if (index !== -1) {
          this.worldRefs.carriedVesicles.splice(index, 1);
          if (DEBUG_CARGO) {
            console.log(`📦 Removed vesicle ${vesicle.id} from carried array (network: ${networkState})`);
          }
        }
      }
    }
    
    // For carried cargo, position it around the remote player (if it's network-controlled)
    if (DEBUG_CARGO) {
      console.log(`🔧 Checking positioning conditions: networkState === 'carried': ${networkState === 'carried'}, entity.isNetworkControlled: ${entity.isNetworkControlled}`);
    }
    
    if (networkState === 'carried' && entity.isNetworkControlled) {
      if (DEBUG_CARGO) {
        console.log(`🔧 Calling positionRemoteCarriedCargo for ${type} ${entity.id}`);
      }
      this.positionRemoteCarriedCargo(entity, type);
    } else if (DEBUG_CARGO) {
      console.log(`🔧 Skipping positioning: networkState: ${networkState}, isNetworkControlled: ${entity.isNetworkControlled}`);
    }
  }

  /**
   * Position network-controlled carried cargo around remote players
   */
  private positionRemoteCarriedCargo(entity: Transcript | Vesicle, type: 'transcript' | 'vesicle'): void {
    if (DEBUG_CARGO) {
      console.log(`🔍 positionRemoteCarriedCargo called for ${type} ${entity.id}`);
    }
    
    // Get remote player position (assuming host player for now - in a full multiplayer system,
    // we'd need to track which player is carrying which cargo)
    const scene = this.worldRefs.cellRoot?.scene;
    if (!scene) {
      if (DEBUG_CARGO) {
        console.log(`🔍 No scene found via cellRoot`);
      }
      return;
    }
    
    const netSyncSystem = (scene as any).netSyncSystem;
    if (!netSyncSystem) {
      if (DEBUG_CARGO) {
        console.log(`🔍 No netSyncSystem found in scene`);
      }
      return;
    }
    
    if (!netSyncSystem.remotePlayers) {
      if (DEBUG_CARGO) {
        console.log(`🔍 No remotePlayers found in netSyncSystem`);
      }
      return;
    }
    
    if (DEBUG_CARGO) {
      console.log(`🔍 Found ${netSyncSystem.remotePlayers.size} remote players:`, Array.from(netSyncSystem.remotePlayers.keys()));
    }
    
    // For now, assume host player is carrying (in a full system, this would be tracked per cargo)
    const remotePlayer = netSyncSystem.remotePlayers.get('host');
    if (!remotePlayer) {
      if (DEBUG_CARGO) {
        console.log(`🔍 No 'host' remote player found`);
      }
      return;
    }
    
    if (DEBUG_CARGO) {
      console.log(`🔍 Found remote host player at (${remotePlayer.x}, ${remotePlayer.y})`);
    }
    
    const remotePlayerPos = new Phaser.Math.Vector2(remotePlayer.x, remotePlayer.y);
    const orbitRadius = 25;
    
    // Calculate orbital position based on cargo index
    const carriedEntities = [...this.worldRefs.carriedTranscripts, ...this.worldRefs.carriedVesicles];
    const networkCarriedEntities = carriedEntities.filter(e => e.isNetworkControlled);
    const cargoIndex = networkCarriedEntities.findIndex(e => e.id === entity.id);
    
    if (DEBUG_CARGO) {
      console.log(`🔍 Total carried entities: ${carriedEntities.length}, network controlled: ${networkCarriedEntities.length}, cargo index: ${cargoIndex}`);
    }
    
    if (cargoIndex !== -1) {
      const angle = (scene.time.now / 1000) * 2 + (cargoIndex * Math.PI / 2);
      const cargoPos = new Phaser.Math.Vector2(
        remotePlayerPos.x + Math.cos(angle) * orbitRadius,
        remotePlayerPos.y + Math.sin(angle) * orbitRadius
      );
      
      entity.worldPos.copy(cargoPos);
      
      if (DEBUG_CARGO) {
        console.log(`🌍 Positioned remote ${type} ${entity.id} around remote player at (${cargoPos.x.toFixed(1)}, ${cargoPos.y.toFixed(1)})`);
      }
    } else {
      if (DEBUG_CARGO) {
        console.log(`🔍 Cargo ${entity.id} not found in network carried entities list`);
      }
    }
  }
}
