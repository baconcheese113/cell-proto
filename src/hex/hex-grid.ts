/*
Hex Grid System for Cell Prototype
Milestone 1: Lightweight hex grid with axial coordinates, world positioning, 
and data containers ready for species in Milestone 2.
*/

import Phaser from "phaser";

// Axial coordinate system for hex grid
export interface HexCoord {
  q: number;  // column
  r: number;  // row
}

// Tile data container - will hold species data in Milestone 2
export interface HexTile {
  coord: HexCoord;
  worldPos: Phaser.Math.Vector2;
  data: Record<string, any>; // Will hold species counts in Milestone 2
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
          data: {} // Empty for now, will hold species in Milestone 2
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
}
