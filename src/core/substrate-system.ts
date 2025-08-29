/**
 * Substrate System
 * 
 * Manages external substrate areas and obstacles for cell locomotion.
 * Provides substrate types (SOFT, FIRM, STICKY) and obstacle collision detection.
 */

export type SubstrateType = 'SOFT' | 'FIRM' | 'ECM' | 'STICKY';

// V2: New terrain feature types
export type TerrainFeatureType = 'micropore' | 'runUpGate' | 'ecmLattice';

export interface SubstrateArea {
  /** Area bounds (circle or polygon) */
  bounds: CircleBounds | PolygonBounds;
  
  /** Substrate type affecting locomotion */
  type: SubstrateType;
  
  /** Optional visual color */
  color?: number;
}

// V2: Terrain features for mode differentiation
export interface TerrainFeature {
  /** Feature bounds */
  bounds: CircleBounds | PolygonBounds;
  
  /** Feature type */
  type: TerrainFeatureType;
  
  /** Feature-specific properties */
  properties: any;
  
  /** Visual properties */
  color?: number;
  alpha?: number;
}

export interface CircleBounds {
  type: 'circle';
  x: number;
  y: number;
  radius: number;
}

export interface PolygonBounds {
  type: 'polygon';
  points: { x: number; y: number }[];
}

export interface Obstacle {
  /** Obstacle bounds for collision */
  bounds: CircleBounds | PolygonBounds;
  
  /** Obstacle type (for future expansion) */
  type: 'rock' | 'wall';
  
  /** Visual properties */
  color?: number;
  alpha?: number;
}

export class SubstrateSystem {
  private substrates: SubstrateArea[] = [];
  private obstacles: Obstacle[] = [];
  private terrainFeatures: TerrainFeature[] = []; // V2: New terrain features
  
  constructor() {
    this.initializeDefaultSubstrates();
    this.initializeDefaultObstacles();
  }
  
  private initializeDefaultSubstrates(): void {
    // Create some sample substrate areas
    this.substrates = [
      // Large FIRM base area
      {
        bounds: {
          type: 'circle',
          x: 0,
          y: 0,
          radius: 1000
        },
        type: 'FIRM',
        color: 0x888888
      },
      
      // SOFT patch (slower, easier turning)
      {
        bounds: {
          type: 'circle',
          x: -200,
          y: 150,
          radius: 80
        },
        type: 'SOFT',
        color: 0x4444AA
      },
      
      // ECM area (dense extracellular matrix)
      {
        bounds: {
          type: 'circle',
          x: 200,
          y: -150,
          radius: 90
        },
        type: 'ECM',
        color: 0x664422
      },
      
      // STICKY area (slow, but good grip)
      {
        bounds: {
          type: 'polygon',
          points: [
            { x: 100, y: -100 },
            { x: 200, y: -80 },
            { x: 180, y: 20 },
            { x: 120, y: 40 },
            { x: 80, y: -20 }
          ]
        },
        type: 'STICKY',
        color: 0xAA4444
      }
    ];
  }
  
  private initializeDefaultObstacles(): void {
    // Create some sample obstacles
    this.obstacles = [
      // Rock obstacle
      {
        bounds: {
          type: 'circle',
          x: 50,
          y: -200,
          radius: 30
        },
        type: 'rock',
        color: 0x666666,
        alpha: 0.8
      },
      
      // Wall obstacle
      {
        bounds: {
          type: 'polygon',
          points: [
            { x: -150, y: -50 },
            { x: -140, y: -50 },
            { x: -140, y: 100 },
            { x: -150, y: 100 }
          ]
        },
        type: 'wall',
        color: 0x333333,
        alpha: 0.9
      }
    ];
  }
  
  /**
   * Get substrate type at a world position
   */
  getSubstrateAt(worldX: number, worldY: number): SubstrateType {
    // Check substrates in reverse order (last added has priority)
    for (let i = this.substrates.length - 1; i >= 0; i--) {
      const substrate = this.substrates[i];
      if (this.pointInBounds(worldX, worldY, substrate.bounds)) {
        return substrate.type;
      }
    }
    
    // Default to FIRM if no substrate found
    return 'FIRM';
  }
  
  /**
   * Check collision with obstacles at a world position
   */
  checkObstacleCollision(worldX: number, worldY: number, radius: number = 0): {
    colliding: boolean;
    obstacle?: Obstacle;
    normal?: { x: number; y: number };
  } {
    for (const obstacle of this.obstacles) {
      if (this.circleIntersectsBounds(worldX, worldY, radius, obstacle.bounds)) {
        const normal = this.getCollisionNormal(worldX, worldY, obstacle.bounds);
        return {
          colliding: true,
          obstacle,
          normal
        };
      }
    }
    
    return { colliding: false };
  }
  
  /**
   * Check if point is inside bounds
   */
  private pointInBounds(x: number, y: number, bounds: CircleBounds | PolygonBounds): boolean {
    if (bounds.type === 'circle') {
      const dx = x - bounds.x;
      const dy = y - bounds.y;
      return (dx * dx + dy * dy) <= (bounds.radius * bounds.radius);
    } else {
      // Polygon point-in-polygon test (ray casting)
      return this.pointInPolygon(x, y, bounds.points);
    }
  }
  
  /**
   * Check if circle intersects with bounds
   */
  private circleIntersectsBounds(x: number, y: number, radius: number, bounds: CircleBounds | PolygonBounds): boolean {
    if (bounds.type === 'circle') {
      const dx = x - bounds.x;
      const dy = y - bounds.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance <= (radius + bounds.radius);
    } else {
      // Check if circle intersects polygon
      return this.circleIntersectsPolygon(x, y, radius, bounds.points);
    }
  }
  
  /**
   * Get collision normal vector
   */
  private getCollisionNormal(x: number, y: number, bounds: CircleBounds | PolygonBounds): { x: number; y: number } {
    if (bounds.type === 'circle') {
      const dx = x - bounds.x;
      const dy = y - bounds.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) return { x: 1, y: 0 };
      return { x: dx / distance, y: dy / distance };
    } else {
      // For polygon, find closest edge and return perpendicular
      return this.getPolygonNormal(x, y, bounds.points);
    }
  }
  
  /**
   * Point-in-polygon test using ray casting
   */
  private pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
  
  /**
   * Circle-polygon intersection test
   */
  private circleIntersectsPolygon(x: number, y: number, radius: number, polygon: { x: number; y: number }[]): boolean {
    // First check if circle center is inside polygon
    if (this.pointInPolygon(x, y, polygon)) {
      return true;
    }
    
    // Check distance to each edge
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const edge = this.distanceToLineSegment(x, y, polygon[i], polygon[j]);
      if (edge <= radius) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get normal vector from polygon collision
   */
  private getPolygonNormal(x: number, y: number, polygon: { x: number; y: number }[]): { x: number; y: number } {
    let closestDistance = Infinity;
    let normal = { x: 1, y: 0 };
    
    // Find closest edge
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const distance = this.distanceToLineSegment(x, y, polygon[i], polygon[j]);
      
      if (distance < closestDistance) {
        closestDistance = distance;
        
        // Calculate edge normal
        const edgeX = polygon[j].x - polygon[i].x;
        const edgeY = polygon[j].y - polygon[i].y;
        const edgeLength = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
        
        if (edgeLength > 0) {
          // Perpendicular to edge, pointing outward
          normal.x = -edgeY / edgeLength;
          normal.y = edgeX / edgeLength;
        }
      }
    }
    
    return normal;
  }
  
  /**
   * Distance from point to line segment
   */
  private distanceToLineSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    
    if (length === 0) {
      // Point a and b are the same
      const dpx = px - a.x;
      const dpy = py - a.y;
      return Math.sqrt(dpx * dpx + dpy * dpy);
    }
    
    // Parameter t represents position along line segment
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length));
    
    // Closest point on line segment
    const closestX = a.x + t * dx;
    const closestY = a.y + t * dy;
    
    // Distance to closest point
    const distX = px - closestX;
    const distY = py - closestY;
    return Math.sqrt(distX * distX + distY * distY);
  }
  
  // Public getters for rendering
  getSubstrates(): readonly SubstrateArea[] {
    return this.substrates;
  }
  
  getObstacles(): readonly Obstacle[] {
    return this.obstacles;
  }

  // V2: Terrain features getter
  getTerrainFeatures(): readonly TerrainFeature[] {
    return this.terrainFeatures;
  }
  
  // Methods to add/remove substrates and obstacles dynamically
  addSubstrate(substrate: SubstrateArea): void {
    this.substrates.push(substrate);
  }
  
  addObstacle(obstacle: Obstacle): void {
    this.obstacles.push(obstacle);
  }

  // V2: Add terrain feature
  addTerrainFeature(feature: TerrainFeature): void {
    this.terrainFeatures.push(feature);
  }
  
  // V2: Check terrain feature interactions
  checkTerrainFeatureAt(x: number, y: number): TerrainFeature | null {
    for (const feature of this.terrainFeatures) {
      if (this.pointInBounds(x, y, feature.bounds)) {
        return feature;
      }
    }
    return null;
  }

  // V2: Check if cell can pass through micropore (amoeboid-specific)
  canPassThroughMicropore(cellRadius: number, modeId: string): boolean {
    return modeId === 'amoeboid' && cellRadius <= 8; // Reduced radius when squeezing
  }

  // V2: Trigger run-up gate timing check
  triggerRunUpGate(speed: number, gateProperties: any): { passed: boolean; time: number } {
    const requiredSpeed = gateProperties.requiredSpeed || 25;
    const passed = speed >= requiredSpeed;
    const time = Date.now();
    
    return { passed, time };
  }

  // V2: Get ECM lattice resistance reduction from track
  getEcmTrackBonus(trackStrength: number): number {
    return Math.min(0.4, trackStrength * 0.6); // Up to 40% resistance reduction
  }
  
  clearSubstrates(): void {
    this.substrates = [];
  }
  
  clearObstacles(): void {
    this.obstacles = [];
  }

  // V2: Clear terrain features
  clearTerrainFeatures(): void {
    this.terrainFeatures = [];
  }
}
