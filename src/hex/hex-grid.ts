/*
Hex Grid System for Cell Prototype
Milestone 2: Extended hex grid with species concentration support.
MEMBRANE INTEGRATION: Barycentric positioning system for dynamic deformation.
*/

import Phaser from "phaser";
import { createEmptyConcentrations, type SpeciesId } from "../species/species-registry";
import type { MembranePhysicsSystem } from "../membrane/membrane-physics-system";

// Axial coordinate system for hex grid
export interface HexCoord {
  q: number;  // column
  r: number;  // row
}

// Barycentric coordinates within a membrane triangle
export interface BarycentricCoord {
  triangleIndex: number;  // Which membrane triangle this tile belongs to
  u: number;              // Barycentric coordinate u (0-1)
  v: number;              // Barycentric coordinate v (0-1)
  w: number;              // Barycentric coordinate w (0-1, computed as 1-u-v)
}

// Tile data container with species concentrations
export interface HexTile {
  coord: HexCoord;
  worldPos: Phaser.Math.Vector2;
  concentrations: Record<SpeciesId, number>; // Species ID -> concentration value
  
  // Milestone 6: Membrane system - BARYCENTRIC POSITIONING
  isMembrane: boolean;
  membraneIndex?: number; // Optional index for membrane growth tracking
  
  // NEW: Barycentric positioning for dynamic deformation
  barycentricCoord?: BarycentricCoord; // How this tile maps to membrane triangles
  isInterior: boolean; // Whether this tile is inside the membrane (needs barycentric mapping)
}

// Main hex grid class
export class HexGrid {
  private tiles: Map<string, HexTile> = new Map();
  private hexSize: number;
  private gridCenter: Phaser.Math.Vector2;
  private gridRadius: number = 0; // Store the current grid radius
  
  // NEW: Membrane physics integration for barycentric positioning
  private membranePhysics?: MembranePhysicsSystem;

  constructor(hexSize: number, centerX: number, centerY: number) {
    this.hexSize = hexSize;
    this.gridCenter = new Phaser.Math.Vector2(centerX, centerY);
  }
  
  // NEW: Set membrane physics system for barycentric positioning
  setMembranePhysics(membranePhysics: MembranePhysicsSystem): void {
    if(!membranePhysics) throw new Error("No membrane physics system provided");
    this.membranePhysics = membranePhysics;
    console.log('🔺 Membrane physics connected to hex grid - recomputing membrane assignment and barycentric coordinates');
    
    // Recompute membrane assignments and barycentric coordinates now that membrane physics is available
    if (this.gridCenter) {
      const cellRadius = this.gridRadius * this.hexSize; // Approximate cell radius
      
      // IMPORTANT: Recompute membrane tiles with gap-filling algorithm
      this.recomputeMembranes(this.gridCenter.x, this.gridCenter.y, cellRadius);
      
      // Then compute barycentric coordinates for interior tiles
      this.computeBarycentricCoordinates(this.gridCenter.x, this.gridCenter.y, cellRadius);
    }
  }

  // Generate tiles within a given radius
  generateTiles(radius: number): void {
    this.tiles.clear();
    this.gridRadius = radius; // Store radius for later use

    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) {
        const coord: HexCoord = { q, r };
        const worldPos = this.hexToWorld(coord);
        const tile: HexTile = {
          coord,
          worldPos: worldPos.clone(),
          concentrations: createEmptyConcentrations(), // Initialize all species to 0
          isMembrane: false, // Will be computed after generation
          membraneIndex: undefined,
          
          // NEW: Barycentric positioning
          isInterior: false, // Will be computed after membrane analysis
          barycentricCoord: undefined // Will be computed for interior tiles
        };
        this.tiles.set(this.coordToKey(coord), tile);
      }
    }
  }

  // Filter tiles to only those inside a circular boundary
  filterTilesInCircle(centerX: number, centerY: number, maxRadius: number): void {
    const filteredTiles = new Map<string, HexTile>();
    
    for (const [key, tile] of this.tiles) {
      const distance = Phaser.Math.Distance.Between(
        tile.worldPos.x, tile.worldPos.y,
        centerX, centerY
      );
      if (distance <= maxRadius) {
        filteredTiles.set(key, tile);
      }
    }
    
    this.tiles = filteredTiles;
  }

  // Convert hex coordinate to world position
  hexToWorld(coord: HexCoord): Phaser.Math.Vector2 {
    const x = this.hexSize * (3/2 * coord.q);
    const y = this.hexSize * (Math.sqrt(3)/2 * coord.q + Math.sqrt(3) * coord.r);
    return new Phaser.Math.Vector2(
      this.gridCenter.x + x,
      this.gridCenter.y + y
    );
  }

  // Convert world position to hex coordinate
  worldToHex(worldX: number, worldY: number): HexCoord {
    const x = (worldX - this.gridCenter.x) / this.hexSize;
    const y = (worldY - this.gridCenter.y) / this.hexSize;
    
    const q = (2/3) * x;
    const r = (-1/3) * x + (Math.sqrt(3)/3) * y;
    
    const cubeCoords = this.cubeRound(q, -q-r, r);
    return { q: cubeCoords.x, r: cubeCoords.z };
  }

  // Get neighbors of a hex tile
  getNeighbors(coord: HexCoord): HexTile[] {
    const directions = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];
    
    const neighbors: HexTile[] = [];
    for (const dir of directions) {
      const neighborCoord = { q: coord.q + dir.q, r: coord.r + dir.r };
      const neighbor = this.getTile(neighborCoord);
      if (neighbor) {
        neighbors.push(neighbor);
      }
    }
    return neighbors;
  }

  // Get tile by coordinate
  getTile(coord: HexCoord): HexTile | undefined {
    return this.tiles.get(this.coordToKey(coord));
  }

  // Get tile by world position (finds closest hex) - UPDATED for deformed membrane
  getTileAtWorld(worldX: number, worldY: number): HexTile | undefined {
    // For deformed membranes, we need to find the closest tile by actual world position
    // rather than using coordinate conversion which assumes regular grid
    
    let closestTile: HexTile | undefined = undefined;
    let closestDistance = Infinity;
    
    // Check all tiles and find the one with closest world position
    for (const tile of this.tiles.values()) {
      const dx = tile.worldPos.x - worldX;
      const dy = tile.worldPos.y - worldY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Only consider tiles within reasonable distance (2 hex sizes)
      if (distance < this.hexSize * 2 && distance < closestDistance) {
        closestDistance = distance;
        closestTile = tile;
      }
    }
    
    return closestTile;
  }

  // Get all tiles
  getAllTiles(): HexTile[] {
    return Array.from(this.tiles.values());
  }

  // Get tile count
  getTileCount(): number {
    return this.tiles.size;
  }

  // Update grid center (for window resize and cell locomotion)
  // Called every frame by locomotion system when cell moves
  updateCenter(centerX: number, centerY: number): void {
    const deltaX = centerX - this.gridCenter.x;
    const deltaY = centerY - this.gridCenter.y;
    
    this.gridCenter.set(centerX, centerY);
    
    // Update all tile world positions
    for (const tile of this.tiles.values()) {
      tile.worldPos.x += deltaX;
      tile.worldPos.y += deltaY;
    }
  }

  // Species concentration helpers - Task 2
  
  /**
   * Get concentration of a species on a tile
   */
  getConcentration(coord: HexCoord, speciesId: SpeciesId): number {
    const tile = this.getTile(coord);
    return tile?.concentrations[speciesId] ?? 0;
  }

  /**
   * Set concentration of a species on a tile
   */
  setConcentration(coord: HexCoord, speciesId: SpeciesId, value: number): void {
    const tile = this.getTile(coord);
    if (tile && tile.concentrations.hasOwnProperty(speciesId)) {
      tile.concentrations[speciesId] = Math.max(0, value); // Ensure non-negative
    }
  }

  /**
   * Add to concentration of a species on a tile
   */
  addConcentration(coord: HexCoord, speciesId: SpeciesId, delta: number): void {
    const tile = this.getTile(coord);
    if (tile && tile.concentrations.hasOwnProperty(speciesId)) {
      tile.concentrations[speciesId] = Math.max(0, tile.concentrations[speciesId] + delta);
    }
  }

  /**
   * Get all concentrations for a tile
   */
  getAllConcentrations(coord: HexCoord): Record<SpeciesId, number> {
    const tile = this.getTile(coord);
    return tile ? { ...tile.concentrations } : {} as Record<SpeciesId, number>;
  }

  /**
   * Clear all concentrations on a tile (set to zero)
   */
  clearConcentrations(coord: HexCoord): void {
    const tile = this.getTile(coord);
    if (tile) {
      for (const speciesId in tile.concentrations) {
        tile.concentrations[speciesId as SpeciesId] = 0;
      }
    }
  }

  // Helper: Convert coordinate to string key for Map lookup
  private coordToKey(coord: HexCoord): string {
    return `${coord.q},${coord.r}`;
  }

  // Helper: Round cube coordinates to nearest hex
  private cubeRound(x: number, y: number, z: number): { x: number, y: number, z: number } {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);

    const x_diff = Math.abs(rx - x);
    const y_diff = Math.abs(ry - y);
    const z_diff = Math.abs(rz - z);

    if (x_diff > y_diff && x_diff > z_diff) {
      rx = -ry - rz;
    } else if (y_diff > z_diff) {
      ry = -rx - rz;
    } else {
      rz = -rx - ry;
    }

    return { x: rx, y: ry, z: rz };
  }

  // Milestone 6 Task 1: Membrane detection system
  
  /**
   * Recompute which tiles are membrane tiles based on current cell boundary.
   * A tile is membrane if it's on the outer ring of the cell.
   */
  public recomputeMembranes(cellCenterX: number, cellCenterY: number, cellRadius: number): void {
    // Reset all membrane flags
    for (const tile of this.tiles.values()) {
      tile.isMembrane = false;
      tile.membraneIndex = undefined;
    }

    // Find outer ring tiles - those with at least one missing neighbor toward the outside
    const membraneTiles: HexTile[] = [];
    
    // IMPROVED: Assign membrane tiles based on proximity to actual membrane particles
    if (this.membranePhysics) {
      const membraneParticles = this.membranePhysics.getParticlePositions();
      const membraneCenter = this.membranePhysics.getCenter();
      
      // Calculate coordinate offset for proper mapping
      const coordinateOffset = {
        x: cellCenterX - membraneCenter.x,
        y: cellCenterY - membraneCenter.y
      };
      
      console.log(`🔺 Membrane assignment: ${membraneParticles.length} particles to distribute`);
      
      // For each membrane particle, find the closest hex tile
      const assignedTiles = new Set<HexTile>();
      let assignmentDebug = [];
      
      for (let i = 0; i < membraneParticles.length; i++) {
        const particle = membraneParticles[i];
        // Transform particle position to world coordinates
        const particleWorldX = particle.x + coordinateOffset.x;
        const particleWorldY = particle.y + coordinateOffset.y;
        
        let closestTile: HexTile | null = null;
        let closestDistance = Infinity;
        
        // Find the closest tile to this membrane particle
        for (const tile of this.tiles.values()) {
          const distance = Phaser.Math.Distance.Between(
            tile.worldPos.x, tile.worldPos.y,
            particleWorldX, particleWorldY
          );
          
          if (distance < closestDistance && !assignedTiles.has(tile)) {
            closestDistance = distance;
            closestTile = tile;
          }
        }
        
        if (closestTile && closestDistance < this.hexSize * 3) { // Increased proximity threshold
          closestTile.isMembrane = true;
          closestTile.membraneIndex = i; // Direct correspondence to membrane particle
          membraneTiles.push(closestTile);
          assignedTiles.add(closestTile);
          
          // Debug info for first few assignments
          if (i < 8) {
            assignmentDebug.push({
              particleIndex: i,
              particlePos: { x: particle.x.toFixed(1), y: particle.y.toFixed(1) },
              particleWorldPos: { x: particleWorldX.toFixed(1), y: particleWorldY.toFixed(1) },
              tilePos: { x: closestTile.worldPos.x.toFixed(1), y: closestTile.worldPos.y.toFixed(1) },
              distance: closestDistance.toFixed(1)
            });
          }
        } else {
          console.warn(`🔺 No suitable tile found for membrane particle ${i} at (${particleWorldX.toFixed(1)}, ${particleWorldY.toFixed(1)}) - closest distance: ${closestDistance.toFixed(1)}`);
        }
      }
      
      console.log(`🔺 Membrane assignment debug (first 8):`, assignmentDebug);
      console.log(`🔺 Membrane tiles assigned via physics particles: ${membraneTiles.length} tiles for ${membraneParticles.length} particles`);
      
      // NEW: Fill gaps by finding boundary tiles not yet assigned
      const boundaryTiles: HexTile[] = [];
      for (const tile of this.tiles.values()) {
        if (!assignedTiles.has(tile)) {
          // Check if this tile is on the boundary
          const distanceFromCenter = Phaser.Math.Distance.Between(
            tile.worldPos.x, tile.worldPos.y,
            cellCenterX, cellCenterY
          );
          
          // Consider tiles near the membrane boundary
          if (distanceFromCenter > cellRadius - this.hexSize * 2 && distanceFromCenter <= cellRadius) {
            boundaryTiles.push(tile);
          }
        }
      }
      
        // Add boundary tiles to fill gaps, prioritizing even angular distribution
        if (boundaryTiles.length > 0) {
          // Sort boundary tiles by angle to ensure even coverage
          boundaryTiles.sort((a, b) => {
            const angleA = Math.atan2(a.worldPos.y - cellCenterY, a.worldPos.x - cellCenterX);
            const angleB = Math.atan2(b.worldPos.y - cellCenterY, b.worldPos.x - cellCenterX);
            return angleA - angleB;
          });
          
          // Calculate angular gaps to identify missing coverage
          const memberTileAngles = membraneTiles.map(tile => {
            const dx = tile.worldPos.x - cellCenterX;
            const dy = tile.worldPos.y - cellCenterY;
            return Math.atan2(dy, dx);
          }).sort((a, b) => a - b);
          
          // Find the largest angular gaps
          const gaps = [];
          for (let i = 0; i < memberTileAngles.length; i++) {
            const currentAngle = memberTileAngles[i];
            const nextAngle = memberTileAngles[(i + 1) % memberTileAngles.length];
            
            let gap;
            if (i === memberTileAngles.length - 1) {
              // Last to first (wrap around)
              gap = (nextAngle + 2 * Math.PI) - currentAngle;
            } else {
              gap = nextAngle - currentAngle;
            }
            
            if (gap > Math.PI / 6) { // Gaps larger than 30 degrees
              gaps.push({
                startAngle: currentAngle,
                endAngle: nextAngle,
                size: gap,
                midAngle: currentAngle + gap / 2
              });
            }
          }
          
          // Fill gaps with boundary tiles
          for (const gap of gaps) {
            const tilesInGap = boundaryTiles.filter(tile => {
              const tileAngle = Math.atan2(tile.worldPos.y - cellCenterY, tile.worldPos.x - cellCenterX);
              return (tileAngle >= gap.startAngle && tileAngle <= gap.endAngle) ||
                     (gap.endAngle < gap.startAngle && (tileAngle >= gap.startAngle || tileAngle <= gap.endAngle));
            });
            
            // Add 2-3 tiles per significant gap
            const tilesToAdd = Math.min(3, tilesInGap.length);
            for (let i = 0; i < tilesToAdd; i++) {
              const tile = tilesInGap[i];
              if (!assignedTiles.has(tile)) {
                tile.isMembrane = true;
                tile.membraneIndex = membraneTiles.length;
                membraneTiles.push(tile);
                assignedTiles.add(tile);
              }
            }
          }
          
          // Also ensure minimum coverage - add boundary tiles to reach target count
          const targetMembraneCount = Math.max(48, membraneParticles.length);
          const additionalTilesNeeded = Math.max(0, targetMembraneCount - membraneTiles.length);
          
          let addedCount = 0;
          for (let i = 0; i < boundaryTiles.length && addedCount < additionalTilesNeeded; i++) {
            const tile = boundaryTiles[i];
            if (!assignedTiles.has(tile)) {
              tile.isMembrane = true;
              tile.membraneIndex = membraneTiles.length;
              membraneTiles.push(tile);
              assignedTiles.add(tile);
              addedCount++;
            }
          }
          
          console.log(`🔺 Found ${gaps.length} angular gaps > 30°. Added boundary tiles to fill gaps and reach target coverage.`);
          console.log(`🔺 Added ${addedCount} additional boundary tiles. Total boundary tiles available: ${boundaryTiles.length}`);
        }      // Check for distribution around perimeter
      if (membraneTiles.length > 0) {
        const angles = membraneTiles.map(tile => {
          const dx = tile.worldPos.x - cellCenterX;
          const dy = tile.worldPos.y - cellCenterY;
          return Math.atan2(dy, dx) * 180 / Math.PI;
        });
        
        angles.sort((a, b) => a - b);
        console.log(`🔺 Membrane tile angle distribution: min=${angles[0].toFixed(1)}°, max=${angles[angles.length-1].toFixed(1)}°, range=${(angles[angles.length-1] - angles[0]).toFixed(1)}°`);
        
        // Show angle distribution in quadrants
        const quadrants = [0, 0, 0, 0]; // NE, NW, SW, SE
        angles.forEach(angle => {
          if (angle >= -45 && angle < 45) quadrants[0]++; // East
          else if (angle >= 45 && angle < 135) quadrants[1]++; // North  
          else if (angle >= -135 && angle < -45) quadrants[2]++; // South
          else quadrants[3]++; // West
        });
        console.log(`🔺 Membrane tiles by quadrant: E=${quadrants[0]}, N=${quadrants[1]}, S=${quadrants[2]}, W=${quadrants[3]}`);
      }
    } else {
      // Fallback: Use boundary detection method
      for (const tile of this.tiles.values()) {
        // Check if this tile is on the boundary by seeing if any neighbor direction
        // would lead to a tile that's either missing or outside the cell radius
        const allDirections = [
          { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
          { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
        ];

        let isBoundary = false;
        for (const dir of allDirections) {
          const neighborCoord = { q: tile.coord.q + dir.q, r: tile.coord.r + dir.r };
          const neighborTile = this.getTile(neighborCoord);
          
          if (!neighborTile) {
            // Missing neighbor means we're on the boundary
            isBoundary = true;
            break;
          }

          // Also check if the neighbor would be outside the circular cell boundary
          const neighborWorldPos = this.hexToWorld(neighborCoord);
          const distanceFromCenter = Phaser.Math.Distance.Between(
            neighborWorldPos.x, neighborWorldPos.y,
            cellCenterX, cellCenterY
          );
          
          if (distanceFromCenter > cellRadius) {
            isBoundary = true;
            break;
          }
        }

        if (isBoundary) {
          tile.isMembrane = true;
          membraneTiles.push(tile);
        }
      }

      // Assign membrane indices for tracking (useful for future growth)
      membraneTiles.forEach((tile, index) => {
        tile.membraneIndex = index;
      });
    }

    console.log(`Membrane computation complete: ${membraneTiles.length} membrane tiles identified`);
    
    // NEW: Compute barycentric coordinates for interior tiles
    this.computeBarycentricCoordinates(cellCenterX, cellCenterY, cellRadius);
  }
  
  /**
   * NEW: Compute barycentric coordinates for all interior tiles relative to membrane triangles
   */
  private computeBarycentricCoordinates(cellCenterX: number, cellCenterY: number, cellRadius: number): void {
    if (!this.membranePhysics) {
      console.warn('Cannot compute barycentric coordinates: no membrane physics system available');
      return;
    }
    
    const membraneParticles = this.membranePhysics.getParticlePositions();
    const membraneCenter = this.membranePhysics.getCenter();
    
    console.log(`🔺 Computing barycentric coordinates for ${membraneParticles.length} membrane particles`);
    
    // Calculate coordinate system offset between hex grid and membrane physics
    const coordinateOffset = {
      x: cellCenterX - membraneCenter.x,
      y: cellCenterY - membraneCenter.y
    };
    
    console.log(`🔺 Coordinate offset: hex center (${cellCenterX.toFixed(1)}, ${cellCenterY.toFixed(1)}) - membrane center (${membraneCenter.x.toFixed(1)}, ${membraneCenter.y.toFixed(1)}) = offset (${coordinateOffset.x.toFixed(1)}, ${coordinateOffset.y.toFixed(1)})`);
    
    // Reset all tiles' barycentric data
    for (const tile of this.tiles.values()) {
      tile.isInterior = false;
      tile.barycentricCoord = undefined;
    }
    
    // Process each tile to determine if it's interior and assign barycentric coordinates
    let tilesProcessed = 0;
    let interiorTilesFound = 0;
    
    for (const tile of this.tiles.values()) {
      tilesProcessed++;
      if (tile.isMembrane) {
        continue; // Membrane tiles don't need barycentric coordinates
      }
      
      // Transform tile position to membrane coordinate system
      const tileInMembraneCoords = {
        x: tile.worldPos.x - coordinateOffset.x,
        y: tile.worldPos.y - coordinateOffset.y
      };
      
      // Check if tile is inside the membrane (using membrane center as reference)
      const tileDistanceFromMembraneCenter = Math.sqrt(
        (tileInMembraneCoords.x - membraneCenter.x) ** 2 + 
        (tileInMembraneCoords.y - membraneCenter.y) ** 2
      );
      
      if (tileDistanceFromMembraneCenter < cellRadius * 0.9) { // Interior threshold
        tile.isInterior = true;
        interiorTilesFound++;
        
        // Find the best membrane triangle for this tile (in membrane coordinates)
        const tileInMembraneSpace = new Phaser.Math.Vector2(tileInMembraneCoords.x, tileInMembraneCoords.y);
        const baryCoord = this.findBestTriangleForTile(tile, membraneParticles, membraneCenter, tileInMembraneSpace);
        tile.barycentricCoord = baryCoord;
      }
    }
    
    const interiorTiles = Array.from(this.tiles.values()).filter(t => t.isInterior);
    console.log(`🔺 Barycentric mapping complete: ${interiorTiles.length} interior tiles mapped out of ${tilesProcessed} total tiles`);
    console.log(`🔺 Cell center: (${cellCenterX.toFixed(1)}, ${cellCenterY.toFixed(1)}), radius: ${cellRadius.toFixed(1)}`);
    console.log(`🔺 Membrane center: (${membraneCenter.x.toFixed(1)}, ${membraneCenter.y.toFixed(1)})`);
    console.log(`🔺 Coordinate offset applied: (${coordinateOffset.x.toFixed(1)}, ${coordinateOffset.y.toFixed(1)})`);
  }
  
  /**
   * Find the best membrane triangle and compute barycentric coordinates for a tile
   */
  private findBestTriangleForTile(
    tile: HexTile, 
    membraneParticles: Phaser.Math.Vector2[], 
    membraneCenter: Phaser.Math.Vector2,
    tilePosition?: Phaser.Math.Vector2  // Optional: use this position instead of tile.worldPos
  ): BarycentricCoord {
    // Use provided position or fall back to tile's world position
    const targetPos = tilePosition || tile.worldPos;
    
    let bestTriangleIndex = 0;
    let bestDistance = Infinity;
    let bestBarycentric = { u: 0, v: 0, w: 1 };
    let foundInsideTriangle = false;
    
    // Try each membrane triangle (center + two adjacent particles)
    for (let i = 0; i < membraneParticles.length; i++) {
      const p1 = membraneCenter;  // Center point
      const p2 = membraneParticles[i];
      const p3 = membraneParticles[(i + 1) % membraneParticles.length];
      
      // Compute barycentric coordinates for this triangle
      const barycentric = this.computeBarycentricCoordinates2D(
        targetPos, p1, p2, p3
      );
      
      // Check if point is inside triangle (all coordinates positive)
      if (barycentric.u >= 0 && barycentric.v >= 0 && barycentric.w >= 0) {
        // Point is inside this triangle - use it
        foundInsideTriangle = true;
        return {
          triangleIndex: i,
          u: barycentric.u,
          v: barycentric.v,
          w: barycentric.w
        };
      }
      
      // If not inside, compute distance to triangle for fallback
      const triangleCenter = new Phaser.Math.Vector2(
        (p1.x + p2.x + p3.x) / 3,
        (p1.y + p2.y + p3.y) / 3
      );
      const distance = targetPos.distance(triangleCenter);
      
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTriangleIndex = i;
        bestBarycentric = barycentric;
      }
    }
    
    // Fallback: use closest triangle but normalize coordinates properly
    let { u, v, w } = bestBarycentric;
    
    // Clamp negative values to 0
    u = Math.max(0, u);
    v = Math.max(0, v);
    w = Math.max(0, w);
    
    // Renormalize to ensure they sum to 1
    const sum = u + v + w;
    if (sum > 0.001) { // Avoid division by zero
      u /= sum;
      v /= sum;
      w /= sum;
    } else {
      // Fallback to center-weighted coordinates
      u = 0;
      v = 0;
      w = 1;
    }
    
    // Debug problematic tiles (but only show a few to avoid spam)
    if (!foundInsideTriangle && Math.random() < 0.1) {
      console.log(`🔺 Tile outside all triangles: pos(${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}) -> triangle ${bestTriangleIndex}, bary(${u.toFixed(3)}, ${v.toFixed(3)}, ${w.toFixed(3)})`);
    }
    
    return {
      triangleIndex: bestTriangleIndex,
      u, v, w
    };
  }
  
  /**
   * Compute barycentric coordinates of point P relative to triangle (A, B, C)
   */
  private computeBarycentricCoordinates2D(
    P: Phaser.Math.Vector2,
    A: Phaser.Math.Vector2,
    B: Phaser.Math.Vector2,
    C: Phaser.Math.Vector2
  ): { u: number; v: number; w: number } {
    const v0 = C.clone().subtract(A);
    const v1 = B.clone().subtract(A);
    const v2 = P.clone().subtract(A);
    
    const dot00 = v0.dot(v0);
    const dot01 = v0.dot(v1);
    const dot02 = v0.dot(v2);
    const dot11 = v1.dot(v1);
    const dot12 = v1.dot(v2);
    
    const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    const w = 1 - u - v;
    
    return { u, v, w };
  }
  
  /**
   * NEW: Update all tile positions based on current membrane deformation
   * Call this every frame to make the hex grid follow membrane movement
   */
  public updateBarycentricPositions(): void {
    if (!this.membranePhysics) return;
    
    const membraneParticles = this.membranePhysics.getParticlePositions();
    const membraneCenter = this.membranePhysics.getCenter();
    
    // Calculate coordinate offset (from initialization time)
    const coordinateOffset = {
      x: this.gridCenter.x - membraneCenter.x,
      y: this.gridCenter.y - membraneCenter.y
    };
    
    // Update positions for membrane tiles
    const membraneTiles = Array.from(this.tiles.values()).filter(tile => tile.isMembrane);
    
    console.log(`🔺 Updating positions: ${membraneTiles.length} membrane tiles, ${membraneParticles.length} membrane particles`);
    
    // If we have more particles than tiles, we need to distribute all particles among our tiles
    // If we have more tiles than particles, use direct mapping then interpolation
    
    if (membraneParticles.length >= membraneTiles.length) {
      // More particles than tiles - distribute particles evenly among tiles
      console.log(`🔺 Using particle distribution: ${membraneParticles.length} particles -> ${membraneTiles.length} tiles`);
      
      for (let i = 0; i < membraneTiles.length; i++) {
        const tile = membraneTiles[i];
        
        // Calculate which particle this tile should use
        const particleIndex = Math.floor((i * membraneParticles.length) / membraneTiles.length);
        const particle = membraneParticles[particleIndex];
        
        // Transform membrane particle position back to world coordinates
        tile.worldPos.set(particle.x + coordinateOffset.x, particle.y + coordinateOffset.y);
        
        // Debug log for first few tiles
        if (i < 5) {
          console.log(`🔺 Tile ${i} -> particle ${particleIndex}: pos(${tile.worldPos.x.toFixed(1)}, ${tile.worldPos.y.toFixed(1)})`);
        }
      }
    } else {
      // More tiles than particles - use direct mapping then interpolation
      console.log(`🔺 Using hybrid approach: ${membraneParticles.length} particles + interpolation for ${membraneTiles.length - membraneParticles.length} additional tiles`);
      
      // First, update tiles with direct particle correspondence
      for (let i = 0; i < Math.min(membraneTiles.length, membraneParticles.length); i++) {
        const tile = membraneTiles[i];
        const particle = membraneParticles[i];
        // Transform membrane particle position back to world coordinates
        tile.worldPos.set(particle.x + coordinateOffset.x, particle.y + coordinateOffset.y);
      }
      
      // For remaining membrane tiles, interpolate between particles
      const additionalTilesCount = membraneTiles.length - membraneParticles.length;
      console.log(`🔺 Interpolating positions for ${additionalTilesCount} additional membrane tiles`);
      
      for (let i = membraneParticles.length; i < membraneTiles.length; i++) {
        const tile = membraneTiles[i];
        
        // Calculate target angle for this tile based on its original position relative to center
        const originalDx = tile.worldPos.x - this.gridCenter.x;
        const originalDy = tile.worldPos.y - this.gridCenter.y;
        const targetAngle = Math.atan2(originalDy, originalDx);
        
        // Find the two closest membrane particles to interpolate between
        const particleAngles = membraneParticles.map((particle, idx) => ({
          angle: Math.atan2(particle.y - membraneCenter.y, particle.x - membraneCenter.x),
          index: idx,
          particle
        }));
        
        // Sort by angle and find surrounding particles
        particleAngles.sort((a, b) => a.angle - b.angle);
        
        let prevParticle = particleAngles[particleAngles.length - 1]; // Last particle (wrap around)
        let nextParticle = particleAngles[0]; // First particle
        
        // Find the two particles that bracket our target angle
        for (let j = 0; j < particleAngles.length - 1; j++) {
          if (targetAngle >= particleAngles[j].angle && targetAngle <= particleAngles[j + 1].angle) {
            prevParticle = particleAngles[j];
            nextParticle = particleAngles[j + 1];
            break;
          }
        }
        
        // Handle wrap-around case (target angle between last and first particle)
        if (targetAngle > particleAngles[particleAngles.length - 1].angle || targetAngle < particleAngles[0].angle) {
          prevParticle = particleAngles[particleAngles.length - 1];
          nextParticle = particleAngles[0];
        }
        
        // Calculate interpolation factor
        let angleDiff = nextParticle.angle - prevParticle.angle;
        if (angleDiff < 0) angleDiff += 2 * Math.PI; // Handle wrap-around
        
        let targetRelative = targetAngle - prevParticle.angle;
        if (targetRelative < 0) targetRelative += 2 * Math.PI; // Handle wrap-around
        
        const t = angleDiff > 0 ? targetRelative / angleDiff : 0;
        
        // Interpolate position and radius
        const prevRadius = Math.sqrt(
          (prevParticle.particle.x - membraneCenter.x) ** 2 + 
          (prevParticle.particle.y - membraneCenter.y) ** 2
        );
        const nextRadius = Math.sqrt(
          (nextParticle.particle.x - membraneCenter.x) ** 2 + 
          (nextParticle.particle.y - membraneCenter.y) ** 2
        );
        
        const interpolatedRadius = prevRadius + t * (nextRadius - prevRadius);
        
        // Position tile at interpolated position
        const newMembraneX = membraneCenter.x + interpolatedRadius * Math.cos(targetAngle);
        const newMembraneY = membraneCenter.y + interpolatedRadius * Math.sin(targetAngle);
        
        // Transform back to world coordinates
        tile.worldPos.set(newMembraneX + coordinateOffset.x, newMembraneY + coordinateOffset.y);
        
        // Debug log for first few interpolated tiles
        if (i - membraneParticles.length < 5) {
          console.log(`🔺 Interpolated tile ${i}: targetAngle=${(targetAngle * 180 / Math.PI).toFixed(1)}° -> pos(${tile.worldPos.x.toFixed(1)}, ${tile.worldPos.y.toFixed(1)})`);
        }
      }
    }
    
    // Update positions for all interior tiles with barycentric coordinates
    let interiorTilesUpdated = 0;
    let problemTiles = [];
    
    for (const tile of this.tiles.values()) {
      if (!tile.isInterior || !tile.barycentricCoord) continue;
      
      const bary = tile.barycentricCoord;
      const triangleIndex = bary.triangleIndex;
      
      // Validate triangle index
      if (triangleIndex < 0 || triangleIndex >= membraneParticles.length) {
        problemTiles.push({
          originalPos: { x: tile.worldPos.x, y: tile.worldPos.y },
          triangleIndex,
          bary,
          issue: 'invalid triangle index'
        });
        continue;
      }
      
      // Get triangle vertices (in membrane coordinates)
      const p1 = membraneCenter;  // Center
      const p2 = membraneParticles[triangleIndex];
      const p3 = membraneParticles[(triangleIndex + 1) % membraneParticles.length];
      
      // Validate barycentric coordinates
      if (Math.abs(bary.u + bary.v + bary.w - 1.0) > 0.1) {
        problemTiles.push({
          originalPos: { x: tile.worldPos.x, y: tile.worldPos.y },
          triangleIndex,
          bary,
          issue: 'invalid barycentric sum'
        });
      }
      
      // Interpolate position using barycentric coordinates (in membrane space)
      const newMembraneX = bary.w * p1.x + bary.u * p2.x + bary.v * p3.x;
      const newMembraneY = bary.w * p1.y + bary.u * p2.y + bary.v * p3.y;
      
      // Transform back to world coordinates
      const newWorldX = newMembraneX + coordinateOffset.x;
      const newWorldY = newMembraneY + coordinateOffset.y;
      
      // Check for extreme positions relative to the world grid center
      const distanceFromGridCenter = Math.sqrt((newWorldX - this.gridCenter.x) ** 2 + (newWorldY - this.gridCenter.y) ** 2);
      const maxReasonableDistance = 300; // Adjust based on your cell size
      
      if (distanceFromGridCenter > maxReasonableDistance) {
        problemTiles.push({
          originalPos: { x: tile.worldPos.x, y: tile.worldPos.y },
          newPos: { x: newWorldX, y: newWorldY },
          triangleIndex,
          bary,
          distanceFromGridCenter,
          triangle: { p1, p2, p3 },
          coordinateOffset,
          issue: 'extreme position'
        });
        // Don't update this tile's position
        continue;
      }
      
      tile.worldPos.set(newWorldX, newWorldY);
      interiorTilesUpdated++;
    }
    
    // Debug logging (throttled)
    if (Math.random() < 0.02) { // Increased frequency for debugging
      console.log(`🔺 Barycentric update: ${membraneTiles.length} membrane tiles, ${interiorTilesUpdated} interior tiles`);
      console.log(`🔺 Membrane center: ${membraneCenter.x.toFixed(1)}, ${membraneCenter.y.toFixed(1)} | Grid center: ${this.gridCenter.x.toFixed(1)}, ${this.gridCenter.y.toFixed(1)} | Offset: ${coordinateOffset.x.toFixed(1)}, ${coordinateOffset.y.toFixed(1)}`);
      
      if (problemTiles.length > 0) {
        console.warn(`🚨 Found ${problemTiles.length} problem tiles:`, problemTiles.slice(0, 2)); // Show first 2
      }

      // Add periodic membrane tile distribution analysis
      if (membraneTiles.length > 0) {
        console.log(`🔺 Analyzing current membrane tile distribution:`);
        
        // Check positions of first few membrane tiles
        for (let i = 0; i < Math.min(8, membraneTiles.length); i++) {
          const tile = membraneTiles[i];
          const particle = membraneParticles[i];
          console.log(`  Tile ${i}: world(${tile.worldPos.x.toFixed(1)}, ${tile.worldPos.y.toFixed(1)}) particle(${particle.x.toFixed(1)}, ${particle.y.toFixed(1)})`);
        }
        
        // Analyze angle distribution relative to membrane center
        const angleDistribution = { N: 0, E: 0, S: 0, W: 0 };
        const angles = [];
        
        for (const tile of membraneTiles) {
          const dx = tile.worldPos.x - (membraneCenter.x + coordinateOffset.x);
          const dy = tile.worldPos.y - (membraneCenter.y + coordinateOffset.y);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          const normalizedAngle = ((angle + 360) % 360);
          angles.push(normalizedAngle);
          
          // Classify into quadrants
          if (normalizedAngle >= 315 || normalizedAngle < 45) angleDistribution.E++;
          else if (normalizedAngle >= 45 && normalizedAngle < 135) angleDistribution.S++;
          else if (normalizedAngle >= 135 && normalizedAngle < 225) angleDistribution.W++;
          else angleDistribution.N++;
        }
        
        console.log(`  Quadrant distribution: N:${angleDistribution.N} E:${angleDistribution.E} S:${angleDistribution.S} W:${angleDistribution.W}`);
        
        // Check for clustering (min/max angles)
        const minAngle = Math.min(...angles);
        const maxAngle = Math.max(...angles);
        const angleSpread = maxAngle - minAngle;
        console.log(`  Angle spread: ${minAngle.toFixed(1)}° to ${maxAngle.toFixed(1)}° (spread: ${angleSpread.toFixed(1)}°)`);
      }
    }
  }

  /**
   * Milestone 6 Task 8: Future-proofing hook for cell growth
   * Called when the cell boundary expands - will need to re-tag membrane tiles
   */
  public onCellGrowth(newCenterX: number, newCenterY: number, newRadius: number): void {
    // TODO: In future milestones, this will:
    // 1. Re-tag membrane tiles after boundary expansion
    // 2. Update existing transporter references
    // 3. Handle membrane protein repositioning
    console.log(`Cell growth event: new radius ${newRadius} (membrane recomputation needed)`);
    this.recomputeMembranes(newCenterX, newCenterY, newRadius);
  }

  /**
   * Get all current membrane tiles
   */
  public getMembraneTiles(): HexTile[] {
    return Array.from(this.tiles.values()).filter(tile => tile.isMembrane);
  }

  /**
   * Check if a coordinate is a membrane tile
   */
  public isMembraneCoord(coord: HexCoord): boolean {
    const tile = this.getTile(coord);
    return tile?.isMembrane ?? false;
  }

  /**
   * Main update method that should be called each frame for dynamic membrane deformation
   */
  public update(_deltaTime: number): void {
    // Update barycentric positions to make hex grid follow membrane deformation
    this.updateBarycentricPositions();
  }
}
