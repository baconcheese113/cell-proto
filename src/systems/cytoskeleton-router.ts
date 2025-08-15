/**
 * Milestone 13 Part D: Smart Routing Between Organelles
 * 
 * Implements intelligent pathfinding through cytoskeleton networks.
 * Features:
 * - Graph representation of filament networks
 * - A* pathfinding with filament-aware costs
 * - Route caching and optimization
 * - Integration with organelle upgrades
 */

import type { HexCoord } from "../hex/hex-grid";
import type { WorldRefs } from "../core/world-refs";
import type { FilamentSegment } from "./cytoskeleton-system";

// Node in the cytoskeleton routing graph
export interface CytoskeletonNode {
  id: string;
  hex: HexCoord;
  type: 'segment' | 'upgrade' | 'junction';
  
  // For segment nodes
  segmentId?: string;
  filamentType?: 'actin' | 'microtubule';
  
  // For upgrade nodes
  upgradeId?: string;
  upgradeType?: string;
  
  // Connectivity
  connections: string[]; // Connected node IDs
}

// Edge between nodes with transport properties
export interface CytoskeletonEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  
  // Transport properties
  capacity: number;        // Max cargo per tick
  speed: number;           // Movement speed multiplier
  currentLoad: number;     // Current cargo count
  
  // Cost factors for pathfinding
  distance: number;        // Physical distance
  congestionCost: number;  // Cost penalty for load
  typeCost: number;        // Preference for microtubules over actin
}

// Cached route with metadata
export interface CytoskeletonRoute {
  id: string;
  startNodeId: string;
  endNodeId: string;
  nodeIds: string[];       // Path through nodes
  
  // Route properties
  totalDistance: number;
  totalCost: number;
  avgSpeed: number;
  minCapacity: number;
  
  // Caching metadata
  createdAt: number;
  usageCount: number;
  lastUsed: number;
}

export class CytoskeletonRouter {
  private worldRefs: WorldRefs;
  
  // Graph representation
  private nodes: Map<string, CytoskeletonNode> = new Map();
  private edges: Map<string, CytoskeletonEdge> = new Map();
  
  // Route caching
  private routeCache: Map<string, CytoskeletonRoute> = new Map();
  private readonly CACHE_EXPIRY_MS = 30000; // 30 seconds
  private readonly MAX_CACHED_ROUTES = 100;
  
  // Pathfinding configuration
  private readonly PATHFINDING_CONFIG = {
    // Cost weights for A* algorithm
    DISTANCE_WEIGHT: 1.0,
    CONGESTION_WEIGHT: 2.0,     // Penalize crowded segments heavily
    TYPE_PREFERENCE_WEIGHT: 0.5, // Prefer microtubules over actin
    
    // Filament type preferences
    MICROTUBULE_BONUS: 0.8,     // 20% speed bonus for microtubules
    ACTIN_PENALTY: 1.2,         // 20% speed penalty for actin
    
    // Congestion thresholds
    CONGESTION_THRESHOLD: 0.7,   // Consider segment congested above 70%
    MAX_CONGESTION_PENALTY: 3.0, // Maximum congestion multiplier
  };
  
  constructor(worldRefs: WorldRefs) {
    this.worldRefs = worldRefs;
  }
  
  /**
   * Rebuild the graph from current cytoskeleton state
   */
  public rebuildGraph(): void {
    this.nodes.clear();
    this.edges.clear();
    this.invalidateAllRoutes();
    
    this.buildNodesFromSegments();
    this.buildNodesFromUpgrades();
    this.buildEdgesFromConnections();
    
    console.log(`🕸️ Cytoskeleton graph rebuilt: ${this.nodes.size} nodes, ${this.edges.size} edges`);
  }
  
  /**
   * Find optimal route between two organelles using cytoskeleton
   */
  public findRoute(startHex: HexCoord, endHex: HexCoord): CytoskeletonRoute | null {
    const routeKey = `${startHex.q},${startHex.r}→${endHex.q},${endHex.r}`;
    
    // Check cache first
    const cached = this.routeCache.get(routeKey);
    if (cached && this.isRouteCacheValid(cached)) {
      cached.usageCount++;
      cached.lastUsed = Date.now();
      return cached;
    }
    
    // Find nearest nodes to start and end points
    const startNode = this.findNearestNode(startHex);
    const endNode = this.findNearestNode(endHex);
    
    if (!startNode || !endNode) {
      console.warn(`⚠️ No cytoskeleton nodes near route ${routeKey}`);
      return null;
    }
    
    // Run A* pathfinding
    const path = this.findPathAStar(startNode.id, endNode.id);
    if (!path) {
      console.warn(`⚠️ No cytoskeleton path found for route ${routeKey}`);
      return null;
    }
    
    // Create route object
    const route = this.createRouteFromPath(startNode.id, endNode.id, path);
    
    // Cache the route
    this.cacheRoute(routeKey, route);
    
    return route;
  }
  
  /**
   * Get current utilization of a filament segment
   */
  public getSegmentUtilization(segmentId: string): number {
    const segment = this.worldRefs.cytoskeletonSystem.getSegment(segmentId);
    if (!segment) return 0;
    
    return segment.currentLoad / segment.capacity;
  }
  
  /**
   * Update edge loads based on current cargo movement
   */
  public updateNetworkLoad(): void {
    for (const edge of this.edges.values()) {
      if (edge.fromNodeId.startsWith('seg_') || edge.toNodeId.startsWith('seg_')) {
        const segmentId = edge.fromNodeId.startsWith('seg_') ? 
          edge.fromNodeId.substring(4) : edge.toNodeId.substring(4);
        
        const segment = this.worldRefs.cytoskeletonSystem.getSegment(segmentId);
        if (segment) {
          edge.currentLoad = segment.currentLoad;
          edge.congestionCost = this.calculateCongestionCost(segment.currentLoad / segment.capacity);
        }
      }
    }
  }
  
  /**
   * Build nodes from filament segments
   */
  private buildNodesFromSegments(): void {
    const segments = this.worldRefs.cytoskeletonSystem.getAllSegments();
    
    for (const segment of segments) {
      // Create nodes for segment endpoints
      const fromNodeId = `seg_${segment.id}_from`;
      const toNodeId = `seg_${segment.id}_to`;
      
      this.nodes.set(fromNodeId, {
        id: fromNodeId,
        hex: segment.fromHex,
        type: 'segment',
        segmentId: segment.id,
        filamentType: segment.type,
        connections: [toNodeId]
      });
      
      this.nodes.set(toNodeId, {
        id: toNodeId,
        hex: segment.toHex,
        type: 'segment',
        segmentId: segment.id,
        filamentType: segment.type,
        connections: [fromNodeId]
      });
    }
  }
  
  /**
   * Build nodes from organelle upgrades
   */
  private buildNodesFromUpgrades(): void {
    const upgrades = this.worldRefs.cytoskeletonSystem.getAllUpgrades();
    
    for (const upgrade of upgrades) {
      const nodeId = `upgrade_${upgrade.id}`;
      
      this.nodes.set(nodeId, {
        id: nodeId,
        hex: upgrade.rimHex,
        type: 'upgrade',
        upgradeId: upgrade.id,
        upgradeType: upgrade.type,
        connections: []
      });
    }
  }
  
  /**
   * Build edges between connected nodes
   */
  private buildEdgesFromConnections(): void {
    // Connect segment endpoints within the same segment
    for (const segment of this.worldRefs.cytoskeletonSystem.getAllSegments()) {
      const fromNodeId = `seg_${segment.id}_from`;
      const toNodeId = `seg_${segment.id}_to`;
      
      if (this.nodes.has(fromNodeId) && this.nodes.has(toNodeId)) {
        this.createEdge(fromNodeId, toNodeId, segment);
      }
    }
    
    // Connect segment endpoints to nearby upgrades
    this.connectSegmentsToUpgrades();
    
    // Connect segments that share endpoints
    this.connectAdjacentSegments();
  }
  
  /**
   * Connect segment endpoints to nearby upgrade nodes
   */
  private connectSegmentsToUpgrades(): void {
    const CONNECTION_RANGE = 1; // Must be adjacent hexes
    
    for (const upgrade of this.worldRefs.cytoskeletonSystem.getAllUpgrades()) {
      const upgradeNodeId = `upgrade_${upgrade.id}`;
      const upgradeNode = this.nodes.get(upgradeNodeId);
      if (!upgradeNode) continue;
      
      // Find nearby segment nodes
      for (const node of this.nodes.values()) {
        if (node.type === 'segment') {
          const distance = this.calculateHexDistance(node.hex, upgradeNode.hex);
          if (distance <= CONNECTION_RANGE) {
            // Create bidirectional connection
            upgradeNode.connections.push(node.id);
            node.connections.push(upgradeNodeId);
            
            // Create edges for upgrade connections
            this.createUpgradeEdge(upgradeNodeId, node.id);
          }
        }
      }
    }
  }
  
  /**
   * Connect segments that share endpoints
   */
  private connectAdjacentSegments(): void {
    const nodesByHex = new Map<string, string[]>();
    
    // Group nodes by hex coordinate
    for (const node of this.nodes.values()) {
      if (node.type === 'segment') {
        const hexKey = `${node.hex.q},${node.hex.r}`;
        if (!nodesByHex.has(hexKey)) {
          nodesByHex.set(hexKey, []);
        }
        nodesByHex.get(hexKey)!.push(node.id);
      }
    }
    
    // Connect nodes at the same hex
    for (const nodeIds of nodesByHex.values()) {
      if (nodeIds.length > 1) {
        for (let i = 0; i < nodeIds.length; i++) {
          for (let j = i + 1; j < nodeIds.length; j++) {
            const nodeA = this.nodes.get(nodeIds[i])!;
            const nodeB = this.nodes.get(nodeIds[j])!;
            
            nodeA.connections.push(nodeB.id);
            nodeB.connections.push(nodeA.id);
            
            // Create junction edge
            this.createJunctionEdge(nodeA.id, nodeB.id);
          }
        }
      }
    }
  }
  
  /**
   * Create edge between segment endpoints
   */
  private createEdge(fromNodeId: string, toNodeId: string, segment: FilamentSegment): void {
    const edgeId = `${fromNodeId}→${toNodeId}`;
    const distance = this.calculateHexDistance(segment.fromHex, segment.toHex);
    
    this.edges.set(edgeId, {
      id: edgeId,
      fromNodeId,
      toNodeId,
      capacity: segment.capacity,
      speed: segment.speed,
      currentLoad: segment.currentLoad,
      distance,
      congestionCost: this.calculateCongestionCost(segment.utilization),
      typeCost: segment.type === 'microtubule' ? 
        this.PATHFINDING_CONFIG.MICROTUBULE_BONUS : 
        this.PATHFINDING_CONFIG.ACTIN_PENALTY
    });
    
    // Create reverse edge
    const reverseEdgeId = `${toNodeId}→${fromNodeId}`;
    this.edges.set(reverseEdgeId, {
      id: reverseEdgeId,
      fromNodeId: toNodeId,
      toNodeId: fromNodeId,
      capacity: segment.capacity,
      speed: segment.speed,
      currentLoad: segment.currentLoad,
      distance,
      congestionCost: this.calculateCongestionCost(segment.utilization),
      typeCost: segment.type === 'microtubule' ? 
        this.PATHFINDING_CONFIG.MICROTUBULE_BONUS : 
        this.PATHFINDING_CONFIG.ACTIN_PENALTY
    });
  }
  
  /**
   * Create edge for upgrade connections
   */
  private createUpgradeEdge(upgradeNodeId: string, segmentNodeId: string): void {
    const edgeId = `${upgradeNodeId}→${segmentNodeId}`;
    const reverseEdgeId = `${segmentNodeId}→${upgradeNodeId}`;
    
    const upgradeNode = this.nodes.get(upgradeNodeId)!;
    const segmentNode = this.nodes.get(segmentNodeId)!;
    const distance = this.calculateHexDistance(upgradeNode.hex, segmentNode.hex);
    
    // Upgrade edges have high capacity and fast transfer
    const edgeProps = {
      capacity: 10,
      speed: 2.0,
      currentLoad: 0,
      distance,
      congestionCost: 1.0,
      typeCost: 0.8 // Slight bonus for using upgrades
    };
    
    this.edges.set(edgeId, { id: edgeId, fromNodeId: upgradeNodeId, toNodeId: segmentNodeId, ...edgeProps });
    this.edges.set(reverseEdgeId, { id: reverseEdgeId, fromNodeId: segmentNodeId, toNodeId: upgradeNodeId, ...edgeProps });
  }
  
  /**
   * Create edge for segment junctions
   */
  private createJunctionEdge(nodeAId: string, nodeBId: string): void {
    const edgeId = `${nodeAId}↔${nodeBId}`;
    const reverseEdgeId = `${nodeBId}↔${nodeAId}`;
    
    // Junction edges allow fast transfer between segments
    const edgeProps = {
      capacity: 5,
      speed: 1.5,
      currentLoad: 0,
      distance: 0, // No distance for junction transfers
      congestionCost: 1.0,
      typeCost: 0.9 // Small bonus for junction usage
    };
    
    this.edges.set(edgeId, { id: edgeId, fromNodeId: nodeAId, toNodeId: nodeBId, ...edgeProps });
    this.edges.set(reverseEdgeId, { id: reverseEdgeId, fromNodeId: nodeBId, toNodeId: nodeAId, ...edgeProps });
  }
  
  /**
   * A* pathfinding algorithm
   */
  private findPathAStar(startNodeId: string, endNodeId: string): string[] | null {
    const openSet = new Set([startNodeId]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    
    gScore.set(startNodeId, 0);
    fScore.set(startNodeId, this.heuristic(startNodeId, endNodeId));
    
    while (openSet.size > 0) {
      // Find node with lowest fScore
      let current = '';
      let lowestF = Infinity;
      for (const nodeId of openSet) {
        const f = fScore.get(nodeId) || Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = nodeId;
        }
      }
      
      if (current === endNodeId) {
        // Reconstruct path
        const path = [current];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current)!;
          path.unshift(current);
        }
        return path;
      }
      
      openSet.delete(current);
      const currentNode = this.nodes.get(current);
      if (!currentNode) continue;
      
      for (const neighborId of currentNode.connections) {
        const edge = this.edges.get(`${current}→${neighborId}`);
        if (!edge) continue;
        
        const tentativeG = (gScore.get(current) || Infinity) + this.calculateEdgeCost(edge);
        
        if (tentativeG < (gScore.get(neighborId) || Infinity)) {
          cameFrom.set(neighborId, current);
          gScore.set(neighborId, tentativeG);
          fScore.set(neighborId, tentativeG + this.heuristic(neighborId, endNodeId));
          openSet.add(neighborId);
        }
      }
    }
    
    return null; // No path found
  }
  
  /**
   * Heuristic function for A* (estimated cost to goal)
   */
  private heuristic(nodeId: string, goalNodeId: string): number {
    const node = this.nodes.get(nodeId);
    const goalNode = this.nodes.get(goalNodeId);
    if (!node || !goalNode) return Infinity;
    
    return this.calculateHexDistance(node.hex, goalNode.hex);
  }
  
  /**
   * Calculate cost of traversing an edge
   */
  private calculateEdgeCost(edge: CytoskeletonEdge): number {
    const config = this.PATHFINDING_CONFIG;
    
    let cost = edge.distance * config.DISTANCE_WEIGHT;
    cost += edge.congestionCost * config.CONGESTION_WEIGHT;
    cost *= edge.typeCost * config.TYPE_PREFERENCE_WEIGHT;
    
    return Math.max(cost, 0.1); // Minimum cost to prevent zero-cost cycles
  }
  
  /**
   * Calculate congestion cost based on utilization
   */
  private calculateCongestionCost(utilization: number): number {
    const config = this.PATHFINDING_CONFIG;
    
    if (utilization < config.CONGESTION_THRESHOLD) {
      return 1.0; // No penalty
    }
    
    const excessUtilization = utilization - config.CONGESTION_THRESHOLD;
    const maxExcess = 1.0 - config.CONGESTION_THRESHOLD;
    
    const penalty = 1.0 + (excessUtilization / maxExcess) * (config.MAX_CONGESTION_PENALTY - 1.0);
    return Math.min(penalty, config.MAX_CONGESTION_PENALTY);
  }
  
  /**
   * Find nearest node to a hex coordinate
   */
  private findNearestNode(hex: HexCoord): CytoskeletonNode | null {
    let nearestNode: CytoskeletonNode | null = null;
    let minDistance = Infinity;
    
    for (const node of this.nodes.values()) {
      const distance = this.calculateHexDistance(hex, node.hex);
      if (distance < minDistance) {
        minDistance = distance;
        nearestNode = node;
      }
    }
    
    return nearestNode;
  }
  
  /**
   * Create route object from pathfinding result
   */
  private createRouteFromPath(startNodeId: string, endNodeId: string, path: string[]): CytoskeletonRoute {
    let totalDistance = 0;
    let totalCost = 0;
    let minCapacity = Infinity;
    let speedSum = 0;
    
    for (let i = 0; i < path.length - 1; i++) {
      const edge = this.edges.get(`${path[i]}→${path[i + 1]}`);
      if (edge) {
        totalDistance += edge.distance;
        totalCost += this.calculateEdgeCost(edge);
        minCapacity = Math.min(minCapacity, edge.capacity);
        speedSum += edge.speed;
      }
    }
    
    const avgSpeed = path.length > 1 ? speedSum / (path.length - 1) : 1.0;
    
    return {
      id: `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startNodeId,
      endNodeId,
      nodeIds: path,
      totalDistance,
      totalCost,
      avgSpeed,
      minCapacity: minCapacity === Infinity ? 0 : minCapacity,
      createdAt: Date.now(),
      usageCount: 1,
      lastUsed: Date.now()
    };
  }
  
  /**
   * Cache a route for future use
   */
  private cacheRoute(routeKey: string, route: CytoskeletonRoute): void {
    // Clean up old routes if cache is full
    if (this.routeCache.size >= this.MAX_CACHED_ROUTES) {
      this.cleanupRouteCache();
    }
    
    this.routeCache.set(routeKey, route);
  }
  
  /**
   * Check if cached route is still valid
   */
  private isRouteCacheValid(route: CytoskeletonRoute): boolean {
    const age = Date.now() - route.createdAt;
    return age < this.CACHE_EXPIRY_MS;
  }
  
  /**
   * Clean up expired routes from cache
   */
  private cleanupRouteCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [key, route] of this.routeCache) {
      if (now - route.createdAt > this.CACHE_EXPIRY_MS) {
        toDelete.push(key);
      }
    }
    
    // If still too many routes, remove least recently used
    if (this.routeCache.size - toDelete.length >= this.MAX_CACHED_ROUTES) {
      const sortedRoutes = Array.from(this.routeCache.entries())
        .filter(([key]) => !toDelete.includes(key))
        .sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
      
      const removeCount = this.routeCache.size - toDelete.length - this.MAX_CACHED_ROUTES + 10;
      for (let i = 0; i < removeCount && i < sortedRoutes.length; i++) {
        toDelete.push(sortedRoutes[i][0]);
      }
    }
    
    for (const key of toDelete) {
      this.routeCache.delete(key);
    }
    
    if (toDelete.length > 0) {
      console.log(`🧹 Cleaned up ${toDelete.length} cached cytoskeleton routes`);
    }
  }
  
  /**
   * Invalidate all cached routes (used when network topology changes)
   */
  private invalidateAllRoutes(): void {
    this.routeCache.clear();
  }
  
  /**
   * Calculate hex distance between two coordinates
   */
  private calculateHexDistance(a: HexCoord, b: HexCoord): number {
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }
}
