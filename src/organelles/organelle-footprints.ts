// Organelle footprint definitions for multi-hex placement
import type { HexCoord } from "../hex/hex-grid";

// Use the standardized HexCoord type instead of duplicate HexCoordinate
export interface OrganelleFootprint {
  name: string;
  tiles: HexCoord[];
  // Center offset relative to the primary tile (usually 0,0)
  centerOffset: HexCoord;
}

// Predefined footprint shapes
export const ORGANELLE_FOOTPRINTS: Record<string, OrganelleFootprint> = {
  // Single hex for basic organelles
  SINGLE: {
    name: "Single Hex",
    tiles: [{ q: 0, r: 0 }],
    centerOffset: { q: 0, r: 0 }
  },

  // Large disk shape for nucleus (7 hexes in flower pattern)
  NUCLEUS_LARGE_DISK: {
    name: "Large Disk",
    tiles: [
      { q: 0, r: 0 },   // center
      { q: 1, r: 0 },   // right
      { q: 0, r: 1 },   // bottom-right
      { q: -1, r: 1 },  // bottom-left
      { q: -1, r: 0 },  // left
      { q: 0, r: -1 },  // top-left
      { q: 1, r: -1 }   // top-right
    ],
    centerOffset: { q: 0, r: 0 }
  },

  // Small cluster for ribosome hub (3 hexes in line)
  RIBOSOME_HUB_SMALL: {
    name: "Small Hub",
    tiles: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: -1, r: 0 }
    ],
    centerOffset: { q: 0, r: 0 }
  },

  // Elongated blob for proto-ER (5 hexes in cross)
  PROTO_ER_BLOB: {
    name: "ER Blob",
    tiles: [
      { q: 0, r: 0 },   // center
      { q: 1, r: 0 },   // right
      { q: -1, r: 0 },  // left
      { q: 0, r: 1 },   // bottom-right
      { q: 0, r: -1 }   // top-left
    ],
    centerOffset: { q: 0, r: 0 }
  },

  // Medium disk for larger organelles (4 hexes in diamond)
  MEDIUM_DISK: {
    name: "Medium Disk",
    tiles: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 0 }
    ],
    centerOffset: { q: 0, r: 0 }
  }
};

// Helper functions for footprint operations
export function getFootprintTiles(footprint: OrganelleFootprint, centerQ: number, centerR: number): HexCoord[] {
  return footprint.tiles.map(tile => ({
    q: centerQ + tile.q,
    r: centerR + tile.r
  }));
}

export function isFootprintValidAt(
  footprint: OrganelleFootprint, 
  centerQ: number, 
  centerR: number, 
  occupied: Set<string>,
  cellRadius: number = 8
): boolean {
  const tiles = getFootprintTiles(footprint, centerQ, centerR);
  
  for (const tile of tiles) {
    // Check if tile is within cell bounds (approximate circle)
    const distance = Math.sqrt(tile.q * tile.q + tile.r * tile.r + tile.q * tile.r);
    if (distance >= cellRadius) {
      return false;
    }
    
    // Check if tile is already occupied
    const key = `${tile.q},${tile.r}`;
    if (occupied.has(key)) {
      return false;
    }
  }
  
  return true;
}

export function getFootprintCenter(footprint: OrganelleFootprint, placementQ: number, placementR: number): HexCoord {
  return {
    q: placementQ + footprint.centerOffset.q,
    r: placementR + footprint.centerOffset.r
  };
}
