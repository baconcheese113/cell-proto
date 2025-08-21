/**
 * World References - Core Data Access
 * 
 * Minimal interface that passes around pointers to the core game state
 * so systems don't import from the Scene directly.
 */

import type { HexGrid } from "../hex/hex-grid";
import type { HexCoord } from "../hex/hex-grid";
import type { PlayerInventorySystem } from "../player/player-inventory";
import type { OrganelleSystem } from "../organelles/organelle-system";
import type { BlueprintSystem } from "../construction/blueprint-system";
import type { MembraneExchangeSystem } from "../membrane/membrane-exchange-system";
import type { MembranePortSystem } from "../membrane/membrane-port-system";
import type { DiffusionSystem } from "../species/diffusion-system";
import type { PassiveEffectsSystem } from "../species/passive-effects-system";
import type { HeatmapSystem } from "../species/heatmap-system";
import type { ConservationTracker } from "../species/conservation-tracker";
import type { CellSpaceSystem } from "./cell-space-system";
import type { SubstrateSystem } from "./substrate-system";
import type { CellMotility } from "../systems/cell-motility";
import type { CytoskeletonSystem } from "../systems/cytoskeleton-system";

// Milestone 7: Orders & Transcripts data types
export type ProteinId = 'GLUT' | 'AA_TRANSPORTER' | 'NT_TRANSPORTER' | 'ROS_EXPORTER' | 'SECRETION_PUMP' | 'GROWTH_FACTOR_RECEPTOR';

// Story 8.10: Shared cargo and processing types for better code organization
export type GlycosylationState = 'none' | 'partial' | 'complete';
export type VesicleState = 'QUEUED_ER' | 'EN_ROUTE_GOLGI' | 'QUEUED_GOLGI' | 'EN_ROUTE_MEMBRANE' | 'INSTALLING' | 'DONE' | 'EXPIRED' | 'BLOCKED';

// Milestone 13: Cargo itinerary system for persistent route planning
export type CargoStageKind = 'NUCLEUS' | 'ER' | 'GOLGI' | 'MEMBRANE_HOTSPOT';

export interface CargoStage {
  kind: CargoStageKind;
  targetOrgId?: string;     // for ER/Golgi instances
  targetHex?: HexCoord;     // for membrane hotspot (dest)
  requires: 'actin' | 'microtubule' | 'either'; // preferred track for this leg
  enterMs: number;          // time to enter seat from rim (e.g., 1000)
  processMs: number;        // time in-seat to convert (e.g., ER fold 2000)
}

export interface CargoItinerary { 
  stages: CargoStage[]; 
  stageIndex: number; 
}

/**
 * Story 8.10: Represents a protein cargo with its processing state
 */
export interface ProteinCargo {
  proteinId: ProteinId;
  glycosylationState: GlycosylationState;
  processedAt?: number; // timestamp when processing completed
}

/**
 * Story 8.10: Performance metrics for system monitoring
 */
export interface SystemPerformanceMetrics {
  activeEntities: number;
  processingRate: number; // entities per second
  memoryUsage: number; // estimated memory in KB
  averageLifetime: number; // average entity lifetime in seconds
}

export interface InstallOrder {
  id: string;
  proteinId: ProteinId;
  destHex: { q: number; r: number };
  createdAt: number; // timestamp for priority/aging
}

export interface Transcript {
  id: string;
  proteinId: ProteinId;
  atHex: { q: number; r: number };
  ttlSeconds: number;
  worldPos: Phaser.Math.Vector2; // for smooth movement rendering
  isCarried: boolean; // true if player is carrying it
  isThrown?: boolean; // true if currently being thrown
  isNetworkControlled?: boolean; // true if controlled by network (remote player)
  moveAccumulator: number; // accumulated movement distance for discrete hex movement
  destHex?: { q: number; r: number }; // original destination from install order
  state: 'traveling' | 'processing_at_er' | 'packaged_for_transport' | 'installing_at_membrane';
  processingTimer: number; // time remaining for current state
  glycosylationState: 'none' | 'partial' | 'complete'; // glycosylation level (affects membrane integration)
  
  // Milestone 13: Persistent route planning
  itinerary?: CargoItinerary;
}

// Milestone 8: Vesicle entity with comprehensive FSM
export interface Vesicle {
  id: string;
  proteinId: ProteinId;
  atHex: { q: number; r: number };
  ttlMs: number; // lifetime in milliseconds
  worldPos: Phaser.Math.Vector2;
  isCarried: boolean;
  isThrown?: boolean; // true if currently being thrown
  destHex: { q: number; r: number }; // final membrane destination
  state: VesicleState;
  glyco: Exclude<GlycosylationState, 'none'>; // vesicles always have some glycosylation
  processingTimer: number; // time remaining for current processing step
  routeCache?: { q: number; r: number }[]; // cached pathfinding route
  retryCounter: number; // number of times blocked and retried
  
  // Milestone 13: Rail state for cytoskeleton transport
  railState?: {
    nodeId: string;        // Current node
    nextNodeId?: string;   // Next node in path
    edgeId?: string;       // Current edge (if moving)
    status: 'queued' | 'moving' | 'stranded';
    plannedPath: string[]; // Node IDs from start to finish
    pathIndex: number;     // Current position in planned path
    
    // Progress tracking for visual feedback
    transitProgress?: number;    // 0.0 to 1.0 progress along current edge
    transitTimer?: number;       // Time remaining for current transit
    totalTransitTime?: number;   // Total time for current edge transit
    
    // A) Launch → Transit → Dwell behavior
    handoffKind?: 'actin-launch'|'actin-end-dwell';
    handoffTimer?: number;          // ms
    handoffDuration?: number;       // ms (default 500)
    
    // B) 3-step actin traversal
    actinPhase?: 'move-to-start' | 'arrival-pause' | 'working' | 'move-to-end';
    actinTimer?: number;       // Timer for current actin phase
    actinProgress?: number;    // Progress (0.0 to 1.0) for working phase
  };
  
  // Milestone 13: Persistent route planning
  itinerary?: CargoItinerary;
  
  // Network multiplayer flag
  isNetworkControlled?: boolean; // If true, local systems should not override state
}

export interface WorldRefs {
  // Core spatial system
  hexGrid: HexGrid;
  
  // HOTFIX: Root container for all cell visuals
  cellRoot: Phaser.GameObjects.Container;
  
  // Scene reference for visual updates
  scene?: any; // Game scene reference for membrane visual refreshes
  
  // Player and inventory
  playerInventory: PlayerInventorySystem;
  player?: any; // Player actor for position tracking
  
  // Organelle systems
  organelleSystem: OrganelleSystem;
  organelleRenderer: any; // Add organelle renderer reference
  
  // Construction systems
  blueprintSystem: BlueprintSystem;
  
  // Overlay systems
  cellOverlays: any; // Add cell overlays for queue badges
  
  // Cytoskeleton rendering
  cytoskeletonRenderer: any; // Add cytoskeleton renderer reference
  
  // Membrane systems
  membraneExchangeSystem: MembraneExchangeSystem;
  membranePortSystem: MembranePortSystem; // Story 8.11: External interface system
  
  // Species systems
  diffusionSystem: DiffusionSystem;
  passiveEffectsSystem: PassiveEffectsSystem;
  heatmapSystem: HeatmapSystem;
  conservationTracker: ConservationTracker;
  
  // Milestone 9: Cell locomotion systems
  cellSpaceSystem: CellSpaceSystem;
  substrateSystem: SubstrateSystem;
  cellMotility: CellMotility;
  
  // Milestone 13: Cytoskeleton transport system
  cytoskeletonSystem: CytoskeletonSystem;
  
  // Graph for real rail transport
  cytoskeletonGraph: any; // CytoskeletonGraph - will be initialized by cytoskeleton system
  
  // Milestone 7: Orders & Transcripts (now handled by consolidated systems)
  installOrders: Map<string, InstallOrder>;
  transcripts: Map<string, Transcript>;
  carriedTranscripts: Transcript[];
  nextOrderId: number;
  nextTranscriptId: number;
  
  // Milestone 8: Vesicle system for secretory pipeline
  vesicles: Map<string, Vesicle>;
  carriedVesicles: Vesicle[];
  nextVesicleId: number;
  
  // UI methods
  showToast(message: string): void;
  refreshTileInfo(): void; // Force refresh of tile info panel
}
