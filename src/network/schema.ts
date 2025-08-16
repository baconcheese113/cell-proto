/**
 * Network Schema - Message definitions for Cell Proto multiplayer
 * 
 * Defines the structure of all network messages exchanged between
 * host and clients in the multiplayer session.
 */

import type { HexCoord } from "../hex/hex-grid";
import type { ProteinId } from "../core/world-refs";

// Input sequence number for client-server reconciliation
export type InputSeq = number;

/**
 * Client Input Message - Sent from client to host
 * Contains all player input for a single frame
 */
export interface ClientInput {
  seq: InputSeq;
  dt: number; // Delta time for this input
  
  // Movement
  moveAxis: { x: number; y: number }; // Normalized movement vector
  dash: boolean; // Dash button pressed
  driveToggle: boolean; // Cell drive mode toggle
  
  // Aim/Throw
  aimDir?: { x: number; y: number }; // Normalized aim direction
  throwCharge: number; // 0-1 throw charge amount
  throwRelease: boolean; // Throw release this frame
  
  // Build/Interact
  buildIntent?: {
    type: 'organelle' | 'filament' | 'upgrade';
    subtype: string; // organelle type, filament type, etc.
    hex: HexCoord;
  };
  
  // Actions
  scoopDrop: boolean; // R key - pickup/drop cargo
  interact: boolean; // E key - general interaction
}

/**
 * Host Command Message - Sent from host to clients
 * Confirms successful actions or notifies of rejections
 */
export interface HostCommand {
  type: 'confirm' | 'reject';
  action: 'build' | 'pickup' | 'drop' | 'throw' | 'install' | 'seatReserve' | 'seatRelease';
  data?: any; // Action-specific data
  reason?: string; // Rejection reason for user feedback
}

/**
 * Player Network State - Replicated player information
 */
export interface NetworkPlayer {
  id: string;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  dir: { x: number; y: number }; // Facing direction
  motilityMode: string;
  dashCooldown: number;
  health: number;
}

/**
 * Cargo Network State - Replicated cargo information
 */
export interface NetworkCargo {
  id: string;
  type: string;
  pos: { x: number; y: number };
  state: 'free' | 'carried' | 'thrown' | 'rail' | 'seat' | 'processing' | 'blocked';
  routeStageIndex?: number;
  destHex?: HexCoord; // Destination for route planning
  ttl?: number;
  progress?: number; // 0-1 for processing progress
}

/**
 * Seat Network State - Organelle seat/queue information
 */
export interface NetworkSeat {
  organelleId: string;
  used: number;
  total: number;
  queuedIds: string[]; // IDs of queued cargo
}

/**
 * Rail Network State - Cytoskeleton rail information
 */
export interface NetworkRail {
  segmentId: string;
  utilization: number; // 0-1 utilization over last few seconds
  active: boolean;
  // Full segment data for new segments (only included for newly added segments)
  segmentData?: {
    type: 'actin' | 'microtubule';
    fromHex: { q: number; r: number };
    toHex: { q: number; r: number };
    capacity: number;
    speed: number;
    currentLoad: number;
    buildCost: Record<string, number>;
    upkeepCost: number;
  };
}

/**
 * Organelle Network State - Placed organelles
 */
export interface NetworkOrganelle {
  id: string;
  type: string; // 'nucleus', 'ribosome-hub', 'proto-er', 'golgi'
  hex: { q: number; r: number };
  health: number;
  tier: number;
}

/**
 * Blueprint Network State - Construction progress
 */
export interface NetworkBlueprint {
  id: string;
  recipeId: string;
  hex: { q: number; r: number };
  progress: Record<string, number>; // species -> amount contributed
  totalProgress: number;
  completed: boolean;
  
  // Cytoskeleton blueprint specific fields
  type?: 'organelle' | 'cytoskeleton';
  cytoskeletonData?: {
    filamentType: 'actin' | 'microtubule';
    fromHex: { q: number; r: number };
    toHex: { q: number; r: number };
    required: Record<string, number>;
  };
}

/**
 * Species Network State - Chemical species distribution
 */
export interface NetworkSpecies {
  // Key tiles and their species concentrations
  tiles: Array<{
    hex: { q: number; r: number };
    species: Record<string, number>; // speciesId -> concentration
  }>;
}

/**
 * Build Network State - Construction/upgrade progress
 */
export interface NetworkBuild {
  id: string;
  type: 'organelle' | 'filament' | 'upgrade';
  hex: HexCoord;
  progress: number; // 0-1 completion
  playerId?: string; // Who initiated the build
}

/**
 * Install Network State - Membrane protein installation
 */
export interface NetworkInstall {
  id: string;
  proteinId: ProteinId;
  destHex: HexCoord;
  progress: number; // 0-1 completion
  playerId?: string; // Who initiated the install
}

/**
 * Membrane Protein Network State - Installed proteins on membrane
 */
export interface NetworkMembraneProtein {
  hex: HexCoord;
  proteinId: string;
  instanceId: string;
  isActive: boolean;
  glycosylationStatus: 'complete' | 'partial';
  throughputMultiplier: number;
}

/**
 * Host Snapshot Message - Complete game state update
 * Sent from host to clients at ~10-20Hz
 */
export interface HostSnapshot {
  tick: number;
  timestamp: number;
  ackSeq: InputSeq; // Last input sequence processed
  
  // Core replicated state
  players: NetworkPlayer[];
  cargo: NetworkCargo[];
  seats: NetworkSeat[];
  organelles: NetworkOrganelle[];
  blueprints: NetworkBlueprint[];
  species: NetworkSpecies;
  membraneProteins: NetworkMembraneProtein[];
  
  // Delta updates (only changes since last snapshot)
  railsDelta?: {
    added: NetworkRail[];
    removed: string[]; // segment IDs
    updated: NetworkRail[];
  };
  
  organelleUpgradesDelta?: {
    added: NetworkBuild[];
    removed: string[]; // build IDs
    updated: NetworkBuild[];
  };
  
  ordersDelta?: {
    added: NetworkBuild[];
    removed: string[]; // order IDs
    updated: NetworkBuild[];
  };
  
  membraneInstallsDelta?: {
    added: NetworkInstall[];
    removed: string[]; // install IDs
    updated: NetworkInstall[];
  };
}

/**
 * Network Message Wrapper - Top-level message container
 */
export interface NetworkMessage {
  type: 'input' | 'command' | 'snapshot' | 'join' | 'leave' | 'ping' | 'pong';
  playerId?: string;
  data: ClientInput | HostCommand | HostSnapshot | any;
  timestamp: number;
}

/**
 * Connection Status for tracking network health
 */
export interface NetworkStatus {
  isHost: boolean;
  connected: boolean;
  playerId: string;
  ping: number;
  tickRate: number;
  inputBuffer: number; // Number of unacknowledged inputs
  lastSnapshot: number; // Timestamp of last snapshot
}

/**
 * Entity ID Management - Ensures stable IDs for networking
 */
export interface NetworkEntityManager {
  getPlayerId(player: any): string;
  getCargoId(cargo: any): string;
  getOrganelleId(organelle: any): string;
  getFilamentId(filament: any): string;
  getBuildId(build: any): string;
  getInstallId(install: any): string;
}
