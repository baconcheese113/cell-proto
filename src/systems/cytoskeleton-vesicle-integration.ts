/**
 * Milestone 13: Cytoskeleton-Vesicle Integration Adapter
 * 
 * Thin adapter layer between vesicle-system.ts and cytoskeleton transport.
 * Provides a clean API for vesicle movement planning and execution.
 */

import type { HexCoord } from "../hex/hex-grid";
import type { WorldRefs, Vesicle } from "../core/world-refs";

/**
 * Plan and step a vesicle along the cytoskeleton network with seat-aware travel
 * Implements: seat egress → actin launch → rails → dwell → seat ingress sequence
 */
export function planAndStepVesicle(vesicle: Vesicle, worldRefs: WorldRefs, deltaTime: number): 'moved' | 'queued' | 'stranded' {
  // Handle vesicles with itinerary (new workflow)
  if (vesicle.itinerary) {
    return handleItineraryBasedMovement(vesicle, worldRefs, deltaTime);
  }
  
  // Legacy vesicle handling (original code)
  return handleLegacyVesicleMovement(vesicle, worldRefs, deltaTime);
}

/**
 * Handle movement for vesicles with itinerary (Milestone 13)
 */
function handleItineraryBasedMovement(vesicle: Vesicle, worldRefs: WorldRefs, deltaTime: number): 'moved' | 'queued' | 'stranded' {
  if (!vesicle.itinerary) return 'stranded';
  
  const currentStage = vesicle.itinerary.stages[vesicle.itinerary.stageIndex];
  if (!currentStage) return 'stranded'; // No more stages
  
  const graph = worldRefs.cytoskeletonSystem.graph;
  
  // If vesicle doesn't have rail state, set up movement to next stage
  if (!vesicle.railState) {
    return initializeStageMovement(vesicle, currentStage, worldRefs);
  }
  
  // Handle rail state progression
  if (vesicle.railState.status === 'queued') {
    // Try to start movement (capacity check)
    const canMove = graph.moveCargo(vesicle, deltaTime, false);
    return canMove ? 'moved' : 'queued';
  } else if (vesicle.railState.status === 'moving') {
    // Continue movement along rails
    const completed = graph.moveCargo(vesicle, deltaTime, false);
    if (completed) {
      // Reached destination node, handle arrival
      return handleStageArrival(vesicle, currentStage, worldRefs);
    }
    return 'moved';
  }
  
  return 'stranded';
}

/**
 * Initialize movement to the next stage in itinerary
 */
function initializeStageMovement(vesicle: Vesicle, stage: any, worldRefs: WorldRefs): 'moved' | 'queued' | 'stranded' {
  let targetHex: HexCoord;
  
  // Determine target based on stage
  if (stage.targetOrgId) {
    const organelle = worldRefs.organelleSystem.getAllOrganelles().find(org => org.id === stage.targetOrgId);
    if (!organelle) return 'stranded';
    targetHex = organelle.coord;
  } else if (stage.targetHex) {
    targetHex = stage.targetHex;
  } else {
    return 'stranded';
  }
  
  // Plan path with actin preference for first hop
  const graph = worldRefs.cytoskeletonSystem.graph;
  const pathResult = graph.findPath(vesicle.atHex, targetHex, 'vesicle');
  if (!pathResult.success) {
    return 'stranded';
  }
  
  // Set up rail state with handoff timing for actin launch
  vesicle.railState = {
    nodeId: pathResult.path[0],
    status: 'queued',
    plannedPath: pathResult.path,
    pathIndex: 0,
    handoffKind: 'actin-launch',
    handoffTimer: 250, // 250ms dwell before launching
    handoffDuration: 250
  };
  
  return 'queued';
}

/**
 * Handle arrival at destination stage
 */
function handleStageArrival(vesicle: Vesicle, stage: any, worldRefs: WorldRefs): 'moved' | 'queued' | 'stranded' {
  // Try to reserve seat at destination organelle
  if (stage.targetOrgId) {
    const freeSeat = worldRefs.organelleSystem.getFreeSeat(stage.targetOrgId);
    if (freeSeat) {
      // Reserve seat and start ingress
      const seatId = worldRefs.organelleSystem.reserveSeat(stage.targetOrgId, vesicle.id);
      if (seatId) {
        // Move to seat position and start processing
        vesicle.atHex = freeSeat;
        vesicle.worldPos = worldRefs.hexGrid.hexToWorld(freeSeat);
        vesicle.processingTimer = stage.processMs;
        vesicle.railState = undefined; // Clear rail state, now processing at seat
        return 'moved';
      }
    }
    
    // No seat available, queue at rim with dwell
    vesicle.railState = {
      nodeId: vesicle.railState?.nodeId || '',
      status: 'queued',
      plannedPath: [],
      pathIndex: 0,
      handoffKind: 'actin-end-dwell',
      handoffTimer: 500, // 500ms dwell at rim while waiting
      handoffDuration: 500
    };
    
    // Milestone 13: Log when seats are full for validation
    const seatInfo = worldRefs.organelleSystem.getSeatInfo(stage.targetOrgId);
    if (seatInfo) {
      console.log(`🎫 ${stage.kind} seats full: ${seatInfo.occupied}/${seatInfo.capacity}, cargo queued at rim`);
    }
    
    return 'queued';
  }
  
  // For membrane destinations, complete immediately
  vesicle.railState = undefined;
  return 'moved';
}

/**
 * Legacy vesicle movement (for existing vesicles without itinerary)
 */
function handleLegacyVesicleMovement(vesicle: Vesicle, worldRefs: WorldRefs, deltaTime: number): 'moved' | 'queued' | 'stranded' {
  const graph = worldRefs.cytoskeletonSystem.graph;
  
  // If vesicle doesn't have a rail state, it needs a new path
  if (!vesicle.railState) {
    let targetHex: HexCoord;
    
    // Determine target based on vesicle state
    if (vesicle.state === 'EN_ROUTE_GOLGI') {
      const golgiHex = findNearestGolgi(worldRefs, vesicle.atHex);
      if (!golgiHex) {
        return 'stranded';
      }
      targetHex = golgiHex;
    } else if (vesicle.state === 'EN_ROUTE_MEMBRANE') {
      targetHex = vesicle.destHex;
    } else {
      return 'stranded'; // Invalid state for rail movement
    }
    
    // Plan path using cytoskeleton graph
    const pathResult = graph.findPath(vesicle.atHex, targetHex, 'vesicle');
    if (!pathResult.success) {
      return 'stranded';
    }
    
    // Set up rail state for the vesicle
    vesicle.railState = {
      nodeId: pathResult.path[0],
      status: 'queued',
      plannedPath: pathResult.path,
      pathIndex: 0
    };
  }
  
  // Step vesicle along its current path
  const completed = graph.moveCargo(vesicle, deltaTime, false);
  if (completed) {
    return 'moved'; // Reached destination
  }
  
  // Check if vesicle is stranded (can't move for too long)
  if (vesicle.railState?.status === 'stranded') {
    return 'stranded';
  }
  
  return 'moved'; // Still moving normally
}

/**
 * Initialize the cytoskeleton integration system
 */
export function initializeEnhancedVesicleRouting(_worldRefs: WorldRefs): void {
  // Integration is now handled directly through cytoskeleton-graph.ts
  // This function remains for compatibility but does nothing
}

/**
 * Update the integration system each frame
 */
export function updateEnhancedVesicleRouting(): void {
  // Integration is now handled directly through cytoskeleton-graph.ts
  // This function remains for compatibility but does nothing
}

/**
 * Find nearest Golgi organelle to a given position
 */
function findNearestGolgi(worldRefs: WorldRefs, fromHex: HexCoord): HexCoord | null {
  const organelles = worldRefs.organelleSystem.getAllOrganelles();
  let nearestGolgi = null;
  let minDistance = Infinity;

  for (const organelle of organelles) {
    if (organelle.type === 'golgi') {
      const distance = Math.max(
        Math.abs(organelle.coord.q - fromHex.q),
        Math.abs(organelle.coord.r - fromHex.r),
        Math.abs((organelle.coord.q - organelle.coord.r) - (fromHex.q - fromHex.r))
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestGolgi = organelle.coord;
      }
    }
  }

  return nearestGolgi;
}
