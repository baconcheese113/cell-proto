/**
 * Cytoskeleton Graph System - Segment Transport
 * 
 * Replaces coverage-based heuristics with actual graph pathfinding.
 * Cargos must follow built filament segments, not arbitrary routes.
 */

import type { HexCoord } from "../hex/hex-grid";
import type { WorldRefs, Cargo, CargoType } from "../core/world-refs";
import type { FilamentSegment, OrganelleUpgrade, UpgradeType } from "./cytoskeleton-system";
import { getFootprintTiles } from "../organelles/organelle-footprints";

// Debug flag for segment transport logging
const DEBUG_SEGMENTS = false;

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
  type: 'actin' | 'microtubule' | 'access' | 'junction' | 'adjacency';

  // State
  occupiedBy?: string; // Cargo ID currently using this edge

  // For microtubules: polarity (minus→plus direction)
  isDirected: boolean;
  direction?: { from: HexCoord; to: HexCoord }; // minus→plus for microtubules
}

// Cargo state when on the cytoskeleton network
export interface segmentState {
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
  private strandedCargos = new Map<string, number>(); // CargoId -> stranded timestamp

  constructor(private worldRefs: WorldRefs) { }

  // Build graph from current filament segments and upgrades
  rebuildGraph(): void {
    this.nodes.clear();
    this.edges.clear();
    this.nodeByHex.clear();

    console.log(`🚧 Starting graph rebuild...`);

    // Create nodes and edges from filament segments
    for (const segment of Object.values(this.worldRefs.cytoskeletonSystem.allSegments)) {
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

    // Debug graph connectivity (reduced logging)
    if (this.nodes.size > 0) {
      let connectedNodes = 0;
      let isolatedNodes = 0;
      for (const [nodeId, node] of this.nodes) {
        if (node.edges.length > 0) {
          connectedNodes++;
        } else {
          isolatedNodes++;
        }
        // Only log node details occasionally for performance
        if (Math.random() < 0.3) {
          console.log(`   Node ${nodeId}: ${node.edges.length} edges`);
        }
      }
      console.log(`   Connected nodes: ${connectedNodes}, Isolated nodes: ${isolatedNodes}`);
    }
  }

  private addSegmentToGraph(segment: FilamentSegment): void {
    // Reduced logging for performance
    // console.log(`🧵 Adding segment ${segment.id}: (${segment.fromHex.q},${segment.fromHex.r}) → (${segment.toHex.q},${segment.toHex.r}) [${segment.type}]`);

    // Create nodes for segment endpoints
    const fromNodeId = this.getOrCreateSegmentNode(segment.fromHex);
    const toNodeId = this.getOrCreateSegmentNode(segment.toHex);

    // console.log(`📍 Created/found nodes: ${fromNodeId} and ${toNodeId}`);

    // Create edge for the segment
    const edge: GraphEdge = {
      id: `edge_${segment.id}`,
      fromNodeId,
      toNodeId,
      type: segment.type,
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

    // console.log(`🔗 Added edge ${edge.id}: FromNode ${fromNodeId} now has ${fromNode.edges.length} edges, ToNode ${toNodeId} now has ${toNode.edges.length} edges`);
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

    // Get all organelles and create access nodes for them
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();

    for (const organelle of organelles) {

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
          
          // Get all tiles in the organelle's footprint
          const footprintTiles = getFootprintTiles(
            organelle.config.footprint,
            organelle.coord.q,
            organelle.coord.r
          );


          // Check if the cytoskeleton node is adjacent to ANY part of the organelle's footprint
          let isAdjacent = false;
          for (const footprintTile of footprintTiles) {
            // Use the same hex distance formula as elsewhere in the code
            const distance = Math.max(
              Math.abs(node.hex.q - footprintTile.q),
              Math.abs(node.hex.q + node.hex.r - footprintTile.q - footprintTile.r),
              Math.abs(node.hex.r - footprintTile.r)
            );

            // Node is accessible if it's immediately adjacent to any footprint tile (distance = 1)
            if (distance <= 1) {
              isAdjacent = true;
              break;
            }
          }

          if (isAdjacent) {
            accessibleNodes.push(nodeId);
            // Create bidirectional access edge between organelle and filament node
            const accessEdgeId = `access_${organelle.id}_${nodeId}`;
            const accessEdge: GraphEdge = {
              id: accessEdgeId,
              fromNodeId: organelleNodeId,
              toNodeId: nodeId,
              type: 'access', // Special type for organelle access
              isDirected: false
            };

            this.edges.set(accessEdgeId, accessEdge);

            // Add edge to both nodes
            organelleNode.edges.push(accessEdgeId);
            node.edges.push(accessEdgeId);
          }
        }
      }

    }

    // Create direct edges between adjacent organelles
    this.connectAdjacentOrganelles();
  }

  private connectAdjacentOrganelles(): void {
    console.log(`🔗 Connecting adjacent organelles...`);
    
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    
    // Check each pair of organelles for adjacency
    for (let i = 0; i < organelles.length; i++) {
      for (let j = i + 1; j < organelles.length; j++) {
        const org1 = organelles[i];
        const org2 = organelles[j];
        
        if (this.worldRefs.organelleSystem.areOrganellesAdjacent(org1, org2)) {
          const node1Id = `organelle_${org1.id}`;
          const node2Id = `organelle_${org2.id}`;
          
          const node1 = this.nodes.get(node1Id);
          const node2 = this.nodes.get(node2Id);
          
          if (node1 && node2) {
            // Create direct adjacency edge
            const adjacencyEdgeId = `adjacency_${org1.id}_${org2.id}`;
            const adjacencyEdge: GraphEdge = {
              id: adjacencyEdgeId,
              fromNodeId: node1Id,
              toNodeId: node2Id,
              type: 'adjacency', // Special type for adjacent organelles
              isDirected: false
            };

            this.edges.set(adjacencyEdgeId, adjacencyEdge);
            
            // Add edge to both nodes
            node1.edges.push(adjacencyEdgeId);
            node2.edges.push(adjacencyEdgeId);
            
            console.log(`🔗 Created adjacency edge between ${org1.type} and ${org2.type}`);
          }
        }
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
            type: 'junction', // Special type for organelle connections
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
  findPath(startHex: HexCoord, endHex: HexCoord, cargoType: CargoType, preferOrganelles = false): PathResult {
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
      if (DEBUG_SEGMENTS) console.log(`No segment path: ${reason}`);
      return { success: false, path: [], totalCost: 0, reason };
    }

    if (endNodes.length === 0) {
      const reason = `No accessible nodes near end (${endHex.q},${endHex.r})`;
      if (DEBUG_SEGMENTS) console.log(`No segment path: ${reason}`);
      return { success: false, path: [], totalCost: 0, reason };
    }

    // Try pathfinding from each start node to each end node to find the best path
    let bestCost = Infinity;
    let bestResult: PathResult | null = null;

    // Reduced logging for performance
    if (Math.random() < 0.1) {
      console.log(`🗺️ Pathfinding: trying ${startNodes.length} start nodes to ${endNodes.length} end nodes`);
      console.log(`🏁 Start nodes: ${startNodes.join(', ')}`);
      console.log(`🎯 End nodes: ${endNodes.join(', ')}`);
    }

    for (const startNodeId of startNodes) {
      for (const endNodeId of endNodes) {
        // Reduced logging for performance
        if (Math.random() < 0.1) {
          console.log(`🔍 Trying path: ${startNodeId} → ${endNodeId}`);
        }
        const result = this.aStarSinglePath(startNodeId, endNodeId, cargoType);
        // Reduced logging for performance
        if (Math.random() < 0.1) {
          console.log(`📊 Path result: success=${result.success}, cost=${result.totalCost}, reason=${result.reason || 'N/A'}`);
        }
        if (result.success && result.totalCost < bestCost) {
          bestCost = result.totalCost;
          bestResult = result;
          // Reduced logging for performance
          if (Math.random() < 0.1) {
            console.log(`✅ New best path found with cost ${bestCost}`);
          }
        }
      }
    }

    if (bestResult) {
      if (DEBUG_SEGMENTS) console.log(`Segment path: ${bestResult.path.join(' → ')}`);
      return bestResult;
    } else {
      const reason = "missing segment";
      if (DEBUG_SEGMENTS) console.log(`No segment path: ${reason}`);
      return { success: false, path: [], totalCost: 0, reason };
    }
  }

  // Find ALL accessible nodes within 2 hexes (for organelle footprints)
  private findAccessibleNodes(hex: HexCoord): string[] {
    const accessibleNodes: string[] = [];

    // First, check if this hex coordinate is part of an organelle footprint
    // If so, include the organelle's center node directly
    const organelleAtHex = this.worldRefs.organelleSystem.getOrganelleAtTile(hex);
    if (organelleAtHex) {
      const organelleNodeId = `organelle_${organelleAtHex.id}`;
      if (this.nodes.has(organelleNodeId)) {
        accessibleNodes.push(organelleNodeId);
        // Reduced logging for performance
        if (Math.random() < 0.2) {
          console.log(`🔗 Found organelle node ${organelleNodeId} directly at (${hex.q},${hex.r}) for organelle ${organelleAtHex.type}`);
        }
      }
      
      // When inside an organelle, only check for adjacent organelles, not cytoskeleton nodes
      for (let dq = -1; dq <= 1; dq++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (dq === 0 && dr === 0) continue; // Skip center (already handled above)
          
          const checkHex = { q: hex.q + dq, r: hex.r + dr };
          const hexKey = `${checkHex.q},${checkHex.r}`;
          const nodeId = this.nodeByHex.get(hexKey);

          if (nodeId && !accessibleNodes.includes(nodeId)) {
            const node = this.nodes.get(nodeId);
            if (node && node.type === 'organelle') {
              // Only include adjacent organelles
              if (node.organelleId) {
                const adjacentOrganelle = this.worldRefs.organelleSystem.getOrganelle(node.organelleId);
                if (adjacentOrganelle && this.worldRefs.organelleSystem.areOrganellesAdjacent(organelleAtHex, adjacentOrganelle)) {
                  accessibleNodes.push(nodeId);
                  if (Math.random() < 0.2) {
                    console.log(`🔗 Found adjacent organelle node ${nodeId} at (${checkHex.q},${checkHex.r}) from inside organelle`);
                  }
                }
              }
            }
          }
        }
      }
      
      return accessibleNodes; // Return early - don't search for cytoskeleton nodes when inside organelle
    }

    // If not inside an organelle, only check for cytoskeleton nodes at the exact position
    // Players must be ON the cytoskeleton network to access it, not just nearby
    const hexKey = `${hex.q},${hex.r}`;
    const nodeId = this.nodeByHex.get(hexKey);
    
    if (nodeId && !accessibleNodes.includes(nodeId)) {
      const node = this.nodes.get(nodeId);
      if (node && (node.type === 'segment' || node.type === 'junction')) {
        accessibleNodes.push(nodeId);
        if (Math.random() < 0.2) {
          console.log(`🔗 Found cytoskeleton node ${nodeId} at exact position (${hex.q},${hex.r})`);
        }
        
        // If standing on a cytoskeleton node, also check nearby connected nodes within distance 1
        for (let dq = -1; dq <= 1; dq++) {
          for (let dr = -1; dr <= 1; dr++) {
            if (dq === 0 && dr === 0) continue; // Skip center (already handled)
            
            const checkHex = { q: hex.q + dq, r: hex.r + dr };
            const checkHexKey = `${checkHex.q},${checkHex.r}`;
            const nearbyNodeId = this.nodeByHex.get(checkHexKey);

            if (nearbyNodeId && !accessibleNodes.includes(nearbyNodeId)) {
              const nearbyNode = this.nodes.get(nearbyNodeId);
              if (nearbyNode && (nearbyNode.type === 'segment' || nearbyNode.type === 'junction')) {
                accessibleNodes.push(nearbyNodeId);
                if (Math.random() < 0.2) {
                  console.log(`🔗 Found nearby cytoskeleton node ${nearbyNodeId} at (${checkHex.q},${checkHex.r}) from cytoskeleton position`);
                }
              }
            }
          }
        }
      }
    }

    return accessibleNodes;
  }

  // A* pathfinding between two specific nodes
  private aStarSinglePath(startNodeId: string, endNodeId: string, cargoType: CargoType): PathResult {
    // Reduced logging for performance
    if (Math.random() < 0.1) {
      console.log(`🔎 A* pathfinding: ${startNodeId} → ${endNodeId}`);
    }
    
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

      // Reduced logging for performance
      if (iterations <= 3 && Math.random() < 0.3) { // Only log first few iterations occasionally
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
        if (edge.type === 'actin') {
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
      if (Math.random() < 0.1) {
        console.log(`⚠️ A* pathfinding hit max iterations (${maxIterations}) for ${startNodeId} → ${endNodeId}`);
      }
      return { success: false, path: [], totalCost: 0, reason: "Max iterations exceeded" };
    }

    // Reduced logging for performance - only log pathfinding failures occasionally
    if (Math.random() < 0.1) {
      console.log(`❌ A* pathfinding failed: no path found from ${startNodeId} to ${endNodeId} after ${iterations} iterations`);
    }
    return { success: false, path: [], totalCost: 0, reason: "No path found" };
  }

  private heuristic(nodeIdA: string, nodeIdB: string): number {
    const nodeA = this.nodes.get(nodeIdA)!;
    const nodeB = this.nodes.get(nodeIdB)!;

    // Manhattan distance
    return Math.abs(nodeA.hex.q - nodeB.hex.q) + Math.abs(nodeA.hex.r - nodeB.hex.r);
  }

  private getEdgeCost(edge: GraphEdge, cargoType: CargoType): number {
    let baseCost = 1.0; // Constant cost for all edges (simplified)
    const log = Math.random() < 0.01; // Random log factor to add variability
    
    if(log) console.log(`💰 Edge cost calculation: baseCost=${baseCost}, edge.type=${edge.type}, cargoType=${cargoType}`);

    // BIOLOGICAL CONSTRAINT: Heavily penalize access edges to force filament usage
    // Access edges should only be for entering/exiting the network, not traversing it
    if (edge.type === 'access') {
      baseCost *= 10; // Heavy penalty to discourage access-to-access shortcuts
    }

    // Adjacency edges for organelle-to-organelle movement should be higher cost
    if (edge.type === 'adjacency') {
      baseCost *= 8; // Higher cost for adjacent organelle movement
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

  // Move cargo along the segment network
  moveCargo(cargo: Cargo, deltaSeconds: number, shouldLog: boolean): boolean {
    if (!cargo.segmentState) {
      console.warn(`⚠️ cargo ${cargo.id} has no segment state`);
      return false;
    }

    const segmentState = cargo.segmentState;
    const currentNode = this.nodes.get(segmentState.nodeId);

    if (!currentNode) {
      console.warn(`⚠️ cargo ${cargo.id} on invalid node ${segmentState.nodeId}`);
      return false;
    }

    if(shouldLog) console.log(`🚛 cargo ${cargo.id} moveCargo: state=${cargo.state}, node=${segmentState.nodeId}, pathIndex=${segmentState.pathIndex}/${segmentState.plannedPath.length}`);

    // A) Handle handoff behaviors (dwell)
    if (segmentState.handoffKind === 'actin-end-dwell') {
      if (segmentState.handoffTimer === undefined) {
        segmentState.handoffTimer = Date.now();
        segmentState.handoffDuration = 500; // 500ms dwell
        if (DEBUG_SEGMENTS) {
          console.log(`⏸️ cargo ${cargo.id} starting actin-end dwell (500ms)`);
        }
      }

      const elapsed = Date.now() - segmentState.handoffTimer!;
      if (elapsed < segmentState.handoffDuration!) {
        // Still dwelling - don't move
        return false;
      } else {
        // Dwell complete - clear handoff state and continue
        segmentState.handoffKind = undefined;
        segmentState.handoffTimer = undefined;
        segmentState.handoffDuration = undefined;
        if (DEBUG_SEGMENTS) {
          console.log(`▶️ cargo ${cargo.id} actin-end dwell complete`);
        }
      }
    }

    if (cargo.state === 'MOVING' && segmentState.edgeId) {
      // Continue moving along current edge
      return this.continueMoveAlongEdge(cargo, deltaSeconds, shouldLog);
    } else if (cargo.state === 'MOVING' || cargo.state === 'BLOCKED') {
      // Try to start moving to next node
      return this.tryStartNextMove(cargo);
    }

    return false;
  }

  private continueMoveAlongEdge(cargo: Cargo, deltaSeconds: number, shouldLog: boolean): boolean {
    const segmentState = cargo.segmentState!;
    const edge = this.edges.get(segmentState.edgeId!)!;
    const targetNode = this.nodes.get(segmentState.nextNodeId!)!;

    if(shouldLog) console.log(`🎯 cargo ${cargo.id} moving on ${edge.type} edge from ${segmentState.nodeId} to ${segmentState.nextNodeId}`);

    // Special handling for actin filaments - 3-step process
    if (edge.type === 'actin') {
      return this.handleActinTraversal(cargo, deltaSeconds, edge, targetNode, shouldLog);
    }

    // Regular handling for microtubules, access edges, and junction edges
    return this.handleRegularTraversal(cargo, deltaSeconds, edge, targetNode);
  }

  // New method for 3-step actin traversal
  private handleActinTraversal(cargo: Cargo, deltaSeconds: number, edge: GraphEdge, _targetNode: GraphNode, shouldLog: boolean): boolean {
    const segmentState = cargo.segmentState!;

    if(shouldLog) console.log(`🔄 cargo ${cargo.id} handleActinTraversal called: phase=${segmentState.actinPhase}, deltaSeconds=${deltaSeconds.toFixed(3)}`);

    // Initialize actin state if not set
    if (!segmentState.actinPhase) {
      segmentState.actinPhase = 'move-to-start';
      segmentState.actinTimer = 0;
      segmentState.actinProgress = 0;

      if(shouldLog) console.log(`🔄 cargo ${cargo.id} starting actin traversal - Phase 1: Move to start`);
    }

    const currentNode = this.nodes.get(segmentState.nodeId)!;
    
    // Extract segment ID by removing 'edge_' prefix from edge ID
    const segmentId = segmentState.edgeId!.startsWith('edge_') 
      ? segmentState.edgeId!.substring(5) 
      : segmentState.edgeId!;
    
    const segment = this.worldRefs.cytoskeletonSystem.getAllSegments().find(seg => seg.id === segmentId);
    
    if(shouldLog) console.log(`🔍 cargo ${cargo.id} segment lookup: edgeId=${segmentState.edgeId}, segmentId=${segmentId}, segment=${segment ? 'found' : 'NOT FOUND'}`);
    
    if (segment) {
      const movingFromSegmentStart = (currentNode.hex.q === segment.fromHex.q && currentNode.hex.r === segment.fromHex.r);
      const startHex = movingFromSegmentStart ? segment.fromHex : segment.toHex;
      const endHex = movingFromSegmentStart ? segment.toHex : segment.fromHex;

      if(shouldLog) console.log(`🧭 cargo ${cargo.id} direction: movingFromSegmentStart=${movingFromSegmentStart}, start=(${startHex.q},${startHex.r}), end=(${endHex.q},${endHex.r})`);

      if (segmentState.actinPhase === 'move-to-start') {
        // Phase 1: Move to start of filament (instant) and pause for 1s
        cargo.atHex = { ...startHex };
        cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(startHex);
        segmentState.actinPhase = 'arrival-pause';
        segmentState.actinTimer = 0;
        
        if (DEBUG_SEGMENTS) {
          if(shouldLog) console.log(`🎯 cargo ${cargo.id} arrived at start of actin at (${startHex.q},${startHex.r}) - Phase 1b: Arrival pause (3s)`);
        }
        return false; // Not complete yet
      }
      
      else if (segmentState.actinPhase === 'arrival-pause') {
        // Phase 1b: Pause at start for 3 seconds (increased for visibility)
        const pauseDuration = 3.0; // 3 second pause (was 1s)
        const oldTimer = segmentState.actinTimer || 0;
        segmentState.actinTimer = oldTimer + deltaSeconds;
        
        // Stay at start position during pause
        cargo.atHex = { ...startHex };
        cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(startHex);
        
        // Debug: Log timer progress periodically
        if (DEBUG_SEGMENTS && Math.floor(segmentState.actinTimer * 4) !== Math.floor(oldTimer * 4)) {
          console.log(`⏱️ cargo ${cargo.id} arrival-pause timer: ${segmentState.actinTimer.toFixed(2)}s / ${pauseDuration}s`);
        }
        
        if (segmentState.actinTimer >= pauseDuration) {
          segmentState.actinPhase = 'working';
          segmentState.actinTimer = 0;
          
          if (DEBUG_SEGMENTS) {
            console.log(`⏰ cargo ${cargo.id} finished arrival pause - Phase 2: Working (5s progress bar)`);
          }
        }
        return false; // Not complete yet
      }
      
      else if (segmentState.actinPhase === 'working') {
        // Phase 2: Stay at start and show progress bar for 5 seconds (increased for visibility)
        const workDuration = 5.0; // 5 seconds for progress bar (was 2s)
        segmentState.actinTimer = (segmentState.actinTimer || 0) + deltaSeconds;
        segmentState.actinProgress = Math.min(1.0, segmentState.actinTimer / workDuration);
        
        // Stay at start position during work phase
        cargo.atHex = { ...startHex };
        cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(startHex);
        
        if (DEBUG_SEGMENTS && Math.floor(segmentState.actinProgress * 10) !== Math.floor((segmentState.actinProgress - deltaSeconds/workDuration) * 10)) {
          console.log(`⚙️ cargo ${cargo.id} working on actin: ${(segmentState.actinProgress * 100).toFixed(0)}%`);
        }
        
        if (segmentState.actinProgress >= 1.0) {
          segmentState.actinPhase = 'move-to-end';
          segmentState.actinTimer = 0;
          
          if (DEBUG_SEGMENTS) {
            console.log(`✅ cargo ${cargo.id} work complete - Phase 3: Move to end`);
          }
        }
        return false; // Not complete yet
      }
      
      else if (segmentState.actinPhase === 'move-to-end') {
        // Phase 3: Move to end of filament (instant)
        cargo.atHex = { ...endHex };
        cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(endHex);
        
        if (DEBUG_SEGMENTS) {
          console.log(`🏁 cargo ${cargo.id} reached end of actin at (${endHex.q},${endHex.r}) - Traversal complete`);
        }
        
        // Clean up actin state
        segmentState.actinPhase = undefined;
        segmentState.actinTimer = undefined;
        segmentState.actinProgress = undefined;
        
        // Mark traversal as complete
        edge.occupiedBy = undefined; // Release edge
        segmentState.nodeId = segmentState.nextNodeId!;
        segmentState.nextNodeId = undefined;
        segmentState.edgeId = undefined;
        segmentState.pathIndex++;
        
        return segmentState.pathIndex >= segmentState.plannedPath.length - 1; // Return true if journey complete
      }
    } else {
      console.error(`❌ cargo ${cargo.id} segment not found for edgeId=${segmentState.edgeId} - cannot proceed with actin traversal`);
      return false;
    }

    return false;
  }

  // Regular traversal for microtubules and access edges
  private handleRegularTraversal(cargo: Cargo, deltaSeconds: number, edge: GraphEdge, targetNode: GraphNode): boolean {
    const segmentState = cargo.segmentState!;

    // Initialize transit timing if not set
    if (segmentState.transitTimer === undefined || segmentState.totalTransitTime === undefined) {
      // Use per-type base times: actin=1000ms, microtubule=600ms, access=250ms
      let baseTimeMs: number;
      let speedMultiplier = 1.0;

      if (edge.type === 'access') {
        // For access edges, use fixed timing
        baseTimeMs = EDGE_BASE_MS.access;
      } else {
        // For filament edges, look up the segment
        const segment = this.worldRefs.cytoskeletonSystem.getAllSegments().find(seg => seg.id === segmentState.edgeId);
        baseTimeMs = segment?.type ? EDGE_BASE_MS[segment.type] : EDGE_BASE_MS.actin;
        speedMultiplier = 1.0; // Constant speed for all segments (simplified)
      }

      segmentState.totalTransitTime = (baseTimeMs / speedMultiplier) / 1000; // Convert to seconds
      segmentState.transitTimer = segmentState.totalTransitTime;
      segmentState.transitProgress = 0.0;

      if (DEBUG_SEGMENTS) {
        console.log(`🚂 Starting transit: ${segmentState.totalTransitTime.toFixed(1)}s for ${edge.type} edge for cargo ${cargo.id}`);
      }
    }

    // Update transit progress
    segmentState.transitTimer! -= deltaSeconds;
    segmentState.transitProgress = Math.max(0, 1.0 - (segmentState.transitTimer! / segmentState.totalTransitTime!));

    // Update cargo position based on progress (interpolate between actual segment endpoints)
    const currentNode = this.nodes.get(segmentState.nodeId)!;
    const progress = segmentState.transitProgress!;

    // Get the actual segment to use its endpoints
    const segment = this.worldRefs.cytoskeletonSystem.getAllSegments().find(seg => seg.id === segmentState.edgeId);
    
    if (segment) {
      // Determine direction: are we moving from segment.fromHex to segment.toHex or vice versa?
      const movingFromSegmentStart = (currentNode.hex.q === segment.fromHex.q && currentNode.hex.r === segment.fromHex.r);
      
      const startHex = movingFromSegmentStart ? segment.fromHex : segment.toHex;
      const endHex = movingFromSegmentStart ? segment.toHex : segment.fromHex;
      
      // Linear interpolation between actual segment endpoints
      cargo.atHex = {
        q: Math.round(startHex.q + (endHex.q - startHex.q) * progress),
        r: Math.round(startHex.r + (endHex.r - startHex.r) * progress)
      };
      
      if (DEBUG_SEGMENTS) {
        console.log(`🚂 cargo ${cargo.id} moving along segment from (${startHex.q},${startHex.r}) to (${endHex.q},${endHex.r}), progress: ${(progress * 100).toFixed(1)}%`);
      }
    } else {
      // Fallback to node-based interpolation if segment not found
      const currentHex = currentNode.hex;
      const targetHex = targetNode.hex;
      cargo.atHex = {
        q: Math.round(currentHex.q + (targetHex.q - currentHex.q) * progress),
        r: Math.round(currentHex.r + (targetHex.r - currentHex.r) * progress)
      };
    }
    
    cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(cargo.atHex);

    // Check if transit is complete
    if (segmentState.transitTimer! <= 0) {
      // Arrived at target node
      cargo.atHex = { ...targetNode.hex };
      cargo.worldPos = this.worldRefs.hexGrid.hexToWorld(targetNode.hex);

      edge.occupiedBy = undefined; // Release edge
      segmentState.nodeId = segmentState.nextNodeId!;
      segmentState.nextNodeId = undefined;
      segmentState.edgeId = undefined;
      segmentState.pathIndex++;

      // Clear transit timing
      segmentState.transitProgress = undefined;
      segmentState.transitTimer = undefined;
      segmentState.totalTransitTime = undefined;

      if (DEBUG_SEGMENTS) {
        console.log(`🚂 cargo ${cargo.id} arrived at node ${segmentState.nodeId}`);
      }

      // Check if reached final destination
      if (segmentState.pathIndex >= segmentState.plannedPath.length - 1) {
        console.log(`🏁 cargo ${cargo.id} completed segment journey to ${segmentState.nodeId} at (${cargo.atHex.q}, ${cargo.atHex.r})`);
        cargo.segmentState = undefined;
        return true;
      }
    }

    return false;
  }



  private tryStartNextMove(cargo: Cargo): boolean {
    const segmentState = cargo.segmentState!;

    if (segmentState.pathIndex >= segmentState.plannedPath.length - 1) {
      return false; // Already at destination
    }

    const currentNodeId = segmentState.nodeId;
    const nextNodeId = segmentState.plannedPath[segmentState.pathIndex + 1];

    // Validate current node exists
    const currentNode = this.nodes.get(currentNodeId);
    if (!currentNode) {
      console.warn(`🚫 cargo ${cargo.id} stranded - current node ${currentNodeId} no longer exists`);
      cargo.state = 'BLOCKED'; // Force cargo to retry pathfinding
      return false;
    }

    // Validate next node exists
    const nextNode = this.nodes.get(nextNodeId);
    if (!nextNode) {
      console.warn(`🚫 cargo ${cargo.id} stranded - next node ${nextNodeId} no longer exists`);
      cargo.state = 'BLOCKED'; // Force cargo to retry pathfinding
      return false;
    }

    // Find edge to next node with actin-first preference for the first hop
    let targetEdge: GraphEdge | undefined;
    const isFirstHop = segmentState.pathIndex === 0;

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
      console.warn(`🚫 cargo ${cargo.id} stranded at ${currentNodeId} (${currentNode.edges.length} edges)`);
      console.warn(`   Trying to reach: ${nextNodeId}`);
      console.warn(`   Available edges: ${currentNode.edges.map(id => {
        const edge = this.edges.get(id);
        return edge ? `${edge.fromNodeId}→${edge.toNodeId}${edge.occupiedBy ? ` [occupied by ${edge.occupiedBy}]` : ''}` : '[deleted]';
      }).join(', ')}`);

      // Check for potential deadlocks - if blocked for too long, clear stale edge occupations
      if (!this.strandedCargos.has(cargo.id)) {
        this.strandedCargos.set(cargo.id, Date.now());
        console.log(`🕰️ Started tracking stranded cargo ${cargo.id} at ${Date.now()}`);
      } else if (Date.now() - this.strandedCargos.get(cargo.id)! > 2000) { // 2 seconds timeout
        console.warn(`🕰️ cargo ${cargo.id} stranded for >2s, clearing blocking edge occupation`);

        // Clear the specific edge that's blocking this Cargo's next move
        const nextNodeId = segmentState.plannedPath[segmentState.pathIndex + 1];
        if (nextNodeId) {
          const blockingEdgeId = this.findEdgeBetweenNodes(segmentState.nodeId, nextNodeId);
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
          if (edge?.occupiedBy && edge.occupiedBy !== cargo.id) {
            console.warn(`🧹 Clearing stale occupation: edge ${edgeId} was occupied by ${edge.occupiedBy}`);
            edge.occupiedBy = undefined;
          }
        }

        this.strandedCargos.delete(cargo.id);
        // Try again immediately
        return this.tryStartNextMove(cargo);
      }

      cargo.state = 'BLOCKED'; // Force cargo to recalculate path
      return false;
    }

    // A) Actin-first preference for the first hop
    if (isFirstHop) {
      // Look for actin edges first
      const actinEdges = availableEdges.filter(edge => edge.type === 'actin');
      if (actinEdges.length > 0) {
        targetEdge = actinEdges[0]; // Choose first available actin edge
        segmentState.handoffKind = 'actin-launch';
        if (DEBUG_SEGMENTS) {
          console.log(`🚀 Actin-first launch: cargo ${cargo.id} using actin edge ${targetEdge.id}`);
        }
      } else {
        targetEdge = availableEdges[0]; // Fall back to first available edge
      }
    } else {
      targetEdge = availableEdges[0]; // Normal selection for subsequent hops
    }

    // Reserve edge and start moving
    targetEdge.occupiedBy = cargo.id;
    segmentState.nextNodeId = nextNodeId;
    segmentState.edgeId = targetEdge.id;

    // Clear stranded timer since we're moving
    this.strandedCargos.delete(cargo.id);

    if (DEBUG_SEGMENTS) {
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

    // When graph changes, invalidate all cargo segment states to force recalculation
    this.invalidateCargoSegmentStates();
  }

  // Invalidate all cargo segment states when graph topology changes
  private invalidateCargoSegmentStates(): void {
    let invalidatedCount = 0;
    const allCargo = this.worldRefs.cargoSystem?.getAllCargo() || [];
    for (const cargo of allCargo) {
      if (cargo.segmentState) {
        cargo.segmentState = undefined;
        if (cargo.state === 'MOVING') {
          cargo.state = 'QUEUED'; // Force recalculation
        }
        invalidatedCount++;
      }
    }
    
    // Notify cargo system that graph topology changed - force immediate retry of blocked cargo
    if (this.worldRefs.cargoSystem && invalidatedCount > 0) {
      console.log(`🔄 Graph rebuild invalidated ${invalidatedCount} cargo states, triggering immediate retry`);
      this.worldRefs.cargoSystem.onGraphTopologyChanged();
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

  // Clean up stranded cargo tracking when cargo completes or is removed
  cleanupStrandedCargo(CargoId: string): void {
    this.strandedCargos.delete(CargoId);
  }

  // Release all edges occupied by a specific Cargo
  releaseCargoEdges(CargoId: string): void {
    for (const [edgeId, edge] of this.edges) {
      if (edge.occupiedBy === CargoId) {
        edge.occupiedBy = undefined;
        if (DEBUG_SEGMENTS) {
          console.log(`🔓 Released edge ${edgeId} from cargo ${CargoId}`);
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

  /**
   * Debug method: Find and analyze pathfinding between two coordinates
   * Returns detailed information about available paths, nodes, and potential issues
   */
  public debugPathfinding(fromHex: HexCoord, toHex: HexCoord, cargoType: CargoType = 'vesicle'): {
    paths: Array<{
      success: boolean;
      path: string[];
      cost: number;
      reason?: string;
      startNode: string;
      endNode: string;
    }>;
    fromNodes: string[];
    toNodes: string[];
    graphInfo: {
      totalNodes: number;
      totalEdges: number;
      hasFromNodes: boolean;
      hasToNodes: boolean;
    };
    issues: string[];
  } {
    if (this.isDirty) {
      this.rebuildGraph();
    }

    const issues: string[] = [];
    const paths: Array<{
      success: boolean;
      path: string[];
      cost: number;
      reason?: string;
      startNode: string;
      endNode: string;
    }> = [];

    // Find accessible nodes for both coordinates
    let fromNodes = this.findAccessibleNodes(fromHex);
    let toNodes = this.findAccessibleNodes(toHex);

    console.log(`🔍 Debug pathfinding: (${fromHex.q},${fromHex.r}) → (${toHex.q},${toHex.r})`);
    console.log(`🏁 From nodes (${fromNodes.length}): ${fromNodes.join(', ')}`);
    console.log(`🎯 To nodes (${toNodes.length}): ${toNodes.join(', ')}`);

    // Check for issues but don't use fallback nodes - debug should match real pathfinding behavior
    if (fromNodes.length === 0) {
      issues.push(`No accessible nodes at player position (${fromHex.q},${fromHex.r}) - player not connected to cytoskeleton network`);
    }
    if (toNodes.length === 0) {
      issues.push(`No accessible nodes at target position (${toHex.q},${toHex.r}) - target not accessible via cytoskeleton`);
    }

    // Final check if we still have no nodes after nearest node search
    if (fromNodes.length === 0) {
      issues.push(`No accessible nodes found within 4 hexes of start position (${fromHex.q},${fromHex.r})`);
    }
    if (toNodes.length === 0) {
      issues.push(`No accessible nodes found within 4 hexes of end position (${toHex.q},${toHex.r})`);
    }

    // Try all combinations and collect results
    for (const fromNode of fromNodes) {
      for (const toNode of toNodes) {
        const result = this.aStarSinglePath(fromNode, toNode, cargoType);
        paths.push({
          success: result.success,
          path: result.path,
          cost: result.totalCost,
          reason: result.reason,
          startNode: fromNode,
          endNode: toNode
        });
      }
    }

    // Sort by success first, then by cost
    paths.sort((a, b) => {
      if (a.success && !b.success) return -1;
      if (!a.success && b.success) return 1;
      return a.cost - b.cost;
    });

    return {
      paths,
      fromNodes,
      toNodes,
      graphInfo: {
        totalNodes: this.nodes.size,
        totalEdges: this.edges.size,
        hasFromNodes: fromNodes.length > 0,
        hasToNodes: toNodes.length > 0,
      },
      issues
    };
  }

  /**
   * Debug method: Get detailed information about a specific node
   */
  public debugNode(nodeId: string): {
    exists: boolean;
    node?: GraphNode;
    connectedEdges: Array<{
      edge: GraphEdge;
      connectedNode: GraphNode | null;
    }>;
  } {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return { exists: false, connectedEdges: [] };
    }

    const connectedEdges = node.edges.map(edgeId => {
      const edge = this.edges.get(edgeId)!;
      const otherNodeId = edge.fromNodeId === nodeId ? edge.toNodeId : edge.fromNodeId;
      const connectedNode = this.nodes.get(otherNodeId) || null;
      return { edge, connectedNode };
    });

    return {
      exists: true,
      node,
      connectedEdges
    };
  }
}
