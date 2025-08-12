/**
 * Motility Modes Configuration
 * 
 * Defines all motility mode parameters and substrate interaction scalars.
 * This is the single source of truth for mode behavior tuning.
 */

export type MotilityModeId = 'amoeboid' | 'blebbing' | 'mesenchymal';
export type SubstrateType = 'SOFT' | 'FIRM' | 'ECM' | 'STICKY';

export interface MotilityModeParams {
  // Basic movement
  baseSpeed: number;                    // Base movement speed (hex/second)
  turnResponsiveness: number;           // Turn rate multiplier (0-2)
  
  // Adhesion dynamics
  adhesionFrontBias: number;            // Front/rear adhesion distribution (-1 to 1)
  rearReleaseRate: number;              // Rate of rear adhesion release (per second)
  adhesionBuildTime?: number;           // Time to build mature adhesions (mesenchymal only)
  
  // Mode-specific physics
  tension: number;                      // Membrane tension/rigidity (0-1)
  
  // Blebbing-specific
  blebBurstSpeed?: number;              // Speed during bleb burst
  blebDurationMs?: number;              // Duration of bleb burst (milliseconds)
  blebCooldownMs?: number;              // Cooldown between bursts (milliseconds)
  
  // Substrate traction preferences
  ecmTraction: number;                  // Effectiveness on ECM substrate
  softTraction: number;                 // Effectiveness on soft substrate
  firmTraction: number;                 // Effectiveness on firm substrate
  stickyTraction: number;               // Effectiveness on sticky substrate
  
  // Energy costs
  atpPerSec: number;                    // ATP drain per second while active
  atpPerBurst?: number;                 // ATP cost per bleb burst
  proteasePerSec?: number;              // Protease consumption (mesenchymal only)
}

export interface MotilityModeDefinition {
  id: MotilityModeId;
  name: string;
  icon: string;                         // Emoji or symbol for UI
  description: string;                  // Short description of strengths
  params: MotilityModeParams;
}

export interface SubstrateScalars {
  [modeId: string]: {
    [substrate: string]: {
      speedMultiplier: number;
      turnMultiplier: number;
      adhesionEfficiency: number;
    };
  };
}

/**
 * Default motility mode configurations
 */
export const MOTILITY_MODES: Record<MotilityModeId, MotilityModeDefinition> = {
  amoeboid: {
    id: 'amoeboid',
    name: 'Amoeboid Crawl',
    icon: '🔄',
    description: 'Fast turns, good in soft/porous spaces',
    params: {
      baseSpeed: 18.0,
      turnResponsiveness: 1.4,
      adhesionFrontBias: 0.7,
      rearReleaseRate: 3.0,
      tension: 0.4,
      ecmTraction: 0.6,
      softTraction: 1.2,
      firmTraction: 1.0,
      stickyTraction: 0.8,
      atpPerSec: 0.6
    }
  },

  blebbing: {
    id: 'blebbing',
    name: 'Blebbing Motility',
    icon: '💥',
    description: 'Burst dashes with poor steering; excels in low adhesion',
    params: {
      baseSpeed: 8.0,
      turnResponsiveness: 0.3,
      adhesionFrontBias: 0.2,
      rearReleaseRate: 1.0,
      tension: 0.1,
      blebBurstSpeed: 35.0,
      blebDurationMs: 800,
      blebCooldownMs: 2500,
      ecmTraction: 0.4,
      softTraction: 1.4,
      firmTraction: 0.8,
      stickyTraction: 0.3,
      atpPerSec: 0.2,
      atpPerBurst: 4.0
    }
  },

  mesenchymal: {
    id: 'mesenchymal',
    name: 'Mesenchymal Migration',
    icon: '🧗',
    description: 'Slow, adhesion-heavy; excels on firm ECM with protease',
    params: {
      baseSpeed: 12.0,
      turnResponsiveness: 0.6,
      adhesionFrontBias: 0.5,
      rearReleaseRate: 1.5,
      adhesionBuildTime: 2.0,
      tension: 0.8,
      ecmTraction: 1.3,
      softTraction: 0.5,
      firmTraction: 1.1,
      stickyTraction: 1.0,
      atpPerSec: 0.8,
      proteasePerSec: 0.3
    }
  }
};

/**
 * Substrate interaction scalars - how each mode performs on each substrate
 */
export const SUBSTRATE_SCALARS: SubstrateScalars = {
  amoeboid: {
    SOFT: { speedMultiplier: 1.2, turnMultiplier: 1.3, adhesionEfficiency: 0.8 },
    FIRM: { speedMultiplier: 1.0, turnMultiplier: 1.0, adhesionEfficiency: 1.0 },
    ECM: { speedMultiplier: 0.6, turnMultiplier: 0.8, adhesionEfficiency: 0.7 },
    STICKY: { speedMultiplier: 0.8, turnMultiplier: 1.2, adhesionEfficiency: 1.1 }
  },
  
  blebbing: {
    SOFT: { speedMultiplier: 1.4, turnMultiplier: 0.7, adhesionEfficiency: 0.3 },
    FIRM: { speedMultiplier: 0.8, turnMultiplier: 0.5, adhesionEfficiency: 0.6 },
    ECM: { speedMultiplier: 0.4, turnMultiplier: 0.3, adhesionEfficiency: 0.2 },
    STICKY: { speedMultiplier: 0.3, turnMultiplier: 0.2, adhesionEfficiency: 0.1 }
  },
  
  mesenchymal: {
    SOFT: { speedMultiplier: 0.5, turnMultiplier: 0.6, adhesionEfficiency: 0.4 },
    FIRM: { speedMultiplier: 1.1, turnMultiplier: 1.0, adhesionEfficiency: 1.2 },
    ECM: { speedMultiplier: 1.3, turnMultiplier: 0.9, adhesionEfficiency: 1.4 },
    STICKY: { speedMultiplier: 1.0, turnMultiplier: 0.8, adhesionEfficiency: 1.3 }
  }
};

/**
 * Preset configurations for different difficulty levels
 */
export const MOTILITY_PRESETS = {
  simulation: {
    name: 'Simulation',
    description: 'Realistic cell physics with energy constraints',
    scalars: {
      speedScale: 0.8,
      atpScale: 1.2,
      adhesionScale: 1.0
    }
  },
  
  arcade: {
    name: 'Arcade',
    description: 'Faster, more responsive for gameplay',
    scalars: {
      speedScale: 1.3,
      atpScale: 0.7,
      adhesionScale: 0.8
    }
  },
  
  competitive: {
    name: 'Competitive',
    description: 'Balanced for skilled play',
    scalars: {
      speedScale: 1.1,
      atpScale: 1.0,
      adhesionScale: 1.1
    }
  }
};

/**
 * Apply preset scaling to a mode definition
 */
export function applyPresetToMode(
  mode: MotilityModeDefinition, 
  preset: keyof typeof MOTILITY_PRESETS
): MotilityModeDefinition {
  const presetData = MOTILITY_PRESETS[preset];
  const scaledParams = { ...mode.params };
  
  scaledParams.baseSpeed *= presetData.scalars.speedScale;
  if (scaledParams.blebBurstSpeed) {
    scaledParams.blebBurstSpeed *= presetData.scalars.speedScale;
  }
  
  scaledParams.atpPerSec *= presetData.scalars.atpScale;
  if (scaledParams.atpPerBurst) {
    scaledParams.atpPerBurst *= presetData.scalars.atpScale;
  }
  
  scaledParams.adhesionFrontBias *= presetData.scalars.adhesionScale;
  scaledParams.rearReleaseRate *= presetData.scalars.adhesionScale;
  
  return {
    ...mode,
    params: scaledParams
  };
}
