/**
 * World References - Core Data Access
 * 
 * Minimal interface that passes around pointers to the core game state
 * so systems don't import from the Scene directly.
 */

import type { HexGrid } from "../hex/hex-grid";
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

// Milestone 7: Orders & Transcripts data types
export type ProteinId = 'GLUT' | 'AA_TRANSPORTER' | 'NT_TRANSPORTER' | 'ROS_EXPORTER' | 'SECRETION_PUMP' | 'GROWTH_FACTOR_RECEPTOR';

// Story 8.10: Shared cargo and processing types for better code organization
export type GlycosylationState = 'none' | 'partial' | 'complete';
export type VesicleState = 'QUEUED_ER' | 'EN_ROUTE_GOLGI' | 'QUEUED_GOLGI' | 'EN_ROUTE_MEMBRANE' | 'INSTALLING' | 'DONE' | 'EXPIRED' | 'BLOCKED';

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
  moveAccumulator: number; // accumulated movement distance for discrete hex movement
  destHex?: { q: number; r: number }; // original destination from install order
  state: 'traveling' | 'processing_at_er' | 'packaged_for_transport' | 'installing_at_membrane';
  processingTimer: number; // time remaining for current state
  glycosylationState: 'none' | 'partial' | 'complete'; // glycosylation level (affects membrane integration)
}

// Milestone 8: Vesicle entity with comprehensive FSM
export interface Vesicle {
  id: string;
  proteinId: ProteinId;
  atHex: { q: number; r: number };
  ttlMs: number; // lifetime in milliseconds
  worldPos: Phaser.Math.Vector2;
  isCarried: boolean;
  destHex: { q: number; r: number }; // final membrane destination
  state: VesicleState;
  glyco: Exclude<GlycosylationState, 'none'>; // vesicles always have some glycosylation
  processingTimer: number; // time remaining for current processing step
  routeCache?: { q: number; r: number }[]; // cached pathfinding route
  retryCounter: number; // number of times blocked and retried
}

export interface WorldRefs {
  // Core spatial system
  hexGrid: HexGrid;
  
  // HOTFIX: Root container for all cell visuals
  cellRoot: Phaser.GameObjects.Container;
  
  // Player and inventory
  playerInventory: PlayerInventorySystem;
  
  // Organelle systems
  organelleSystem: OrganelleSystem;
  organelleRenderer: any; // Add organelle renderer reference
  
  // Construction systems
  blueprintSystem: BlueprintSystem;
  
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
