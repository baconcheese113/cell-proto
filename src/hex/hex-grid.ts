/*
Hex Grid System for Cell Prototype
Milestone 2: Extended hex grid with species concentration support.
*/

import Phaser from "phaser";
import { createEmptyConcentrations } from "../species/species-registry";

// Axial coordinate system for hex grid
export interface HexCoord {
  q: number;  // column
  r: number;  // row
}

// Tile data container with species concentrations
export interface HexTile {
  coord: HexCoord;
  worldPos: Phaser.Math.Vector2;
  concentrations: Record<string, number>; // Species ID -> concentration value
  
  // Milestone 6: Membrane system
  isMembrane: boolean;
  membraneIndex?: number; // Optional index for membrane growth tracking
}

// Main hex grid class
export class HexGrid {
  private tiles: Map<string, HexTile> = new Map();
  private hexSize: number;
  private gridCenter: Phaser.Math.Vector2;

  constructor(hexSize: number, centerX: number, centerY: number) {
    this.hexSize = hexSize;
    this.gridCenter = new Phaser.Math.Vector2(centerX, centerY);
  }

  // Generate tiles within a given radius
  generateTiles(radius: number): void {
    this.tiles.clear();

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
          membraneIndex: undefined
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

  // Get tile by world position (finds closest hex)
  getTileAtWorld(worldX: number, worldY: number): HexTile | undefined {
    const coord = this.worldToHex(worldX, worldY);
    return this.getTile(coord);
  }

  // Get all tiles
  getAllTiles(): HexTile[] {
    return Array.from(this.tiles.values());
  }

  // Get tile count
  getTileCount(): number {
    return this.tiles.size;
  }

  // Update grid center (for window resize)
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
  getConcentration(coord: HexCoord, speciesId: string): number {
    const tile = this.getTile(coord);
    return tile?.concentrations[speciesId] ?? 0;
  }

  /**
   * Set concentration of a species on a tile
   */
  setConcentration(coord: HexCoord, speciesId: string, value: number): void {
    const tile = this.getTile(coord);
    if (tile && tile.concentrations.hasOwnProperty(speciesId)) {
      tile.concentrations[speciesId] = Math.max(0, value); // Ensure non-negative
    }
  }

  /**
   * Add to concentration of a species on a tile
   */
  addConcentration(coord: HexCoord, speciesId: string, delta: number): void {
    const tile = this.getTile(coord);
    if (tile && tile.concentrations.hasOwnProperty(speciesId)) {
      tile.concentrations[speciesId] = Math.max(0, tile.concentrations[speciesId] + delta);
    }
  }

  /**
   * Get all concentrations for a tile
   */
  getAllConcentrations(coord: HexCoord): Record<string, number> {
    const tile = this.getTile(coord);
    return tile ? { ...tile.concentrations } : {};
  }

  /**
   * Clear all concentrations on a tile (set to zero)
   */
  clearConcentrations(coord: HexCoord): void {
    const tile = this.getTile(coord);
    if (tile) {
      for (const speciesId in tile.concentrations) {
        tile.concentrations[speciesId] = 0;
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

    console.log(`Membrane computation complete: ${membraneTiles.length} membrane tiles identified`);
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
}
