/**
 * Milestone 13 - Cytoskeleton Transport v1
 * 
 * Core cytoskeleton system that manages actin filaments and microtubules.
 * Handles:
 * - Filament placement and rules (actin vs microtubules)
 * - Network topology and connectivity
 * - Transport capacity and routing
 * - Integration with organelle upgrades
 */

import type { HexCoord } from "../hex/hex-grid";
import type { WorldRefs } from "../core/world-refs";
import { CytoskeletonGraph } from "./cytoskeleton-graph";
import { System } from './system';
import { RunOnServer } from '../network/decorators';
import type { NetBus } from '../network/net-bus';
import type { BaseBlueprint } from '../construction/base-blueprint';

// Story 13.2: Filament types with distinct properties
export type FilamentType = 'actin' | 'microtubule';

// Story 13.2: Individual filament segment
export interface FilamentSegment {
  id: string;
  type: FilamentType;
  fromHex: HexCoord;
  toHex: HexCoord;
  
  // Network properties
  networkId: string; // Groups connected segments
}

// Story 13.2: Network of connected segments
export interface FilamentNetwork {
  id: string;
  type: FilamentType;
  segments: Set<string>; // Segment IDs in this network
  
  // MTOC tracking for microtubules
  mtocHex?: HexCoord; // Origin point for microtubules
  
  // Performance stats
  totalCapacity: number;
  totalLoad: number;
}

// Story 13.3: Organelle upgrade types
export type UpgradeType = 
  | 'npc_exporter'      // Nucleus - allows transcripts to enter filaments
  | 'er_exit'           // ER - COPII, emits partial vesicles
  | 'golgi_tgn'         // Golgi - TGN adapter, partial->complete vesicles
  | 'exocyst_hotspot';  // Membrane - accepts complete vesicles

// Story 13.3: Organelle upgrade instance
export interface OrganelleUpgrade {
  id: string;
  type: UpgradeType;
  organelleHex: HexCoord;
  rimHex: HexCoord;     // Specific rim tile where upgrade is installed
  
  // I/O capacity
  inputCapacity: number;  // Max incoming cargo per tick
  outputCapacity: number; // Max outgoing cargo per tick
  
  // State
  inputQueue: string[];   // Cargo IDs waiting to be processed
  outputQueue: string[];  // Cargo IDs ready to be sent
}

// Story 13.4: Junction between filament and upgrade
export interface FilamentJunction {
  id: string;
  segmentId: string;
  upgradeId: string;
  hexCoord: HexCoord;
  
  // Traffic flow
  isActive: boolean;
  lastTransferTime: number;
}

// Milestone 13: Filament blueprint system for gradual construction
export interface FilamentBlueprint extends BaseBlueprint {
  type: FilamentType;
  fromHex: HexCoord;
  toHex: HexCoord;
  
  // Construction rate
  buildRatePerTick: number;
}

// Story 13.2: Segment state for network replication
type SegmentState = { 
  segments: Record<string, FilamentSegment> 
};

type BlueprintState = {
  blueprints: Record<string, FilamentBlueprint>
};

export class CytoskeletonSystem extends System {
  private worldRefs: WorldRefs;
  
  // Network state mirrors
  private segmentsState = this.stateChannel<SegmentState>('segments', { segments: {} });
  private blueprintState = this.stateChannel<BlueprintState>('filament_blueprints', { blueprints: {} });
  
  // Core data structures
  private networks: Map<string, FilamentNetwork> = new Map();
  private upgrades: Map<string, OrganelleUpgrade> = new Map();
  private junctions: Map<string, FilamentJunction> = new Map();
  
  // NOTE: Blueprints are stored only in replicated state (this.blueprintState.blueprints)
  
  // Graph for segment transport
  public graph: CytoskeletonGraph;
  
  // ID generators
  private nextSegmentId = 1;
  private nextNetworkId = 1;
  private nextUpgradeId = 1;
  private nextJunctionId = 1;
  private nextBlueprintId = 1;
  
  // Story 13.6: MTOC location for microtubule seeding
  private mtocHex: HexCoord | null = null;
  
  // Upgrade configurations
  private readonly UPGRADE_CONFIGS: Record<UpgradeType, any> = {
    npc_exporter: {
      inputCapacity: 1,
      outputCapacity: 1
    },
    er_exit: {
      inputCapacity: 1,
      outputCapacity: 1
    },
    golgi_tgn: {
      inputCapacity: 2,
      outputCapacity: 2
    },
    exocyst_hotspot: {
      inputCapacity: 1,
      outputCapacity: 0 // Final destination
    }
  };

  constructor(scene: Phaser.Scene, netBus: NetBus, worldRefs: WorldRefs) {
    super(scene, netBus, 'CytoskeletonSystem', (deltaSeconds: number) => this.updateCytoskeleton(deltaSeconds), { address: 'CytoskeletonSystem' });
    this.worldRefs = worldRefs;
    
    // Initialize graph for real segment transport
    this.graph = new CytoskeletonGraph(worldRefs);
    
    // Story 13.6: Initialize starter cytoskeleton
    this.initializeStarterCytoskeleton();
    
    // Debug: Show initial graph state
    setTimeout(() => {
      console.log("🚂 Initial Cytoskeleton Graph State: Ready");
    }, 100);
  }

  // Public getters for graph system
  get allSegments(): Record<string, FilamentSegment> {
    return this.segmentsState.segments;
  }

  get allUpgrades(): Map<string, OrganelleUpgrade> {
    return this.upgrades;
  }

  public updateCytoskeleton(deltaSeconds: number): void {
    this.processUpgradeQueues(deltaSeconds);
    this.updateJunctionActivity();
    
    // Milestone 13: Process filament blueprint construction
    this.processFilamentBlueprints(deltaSeconds);
  }

  /**
   * Story 13.6: Initialize starter cytoskeleton near nucleus
   */
  private initializeStarterCytoskeleton(): void {
    // Find nucleus location for MTOC placement
    const nucleusOrganelles = this.worldRefs.organelleSystem.getOrganellesByType('nucleus');
    if (nucleusOrganelles.length === 0) {
      console.warn("No nucleus found for MTOC placement");
      return;
    }
    
    const nucleus = nucleusOrganelles[0];
    this.mtocHex = { q: nucleus.coord.q + 1, r: nucleus.coord.r }; // Adjacent to nucleus
    
    console.log(`MTOC placed at (${this.mtocHex.q}, ${this.mtocHex.r})`);
    
    // Add some test resources around the MTOC for cytoskeleton construction
    const resourceTiles = [
      { q: this.mtocHex.q, r: this.mtocHex.r },
      { q: this.mtocHex.q + 1, r: this.mtocHex.r },
      { q: this.mtocHex.q - 1, r: this.mtocHex.r },
      { q: this.mtocHex.q, r: this.mtocHex.r + 1 },
      { q: this.mtocHex.q, r: this.mtocHex.r - 1 },
    ];
    
    for (const coord of resourceTiles) {
      const tile = this.worldRefs.hexGrid.getTile(coord);
      if (tile && !tile.isMembrane) {
        // Add small amounts of AA and PROTEIN for cytoskeleton construction
        this.worldRefs.hexGrid.addConcentration(coord, 'AA', 2.0);
        this.worldRefs.hexGrid.addConcentration(coord, 'PROTEIN', 2.0);
      }
    }
    
    console.log(`Added AA and PROTEIN resources around MTOC for cytoskeleton construction`);
    
    // Create 3-5 short microtubule spokes from MTOC
    this.createStarterMicrotubules();
    
    // Create sparse cortical actin ring
    this.createStarterActin();
  }
  
  /**
   * Story 13.6: Create starter microtubule spokes from MTOC
   */
  private createStarterMicrotubules(): void {
    if (!this.mtocHex) return;
    
    const directions = [
      { q: 1, r: 0 },   // East
      { q: 0, r: 1 },   // Southeast
      { q: -1, r: 1 },  // Southwest
      { q: -1, r: 0 },  // West
      { q: 0, r: -1 }   // Northwest
    ];
    
    // Create 3-4 short spokes (2-3 segments each)
    for (let i = 0; i < 4; i++) {
      const dir = directions[i];
      const spokeLength = 2 + Math.floor(Math.random() * 2); // 2-3 segments
      
      let currentHex = { ...this.mtocHex };
      for (let j = 0; j < spokeLength; j++) {
        const nextHex = { 
          q: currentHex.q + dir.q, 
          r: currentHex.r + dir.r 
        };
        
        // Check if next hex is valid (in cytosol, not membrane)
        if (this.isValidFilamentPlacement(nextHex, 'microtubule')) {
          this.createSegment('microtubule', currentHex, nextHex);
          currentHex = nextHex;
        } else {
          break; // Stop this spoke if we hit an invalid tile
        }
      }
    }
    
    console.log("Starter microtubules created");
  }
  
  /**
   * Story 13.6: Create sparse cortical actin ring
   */
  private createStarterActin(): void {
    const membraneTiles = this.worldRefs.hexGrid.getMembraneTiles();
    const actinSegmentCount = Math.min(6, Math.floor(membraneTiles.length / 4)); // Sparse ring
    
    // Create a few short actin arcs along the membrane
    const usedTiles = new Set<string>();
    let segmentsCreated = 0;
    
    for (const membraneTile of membraneTiles) {
      if (segmentsCreated >= actinSegmentCount) break;
      
      const tileKey = `${membraneTile.coord.q},${membraneTile.coord.r}`;
      if (usedTiles.has(tileKey)) continue;
      
      // Find an adjacent cytosol tile for actin placement
      const neighbors = this.worldRefs.hexGrid.getNeighbors(membraneTile.coord);
      const cytosolNeighbors = neighbors.filter(n => !n.isMembrane);
      
      if (cytosolNeighbors.length >= 2) {
        // Create a short 2-segment actin arc
        const start = cytosolNeighbors[0];
        const end = cytosolNeighbors[1];
        
        this.createSegment('actin', start.coord, end.coord);
        
        usedTiles.add(`${start.coord.q},${start.coord.r}`);
        usedTiles.add(`${end.coord.q},${end.coord.r}`);
        segmentsCreated++;
      }
    }
    
    console.log(`Starter actin segments created: ${segmentsCreated}`);
  }
  
  /**
   * Story 13.2: Check if a filament can be placed at this location
   */
  private isValidFilamentPlacement(hex: HexCoord, type: FilamentType): boolean {
    const tile = this.worldRefs.hexGrid.getTile(hex);
    if (!tile) return false;
    
    // Both types are cytosol-only (cannot occupy membrane tiles)
    if (tile.isMembrane) return false;
    
    // Check if tile is already occupied by an organelle
    if (this.worldRefs.organelleSystem.hasTileOrganelle(hex)) return false;
    
    // MTOC is always a valid starting point for microtubules
    if (type === 'microtubule' && this.mtocHex && 
        this.mtocHex.q === hex.q && this.mtocHex.r === hex.r) {
      return true;
    }
    
    // Check if there's already a filament segment at this location
    // Allow placement if there's an existing compatible segment (for extending networks)
    for (const segment of Object.values(this.segmentsState.segments)) {
      const segmentAtFromHex = (segment.fromHex.q === hex.q && segment.fromHex.r === hex.r);
      const segmentAtToHex = (segment.toHex.q === hex.q && segment.toHex.r === hex.r);
      
      if (segmentAtFromHex || segmentAtToHex) {
        // If there's a segment of the same type, allow extending from it
        if (segment.type === type) {
          return true; // Compatible segment found, allow extension
        } else {
          // Different filament type at this location - not allowed
          return false;
        }
      }
    }
    
    // Allow placement on empty tiles
    return true;
  }
  
  /**
   * Task 4: Validate blueprint placement including conflicts with existing blueprints
   */
  private validateFilamentBlueprintPlacement(type: FilamentType, fromHex: HexCoord, toHex: HexCoord): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Basic placement validation
    if (!this.isValidFilamentPlacement(fromHex, type)) {
      errors.push(`Invalid start position (${fromHex.q}, ${fromHex.r}) for ${type}`);
    }
    
    if (!this.isValidFilamentPlacement(toHex, type)) {
      errors.push(`Invalid end position (${toHex.q}, ${toHex.r}) for ${type}`);
    }
    
    // Check for blueprint conflicts
    for (const blueprint of Object.values(this.blueprintState.blueprints)) {
      if (!blueprint.isActive) continue;
      
      // Check if this blueprint conflicts with start or end positions
      const conflictsWithStart = (blueprint.fromHex.q === fromHex.q && blueprint.fromHex.r === fromHex.r) ||
                                (blueprint.toHex.q === fromHex.q && blueprint.toHex.r === fromHex.r);
      const conflictsWithEnd = (blueprint.fromHex.q === toHex.q && blueprint.fromHex.r === toHex.r) ||
                              (blueprint.toHex.q === toHex.q && blueprint.toHex.r === toHex.r);
      
      if (conflictsWithStart) {
        errors.push(`Another ${blueprint.type} blueprint already planned at start position (${fromHex.q}, ${fromHex.r})`);
      }
      
      if (conflictsWithEnd) {
        errors.push(`Another ${blueprint.type} blueprint already planned at end position (${toHex.q}, ${toHex.r})`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Milestone 13: Create a filament blueprint for gradual construction (server-authoritative)
   */
  @RunOnServer()
  public createFilamentBlueprint(type: FilamentType, fromHex: HexCoord, toHex: HexCoord): string | null {
    // Use enhanced validation
    const validation = this.validateFilamentBlueprintPlacement(type, fromHex, toHex);
    if (!validation.isValid) {
      console.warn(`Cannot create ${type} blueprint: ${validation.errors.join(', ')}`);
      return null;
    }
    
    // const config = this.FILAMENT_CONFIGS[type]; // Will be used later for segment creation
    const blueprintId = `${type}_blueprint_${this.nextBlueprintId++}`;
    
    // Create blueprint directly in replicated state
    const blueprint: FilamentBlueprint = {
      id: blueprintId,
      type,
      fromHex: { ...fromHex },
      toHex: { ...toHex },
      progress: {
        AA: 0,
        PROTEIN: 0
      },
      required: {
        AA: 1.0, // Simple default cost
        PROTEIN: 1.0
      },
      isActive: true,
      createdAt: Date.now(),
      buildRatePerTick: type === 'actin' ? 2.0 : 1.5 // Actin builds faster
    };
    
    this.blueprintState.blueprints[blueprintId] = blueprint;
    
    console.log(`Created ${type} blueprint: (${fromHex.q},${fromHex.r}) -> (${toHex.q},${toHex.r})`);
    return blueprintId;
  }
  
  /**
   * Milestone 13: Process blueprint construction over time (server-only)
   */
  @RunOnServer()
  private processFilamentBlueprints(deltaSeconds: number): void {
    for (const blueprint of Object.values(this.blueprintState.blueprints)) {
      if (!blueprint.isActive) continue;
      
      this.processBlueprint(blueprint, deltaSeconds);
    }
  }
  
  /**
   * Milestone 13: Process individual blueprint construction (server-only)
   */
  @RunOnServer()
  private processBlueprint(blueprint: FilamentBlueprint, deltaSeconds: number): void {
    // Calculate how much we can consume this tick
    const maxConsumptionPerTick = blueprint.buildRatePerTick * deltaSeconds;
    
    // Debug: Log blueprint processing
    if (Math.random() < 0.01) { // Log occasionally to avoid spam
      console.log(`🔨 Processing blueprint ${blueprint.id} at (${blueprint.fromHex.q},${blueprint.fromHex.r})`);
      const tile = this.worldRefs.hexGrid.getTile(blueprint.fromHex);
      if (tile) {
        console.log(`  Available concentrations:`, tile.concentrations);
        console.log(`  Current progress:`, blueprint.progress);
        console.log(`  Required:`, blueprint.required);
      }
    }
    
    // Try to consume AA first, then PROTEIN
    for (const [speciesId, requiredAmount] of Object.entries(blueprint.required)) {
      const currentProgress = blueprint.progress[speciesId] || 0;
      const stillNeeded = requiredAmount - currentProgress;
      
      if (stillNeeded <= 0) continue; // Already satisfied
      
      // Check what's available at the starting tile
      const tile = this.worldRefs.hexGrid.getTile(blueprint.fromHex);
      if (!tile) continue;
      
      const availableAmount = tile.concentrations[speciesId as keyof typeof tile.concentrations] || 0;
      const canConsume = Math.min(stillNeeded, availableAmount, maxConsumptionPerTick);
      
      if (canConsume > 0) {
        // Consume resources from tile
        this.worldRefs.hexGrid.addConcentration(blueprint.fromHex, speciesId as any, -canConsume);
        
        // Update blueprint progress directly in replicated state
        blueprint.progress[speciesId] = (blueprint.progress[speciesId] || 0) + canConsume;
        
        console.log(`🔨 Blueprint ${blueprint.id} consumed ${canConsume.toFixed(3)} ${speciesId} (${blueprint.progress[speciesId]!.toFixed(3)}/${requiredAmount})`);
      }
    }
    
    // Check if blueprint is complete
    this.checkBlueprintCompletion(blueprint);
  }
  
  /**
   * Milestone 13: Check if blueprint is complete and spawn filament (server-only)
   */
  @RunOnServer()
  private checkBlueprintCompletion(blueprint: FilamentBlueprint): void {
    const isComplete = blueprint.progress['AA'] >= blueprint.required['AA'] && 
                      blueprint.progress['PROTEIN'] >= blueprint.required['PROTEIN'];
    
    if (isComplete) {
      // Create the actual filament segment
      const segmentId = this.createSegment(blueprint.type, blueprint.fromHex, blueprint.toHex);
      
      if (segmentId) {
        console.log(`Blueprint ${blueprint.id} completed! Created segment ${segmentId}`);
        this.worldRefs.showToast(`${blueprint.type} filament completed!`);
      }
      
      // Remove the blueprint from replicated state only
      blueprint.isActive = false;
      delete this.blueprintState.blueprints[blueprint.id];
    }
  }
  
  /**
   * Milestone 13: Get all active blueprints (for rendering)
   */
  public getActiveBlueprints(): FilamentBlueprint[] {
    return Object.values(this.blueprintState.blueprints).filter(bp => bp.isActive);
  }

  /**
   * Story 13.2: Create a new filament segment (internal implementation)
   */
  private createSegment(type: FilamentType, fromHex: HexCoord, toHex: HexCoord): string | null {
    // Validate placement
    if (!this.isValidFilamentPlacement(fromHex, type) || !this.isValidFilamentPlacement(toHex, type)) {
      return null;
    }
    
    const segmentId = `${type}_segment_${this.nextSegmentId++}`;
    
    const segment: FilamentSegment = {
      id: segmentId,
      type,
      fromHex: { ...fromHex },
      toHex: { ...toHex },
      networkId: '', // Will be assigned when building networks
    };
    
    // Store only in replicated state - no dual data structures
    this.segmentsState.segments[segmentId] = segment;
    
    this.rebuildNetworks(); // Rebuild network topology
    this.graph.markDirty(); // Mark graph for rebuild
    
    // Notify cargo system that graph topology has changed
    this.worldRefs.cargoSystem?.onGraphTopologyChanged();
    
    console.log(`Created ${type} segment: (${fromHex.q},${fromHex.r}) -> (${toHex.q},${toHex.r}) in replicated state`);
    return segmentId;
  }
  
  /**
   * Update network topology after segment changes
   */
  private rebuildNetworks(): void {
    this.networks.clear();
    
    // Group connected segments into networks
    const visited = new Set<string>();
    
    for (const segment of Object.values(this.segmentsState.segments)) {
      if (visited.has(segment.id)) continue;
      
      const networkId = `network_${this.nextNetworkId++}`;
      const network: FilamentNetwork = {
        id: networkId,
        type: segment.type,
        segments: new Set(),
        totalCapacity: 0,
        totalLoad: 0
      };
      
      // Find all connected segments of the same type
      this.exploreNetwork(segment, network, visited);
      
      // Set network ID for all segments in this network
      for (const segmentId of network.segments) {
        const seg = this.segmentsState.segments[segmentId];
        if (seg) {
          seg.networkId = networkId;
          network.totalCapacity += 1; // Constant capacity per segment
          // No load tracking for simplified segments
        }
      }
      
      this.networks.set(networkId, network);
    }
    
    console.log(`Networks rebuilt: ${this.networks.size} networks, ${Object.keys(this.segmentsState.segments).length} segments`);
  }
  
  /**
   * Recursively explore connected segments for network building
   */
  private exploreNetwork(segment: FilamentSegment, network: FilamentNetwork, visited: Set<string>): void {
    if (visited.has(segment.id)) return;
    
    visited.add(segment.id);
    network.segments.add(segment.id);
    
    // Find connected segments of the same type
    for (const otherSegment of Object.values(this.segmentsState.segments)) {
      if (otherSegment.id === segment.id || otherSegment.type !== segment.type) continue;
      if (visited.has(otherSegment.id)) continue;
      
      // Check if segments are connected (share an endpoint)
      if (this.segmentsConnected(segment, otherSegment)) {
        this.exploreNetwork(otherSegment, network, visited);
      }
    }
  }
  
  /**
   * Check if two segments are connected (share an endpoint)
   */
  private segmentsConnected(seg1: FilamentSegment, seg2: FilamentSegment): boolean {
    return (
      (seg1.fromHex.q === seg2.fromHex.q && seg1.fromHex.r === seg2.fromHex.r) ||
      (seg1.fromHex.q === seg2.toHex.q && seg1.fromHex.r === seg2.toHex.r) ||
      (seg1.toHex.q === seg2.fromHex.q && seg1.toHex.r === seg2.fromHex.r) ||
      (seg1.toHex.q === seg2.toHex.q && seg1.toHex.r === seg2.toHex.r)
    );
  }
  
  /**
   * Story 13.3: Create an organelle upgrade
   */
  public createUpgrade(type: UpgradeType, organelleHex: HexCoord, rimHex: HexCoord): string | null {
    // Validate placement
    if (!this.isValidUpgradePlacement(type, organelleHex, rimHex)) {
      return null;
    }
    
    const config = this.UPGRADE_CONFIGS[type];
    const upgradeId = `${type}_${this.nextUpgradeId++}`;
    
    const upgrade: OrganelleUpgrade = {
      id: upgradeId,
      type,
      organelleHex: { ...organelleHex },
      rimHex: { ...rimHex },
      inputCapacity: config.inputCapacity,
      outputCapacity: config.outputCapacity,
      inputQueue: [],
      outputQueue: []
    };
    
    this.upgrades.set(upgradeId, upgrade);
    this.updateJunctions(); // Check for new junction opportunities
    this.graph.markDirty(); // Mark graph for rebuild
    
    console.log(`Created upgrade ${type} at organelle (${organelleHex.q},${organelleHex.r}) rim (${rimHex.q},${rimHex.r})`);
    return upgradeId;
  }
  
  /**
   * Story 13.3: Validate upgrade placement
   */
  private isValidUpgradePlacement(type: UpgradeType, organelleHex: HexCoord, rimHex: HexCoord): boolean {
    // Check if organelle exists at the specified hex
    const organelle = this.worldRefs.organelleSystem.getOrganelleAtTile(organelleHex);
    if (!organelle) return false;
    
    // Check type compatibility
    const validPlacements: Record<UpgradeType, string[]> = {
      npc_exporter: ['nucleus'],
      er_exit: ['proto-er'],
      golgi_tgn: ['golgi'],
      exocyst_hotspot: [] // Can be placed on membrane
    };
    
    if (type !== 'exocyst_hotspot' && !validPlacements[type].includes(organelle.type)) {
      return false;
    }
    
    // Check if rim hex is adjacent to organelle and not already occupied
    const rimTile = this.worldRefs.hexGrid.getTile(rimHex);
    if (!rimTile) return false;
    
    // Check if there's already an upgrade at this rim hex
    for (const upgrade of this.upgrades.values()) {
      if (upgrade.rimHex.q === rimHex.q && upgrade.rimHex.r === rimHex.r) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Story 13.4: Update junctions between filaments and upgrades
   */
  private updateJunctions(): void {
    // Clear existing junctions
    this.junctions.clear();
    
    // Check each segment against each upgrade for proximity
    for (const segment of Object.values(this.segmentsState.segments)) {
      for (const upgrade of this.upgrades.values()) {
        if (this.segmentAdjacentToUpgrade(segment, upgrade)) {
          const junctionId = `junction_${this.nextJunctionId++}`;
          
          const junction: FilamentJunction = {
            id: junctionId,
            segmentId: segment.id,
            upgradeId: upgrade.id,
            hexCoord: { ...upgrade.rimHex },
            isActive: true,
            lastTransferTime: 0
          };
          
          this.junctions.set(junctionId, junction);
          
          console.log(`Created junction: segment ${segment.id} <-> upgrade ${upgrade.id}`);
        }
      }
    }
  }
  
  /**
   * Check if a filament segment is adjacent to an upgrade
   */
  private segmentAdjacentToUpgrade(segment: FilamentSegment, upgrade: OrganelleUpgrade): boolean {
    // Check if either end of the segment is adjacent to the upgrade's rim hex
    const rimHex = upgrade.rimHex;
    
    return this.hexesAdjacent(segment.fromHex, rimHex) || 
           this.hexesAdjacent(segment.toHex, rimHex);
  }
  
  /**
   * Check if two hexes are adjacent
   */
  private hexesAdjacent(hex1: HexCoord, hex2: HexCoord): boolean {
    const dq = Math.abs(hex1.q - hex2.q);
    const dr = Math.abs(hex1.r - hex2.r);
    const ds = Math.abs((hex1.q + hex1.r) - (hex2.q + hex2.r));
    
    return (dq <= 1 && dr <= 1 && ds <= 1) && (dq + dr + ds === 2);
  }
  
  /**
   * Process upgrade queues and handle cargo flow
   */
  private processUpgradeQueues(_deltaSeconds: number): void {
    // TODO: Story 13.5 - Implement cargo routing through junctions
    // For now, just clear any queues to prevent buildup
    for (const upgrade of this.upgrades.values()) {
      upgrade.inputQueue = [];
      upgrade.outputQueue = [];
    }
  }
  
  /**
   * Update junction activity for visualization
   */
  private updateJunctionActivity(): void {
    const now = Date.now();
    for (const junction of this.junctions.values()) {
      // Mark junction as active if it's been used recently
      junction.isActive = (now - junction.lastTransferTime) < 2000; // 2 second activity window
    }
  }
  
  // Public accessors for rendering system
  
  public getAllSegments(): FilamentSegment[] {
    return Object.values(this.segmentsState.segments);
  }
  
  public getAllUpgrades(): OrganelleUpgrade[] {
    return Array.from(this.upgrades.values());
  }
  
  public getAllJunctions(): FilamentJunction[] {
    return Array.from(this.junctions.values());
  }
  
  public getMTOCLocation(): HexCoord | null {
    return this.mtocHex;
  }
  
  /**
   * Get segments by type for targeted rendering
   */
  public getSegmentsByType(type: FilamentType): FilamentSegment[] {
    return Object.values(this.segmentsState.segments).filter(seg => seg.type === type);
  }

  /**
   * Get all segments that pass through a specific tile
   */
  public getSegmentsAtTile(coord: HexCoord): FilamentSegment[] {
    return Object.values(this.segmentsState.segments).filter(segment => {
      // Check if segment passes through this coordinate
      return (segment.fromHex.q === coord.q && segment.fromHex.r === coord.r) ||
             (segment.toHex.q === coord.q && segment.toHex.r === coord.r);
    });
  }
}
