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
import { getFootprintTiles } from "../organelles/organelle-footprints";

/**
 * NEW: Rail-based pathfinding - replaces calculateRouteWithCytoskeleton
 */
function calculateRailRoute(worldRefs: WorldRefs, start: HexCoord, end: HexCoord): HexCoord[] {
  const graph = worldRefs.cytoskeletonSystem.graph;
  
  const pathResult = graph.findPath(start, end, 'vesicle', true); // Prefer organelles for membrane installation
  
  if (pathResult.success) {
    return [start, end]; // Simplified for now - vesicle will follow rail path
  } else {
    console.warn(`🚫 No rail path: ${pathResult.reason}`);
    return []; // Block movement - no rail path available
  }
}

/**
 * NEW: Move vesicle via rail system - replaces moveVesicleWithCytoskeletonSupport
 */
function moveVesicleViaRails(
  worldRefs: WorldRefs,
  vesicle: Vesicle,
  deltaSeconds: number,
  targetType: 'golgi' | 'membrane'
): void {
  const graph = worldRefs.cytoskeletonSystem.graph;
  
  // If vesicle has no rail state, try to start a rail journey
  if (!vesicle.railState) {
    const targetHex = targetType === 'golgi' 
      ? findNearestGolgiHex(worldRefs) 
      : vesicle.destHex;
      
    if (!targetHex) {
      console.warn(`⚠️ No target found for ${targetType}`);
      return;
    }
    
    // Clean up any existing edge occupancy before starting new journey
    graph.releaseVesicleEdges(vesicle.id);
    
    const pathResult = graph.findPath(vesicle.atHex, targetHex, 'vesicle', targetType === 'membrane');
    
    if (pathResult.success) {
      vesicle.railState = {
        nodeId: pathResult.path[0],
        status: 'queued',
        plannedPath: pathResult.path,
        pathIndex: 0
      };
      console.log(`🚂 Vesicle ${vesicle.id} started rail journey (${pathResult.path.length} nodes)`);
      console.log(`🗺️ Path: ${pathResult.path.join(' → ')}`);
    } else {
      console.warn(`🚫 Vesicle ${vesicle.id} blocked: ${pathResult.reason}`);
      vesicle.state = 'BLOCKED';
      return;
    }
  }

  const shouldLog = Math.random() < 0.01; // 1% chance to log for performance
  
  if(shouldLog) console.log(`⏱️ Vesicle movement deltaSeconds: ${deltaSeconds.toFixed(3)}s`);
  const reached = graph.moveCargo(vesicle, deltaSeconds, shouldLog);
  
  if (reached) {
    // Successfully reached target via rails
    if (targetType === 'golgi') {
      // B) Check organelle seat availability before entering
      const golgiOrganelle = findGolgiOrganelleAtPosition(worldRefs, vesicle.atHex);
      
      if (golgiOrganelle) {
        // Get seat info for debugging
        const seatInfo = worldRefs.organelleSystem.getSeatInfo(golgiOrganelle.id);
        
        // Check if Golgi has available seats
        if (!worldRefs.organelleSystem.hasAvailableSeats(golgiOrganelle.id)) {
          // Organelle is full - keep vesicle in transit, block until seat available
          console.log(`🚫 Vesicle ${vesicle.id} blocked: Golgi ${golgiOrganelle.id} is full (${seatInfo?.occupied || 'unknown'}/${seatInfo?.capacity || 'unknown'})`);
          vesicle.state = 'BLOCKED';
          vesicle.railState = undefined; // Clear rail state to allow reattempt
          releaseSeatIfReserved(worldRefs, vesicle); // Clean up any prior reservations
          return;
        }
        
        console.log(`🎫 Vesicle ${vesicle.id} attempting to reserve seat in Golgi ${golgiOrganelle.id} (${seatInfo?.occupied || 0}/${seatInfo?.capacity || 'unknown'} occupied)`);
        
        // Reserve a seat for this vesicle
        
        // Reserve a seat for this vesicle
        const seatId = worldRefs.organelleSystem.reserveSeat(golgiOrganelle.id, vesicle.id);
        if (!seatId) {
          console.warn(`⚠️ Failed to reserve seat in ${golgiOrganelle.id} despite showing availability`);
          vesicle.state = 'BLOCKED';
          releaseSeatIfReserved(worldRefs, vesicle); // Clean up any prior reservations
          return;
        }
        
        // Store seat info for later release
        if (!vesicle.railState) vesicle.railState = {} as any;
        (vesicle.railState as any).reservedSeatId = seatId;
        (vesicle.railState as any).targetOrganelleId = golgiOrganelle.id;
        
        // Position vesicle at the assigned seat position
        const seatPosition = worldRefs.organelleSystem.getSeatPosition(golgiOrganelle.id, seatId);
        if (seatPosition) {
          vesicle.atHex = seatPosition;
          vesicle.worldPos = worldRefs.hexGrid.hexToWorld(seatPosition);
          console.log(`🎫 Vesicle ${vesicle.id} positioned at seat ${seatId} at (${seatPosition.q},${seatPosition.r})`);
        } else {
          console.warn(`⚠️ Failed to get position for seat ${seatId} in ${golgiOrganelle.id}`);
          // Fallback to old positioning logic
          const golgiPosition = findGolgiFootprintPosition(worldRefs, vesicle);
          if (golgiPosition) {
            vesicle.atHex = golgiPosition;
            vesicle.worldPos = worldRefs.hexGrid.hexToWorld(golgiPosition);
          }
        }
      } else {
        // No golgi organelle found - use fallback positioning
        const golgiPosition = findGolgiFootprintPosition(worldRefs, vesicle);
        if (golgiPosition) {
          vesicle.atHex = golgiPosition;
          vesicle.worldPos = worldRefs.hexGrid.hexToWorld(golgiPosition);
        }
      }
      
      vesicle.state = 'QUEUED_GOLGI';
      vesicle.processingTimer = 3.0; // Golgi processing: 3 seconds
    } else {
      // Reached membrane destination via rails - vesicle should already be positioned correctly
      // by the rail system at the end of the path. Just change state to INSTALLING.
      console.log(`🚂 Vesicle ${vesicle.id} reached membrane destination via rails at (${vesicle.atHex.q}, ${vesicle.atHex.r})`);
      console.log(`🎯 Target membrane destination: (${vesicle.destHex.q}, ${vesicle.destHex.r})`);
      console.log(`📏 Distance to target: ${calculateHexDistance(vesicle.atHex, vesicle.destHex)} hexes`);
      
      vesicle.state = 'INSTALLING';
      vesicle.processingTimer = 2.5; // Membrane installation: 2.5 seconds
    }
  }
}

function findNearestGolgiHex(worldRefs: WorldRefs): HexCoord | null {
  // Find first Golgi organelle
  const golgis = worldRefs.organelleSystem.getOrganellesByType('golgi');
  if (golgis.length > 0) {
    return golgis[0].coord;
  }
  return null;
}

/**
 * Find the Golgi organelle at a specific position (used for seat management)
 */
function findGolgiOrganelleAtPosition(worldRefs: WorldRefs, position: HexCoord): any | null {
  // Check if there's a Golgi organelle at this exact position
  const organelle = worldRefs.organelleSystem.getOrganelleAtTile(position);
  if (organelle && organelle.type === 'golgi') {
    return organelle;
  }
  
  // Only check exact position - vesicle must be exactly at Golgi to be processed
  // The previous logic of checking "within 1 hex" was causing premature glycosylation
  // when vesicles were near but not at the Golgi
  
  return null;
}

/**
 * Find an available position within the Golgi footprint for a vesicle to sit
 */
function findGolgiFootprintPosition(worldRefs: WorldRefs, vesicle: Vesicle): HexCoord | null {
  const golgis = worldRefs.organelleSystem.getOrganellesByType('golgi');
  if (golgis.length === 0) return null;
  
  // Find the nearest Golgi
  let nearestGolgi = null;
  let minDistance = Infinity;
  
  for (const golgi of golgis) {
    const distance = calculateHexDistance(vesicle.atHex, golgi.coord);
    if (distance < minDistance) {
      minDistance = distance;
      nearestGolgi = golgi;
    }
  }
  
  if (!nearestGolgi) return null;
  
  // Get all tiles in the Golgi footprint
  const footprintTiles = getFootprintTiles(
    nearestGolgi.config.footprint,
    nearestGolgi.coord.q,
    nearestGolgi.coord.r
  );
  
  // Find the first available tile (not occupied by other vesicles)
  const occupiedTiles = new Set<string>();
  for (const otherVesicle of worldRefs.vesicles.values()) {
    if (otherVesicle.id !== vesicle.id && otherVesicle.state === 'QUEUED_GOLGI') {
      occupiedTiles.add(`${otherVesicle.atHex.q},${otherVesicle.atHex.r}`);
    }
  }
  
  // Try to find an unoccupied footprint tile
  for (const tile of footprintTiles) {
    const tileKey = `${tile.q},${tile.r}`;
    if (!occupiedTiles.has(tileKey)) {
      return tile;
    }
  }
  
  // If all tiles are occupied, use the first tile anyway (stacking)
  return footprintTiles[0] || null;
}

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
    
    // Skip network-controlled vesicles to prevent local system interference
    if (vesicle.isNetworkControlled) continue;
    
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
        // Use enhanced movement with cytoskeleton support
        moveVesicleViaRails(worldRefs, vesicle, deltaSeconds, 'golgi');
        break;
        
      case 'QUEUED_GOLGI':
        processVesicleAtGolgi(worldRefs, vesicle, deltaSeconds);
        break;
        
      case 'EN_ROUTE_MEMBRANE':
        // Use enhanced movement with cytoskeleton support
        moveVesicleViaRails(worldRefs, vesicle, deltaSeconds, 'membrane');
        break;
        
      case 'INSTALLING':
        vesicle.processingTimer -= deltaSeconds;
        if (vesicle.processingTimer <= 0) {
          completeMembraneInstallation(worldRefs, vesicle, scene);
        }
        break;
        
      case 'EXPIRED':
      case 'DONE':
        // Clean up any stranded vesicle tracking before removal
        worldRefs.cytoskeletonGraph.cleanupStrandedVesicle(vesicle.id);
        
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
    vesicle.routeCache = calculateRailRoute(worldRefs, vesicle.atHex, vesicle.destHex);
    notifyVesicleStateChange(worldRefs, vesicle, oldState, vesicle.state);
    return;
  }
  
  const oldState = vesicle.state;
  vesicle.state = 'EN_ROUTE_GOLGI';
  vesicle.routeCache = calculateRailRoute(worldRefs, vesicle.atHex, golgiHex);
  notifyVesicleStateChange(worldRefs, vesicle, oldState, vesicle.state);
}

/**
 * Move vesicle toward target using cached route with capacity limits
 */
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
    // Complete glycosylation and move vesicle to rail-accessible exit position
    vesicle.glyco = 'complete';
    
    // B) Release seat when leaving organelle
    if (vesicle.railState && (vesicle.railState as any).reservedSeatId && (vesicle.railState as any).targetOrganelleId) {
      const seatId = (vesicle.railState as any).reservedSeatId;
      const organelleId = (vesicle.railState as any).targetOrganelleId;
      
      worldRefs.organelleSystem.releaseSeat(organelleId, seatId);
      console.log(`🎫 Released seat ${seatId} from ${organelleId} as vesicle ${vesicle.id} exits`);
    }
    
    // TEMP: Disable teleportation - force vesicle to use cytoskeleton for Golgi→Membrane
    console.log(`✨ Vesicle ${vesicle.id} completed glycosylation - routing to membrane via cytoskeleton`);
    vesicle.state = 'EN_ROUTE_MEMBRANE';
    // Clean up any existing edge occupancy and rail state before starting new journey
    worldRefs.cytoskeletonSystem.graph.releaseVesicleEdges(vesicle.id);
    vesicle.railState = undefined; // Clear old rail state to force new path calculation
    vesicle.routeCache = calculateRailRoute(worldRefs, vesicle.atHex, vesicle.destHex);
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
    
    // Clean up any stranded vesicle tracking
    worldRefs.cytoskeletonGraph.cleanupStrandedVesicle(vesicle.id);
    
    console.log(`✅ Vesicle ${vesicle.id} completed installation of ${vesicle.proteinId} at (${vesicle.destHex.q}, ${vesicle.destHex.r}) with ${vesicle.glyco} glycosylation`);
    
    // Story 8.7: Trigger immediate membrane icon refresh
    if (scene) {
      scene.events.emit('refresh-membrane-glyphs');
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
 * Retry movement for blocked vesicle
 */
function retryVesicleMovement(worldRefs: WorldRefs, vesicle: Vesicle): void {
  if (vesicle.state !== 'BLOCKED') return;
  
  // Clear any old rail state that might be invalid
  vesicle.railState = undefined;
  
  // Check if vesicle is now in a valid state to proceed
  if (vesicle.glyco === 'partial') {
    // Vesicle needs to go to Golgi first
    if (canInteractWithGolgi(worldRefs, vesicle)) {
      // Close enough to Golgi for processing - position inside footprint
      const golgiPosition = findGolgiFootprintPosition(worldRefs, vesicle);
      if (golgiPosition) {
        vesicle.atHex = golgiPosition;
        vesicle.worldPos = worldRefs.hexGrid.hexToWorld(golgiPosition);
      }
      
      vesicle.state = 'QUEUED_GOLGI';
      vesicle.processingTimer = Math.random() * 1.5 + 2.0; // Golgi processing: 2-3.5 seconds
      return;
    } else {
      // Try to route to Golgi with fresh pathfinding
      const golgiHex = findNearestGolgi(worldRefs, vesicle.atHex);
      if (golgiHex) {
        vesicle.state = 'EN_ROUTE_GOLGI'; // Let normal movement logic handle it
        return;
      }
    }
  } else {
    // Vesicle has complete glycosylation, needs to go to membrane
    if (canInstallAtMembrane(vesicle)) {
      // Close enough to membrane for installation
      vesicle.state = 'INSTALLING';
      vesicle.processingTimer = Math.random() * 1.0 + 2.0; // Membrane installation: 2-3 seconds
      return;
    } else {
      // Try to route to membrane with fresh pathfinding
      vesicle.state = 'EN_ROUTE_MEMBRANE'; // Let normal movement logic handle it
      return;
    }
  }
  
  // If we get here, vesicle is still blocked - keep retrying
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
 * Release any reserved seat when vesicle leaves or gets blocked
 */
function releaseSeatIfReserved(worldRefs: WorldRefs, vesicle: Vesicle): void {
  if (vesicle.railState && (vesicle.railState as any).reservedSeatId && (vesicle.railState as any).targetOrganelleId) {
    const seatId = (vesicle.railState as any).reservedSeatId;
    const organelleId = (vesicle.railState as any).targetOrganelleId;
    
    worldRefs.organelleSystem.releaseSeat(organelleId, seatId);
    console.log(`🎫 Auto-released seat ${seatId} from ${organelleId} for vesicle ${vesicle.id}`);
    
    // Clear seat info
    delete (vesicle.railState as any).reservedSeatId;
    delete (vesicle.railState as any).targetOrganelleId;
  }
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
