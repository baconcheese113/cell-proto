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
  
  // V2: Blebbing chain mechanics
  blebChainWindowMs?: number;           // Timing window for chain bursts (milliseconds)
  blebChainCostMultiplier?: number;     // Cost multiplier for chained bursts (0-1)
  blebRefractoryMs?: number;            // Steering penalty duration after missed chain (milliseconds)
  blebRefractorySteeringPenalty?: number; // Turn rate penalty during refractory (0-1)
  
  // V2: Amoeboid pseudopod mechanics
  amoeboidPulseRegenRate?: number;      // Pulse regeneration per second while coasting
  amoeboidPulseMaxBank?: number;        // Maximum stored pulse energy
  amoeboidLobeForce?: number;           // Force applied by pseudopod lobe
  amoeboidLobeAngle?: number;           // Angle range for lobe aiming (radians)
  amoeboidHandbrakeForce?: number;      // Rear tension force for handbrake
  amoeboidHandbrakeDuration?: number;   // Duration of handbrake effect (seconds)
  
  // V2: Mesenchymal track mechanics
  mesenchymalMaturityTime?: number;     // Time to reach full adhesion maturity (seconds)
  mesenchymalMaturitySpeedMin?: number; // Speed at 0% maturity (0-1 of baseSpeed)
  mesenchymalMaturitySpeedMax?: number; // Speed at 100% maturity (0-1.5 of baseSpeed)
  mesenchymalTurnThreshold?: number;    // Turn rate that triggers anchor drop (rad/s)
  mesenchymalTrackDuration?: number;    // How long protease tracks persist (seconds)
  mesenchymalTrackStrength?: number;    // Initial track effectiveness (0-1)
  mesenchymalTrackDecayRate?: number;   // Track strength decay per use/second
  
  // Substrate traction preferences
  ecmTraction: number;                  // Effectiveness on ECM substrate
  softTraction: number;                 // Effectiveness on soft substrate
  firmTraction: number;                 // Effectiveness on firm substrate
  stickyTraction: number;               // Effectiveness on sticky substrate
  
  // Energy costs
  atpPerSec: number;                    // ATP drain per second while active
  atpPerBurst?: number;                 // ATP cost per bleb burst
  proteasePerSec?: number;              // Protease consumption (mesenchymal only)
  
  // V2: Dynamic energy curves
  atpIdleMultiplier?: number;           // ATP multiplier when not moving (0-1)
  atpHighSpeedMultiplier?: number;      // ATP multiplier at max speed (1-2)
  atpChainPenalty?: number;             // Additional ATP cost per burst in chain
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
      atpPerSec: 0.6,
      // V2: Pseudopod aiming mechanics
      amoeboidPulseRegenRate: 2.0,
      amoeboidPulseMaxBank: 10.0,
      amoeboidLobeForce: 15.0,
      amoeboidLobeAngle: Math.PI / 3,  // 60 degree aim cone
      amoeboidHandbrakeForce: 8.0,
      amoeboidHandbrakeDuration: 0.4,
      atpIdleMultiplier: 0.3,
      atpHighSpeedMultiplier: 1.5
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
      atpPerBurst: 4.0,
      // V2: Chain rhythm mechanics
      blebChainWindowMs: 300,
      blebChainCostMultiplier: 0.9,
      blebRefractoryMs: 1200,
      blebRefractorySteeringPenalty: 0.4,
      atpIdleMultiplier: 0.1,
      atpChainPenalty: 1.2
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
      proteasePerSec: 0.3,
      // V2: Adhesion maturity and track mechanics
      mesenchymalMaturityTime: 2.0,
      mesenchymalMaturitySpeedMin: 0.3,
      mesenchymalMaturitySpeedMax: 1.0,
      mesenchymalTurnThreshold: 0.8,
      mesenchymalTrackDuration: 15.0,
      mesenchymalTrackStrength: 0.7,
      mesenchymalTrackDecayRate: 0.1,
      atpIdleMultiplier: 0.8,
      atpHighSpeedMultiplier: 1.2
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

/**
 * Debug configuration for state meter visibility
 */
export interface MotilityDebugConfig {
  showMeters: boolean;
  showAllValues: boolean;
  enableTelemetry: boolean;
  logInterval: number; // seconds
}

export const DEFAULT_DEBUG_CONFIG: MotilityDebugConfig = {
  showMeters: false,
  showAllValues: false,
  enableTelemetry: false,
  logInterval: 5.0
};

/**
 * Telemetry data structure for mode performance tracking
 */
export interface MotilityTelemetry {
  sessionId: string;
  timestamp: number;
  mode: MotilityModeId;
  
  // Performance metrics
  avgSpeed: number;
  maxSpeed: number;
  atpEfficiency: number;  // distance/atp
  
  // Mode-specific metrics
  amoeboid?: {
    pulseUtilization: number;      // 0-1, how much pulse was used
    handbrakeUsage: number;        // times used per minute
    lobeAccuracy: number;          // 0-1, aiming effectiveness
  };
  
  blebbing?: {
    chainSuccessRate: number;      // 0-1, successful chains vs attempts
    refractoryTime: number;        // total seconds in refractory
    burstEfficiency: number;       // distance per burst
  };
  
  mesenchymal?: {
    avgAdhesionMaturity: number;   // 0-1, average maturity maintained
    anchorDropCount: number;       // times anchors were dropped
    trackReuseCount: number;       // times tracks were reused
  };
}
