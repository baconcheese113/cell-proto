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
import type { OrganelleType } from "../organelles/organelle-registry";
import type { BlueprintSystem } from "../construction/blueprint-system";
import type { MembraneExchangeSystem } from "../membrane/membrane-exchange-system";
import type { MembranePortSystem } from "../membrane/membrane-port-system";
import type { DiffusionSystem } from "../species/diffusion-system";
import type { PassiveEffectsSystem } from "../species/passive-effects-system";
import type { HeatmapSystem } from "../species/heatmap-system";
import type { CellSpaceSystem } from "./cell-space-system";
import type { SubstrateSystem } from "./substrate-system";
import type { CellMotility } from "../systems/cell-motility";
import type { CytoskeletonSystem } from "../systems/cytoskeleton-system";
import type { OrganelleRenderer } from "../organelles/organelle-renderer";
import type { CellOverlays } from "../systems/cell-overlays";
import type { Player } from "@/actors/player";
import type { GameScene } from "@/scenes/game-scene";
import type { CytoskeletonRenderer } from "@/systems/cytoskeleton-renderer";
import type { CytoskeletonGraph } from "@/systems/cytoskeleton-graph";
import type { CargoSystem } from "@/systems/cargo-system";
import type { InstallOrderSystem } from "@/systems/install-order-system";

// Milestone 7: Orders & Transcripts data types
export type ProteinId = 'GLUT' | 'AA_TRANSPORTER' | 'NT_TRANSPORTER' | 'ROS_EXPORTER' | 'SECRETION_PUMP' | 'GROWTH_FACTOR_RECEPTOR';
export type CargoType = 'vesicle' | 'transcript' | 'polypeptide';
// Simplified cargo state system - user's vision: combine simple state with destination knowledge
export type GlycosylationState = 'none' | 'partial' | 'complete';
export type CargoState = 'BLOCKED' | 'TRANSFORMING' | 'MOVING' | 'QUEUED';

// Milestone 13: Cargo itinerary system for persistent route planning
// Using OrganelleType directly instead of separate CargoStageKind

export interface CargoStage {
  kind: OrganelleType;
  targetHex?: HexCoord;     // for membrane hotspot (dest) - only used for transporter
  enterMs: number;          // time to enter seat from rim (e.g., 1000)
  processMs: number;        // time in-seat to convert (e.g., ER fold 2000)
}

export interface CargoItinerary { 
  stages: CargoStage[]; 
  stageIndex: number; 
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
  itinerary: CargoItinerary; // Full stage progression for this order
}

export interface Cargo {
  id: string;
  currentType: CargoType;
  proteinId: ProteinId;
  atHex?: { q: number; r: number };
  worldPos: Phaser.Math.Vector2; // for smooth movement rendering
  destHex: { q: number; r: number }; // original destination from install order
  createdAt: number;    // timestamp when last created at an organelle, basis for the TTL
  ttlSecondsInitial: number; // starting lifetime in seconds for current Cargo type
  ttlSecondsRemaining: number; // remaining lifetime in seconds, resets when transitioned to new Cargo type
  localDecayRate: number;  // Client-side decay multiplier
  carriedBy?: string; // Player ID who is carrying this cargo, null if on ground
  isThrown?: boolean; // true if currently being thrown
  state: CargoState; // Unified states: BLOCKED (no path), TRANSFORMING (processing), MOVING (en route), QUEUED (waiting)  
  glycosylationState: 'none' | 'partial' | 'complete'; // glycosylation level (affects membrane integration)

  currentStageDestination?: { q: number; r: number }; // Where cargo is trying to go for current stage
  
  // ER/Golgi seat reservation tracking
  reservedSeatId?: string; // Seat ID reserved at organelle for processing
  targetOrganelleId?: string; // Organelle ID where seat is reserved
  
  // Milestone 13: Persistent route planning
  itinerary?: CargoItinerary;
  routeCache?: { q: number; r: number }[]; // cached pathfinding route
  processingTimer: number; // timestamp when processing at current stage began
  // Milestone 13: Segment state for cytoskeleton transport
  segmentState?: {
    nodeId: string;        // Current node
    nextNodeId?: string;   // Next node in path
    edgeId?: string;       // Current edge (if moving)
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
  isNetworkControlled?: boolean; // Network multiplayer flag for state synchronization
}

export interface WorldRefs {
  // Core spatial system
  hexGrid: HexGrid;
  
  // HOTFIX: Root container for all cell visuals
  cellRoot: Phaser.GameObjects.Container;
  
  // Scene reference for visual updates
  scene?: GameScene; // Game scene reference for membrane visual refreshes
  
  // Player and inventory
  playerInventory: PlayerInventorySystem;
  player: Player; // Player actor for position tracking
  
  // Organelle systems
  organelleSystem: OrganelleSystem;
  organelleRenderer: OrganelleRenderer; // Add organelle renderer reference
  
  // Construction systems
  blueprintSystem: BlueprintSystem;
  
  // Overlay systems
  cellOverlays: CellOverlays; // Add cell overlays for queue badges
  
  // Cytoskeleton rendering
  cytoskeletonRenderer: CytoskeletonRenderer; // Add cytoskeleton renderer reference
  
  // Membrane systems
  membraneExchangeSystem: MembraneExchangeSystem;
  membranePortSystem: MembranePortSystem; // Story 8.11: External interface system
  
  // Species systems
  diffusionSystem: DiffusionSystem;
  passiveEffectsSystem: PassiveEffectsSystem;
  heatmapSystem: HeatmapSystem;
  
  // Milestone 9: Cell locomotion systems
  cellSpaceSystem: CellSpaceSystem;
  substrateSystem: SubstrateSystem;
  cellMotility: CellMotility;
  
  // Milestone 13: Cytoskeleton transport system
  cytoskeletonSystem: CytoskeletonSystem;
  
  // Graph for real segment transport
  cytoskeletonGraph: CytoskeletonGraph; // CytoskeletonGraph - will be initialized by cytoskeleton system
  
  // Milestone 7: Orders & Install Management
  installOrders: Map<string, InstallOrder>;
  nextOrderId: number;
  
  // Milestone 12: Unified cargo management system - SINGLE SOURCE OF TRUTH
  cargoSystem: CargoSystem;
  
  // Install order system for transcript creation
  installOrderSystem: InstallOrderSystem;
  
  // UI methods
  showToast(message: string): void;
  refreshTileInfo(): void; // Force refresh of tile info panel
}
