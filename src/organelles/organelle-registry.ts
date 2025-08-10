/**
 * Centralized Organelle Registry
 * 
 * Single source of truth for all organelle definitions to eliminate duplication
 * across game-scene.ts, organelle-system.ts, and construction-recipes.ts
 */

import type { HexCoord } from "../hex/hex-grid";
import { ORGANELLE_FOOTPRINTS } from "./organelle-footprints";

export interface OrganelleDefinition {
  // Basic properties
  id: string;
  type: string;
  label: string;
  
  // Visual properties
  color: number;
  size: number;
  
  // Spatial properties
  footprint: string; // Reference to ORGANELLE_FOOTPRINTS key
  
  // Functional properties
  throughputCap: number;
  priority: number;
  
  // Construction properties
  buildCost: Record<string, number>; // species ID -> amount needed
  buildRatePerTick: number;
  
  // Placement info for starter organelles
  starterPlacement?: {
    coord: HexCoord;
    instanceId: string;
  };
}

/**
 * Central registry of all organelle types
 */
export const ORGANELLE_REGISTRY: Record<string, OrganelleDefinition> = {
  'nucleus': {
    id: 'nucleus',
    type: 'nucleus',
    label: 'Nucleus',
    color: 0x3779c2,
    size: 1.2,
    footprint: 'NUCLEUS_LARGE_DISK',
    throughputCap: 5,
    priority: 1,
    buildCost: {}, // Empty build cost = not buildable
    buildRatePerTick: 0.3,
    starterPlacement: {
      coord: { q: -2, r: 1 },
      instanceId: 'nucleus-1'
    }
  },

  'ribosome-hub': {
    id: 'ribosome-hub',
    type: 'ribosome-hub',
    label: 'Ribosome Hub',
    color: 0x39b3a6,
    size: 1.0,  // Relative size multiplier
    footprint: 'RIBOSOME_HUB_SMALL',
    throughputCap: 3,
    priority: 2,
    buildCost: { 'AA': 15, 'PRE_MRNA': 8 },
    buildRatePerTick: 0.5,
    starterPlacement: {
      coord: { q: 2, r: -1 },
      instanceId: 'ribosome-hub-1'
    }
  },

  'proto-er': {
    id: 'proto-er',
    type: 'proto-er',
    label: 'Proto-ER',
    color: 0xd07de0,
    size: 0.8,
    footprint: 'PROTO_ER_BLOB',
    throughputCap: 2,
    priority: 3,
    buildCost: { 'PROTEIN': 45 },
    buildRatePerTick: 0.4,
    starterPlacement: {
      coord: { q: -1, r: 3 },
      instanceId: 'proto-er-1'
    }
  },

  'golgi': {
    id: 'golgi',
    type: 'golgi',
    label: 'Golgi Patch',
    color: 0xf5a623,
    size: 0.5,
    footprint: 'MEDIUM_DISK',
    throughputCap: 20,
    priority: 4,
    buildCost: { 'PROTEIN': 35, 'CARGO': 15 },
    buildRatePerTick: 0.6
  },

  'peroxisome': {
    id: 'peroxisome',
    type: 'peroxisome',
    label: 'Peroxisome',
    color: 0x7ed321,
    size: 0.4,
    footprint: 'RIBOSOME_HUB_SMALL',
    throughputCap: 18,
    priority: 2,
    buildCost: { 'PROTEIN': 30 },
    buildRatePerTick: 0.7
  }
};

/**
 * Get organelle definition by type
 */
export function getOrganelleDefinition(type: string): OrganelleDefinition | undefined {
  return ORGANELLE_REGISTRY[type];
}

/**
 * Get all organelle definitions
 */
export function getAllOrganelleDefinitions(): OrganelleDefinition[] {
  return Object.values(ORGANELLE_REGISTRY);
}

/**
 * Get buildable organelle definitions (those with build costs)
 */
export function getBuildableOrganelleDefinitions(): OrganelleDefinition[] {
  return getAllOrganelleDefinitions().filter(def => Object.keys(def.buildCost).length > 0);
}

/**
 * Get starter organelle definitions (those with starter placements)
 */
export function getStarterOrganelleDefinitions(): OrganelleDefinition[] {
  return getAllOrganelleDefinitions().filter(def => def.starterPlacement);
}

/**
 * Convert organelle definition to config format for organelle system
 */
export function definitionToConfig(definition: OrganelleDefinition, instanceId?: string): any {
  return {
    id: instanceId || `${definition.type}-${Date.now()}`,
    type: definition.type,
    label: definition.label,
    color: definition.color,
    size: definition.size,
    footprint: definition.footprint,
    throughputCap: definition.throughputCap,
    priority: definition.priority
  };
}

/**
 * Get footprint shape for construction recipes
 */
export function getFootprintShape(footprintKey: string): HexCoord[] {
  const footprintShapes: Record<string, HexCoord[]> = {
    'SINGLE': [{ q: 0, r: 0 }],
    'RIBOSOME_HUB_SMALL': [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: -1, r: 0 }
    ],
    'PROTO_ER_BLOB': [
      { q: 0, r: 0 },   // center
      { q: 1, r: 0 },   // right
      { q: -1, r: 0 },  // left
      { q: 0, r: 1 },   // bottom-right
      { q: 0, r: -1 },  // top-left
      { q: 1, r: -1 }   // top-right (6 tiles total)
    ],
    'MEDIUM_DISK': [
      { q: 0, r: 0 },   // center
      { q: 1, r: 0 },   // right
      { q: 0, r: 1 },   // bottom-right
      { q: -1, r: 0 }   // left (4 tiles in diamond)
    ],
    'NUCLEUS_LARGE_DISK': [
      { q: 0, r: 0 },   // center
      { q: 1, r: 0 },   // right
      { q: 0, r: 1 },   // bottom-right
      { q: -1, r: 1 },  // bottom-left
      { q: -1, r: 0 },  // left
      { q: 0, r: -1 },  // top-left
      { q: 1, r: -1 }   // top-right
    ]
  };
  
  return footprintShapes[footprintKey] || [{ q: 0, r: 0 }];
}
