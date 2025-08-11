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
import type { DiffusionSystem } from "../species/diffusion-system";
import type { PassiveEffectsSystem } from "../species/passive-effects-system";
import type { HeatmapSystem } from "../species/heatmap-system";
import type { ConservationTracker } from "../species/conservation-tracker";

// Milestone 7: Orders & Transcripts data types
export type ProteinId = 'GLUT' | 'AA_TRANSPORTER' | 'NT_TRANSPORTER' | 'ROS_EXPORTER' | 'SECRETION_PUMP' | 'GROWTH_FACTOR_RECEPTOR';

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

export interface WorldRefs {
  // Core spatial system
  hexGrid: HexGrid;
  
  // Player and inventory
  playerInventory: PlayerInventorySystem;
  
  // Organelle systems
  organelleSystem: OrganelleSystem;
  organelleRenderer: any; // Add organelle renderer reference
  
  // Construction systems
  blueprintSystem: BlueprintSystem;
  
  // Membrane systems
  membraneExchangeSystem: MembraneExchangeSystem;
  
  // Species systems
  diffusionSystem: DiffusionSystem;
  passiveEffectsSystem: PassiveEffectsSystem;
  heatmapSystem: HeatmapSystem;
  conservationTracker: ConservationTracker;
  
  // Milestone 7: Orders & Transcripts (now handled by consolidated systems)
  installOrders: Map<string, InstallOrder>;
  transcripts: Map<string, Transcript>;
  carriedTranscripts: Transcript[];
  nextOrderId: number;
  nextTranscriptId: number;
  
  // UI methods
  showToast(message: string): void;
  refreshTileInfo(): void; // Force refresh of tile info panel
}
