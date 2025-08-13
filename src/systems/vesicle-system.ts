/**
 * Vesicle System - Milestone 8 Story 8.2 & 8.3
 * 
 * Handles vesicle entities with FSM states and pathfinding with capacity limits.
 * 
 * ## Architecture
 * 
 * The vesicle system implements a complete secretory pathway:
 * 1. **ER Processing**: Transcripts are converted to vesicles with partial glycosylation
 * 2. **Golgi Processing**: Vesicles undergo complete glycosylation (Story 8.4)
 * 3. **Membrane Installation**: Proteins are installed with glycosylation-based throughput (Story 8.5)
 * 
 * ## State Machine
 * 
 * Vesicles follow this FSM flow:
 * ```
 * QUEUED_ER → EN_ROUTE_GOLGI → QUEUED_GOLGI → EN_ROUTE_MEMBRANE → INSTALLING → DONE
 *     ↓              ↓               ↓               ↓              ↓
 *   BLOCKED ←—————————————————————————————————————————————————————
 * ```
 * 
 * ## Performance Features
 * 
 * - **Capacity Limits**: Per-tile hop capacity prevents pathfinding jams (Story 8.3)
 * - **Proximity Enforcement**: Distance checks for Golgi/membrane interactions (Story 8.8)
 * - **Performance Budgets**: Maximum vesicle limits and cleanup (Story 8.9)
 * - **Telemetry**: Detailed metrics and monitoring (Story 8.9)
 * 
 * ## Visual Features
 * 
 * - State-based vesicle colors and directional arrows (Story 8.6)
 * - Queue badges and incoming vesicle indicators (Story 8.6)
 * - Dirty tile refresh for real-time updates (Story 8.7)
 */

import type { WorldRefs, Vesicle, ProteinId } from "../core/world-refs";
import type { HexCoord } from "../hex/hex-grid";

// Story 8.3: Per-tile hop capacity to create intentional jams
const TILE_HOP_CAPACITY = 2; // vesicles per tile per tick
const VESICLE_LIFETIME_MS = 90000; // 90 seconds before expiry

// Story 8.8: Proximity enforcement for new interactions
const GOLGI_INTERACTION_RANGE = 1; // Must be within 1 hex to interact with Golgi
const MEMBRANE_INSTALL_RANGE = 1; // Must be within 1 hex to install at membrane

// Story 8.9: Telemetry & performance guardrails
const MAX_VESICLES = 50; // Performance budget: max vesicles in system
const METRICS_LOG_INTERVAL_MS = 10000; // Log metrics every 10 seconds
const VESICLE_CLEANUP_THRESHOLD = 100; // Clean up expired vesicles when over this count

// Story 8.2: Vesicle FSM states (now defined in world-refs.ts)
export type { VesicleState } from "../core/world-refs";

/**
 * Create a new vesicle at the ER after transcript processing
 */
export function createVesicleAtER(
  worldRefs: WorldRefs,
  proteinId: ProteinId,
  destHex: HexCoord,
  erHex: HexCoord,
  glyco: 'partial' | 'complete' = 'partial'
): Vesicle | null {
  // Story 8.9: Performance guardrail - check vesicle budget
  if (worldRefs.vesicles.size >= MAX_VESICLES) {
    console.warn(`⚠️ Vesicle budget exceeded (${worldRefs.vesicles.size}/${MAX_VESICLES}) - cannot create vesicle for ${proteinId}`);
    return null;
  }
  
  const vesicle: Vesicle = {
    id: `vesicle_${worldRefs.nextVesicleId++}`,
    proteinId,
    atHex: { q: erHex.q, r: erHex.r },
    ttlMs: VESICLE_LIFETIME_MS,
    worldPos: worldRefs.hexGrid.hexToWorld(erHex),
    isCarried: false,
    destHex: { q: destHex.q, r: destHex.r },
    state: 'QUEUED_ER',
    glyco,
    processingTimer: 0,
    retryCounter: 0
  };
  
  worldRefs.vesicles.set(vesicle.id, vesicle);
  console.log(`🚛 Created vesicle ${vesicle.id} for ${proteinId} at ER (${erHex.q}, ${erHex.r}) with glyco: ${glyco}`);
  
  // Story 8.11: Notify external interface about vesicle creation
  worldRefs.membranePortSystem.notifyVesicleCreated({
    vesicleId: vesicle.id,
    proteinId: vesicle.proteinId,
    fromState: 'QUEUED_ER', // vesicles start in this state
    toState: 'QUEUED_ER',
    atHex: vesicle.atHex,
    timestamp: Date.now(),
    glycosylationState: glyco === 'complete' ? 'complete' : 'partial'
  });
  
  return vesicle;
}

/**
 * Update all vesicles according to their FSM states
 */
export function updateVesicles(worldRefs: WorldRefs, deltaSeconds: number, scene?: Phaser.Scene): void {
  let expiredCount = 0;
  
  for (const vesicle of worldRefs.vesicles.values()) {
    if (vesicle.isCarried) continue;
    
    // Update TTL for all vesicles
    vesicle.ttlMs -= deltaSeconds * 1000;
    if (vesicle.ttlMs <= 0) {
      vesicle.state = 'EXPIRED';
      expiredCount++;
    }
    
    // Process vesicle based on current state
    switch (vesicle.state) {
      case 'QUEUED_ER':
        // Ready to route to Golgi
        routeVesicleToGolgi(worldRefs, vesicle);
        break;
        
      case 'EN_ROUTE_GOLGI':
        moveVesicleTowardTarget(worldRefs, vesicle, deltaSeconds, 'golgi');
        break;
        
      case 'QUEUED_GOLGI':
        processVesicleAtGolgi(worldRefs, vesicle, deltaSeconds);
        break;
        
      case 'EN_ROUTE_MEMBRANE':
        moveVesicleTowardTarget(worldRefs, vesicle, deltaSeconds, 'membrane');
        break;
        
      case 'INSTALLING':
        vesicle.processingTimer -= deltaSeconds;
        if (vesicle.processingTimer <= 0) {
          completeMembraneInstallation(worldRefs, vesicle, scene);
        }
        break;
        
      case 'EXPIRED':
      case 'DONE':
        // Remove completed/expired vesicles
        worldRefs.vesicles.delete(vesicle.id);
        break;
        
      case 'BLOCKED':
        // Retry pathfinding
        vesicle.retryCounter++;
        if (vesicle.retryCounter % 30 === 0) { // Retry every 30 ticks (~0.25 seconds)
          retryVesicleMovement(worldRefs, vesicle);
        }
        break;
    }
  }
  
  // Story 8.9: Enhanced telemetry and performance guardrails
  logVesicleMetrics(worldRefs, deltaSeconds);
  
  // Story 8.9: Cleanup expired vesicles when over threshold
  if (worldRefs.vesicles.size > VESICLE_CLEANUP_THRESHOLD) {
    cleanupExpiredVesicles(worldRefs);
  }
}

/**
 * Story 8.9: Log detailed vesicle metrics periodically
 */
function logVesicleMetrics(worldRefs: WorldRefs, deltaSeconds: number): void {
  const now = Date.now();
  const prevTime = now - deltaSeconds * 1000;
  
  if (Math.floor(now / METRICS_LOG_INTERVAL_MS) !== Math.floor(prevTime / METRICS_LOG_INTERVAL_MS)) {
    const metrics = getVesicleMetrics(worldRefs);
    
    console.log(`📊 Vesicle Telemetry:`);
    console.log(`  Active: ${metrics.activeVesicles}/${MAX_VESICLES} (${Math.round(metrics.activeVesicles/MAX_VESICLES*100)}% of budget)`);
    console.log(`  Avg Path Length: ${metrics.avgPathLength.toFixed(1)} hexes`);
    console.log(`  State Distribution:`);
    console.log(`    - Queued at Golgi: ${metrics.queuedAtGolgi}`);
    console.log(`    - En Route to Membrane: ${metrics.enRouteToMembrane}`);
    console.log(`    - Installing: ${metrics.installing}`);
    console.log(`    - Blocked: ${metrics.blocked}`);
    
    // Performance warning
    if (metrics.activeVesicles > MAX_VESICLES * 0.8) {
      console.warn(`⚠️ Vesicle budget approaching limit (${metrics.activeVesicles}/${MAX_VESICLES})`);
    }
  }
}

/**
 * Story 8.9: Clean up expired vesicles when over threshold
 */
function cleanupExpiredVesicles(worldRefs: WorldRefs): void {
  let cleanedCount = 0;
  
  for (const [id, vesicle] of worldRefs.vesicles) {
    if (vesicle.state === 'EXPIRED' || vesicle.state === 'DONE') {
      worldRefs.vesicles.delete(id);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired vesicles`);
  }
}

/**
 * Story 8.11: Helper to notify external systems about vesicle state changes
 */
function notifyVesicleStateChange(
  worldRefs: WorldRefs, 
  vesicle: Vesicle, 
  fromState: string, 
  toState: string
): void {
  worldRefs.membranePortSystem.notifyVesicleStateChange({
    vesicleId: vesicle.id,
    proteinId: vesicle.proteinId,
    fromState: fromState as any,
    toState: toState as any,
    atHex: vesicle.atHex,
    timestamp: Date.now(),
    glycosylationState: vesicle.glyco
  });
}

/**
 * Route vesicle from ER to Golgi
 */
function routeVesicleToGolgi(worldRefs: WorldRefs, vesicle: Vesicle): void {
  const golgiHex = findNearestGolgi(worldRefs, vesicle.atHex);
  if (!golgiHex) {
    console.warn(`⚠️ No Golgi found for vesicle ${vesicle.id}, routing directly to membrane`);
    const oldState = vesicle.state;
    vesicle.state = 'EN_ROUTE_MEMBRANE';
    vesicle.routeCache = calculateRoute(worldRefs, vesicle.atHex, vesicle.destHex);
    notifyVesicleStateChange(worldRefs, vesicle, oldState, vesicle.state);
    return;
  }
  
  const oldState = vesicle.state;
  vesicle.state = 'EN_ROUTE_GOLGI';
  vesicle.routeCache = calculateRoute(worldRefs, vesicle.atHex, golgiHex);
  notifyVesicleStateChange(worldRefs, vesicle, oldState, vesicle.state);
}

/**
 * Move vesicle toward target using cached route with capacity limits
 */
function moveVesicleTowardTarget(
  worldRefs: WorldRefs,
  vesicle: Vesicle,
  _deltaSeconds: number,
  targetType: 'golgi' | 'membrane'
): void {
  if (!vesicle.routeCache || vesicle.routeCache.length === 0) {
    console.warn(`⚠️ Vesicle ${vesicle.id} has no route to ${targetType}`);
    vesicle.state = 'BLOCKED';
    return;
  }
  
  // Check if we can move (tile capacity limit)
  const nextHex = vesicle.routeCache[0];
  if (!canMoveToHex(worldRefs, nextHex, vesicle.id)) {
    vesicle.state = 'BLOCKED';
    return;
  }
  
  // Move at vesicle speed
  vesicle.atHex = nextHex;
  vesicle.worldPos = worldRefs.hexGrid.hexToWorld(nextHex);
  vesicle.routeCache.shift(); // Remove reached hex from route
  
  // Check if arrived at target
  if (vesicle.routeCache.length === 0) {
    if (targetType === 'golgi') {
      // Story 8.8: Proximity enforcement - must be close enough to interact with Golgi
      if (canInteractWithGolgi(worldRefs, vesicle)) {
        vesicle.state = 'QUEUED_GOLGI';
        vesicle.processingTimer = 2.0; // 2 seconds for glycosylation
        console.log(`🏭 Vesicle ${vesicle.id} arrived at Golgi - starting glycosylation`);
      } else {
        console.warn(`⚠️ Vesicle ${vesicle.id} too far from Golgi for interaction - blocking`);
        vesicle.state = 'BLOCKED';
      }
    } else {
      // Story 8.8: Proximity enforcement - must be close enough to install at membrane
      if (canInstallAtMembrane(vesicle)) {
        vesicle.state = 'INSTALLING';
        vesicle.processingTimer = 2.0; // 2 seconds for membrane installation
      } else {
        console.warn(`⚠️ Vesicle ${vesicle.id} too far from membrane for installation - blocking`);
        vesicle.state = 'BLOCKED';
      }
    }
  }
}

/**
 * Process vesicle at Golgi (glycosylation)
 */
function processVesicleAtGolgi(worldRefs: WorldRefs, vesicle: Vesicle, deltaSeconds: number): void {
  // Story 8.8: Proximity enforcement - check if still close enough to Golgi
  if (!canInteractWithGolgi(worldRefs, vesicle)) {
    console.warn(`⚠️ Vesicle ${vesicle.id} moved too far from Golgi during processing - blocking`);
    vesicle.state = 'BLOCKED';
    return;
  }
  
  vesicle.processingTimer -= deltaSeconds;
  
  if (vesicle.processingTimer <= 0) {
    // Complete glycosylation
    vesicle.glyco = 'complete';
    vesicle.state = 'EN_ROUTE_MEMBRANE';
    vesicle.routeCache = calculateRoute(worldRefs, vesicle.atHex, vesicle.destHex);
    console.log(`✨ Vesicle ${vesicle.id} completed glycosylation - routing to membrane`);
  }
}

/**
 * Complete membrane installation
 */
function completeMembraneInstallation(worldRefs: WorldRefs, vesicle: Vesicle, scene?: Phaser.Scene): void {
  // Story 8.8: Proximity enforcement - check if still close enough to membrane
  if (!canInstallAtMembrane(vesicle)) {
    console.warn(`⚠️ Vesicle ${vesicle.id} too far from membrane for installation - blocking`);
    vesicle.state = 'BLOCKED';
    return;
  }
  
  // Install protein on the membrane with glycosylation status
  const success = worldRefs.membraneExchangeSystem.installMembraneProteinWithGlycosylation(
    vesicle.destHex, 
    vesicle.proteinId, 
    vesicle.glyco
  );
  if (success) {
    vesicle.state = 'DONE';
    console.log(`✅ Vesicle ${vesicle.id} completed installation of ${vesicle.proteinId} at (${vesicle.destHex.q}, ${vesicle.destHex.r}) with ${vesicle.glyco} glycosylation`);
    
    // Story 8.7: Trigger immediate membrane icon refresh
    if (scene) {
      scene.events.emit('refresh-membrane-glyphs');
      console.log(`🔄 Membrane protein installed - triggered icon refresh`);
    } else {
      console.log(`🔄 Membrane protein installed - no scene available for refresh`);
    }
  } else {
    console.warn(`❌ Failed to install ${vesicle.proteinId} at (${vesicle.destHex.q}, ${vesicle.destHex.r}) - membrane occupied or invalid`);
    vesicle.state = 'BLOCKED';
    vesicle.retryCounter = 0; // Reset retry counter for new attempts
  }
}

/**
 * Find nearest Golgi organelle
 */
function findNearestGolgi(worldRefs: WorldRefs, fromHex: HexCoord): HexCoord | null {
  const organelles = worldRefs.organelleSystem.getAllOrganelles();
  let nearestGolgi = null;
  let minDistance = Infinity;

  for (const organelle of organelles) {
    if (organelle.type === 'golgi') {
      const distance = calculateHexDistance(fromHex, organelle.coord);
      if (distance < minDistance) {
        minDistance = distance;
        nearestGolgi = organelle.coord;
      }
    }
  }

  return nearestGolgi;
}

/**
 * Calculate route between two hexes using BFS pathfinding
 */
function calculateRoute(worldRefs: WorldRefs, start: HexCoord, end: HexCoord): HexCoord[] {
  // Simple BFS pathfinding on hex grid
  const visited = new Set<string>();
  const queue: { hex: HexCoord; path: HexCoord[] }[] = [{ hex: start, path: [] }];
  
  while (queue.length > 0) {
    const { hex, path } = queue.shift()!;
    const hexKey = `${hex.q},${hex.r}`;
    
    if (visited.has(hexKey)) continue;
    visited.add(hexKey);
    
    if (hex.q === end.q && hex.r === end.r) {
      return path;
    }
    
    // Add neighbors to queue
    const neighbors = worldRefs.hexGrid.getNeighbors(hex);
    for (const neighborTile of neighbors) {
      const neighborCoord = neighborTile.coord;
      const neighborKey = `${neighborCoord.q},${neighborCoord.r}`;
      if (!visited.has(neighborKey) && isValidPathHex(worldRefs, neighborCoord)) {
        queue.push({
          hex: neighborCoord,
          path: [...path, neighborCoord]
        });
      }
    }
  }
  
  console.warn(`⚠️ No route found from (${start.q}, ${start.r}) to (${end.q}, ${end.r})`);
  return [];
}

/**
 * Check if a hex is valid for pathfinding (inside cell, not blocked by organelles)
 */
function isValidPathHex(worldRefs: WorldRefs, hex: HexCoord): boolean {
  const tile = worldRefs.hexGrid.getTile(hex);
  if (!tile) return false;
  
  // Must be inside cell (either cytosol or membrane)
  if (!tile.isMembrane) {
    // For non-membrane tiles, we assume they are cytosol if they exist
    // (the hex grid only contains tiles inside the cell)
  }
  
  // Large organelles might block movement (check for nucleus specifically)
  const organelle = worldRefs.organelleSystem.getOrganelleAtTile(hex);
  if (organelle && organelle.type === 'nucleus') return false; // nucleus blocks movement
  
  return true;
}

/**
 * Check if vesicle can move to hex (tile capacity limit)
 */
function canMoveToHex(worldRefs: WorldRefs, hex: HexCoord, vesicleId: string): boolean {
  // Count vesicles currently at this hex
  let vesicleCount = 0;
  for (const vesicle of worldRefs.vesicles.values()) {
    if (vesicle.id !== vesicleId && vesicle.atHex.q === hex.q && vesicle.atHex.r === hex.r) {
      vesicleCount++;
    }
  }
  
  return vesicleCount < TILE_HOP_CAPACITY;
}

/**
 * Retry movement for blocked vesicle
 */
function retryVesicleMovement(worldRefs: WorldRefs, vesicle: Vesicle): void {
  // Recalculate route in case obstacles moved
  let targetHex: HexCoord;
  
  if (vesicle.state === 'BLOCKED') {
    // Determine target based on current progress
    if (vesicle.glyco === 'partial') {
      const golgiHex = findNearestGolgi(worldRefs, vesicle.atHex);
      if (golgiHex) {
        targetHex = golgiHex;
        vesicle.state = 'EN_ROUTE_GOLGI';
      } else {
        targetHex = vesicle.destHex;
        vesicle.state = 'EN_ROUTE_MEMBRANE';
      }
    } else {
      targetHex = vesicle.destHex;
      vesicle.state = 'EN_ROUTE_MEMBRANE';
    }
    
    vesicle.routeCache = calculateRoute(worldRefs, vesicle.atHex, targetHex);
    console.log(`🔄 Vesicle ${vesicle.id} retry: new route to target`);
  }
}

/**
 * Story 8.8: Check if vesicle is close enough to interact with Golgi
 */
function canInteractWithGolgi(worldRefs: WorldRefs, vesicle: Vesicle): boolean {
  const golgiHex = findNearestGolgi(worldRefs, vesicle.atHex);
  if (!golgiHex) return false;
  
  const distance = calculateHexDistance(vesicle.atHex, golgiHex);
  return distance <= GOLGI_INTERACTION_RANGE;
}

/**
 * Story 8.8: Check if vesicle is close enough to install at membrane
 */
function canInstallAtMembrane(vesicle: Vesicle): boolean {
  const distance = calculateHexDistance(vesicle.atHex, vesicle.destHex);
  return distance <= MEMBRANE_INSTALL_RANGE;
}

/**
 * Calculate hex distance (Manhattan distance in axial coordinates)
 */
function calculateHexDistance(hex1: HexCoord, hex2: HexCoord): number {
  return (Math.abs(hex1.q - hex2.q) + Math.abs(hex1.q + hex1.r - hex2.q - hex2.r) + Math.abs(hex1.r - hex2.r)) / 2;
}

/**
 * Get vesicle metrics for debugging
 */
export function getVesicleMetrics(worldRefs: WorldRefs): {
  activeVesicles: number;
  avgPathLength: number;
  queuedAtGolgi: number;
  enRouteToMembrane: number;
  installing: number;
  blocked: number;
} {
  let activeVesicles = 0;
  let totalPathLength = 0;
  let pathCount = 0;
  let queuedAtGolgi = 0;
  let enRouteToMembrane = 0;
  let installing = 0;
  let blocked = 0;
  
  for (const vesicle of worldRefs.vesicles.values()) {
    activeVesicles++;
    
    if (vesicle.routeCache) {
      totalPathLength += vesicle.routeCache.length;
      pathCount++;
    }
    
    switch (vesicle.state) {
      case 'QUEUED_GOLGI':
        queuedAtGolgi++;
        break;
      case 'EN_ROUTE_MEMBRANE':
        enRouteToMembrane++;
        break;
      case 'INSTALLING':
        installing++;
        break;
      case 'BLOCKED':
        blocked++;
        break;
    }
  }
  
  return {
    activeVesicles,
    avgPathLength: pathCount > 0 ? totalPathLength / pathCount : 0,
    queuedAtGolgi,
    enRouteToMembrane,
    installing,
    blocked
  };
}
