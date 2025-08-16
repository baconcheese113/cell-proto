/**
 * Cytoskeleton Graph System - "Real Rails" Transport
 * 
 * Replaces coverage-based heuristics with actual graph pathfinding.
 * Vesicles must follow built filament segments, not arbitrary routes.
 */

import type { HexCoord } from "../hex/hex-grid";
import type { WorldRefs, Vesicle } from "../core/world-refs";
import type { FilamentSegment, OrganelleUpgrade, UpgradeType } from "./cytoskeleton-system";

// Debug flag for rail transport logging
const DEBUG_RAILS = false;

// Milestone 13: Edge base timing (milliseconds)
const EDGE_BASE_MS = {
  actin: 10000,      // 10 seconds for actin segments (much longer for visibility)
  microtubule: 600,  // 0.6 seconds for microtubule segments
  access: 250        // 0.25 seconds for organelle access
};

// Node in the cytoskeleton transport graph
export interface GraphNode {
  id: string;
  hex: HexCoord;
  type: 'segment' | 'junction' | 'organelle';

  // Adjacent edges
  edges: string[]; // Edge IDs

  // For junction nodes (rim upgrades)
  upgradeType?: UpgradeType;
  upgradeId?: string;
  inputQueue?: string[]; // Cargo waiting at this junction
  outputQueue?: string[]; // Cargo ready to leave this junction

  // For organelle nodes
  organelleId?: string;
  organelleType?: string;
}

// Edge between nodes representing filament segments
export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;

  // Filament properties
  type: 'actin' | 'microtubule' | 'access';
  speed: number;
  capacity: number; // Always 1 for now

  // State
  occupiedBy?: string; // Cargo ID currently using this edge

  // For microtubules: polarity (minus→plus direction)
  isDirected: boolean;
  direction?: { from: HexCoord; to: HexCoord }; // minus→plus for microtubules
}

// Cargo state when on the cytoskeleton network
export interface RailState {
  nodeId: string;        // Current node
  nextNodeId?: string;   // Next node in path
  edgeId?: string;       // Current edge (if moving)
  status: 'queued' | 'moving' | 'stranded';

  // Full path for debugging
  plannedPath: string[]; // Node IDs from start to finish
  pathIndex: number;     // Current position in planned path
}

// Pathfinding result
export interface PathResult {
  success: boolean;
  path: string[]; // Node IDs
  totalCost: number;
  reason?: string; // Why pathfinding failed
}

export class CytoskeletonGraph {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private nodeByHex = new Map<string, string>(); // "q,r" → nodeId
  private isDirty = true;

  // Deadlock prevention
  private strandedVesicles = new Map<string, number>(); // vesicleId -> stranded timestamp

  constructor(private worldRefs: WorldRefs) { }

  // Build graph from current filament segments and upgrades
  rebuildGraph(): void {
    this.nodes.clear();
    this.edges.clear();
    this.nodeByHex.clear();

    console.log(`🚧 Starting graph rebuild...`);
        // if(shouldLog) console.log(`🔍 Found 8 segments to process`);
        // if(shouldLog) console.log(`🔍 Found 0 upgrades to process`);

    // Create nodes and edges from filament segments
    for (const segment of this.worldRefs.cytoskeletonSystem.allSegments.values()) {
      console.log(`📍 Processing segment:`, segment);
      this.addSegmentToGraph(segment);
    }

    // Connect junction nodes - segments that share endpoints
    this.connectJunctionNodes();

    // Create junction nodes from rim upgrades
    for (const upgrade of this.worldRefs.cytoskeletonSystem.allUpgrades.values()) {
      this.addJunctionToGraph(upgrade);
    }

    // Add organelle access nodes - create virtual connections between organelles and nearby filaments
    this.addOrganelleAccessPoints();

    this.isDirty = false;
    console.log(`🕸️ Rebuilt cytoskeleton graph: ${this.nodes.size} nodes, ${this.edges.size} edges`);

    // Debug graph connectivity
    if (this.nodes.size > 0) {
      console.log(`🔗 Graph connectivity analysis:`);
      let connectedNodes = 0;
      let isolatedNodes = 0;
      for (const [nodeId, node] of this.nodes) {
        if (node.edges.length > 0) {
          connectedNodes++;
        } else {
          isolatedNodes++;
        }
        console.log(`   Node ${nodeId}: ${node.edges.length} edges`);
      }
      console.log(`   Connected nodes: ${connectedNodes}, Isolated nodes: ${isolatedNodes}`);
    }
  }

  private addSegmentToGraph(segment: FilamentSegment): void {
    console.log(`🧵 Adding segment ${segment.id}: (${segment.fromHex.q},${segment.fromHex.r}) → (${segment.toHex.q},${segment.toHex.r}) [${segment.type}]`);

    // Create nodes for segment endpoints
    const fromNodeId = this.getOrCreateSegmentNode(segment.fromHex);
    const toNodeId = this.getOrCreateSegmentNode(segment.toHex);

    console.log(`📍 Created/found nodes: ${fromNodeId} and ${toNodeId}`);

    // Create edge for the segment
    const edge: GraphEdge = {
      id: `edge_${segment.id}`,
      fromNodeId,
      toNodeId,
      type: segment.type,
      speed: segment.speed,
      capacity: 1, // Always 1 for clarity
      isDirected: segment.type === 'microtubule',
      direction: segment.type === 'microtubule' ? { from: segment.fromHex, to: segment.toHex } : undefined
    };

    this.edges.set(edge.id, edge);

    // Add edge to node adjacency lists
    const fromNode = this.nodes.get(fromNodeId)!;
    const toNode = this.nodes.get(toNodeId)!;

    fromNode.edges.push(edge.id);
    if (!edge.isDirected) {
      // For actin (undirected), add reverse connection
      toNode.edges.push(edge.id);
    } else {
      // For microtubules (directed), only add if going minus→plus
      toNode.edges.push(edge.id);
    }

    console.log(`🔗 Added edge ${edge.id}: FromNode ${fromNodeId} now has ${fromNode.edges.length} edges, ToNode ${toNodeId} now has ${toNode.edges.length} edges`);
  }

  private addJunctionToGraph(upgrade: OrganelleUpgrade): void {
    const hexKey = `${upgrade.rimHex.q},${upgrade.rimHex.r}`;

    // Check if there's already a segment node at this hex
    const existingNodeId = this.nodeByHex.get(hexKey);

    if (existingNodeId) {
      // Convert existing segment node to junction
      const node = this.nodes.get(existingNodeId)!;
      node.type = 'junction';
      node.upgradeType = upgrade.type;
      node.upgradeId = upgrade.id;
      node.inputQueue = [];
      node.outputQueue = [];
    } else {
      // Create new junction node
      const junctionNodeId = `junction_${upgrade.id}`;
      const junctionNode: GraphNode = {
        id: junctionNodeId,
        hex: upgrade.rimHex,
        type: 'junction',
        edges: [],
        upgradeType: upgrade.type,
        upgradeId: upgrade.id,
        inputQueue: [],
        outputQueue: []
      };

      this.nodes.set(junctionNodeId, junctionNode);
      this.nodeByHex.set(hexKey, junctionNodeId);
    }
  }

  private addOrganelleAccessPoints(): void {
    console.log(`🏢 Adding organelle access points...`);

    // Get all organelles and create access nodes for them
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    console.log(`🔍 Found ${organelles.length} organelles to process`);

    for (const organelle of organelles) {
      console.log(`🏢 Processing ${organelle.type} at (${organelle.coord.q},${organelle.coord.r})`);

      // Create an organelle access node at the organelle's location
      const organelleNodeId = `organelle_${organelle.id}`;
      const organelleNode: GraphNode = {
        id: organelleNodeId,
        hex: organelle.coord,
        type: 'organelle',
        edges: [],
        organelleId: organelle.id,
        organelleType: organelle.type
      };

      this.nodes.set(organelleNodeId, organelleNode);
      const hexKey = `${organelle.coord.q},${organelle.coord.r}`;
      this.nodeByHex.set(hexKey, organelleNodeId);

      // Find all filament nodes within reasonable distance (up to 2 hexes)
      const accessibleNodes: string[] = [];

      for (const [nodeId, node] of this.nodes) {
        if (node.type === 'segment') {
          // Calculate distance from organelle center to filament node
          const distance = Math.max(
            Math.abs(node.hex.q - organelle.coord.q),
            Math.abs(node.hex.r - organelle.coord.r),
            Math.abs((node.hex.q - node.hex.r) - (organelle.coord.q - organelle.coord.r))
          );

          // Node is accessible if it's close to the organelle (distance <= 2)
          if (distance <= 2) {
            accessibleNodes.push(nodeId);
            console.log(`🔗 Found accessible node ${nodeId} at (${node.hex.q},${node.hex.r}), distance ${distance} from organelle at (${organelle.coord.q},${organelle.coord.r})`);

            // Create bidirectional access edge between organelle and filament node
            const accessEdgeId = `access_${organelle.id}_${nodeId}`;
            const accessEdge: GraphEdge = {
              id: accessEdgeId,
              fromNodeId: organelleNodeId,
              toNodeId: nodeId,
              type: 'access', // Special type for organelle access
              speed: 1.0,
              capacity: 1,
              isDirected: false
            };

            this.edges.set(accessEdgeId, accessEdge);

            // Add edge to both nodes
            organelleNode.edges.push(accessEdgeId);
            node.edges.push(accessEdgeId);
          }
        }
      }

      if (accessibleNodes.length > 0) {
        console.log(`🏢 Created organelle node ${organelleNodeId} with ${accessibleNodes.length} access connections`);
      } else {
        console.log(`🚫 Organelle ${organelle.type} at (${organelle.coord.q},${organelle.coord.r}) has no accessible filament nodes`);
      }
    }
  }

  private connectJunctionNodes(): void {
    console.log(`🔗 Connecting junction nodes...`);

    // Helper function to calculate hex distance
    const hexDistance = (hex1: HexCoord, hex2: HexCoord): number => {
      return Math.max(
        Math.abs(hex1.q - hex2.q),
        Math.abs(hex1.q + hex1.r - hex2.q - hex2.r),
        Math.abs(hex1.r - hex2.r)
      );
    };

    // Find all segment nodes
    const segmentNodes: Array<{ nodeId: string; node: GraphNode }> = [];
    for (const [nodeId, node] of this.nodes) {
      if (node.type === 'segment') {
        segmentNodes.push({ nodeId, node });
      }
    }

    // Create junction connections between nodes within distance 1
    let junctionsCreated = 0;

    // Check all pairs of segment nodes
    for (let i = 0; i < segmentNodes.length; i++) {
      for (let j = i + 1; j < segmentNodes.length; j++) {
        const nodeA = segmentNodes[i];
        const nodeB = segmentNodes[j];

        const distance = hexDistance(nodeA.node.hex, nodeB.node.hex);

        // Connect nodes that are exactly 1 hex apart (adjacent)
        if (distance === 1) {
          const coordA = `${nodeA.node.hex.q},${nodeA.node.hex.r}`;
          const coordB = `${nodeB.node.hex.q},${nodeB.node.hex.r}`;

          // Create bidirectional junction edge
          const edgeId = `junction_${coordA}_${coordB}`;
          const edge: GraphEdge = {
            id: edgeId,
            fromNodeId: nodeA.nodeId,
            toNodeId: nodeB.nodeId,
            type: 'actin', // Use actin as default for junctions
            speed: 1.0,
            capacity: 1,
            isDirected: false
          };

          this.edges.set(edgeId, edge);

          // Add edge references to both nodes
          nodeA.node.edges.push(edgeId);
          nodeB.node.edges.push(edgeId);

          junctionsCreated++;
        }
      }
    }
  }

  private getOrCreateSegmentNode(hex: HexCoord): string {
    const hexKey = `${hex.q},${hex.r}`;
    let nodeId = this.nodeByHex.get(hexKey);

    if (!nodeId) {
      nodeId = `node_${hex.q}_${hex.r}`;
      const node: GraphNode = {
        id: nodeId,
        hex,
        type: 'segment',
        edges: [],
        inputQueue: [],
        outputQueue: []
      };

      this.nodes.set(nodeId, node);
      this.nodeByHex.set(hexKey, nodeId);
    }

    return nodeId;
  }

  // Find path using A* algorithm
  findPath(startHex: HexCoord, endHex: HexCoord, cargoType: 'transcript' | 'vesicle', preferOrganelles = false): PathResult {
    if (this.isDirty) {
      this.rebuildGraph();
    }

    // Find ALL accessible nodes for start and end organelles (not just the nearest one)
    const startNodes = this.findAccessibleNodes(startHex);
    let endNodes = this.findAccessibleNodes(endHex);

    // For membrane installation, prefer organelle nodes over regular nodes
    if (preferOrganelles && endNodes.length > 1) {
      const organelleNodes = endNodes.filter(nodeId => nodeId.startsWith('organelle_'));
      if (organelleNodes.length > 0) {
        endNodes = organelleNodes;
        console.log(`🎯 Preferring organelle nodes for membrane installation: ${endNodes.join(', ')}`);
      }
    }

    if (startNodes.length === 0) {
      const reason = `No accessible nodes near start (${startHex.q},${startHex.r})`;
      if (DEBUG_RAILS) console.log(`No rail path: ${reason}`);
      return { success: false, path: [], totalCost: 0, reason };
    }

    if (endNodes.length === 0) {
      const reason = `No accessible nodes near end (${endHex.q},${endHex.r})`;
      if (DEBUG_RAILS) console.log(`No rail path: ${reason}`);
      return { success: false, path: [], totalCost: 0, reason };
    }

    // Try pathfinding from each start node to each end node to find the best path
    let bestCost = Infinity;
    let bestResult: PathResult | null = null;

    console.log(`🗺️ Pathfinding: trying ${startNodes.length} start nodes to ${endNodes.length} end nodes`);
    console.log(`🏁 Start nodes: ${startNodes.join(', ')}`);
    console.log(`🎯 End nodes: ${endNodes.join(', ')}`);

    for (const startNodeId of startNodes) {
      for (const endNodeId of endNodes) {
        console.log(`🔍 Trying path: ${startNodeId} → ${endNodeId}`);
        const result = this.aStarSinglePath(startNodeId, endNodeId, cargoType);
        console.log(`📊 Path result: success=${result.success}, cost=${result.totalCost}, reason=${result.reason || 'N/A'}`);
        if (result.success && result.totalCost < bestCost) {
          bestCost = result.totalCost;
          bestResult = result;
          console.log(`✅ New best path found with cost ${bestCost}`);
        }
      }
    }

    if (bestResult) {
      if (DEBUG_RAILS) console.log(`Rail path: ${bestResult.path.join(' → ')}`);
      return bestResult;
    } else {
      const reason = "missing segment";
      if (DEBUG_RAILS) console.log(`No rail path: ${reason}`);
      return { success: false, path: [], totalCost: 0, reason };
    }
  }

  // Find ALL accessible nodes within 2 hexes (for organelle footprints)
  private findAccessibleNodes(hex: HexCoord): string[] {
    const accessibleNodes: string[] = [];

    // Check all hexes within distance 2 (covers organelle footprint + adjacent)
    for (let dq = -2; dq <= 2; dq++) {
      for (let dr = -2; dr <= 2; dr++) {
        // Skip if distance > 2 (hex distance calculation)
        const distance = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq - dr));
        if (distance > 2) continue;

        const checkHex = { q: hex.q + dq, r: hex.r + dr };
        const hexKey = `${checkHex.q},${checkHex.r}`;
        const nodeId = this.nodeByHex.get(hexKey);

        if (nodeId) {
          accessibleNodes.push(nodeId);
          console.log(`🔗 Found accessible node ${nodeId} at (${checkHex.q},${checkHex.r}), distance ${distance} from organelle at (${hex.q},${hex.r})`);
        }
      }
    }

    return accessibleNodes;
  }

  // A* pathfinding between two specific nodes
  private aStarSinglePath(startNodeId: string, endNodeId: string, cargoType: 'transcript' | 'vesicle'): PathResult {
    console.log(`🔎 A* pathfinding: ${startNodeId} → ${endNodeId}`);
    
    // A* pathfinding
    const openSet = new Set([startNodeId]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();

    gScore.set(startNodeId, 0);
    fScore.set(startNodeId, this.heuristic(startNodeId, endNodeId));

    let iterations = 0;
    const maxIterations = 100; // Prevent infinite loops

    while (openSet.size > 0 && iterations < maxIterations) {
      iterations++;
      
      // Find node with lowest fScore
      let current = [...openSet].reduce((a, b) =>
        (fScore.get(a) ?? Infinity) < (fScore.get(b) ?? Infinity) ? a : b
      );

      if (iterations <= 3) { // Only log first few iterations to avoid spam
        console.log(`🔎 A* iteration ${iterations}: exploring ${current}, openSet size: ${openSet.size}`);
      }

      // CRITICAL: Ensure current node has a valid gScore
      if (!gScore.has(current)) {
        console.error(`❌ A* error: missing gScore for node '${current}'`);
        return { success: false, path: [], totalCost: 0, reason: "A* algorithm error: missing gScore" };
      }

      if (current === endNodeId) {
        // Reconstruct path
        const path = [current];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current)!;
          path.unshift(current);
        }
        return { success: true, path, totalCost: gScore.get(endNodeId) ?? 0 };
      }

      openSet.delete(current);

      // Check neighbors
      const currentNode = this.nodes.get(current)!;

      for (const edgeId of currentNode.edges) {
        const edge = this.edges.get(edgeId)!;

        // Determine neighbor and check if we can traverse this edge
        let neighbor: string;

        if (edge.fromNodeId === current) {
          neighbor = edge.toNodeId;
        } else if (edge.toNodeId === current && !edge.isDirected) {
          neighbor = edge.fromNodeId;
        } else {
          continue; // Can't traverse this edge
        }

        // Cargo type restrictions
        if (cargoType === 'vesicle' && edge.type === 'actin') {
          // Allow vesicles on actin for now
        }

        if (cargoType === 'transcript' && edge.type === 'microtubule') {
          // Transcripts can use microtubules but prefer actin
        }

        const currentGScore = gScore.get(current) ?? Infinity;
        const edgeCost = this.getEdgeCost(edge, cargoType);
        const tentativeGScore = currentGScore + edgeCost;

        if (tentativeGScore < (gScore.get(neighbor) ?? Infinity)) {
          cameFrom.set(neighbor, current);
          gScore.set(neighbor, tentativeGScore);
          fScore.set(neighbor, tentativeGScore + this.heuristic(neighbor, endNodeId));

          if (!openSet.has(neighbor)) {
            openSet.add(neighbor);
          }
        }
      }
    }

    if (iterations >= maxIterations) {
      console.log(`⚠️ A* pathfinding hit max iterations (${maxIterations}) for ${startNodeId} → ${endNodeId}`);
      return { success: false, path: [], totalCost: 0, reason: "Max iterations exceeded" };
    }

    console.log(`❌ A* pathfinding failed: no path found from ${startNodeId} to ${endNodeId} after ${iterations} iterations`);
    return { success: false, path: [], totalCost: 0, reason: "No path found" };
  }

  private heuristic(nodeIdA: string, nodeIdB: string): number {
    const nodeA = this.nodes.get(nodeIdA)!;
    const nodeB = this.nodes.get(nodeIdB)!;

    // Manhattan distance
    return Math.abs(nodeA.hex.q - nodeB.hex.q) + Math.abs(nodeA.hex.r - nodeB.hex.r);
  }

  private getEdgeCost(edge: GraphEdge, cargoType: 'transcript' | 'vesicle'): number {
    let baseCost = 1 / edge.speed; // Faster = cheaper
    const log = Math.random() < 0.01; // Random log factor to add variability
    
    if(log) console.log(`💰 Edge cost calculation: edge.speed=${edge.speed}, baseCost=${baseCost}, edge.type=${edge.type}, cargoType=${cargoType}`);

    // BIOLOGICAL CONSTRAINT: Heavily penalize access edges to force filament usage
    // Access edges should only be for entering/exiting the network, not traversing it
    if (edge.type === 'access') {
      baseCost *= 10; // Heavy penalty to discourage access-to-access shortcuts
    }

    // Type preferences
    if (cargoType === 'transcript' && edge.type === 'microtubule') {
      baseCost *= 1.5; // Transcripts prefer actin
    }

    // Capacity penalty - allow traffic flow but discourage congestion
    if (edge.occupiedBy) {
      baseCost *= 3; // Moderate penalty for occupied edges to allow traffic flow
    }

    if(log) console.log(`💰 Final edge cost: ${baseCost}`);
    return baseCost;
  }

  // Move cargo along the rail network
  moveCargo(vesicle: Vesicle, deltaSeconds: number, shouldLog: boolean): boolean {
    if (!vesicle.railState) {
      console.warn(`⚠️ Vesicle ${vesicle.id} has no rail state`);
      return false;
    }

    const railState = vesicle.railState;
    const currentNode = this.nodes.get(railState.nodeId);

    if (!currentNode) {
      console.warn(`⚠️ Vesicle ${vesicle.id} on invalid node ${railState.nodeId}`);
      return false;
    }

    if(shouldLog) console.log(`🚛 Vesicle ${vesicle.id} moveCargo: status=${railState.status}, node=${railState.nodeId}, pathIndex=${railState.pathIndex}/${railState.plannedPath.length}`);

    // A) Handle handoff behaviors (dwell)
    if (railState.handoffKind === 'actin-end-dwell') {
      if (railState.handoffTimer === undefined) {
        railState.handoffTimer = Date.now();
        railState.handoffDuration = 500; // 500ms dwell
        if (DEBUG_RAILS) {
          console.log(`⏸️ Vesicle ${vesicle.id} starting actin-end dwell (500ms)`);
        }
      }

      const elapsed = Date.now() - railState.handoffTimer!;
      if (elapsed < railState.handoffDuration!) {
        // Still dwelling - don't move
        return false;
      } else {
        // Dwell complete - clear handoff state and continue
        railState.handoffKind = undefined;
        railState.handoffTimer = undefined;
        railState.handoffDuration = undefined;
        if (DEBUG_RAILS) {
          console.log(`▶️ Vesicle ${vesicle.id} actin-end dwell complete`);
        }
      }
    }

    if (railState.status === 'moving' && railState.edgeId) {
      // Continue moving along current edge
      return this.continueMoveAlongEdge(vesicle, deltaSeconds, shouldLog);
    } else if (railState.status === 'queued' || railState.status === 'stranded') {
      // Try to start moving to next node
      return this.tryStartNextMove(vesicle);
    }

    return false;
  }

  private continueMoveAlongEdge(vesicle: Vesicle, deltaSeconds: number, shouldLog: boolean): boolean {
    const railState = vesicle.railState!;
    const edge = this.edges.get(railState.edgeId!)!;
    const targetNode = this.nodes.get(railState.nextNodeId!)!;

    if(shouldLog) console.log(`🎯 Vesicle ${vesicle.id} moving on ${edge.type} edge from ${railState.nodeId} to ${railState.nextNodeId}`);

    // Special handling for actin filaments - 3-step process
    if (edge.type === 'actin') {
      return this.handleActinTraversal(vesicle, deltaSeconds, edge, targetNode, shouldLog);
    }

    // Regular handling for microtubules and access edges
    return this.handleRegularTraversal(vesicle, deltaSeconds, edge, targetNode);
  }

  // New method for 3-step actin traversal
  private handleActinTraversal(vesicle: Vesicle, deltaSeconds: number, edge: GraphEdge, _targetNode: GraphNode, shouldLog: boolean): boolean {
    const railState = vesicle.railState!;

    if(shouldLog) console.log(`🔄 Vesicle ${vesicle.id} handleActinTraversal called: phase=${railState.actinPhase}, deltaSeconds=${deltaSeconds.toFixed(3)}`);

    // Initialize actin state if not set
    if (!railState.actinPhase) {
      railState.actinPhase = 'move-to-start';
      railState.actinTimer = 0;
      railState.actinProgress = 0;

      if(shouldLog) console.log(`🔄 Vesicle ${vesicle.id} starting actin traversal - Phase 1: Move to start`);
    }

    const currentNode = this.nodes.get(railState.nodeId)!;
    
    // Extract segment ID by removing 'edge_' prefix from edge ID
    const segmentId = railState.edgeId!.startsWith('edge_') 
      ? railState.edgeId!.substring(5) 
      : railState.edgeId!;
    
    const segment = this.worldRefs.cytoskeletonSystem.getAllSegments().find(seg => seg.id === segmentId);
    
    if(shouldLog) console.log(`🔍 Vesicle ${vesicle.id} segment lookup: edgeId=${railState.edgeId}, segmentId=${segmentId}, segment=${segment ? 'found' : 'NOT FOUND'}`);
    
    if (segment) {
      const movingFromSegmentStart = (currentNode.hex.q === segment.fromHex.q && currentNode.hex.r === segment.fromHex.r);
      const startHex = movingFromSegmentStart ? segment.fromHex : segment.toHex;
      const endHex = movingFromSegmentStart ? segment.toHex : segment.fromHex;

      if(shouldLog) console.log(`🧭 Vesicle ${vesicle.id} direction: movingFromSegmentStart=${movingFromSegmentStart}, start=(${startHex.q},${startHex.r}), end=(${endHex.q},${endHex.r})`);

      if (railState.actinPhase === 'move-to-start') {
        // Phase 1: Move to start of filament (instant) and pause for 1s
        vesicle.atHex = { ...startHex };
        vesicle.worldPos = this.worldRefs.hexGrid.hexToWorld(startHex);
        railState.actinPhase = 'arrival-pause';
        railState.actinTimer = 0;
        
        if (DEBUG_RAILS) {
          if(shouldLog) console.log(`🎯 Vesicle ${vesicle.id} arrived at start of actin at (${startHex.q},${startHex.r}) - Phase 1b: Arrival pause (3s)`);
        }
        return false; // Not complete yet
      }
      
      else if (railState.actinPhase === 'arrival-pause') {
        // Phase 1b: Pause at start for 3 seconds (increased for visibility)
        const pauseDuration = 3.0; // 3 second pause (was 1s)
        const oldTimer = railState.actinTimer || 0;
        railState.actinTimer = oldTimer + deltaSeconds;
        
        // Stay at start position during pause
        vesicle.atHex = { ...startHex };
        vesicle.worldPos = this.worldRefs.hexGrid.hexToWorld(startHex);
        
        // Debug: Log timer progress periodically
        if (DEBUG_RAILS && Math.floor(railState.actinTimer * 4) !== Math.floor(oldTimer * 4)) {
          console.log(`⏱️ Vesicle ${vesicle.id} arrival-pause timer: ${railState.actinTimer.toFixed(2)}s / ${pauseDuration}s`);
        }
        
        if (railState.actinTimer >= pauseDuration) {
          railState.actinPhase = 'working';
          railState.actinTimer = 0;
          
          if (DEBUG_RAILS) {
            console.log(`⏰ Vesicle ${vesicle.id} finished arrival pause - Phase 2: Working (5s progress bar)`);
          }
        }
        return false; // Not complete yet
      }
      
      else if (railState.actinPhase === 'working') {
        // Phase 2: Stay at start and show progress bar for 5 seconds (increased for visibility)
        const workDuration = 5.0; // 5 seconds for progress bar (was 2s)
        railState.actinTimer = (railState.actinTimer || 0) + deltaSeconds;
        railState.actinProgress = Math.min(1.0, railState.actinTimer / workDuration);
        
        // Stay at start position during work phase
        vesicle.atHex = { ...startHex };
        vesicle.worldPos = this.worldRefs.hexGrid.hexToWorld(startHex);
        
        if (DEBUG_RAILS && Math.floor(railState.actinProgress * 10) !== Math.floor((railState.actinProgress - deltaSeconds/workDuration) * 10)) {
          console.log(`⚙️ Vesicle ${vesicle.id} working on actin: ${(railState.actinProgress * 100).toFixed(0)}%`);
        }
        
        if (railState.actinProgress >= 1.0) {
          railState.actinPhase = 'move-to-end';
          railState.actinTimer = 0;
          
          if (DEBUG_RAILS) {
            console.log(`✅ Vesicle ${vesicle.id} work complete - Phase 3: Move to end`);
          }
        }
        return false; // Not complete yet
      }
      
      else if (railState.actinPhase === 'move-to-end') {
        // Phase 3: Move to end of filament (instant)
        vesicle.atHex = { ...endHex };
        vesicle.worldPos = this.worldRefs.hexGrid.hexToWorld(endHex);
        
        if (DEBUG_RAILS) {
          console.log(`🏁 Vesicle ${vesicle.id} reached end of actin at (${endHex.q},${endHex.r}) - Traversal complete`);
        }
        
        // Clean up actin state
        railState.actinPhase = undefined;
        railState.actinTimer = undefined;
        railState.actinProgress = undefined;
        
        // Mark traversal as complete
        edge.occupiedBy = undefined; // Release edge
        railState.nodeId = railState.nextNodeId!;
        railState.nextNodeId = undefined;
        railState.edgeId = undefined;
        railState.status = 'queued';
        railState.pathIndex++;
        
        return railState.pathIndex >= railState.plannedPath.length - 1; // Return true if journey complete
      }
    } else {
      console.error(`❌ Vesicle ${vesicle.id} segment not found for edgeId=${railState.edgeId} - cannot proceed with actin traversal`);
      return false;
    }

    return false;
  }

  // Regular traversal for microtubules and access edges
  private handleRegularTraversal(vesicle: Vesicle, deltaSeconds: number, edge: GraphEdge, targetNode: GraphNode): boolean {
    const railState = vesicle.railState!;

    // Initialize transit timing if not set
    if (railState.transitTimer === undefined || railState.totalTransitTime === undefined) {
      // Use per-type base times: actin=1000ms, microtubule=600ms, access=250ms
      let baseTimeMs: number;
      let speedMultiplier = 1.0;

      if (edge.type === 'access') {
        // For access edges, use fixed timing
        baseTimeMs = EDGE_BASE_MS.access;
      } else {
        // For filament edges, look up the segment
        const segment = this.worldRefs.cytoskeletonSystem.getAllSegments().find(seg => seg.id === railState.edgeId);
        baseTimeMs = segment?.type ? EDGE_BASE_MS[segment.type] : EDGE_BASE_MS.actin;
        speedMultiplier = segment?.speed || 1.0;
      }

      railState.totalTransitTime = (baseTimeMs / speedMultiplier) / 1000; // Convert to seconds
      railState.transitTimer = railState.totalTransitTime;
      railState.transitProgress = 0.0;

      if (DEBUG_RAILS) {
        console.log(`🚂 Starting transit: ${railState.totalTransitTime.toFixed(1)}s for ${edge.type} edge for vesicle ${vesicle.id}`);
      }
    }

    // Update transit progress
    railState.transitTimer! -= deltaSeconds;
    railState.transitProgress = Math.max(0, 1.0 - (railState.transitTimer! / railState.totalTransitTime!));

    // Update vesicle position based on progress (interpolate between actual segment endpoints)
    const currentNode = this.nodes.get(railState.nodeId)!;
    const progress = railState.transitProgress!;

    // Get the actual segment to use its endpoints
    const segment = this.worldRefs.cytoskeletonSystem.getAllSegments().find(seg => seg.id === railState.edgeId);
    
    if (segment) {
      // Determine direction: are we moving from segment.fromHex to segment.toHex or vice versa?
      const movingFromSegmentStart = (currentNode.hex.q === segment.fromHex.q && currentNode.hex.r === segment.fromHex.r);
      
      const startHex = movingFromSegmentStart ? segment.fromHex : segment.toHex;
      const endHex = movingFromSegmentStart ? segment.toHex : segment.fromHex;
      
      // Linear interpolation between actual segment endpoints
      vesicle.atHex = {
        q: Math.round(startHex.q + (endHex.q - startHex.q) * progress),
        r: Math.round(startHex.r + (endHex.r - startHex.r) * progress)
      };
      
      if (DEBUG_RAILS) {
        console.log(`🚂 Vesicle ${vesicle.id} moving along segment from (${startHex.q},${startHex.r}) to (${endHex.q},${endHex.r}), progress: ${(progress * 100).toFixed(1)}%`);
      }
    } else {
      // Fallback to node-based interpolation if segment not found
      const currentHex = currentNode.hex;
      const targetHex = targetNode.hex;
      vesicle.atHex = {
        q: Math.round(currentHex.q + (targetHex.q - currentHex.q) * progress),
        r: Math.round(currentHex.r + (targetHex.r - currentHex.r) * progress)
      };
    }
    
    vesicle.worldPos = this.worldRefs.hexGrid.hexToWorld(vesicle.atHex);

    // Check if transit is complete
    if (railState.transitTimer! <= 0) {
      // Arrived at target node
      vesicle.atHex = { ...targetNode.hex };
      vesicle.worldPos = this.worldRefs.hexGrid.hexToWorld(targetNode.hex);

      edge.occupiedBy = undefined; // Release edge
      railState.nodeId = railState.nextNodeId!;
      railState.nextNodeId = undefined;
      railState.edgeId = undefined;
      railState.status = 'queued';
      railState.pathIndex++;

      // Clear transit timing
      railState.transitProgress = undefined;
      railState.transitTimer = undefined;
      railState.totalTransitTime = undefined;

      if (DEBUG_RAILS) {
        console.log(`🚂 Vesicle ${vesicle.id} arrived at node ${railState.nodeId}`);
      }

      // Check if reached final destination
      if (railState.pathIndex >= railState.plannedPath.length - 1) {
        console.log(`🏁 Vesicle ${vesicle.id} completed rail journey to ${railState.nodeId} at (${vesicle.atHex.q}, ${vesicle.atHex.r})`);
        vesicle.railState = undefined;
        return true;
      }
    }

    return false;
  }



  private tryStartNextMove(vesicle: Vesicle): boolean {
    const railState = vesicle.railState!;

    if (railState.pathIndex >= railState.plannedPath.length - 1) {
      return false; // Already at destination
    }

    const currentNodeId = railState.nodeId;
    const nextNodeId = railState.plannedPath[railState.pathIndex + 1];

    // Validate current node exists
    const currentNode = this.nodes.get(currentNodeId);
    if (!currentNode) {
      console.warn(`🚫 Vesicle ${vesicle.id} stranded - current node ${currentNodeId} no longer exists`);
      railState.status = 'stranded';
      vesicle.state = 'BLOCKED'; // Force vesicle to retry pathfinding
      return false;
    }

    // Validate next node exists
    const nextNode = this.nodes.get(nextNodeId);
    if (!nextNode) {
      console.warn(`🚫 Vesicle ${vesicle.id} stranded - next node ${nextNodeId} no longer exists`);
      railState.status = 'stranded';
      vesicle.state = 'BLOCKED'; // Force vesicle to retry pathfinding
      return false;
    }

    // Find edge to next node with actin-first preference for the first hop
    let targetEdge: GraphEdge | undefined;
    const isFirstHop = railState.pathIndex === 0;

    // Collect available edges to the next node
    const availableEdges: GraphEdge[] = [];
    for (const edgeId of currentNode.edges) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue; // Edge was deleted

      if ((edge.fromNodeId === currentNodeId && edge.toNodeId === nextNodeId) ||
        (!edge.isDirected && edge.toNodeId === currentNodeId && edge.fromNodeId === nextNodeId)) {

        if (!edge.occupiedBy) { // Edge available
          availableEdges.push(edge);
        }
      }
    }

    if (availableEdges.length === 0) {
      // Enhanced diagnostic information
      console.warn(`🚫 Vesicle ${vesicle.id} stranded at ${currentNodeId} (${currentNode.edges.length} edges)`);
      console.warn(`   Trying to reach: ${nextNodeId}`);
      console.warn(`   Available edges: ${currentNode.edges.map(id => {
        const edge = this.edges.get(id);
        return edge ? `${edge.fromNodeId}→${edge.toNodeId}${edge.occupiedBy ? ` [occupied by ${edge.occupiedBy}]` : ''}` : '[deleted]';
      }).join(', ')}`);

      // Check for potential deadlocks - if blocked for too long, clear stale edge occupations
      if (!this.strandedVesicles.has(vesicle.id)) {
        this.strandedVesicles.set(vesicle.id, Date.now());
        console.log(`🕰️ Started tracking stranded vesicle ${vesicle.id} at ${Date.now()}`);
      } else if (Date.now() - this.strandedVesicles.get(vesicle.id)! > 2000) { // 2 seconds timeout
        console.warn(`🕰️ Vesicle ${vesicle.id} stranded for >2s, clearing blocking edge occupation`);

        // Clear the specific edge that's blocking this vesicle's next move
        const nextNodeId = railState.plannedPath[railState.pathIndex + 1];
        if (nextNodeId) {
          const blockingEdgeId = this.findEdgeBetweenNodes(railState.nodeId, nextNodeId);
          if (blockingEdgeId) {
            const blockingEdge = this.edges.get(blockingEdgeId);
            if (blockingEdge?.occupiedBy) {
              console.warn(`🧹 Clearing blocking edge ${blockingEdgeId} occupied by ${blockingEdge.occupiedBy}`);
              blockingEdge.occupiedBy = undefined;
            }
          }
        }

        // Also clear any other stale occupations on current node edges as backup
        for (const edgeId of currentNode.edges) {
          const edge = this.edges.get(edgeId);
          if (edge?.occupiedBy && edge.occupiedBy !== vesicle.id) {
            console.warn(`🧹 Clearing stale occupation: edge ${edgeId} was occupied by ${edge.occupiedBy}`);
            edge.occupiedBy = undefined;
          }
        }

        this.strandedVesicles.delete(vesicle.id);
        // Try again immediately
        return this.tryStartNextMove(vesicle);
      }

      railState.status = 'stranded';
      vesicle.state = 'BLOCKED'; // Force vesicle to recalculate path
      return false;
    }

    // A) Actin-first preference for the first hop
    if (isFirstHop) {
      // Look for actin edges first
      const actinEdges = availableEdges.filter(edge => edge.type === 'actin');
      if (actinEdges.length > 0) {
        targetEdge = actinEdges[0]; // Choose first available actin edge
        railState.handoffKind = 'actin-launch';
        if (DEBUG_RAILS) {
          console.log(`🚀 Actin-first launch: vesicle ${vesicle.id} using actin edge ${targetEdge.id}`);
        }
      } else {
        targetEdge = availableEdges[0]; // Fall back to first available edge
      }
    } else {
      targetEdge = availableEdges[0]; // Normal selection for subsequent hops
    }

    // Reserve edge and start moving
    targetEdge.occupiedBy = vesicle.id;
    railState.nextNodeId = nextNodeId;
    railState.edgeId = targetEdge.id;
    railState.status = 'moving';

    // Clear stranded timer since we're moving
    this.strandedVesicles.delete(vesicle.id);

    if (DEBUG_RAILS) {
      console.log(`J(${currentNodeId}) -> Edge(${targetEdge.id}) -> J(${nextNodeId})`);
    }

    return false; // Movement started, but not complete yet
  }

  // Get node at specific hex (for throw integration)
  getNodeAtHex(hex: HexCoord): GraphNode | undefined {
    const nodeId = this.nodeByHex.get(`${hex.q},${hex.r}`);
    return nodeId ? this.nodes.get(nodeId) : undefined;
  }

  // Mark graph as dirty when filaments change
  markDirty(): void {
    this.isDirty = true;

    // When graph changes, invalidate all vesicle rail states to force recalculation
    this.invalidateVesicleRailStates();
  }

  // Invalidate all vesicle rail states when graph topology changes
  private invalidateVesicleRailStates(): void {
    let invalidatedCount = 0;
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (vesicle.railState) {
        vesicle.railState = undefined;
        if (vesicle.state === 'EN_ROUTE_GOLGI' || vesicle.state === 'EN_ROUTE_MEMBRANE') {
          vesicle.state = 'BLOCKED'; // Force recalculation
        }
        invalidatedCount++;
      }
    }
  }

  // Helper method to find edge between two nodes
  private findEdgeBetweenNodes(fromNodeId: string, toNodeId: string): string | undefined {
    const fromNode = this.nodes.get(fromNodeId);
    if (!fromNode) return undefined;

    for (const edgeId of fromNode.edges) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;

      // Check if this edge connects the two nodes
      if ((edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId) ||
        (edge.fromNodeId === toNodeId && edge.toNodeId === fromNodeId && !edge.isDirected)) {
        return edgeId;
      }
    }
    return undefined;
  }

  // Clean up stranded vesicle tracking when vesicle completes or is removed
  cleanupStrandedVesicle(vesicleId: string): void {
    this.strandedVesicles.delete(vesicleId);
  }

  // Release all edges occupied by a specific vesicle
  releaseVesicleEdges(vesicleId: string): void {
    for (const [edgeId, edge] of this.edges) {
      if (edge.occupiedBy === vesicleId) {
        edge.occupiedBy = undefined;
        if (DEBUG_RAILS) {
          console.log(`🔓 Released edge ${edgeId} from vesicle ${vesicleId}`);
        }
      }
    }
  }

  // Get a specific edge by ID (for network replication)
  getEdge(edgeId: string): GraphEdge | undefined {
    return this.edges.get(edgeId);
  }

  // Get all edges (for network replication)
  getAllEdges(): GraphEdge[] {
    if (this.isDirty) {
      this.rebuildGraph();
    }
    return Array.from(this.edges.values());
  }
}
