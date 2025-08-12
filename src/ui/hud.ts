import Phaser from "phaser";

export type HudCtx = {
  message?: string;
  // Milestone 10: Enhanced motility information
  motilityInfo?: {
    speed: number;
    adhesionCount: number;
    atpDrain: number;
    mode: string;
    substrate: string;
    // New fields for motility modes
    currentMotilityMode?: {
      id: string;
      name: string;
      icon: string;
    };
    modeState?: {
      blebCooldown?: number;
      adhesionMaturity?: number;
      proteaseActive?: boolean;
      handbrakeAvailable?: boolean;
    };
    substrateEffects?: {
      speedMultiplier: number;
      turnMultiplier: number;
      adhesionEfficiency: number;
    };
    // V2: State meters
    stateMeters?: {
      pulse?: number;              // 0-1, amoeboid pulse energy
      pressure?: number;           // 0-1, blebbing pressure
      leftMaturity?: number;       // 0-1, left adhesion maturity
      rightMaturity?: number;      // 0-1, right adhesion maturity
      trackStrength?: number;      // 0-1, protease track strength
      chainWindow?: number;        // 0-1, chain timing window progress
    };
    // V2: Action availability
    actionStates?: {
      blebBurst?: boolean;
      proteaseToggle?: boolean;
      handbrake?: boolean;
      pseudopodLobe?: boolean;
    };
    // V2: Visual effects for readability
    visualEffects?: {
      membraneState: 'normal' | 'extending' | 'retracting' | 'blebbing';
      pulse: {
        active: boolean;
        intensity: number;
        color: string;
      };
      trail: {
        active: boolean;
        type: 'adhesion' | 'protease' | 'cytoplasm';
        opacity: number;
      };
      animation: {
        phase: number;
        speed: number;
      };
    };
  };
  // Milestone 9: Drive mode status
  driveMode?: boolean;
  // V2: Debug mode
  debugMode?: boolean;
};

let hudText: Phaser.GameObjects.Text | null = null;

export function addHud(scene: Phaser.Scene) {
  hudText?.destroy(); 
  hudText = null;

  hudText = scene.add.text(14, 12, "", {
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#cfe",
    align: "left",
  }).setDepth(1000).setScrollFactor(0);
}

export function setHud(scene: Phaser.Scene, ctx: HudCtx) {
  if (!hudText) addHud(scene);

  const controls = "WASD: Move  |  TAB: Cycle Mode  |  SPACE: Mode Action  |  T: Toggle Drive Mode  |  G: Toggle Hex Grid  |  K: Add ATP";
  const message = ctx.message ? `\n${ctx.message}` : "";
  
  // Drive mode indicator
  let driveStatus = "";
  if (ctx.driveMode !== undefined) {
    driveStatus = `\n🚗 Drive: ${ctx.driveMode ? 'ON' : 'OFF'}`;
  }
  
  // Enhanced motility information
  let motilityInfo = "";
  if (ctx.motilityInfo) {
    const info = ctx.motilityInfo;
    
    // Current motility mode
    if (info.currentMotilityMode) {
      motilityInfo += `\n\n${info.currentMotilityMode.icon} Mode: ${info.currentMotilityMode.name}`;
    }
    
    // Basic motion info
    motilityInfo += `\n🏃 Motion: ${info.mode.toUpperCase()} | Speed: ${info.speed.toFixed(1)}`;
    motilityInfo += `\n🔗 Adhesion: ${Math.round(info.adhesionCount)} | Substrate: ${info.substrate}`;
    
    // Substrate effects
    if (info.substrateEffects) {
      const effects = info.substrateEffects;
      motilityInfo += `\n📊 Effects: Speed ${(effects.speedMultiplier * 100).toFixed(0)}% | Turn ${(effects.turnMultiplier * 100).toFixed(0)}% | Grip ${(effects.adhesionEfficiency * 100).toFixed(0)}%`;
    }
    
    motilityInfo += `\n⚡ ATP Drain: ${info.atpDrain.toFixed(2)}/sec`;
    
    // Mode-specific state
    if (info.modeState) {
      const state = info.modeState;
      
      if (state.blebCooldown !== undefined && state.blebCooldown > 0) {
        motilityInfo += ` | Bleb CD: ${state.blebCooldown.toFixed(1)}s`;
      }
      
      if (state.adhesionMaturity !== undefined) {
        motilityInfo += ` | Adhesion: ${(state.adhesionMaturity * 100).toFixed(0)}%`;
      }
      
      if (state.proteaseActive !== undefined) {
        motilityInfo += ` | Protease: ${state.proteaseActive ? 'ON' : 'OFF'}`;
      }
      
      if (state.handbrakeAvailable !== undefined && !state.handbrakeAvailable) {
        motilityInfo += ` | Handbrake: COOLDOWN`;
      }
    }

    // V2: State meters display
    if (info.stateMeters && ctx.debugMode) {
      const meters = info.stateMeters;
      motilityInfo += `\n📊 State Meters:`;
      
      if (meters.pulse !== undefined) {
        const pulseBar = generateProgressBar(meters.pulse, 10);
        motilityInfo += `\n  🎯 Pulse: ${pulseBar} ${(meters.pulse * 100).toFixed(0)}%`;
      }
      
      if (meters.pressure !== undefined) {
        const pressureBar = generateProgressBar(meters.pressure, 10);
        motilityInfo += `\n  💨 Pressure: ${pressureBar} ${(meters.pressure * 100).toFixed(0)}%`;
      }
      
      if (meters.leftMaturity !== undefined && meters.rightMaturity !== undefined) {
        const leftBar = generateProgressBar(meters.leftMaturity, 5);
        const rightBar = generateProgressBar(meters.rightMaturity, 5);
        motilityInfo += `\n  🔗 L:${leftBar} R:${rightBar}`;
      }
      
      if (meters.trackStrength !== undefined) {
        const trackBar = generateProgressBar(meters.trackStrength, 10);
        motilityInfo += `\n  🛤️  Track: ${trackBar} ${(meters.trackStrength * 100).toFixed(0)}%`;
      }
      
      if (meters.chainWindow !== undefined && meters.chainWindow > 0) {
        const chainBar = generateProgressBar(meters.chainWindow, 8);
        motilityInfo += `\n  ⛓️  Chain: ${chainBar}`;
      }
    }
    
    // V2: Visual effects display (always shown for readability feedback)
    if (info.visualEffects) {
      const vfx = info.visualEffects;
      motilityInfo += `\n🎬 Visual Mode:`;
      
      // Membrane state indicator
      let membraneIcon = '⚪';
      switch (vfx.membraneState) {
        case 'extending': membraneIcon = '🟢'; break;
        case 'retracting': membraneIcon = '🔴'; break;
        case 'blebbing': membraneIcon = '🔵'; break;
      }
      motilityInfo += ` ${membraneIcon} ${vfx.membraneState}`;
      
      // Active pulse indicator
      if (vfx.pulse.active) {
        const intensity = Math.round(vfx.pulse.intensity * 100);
        motilityInfo += ` ✨${intensity}%`;
      }
      
      // Trail indicator
      if (vfx.trail.active) {
        const trailIcon = vfx.trail.type === 'protease' ? '🧪' : 
                         vfx.trail.type === 'adhesion' ? '🔗' : '💫';
        const opacity = Math.round(vfx.trail.opacity * 100);
        motilityInfo += ` ${trailIcon}${opacity}%`;
      }
    }

    // V2: Action availability indicators
    if (info.actionStates) {
      const actions = info.actionStates;
      let actionLine = "\n🎮 Actions: ";
      
      if (actions.blebBurst !== undefined) {
        actionLine += `SPACE${actions.blebBurst ? '✓' : '✗'} `;
      }
      if (actions.handbrake !== undefined) {
        actionLine += `Z${actions.handbrake ? '✓' : '✗'} `;
      }
      if (actions.proteaseToggle !== undefined) {
        actionLine += `X${actions.proteaseToggle ? '✓' : '✗'} `;
      }
      if (actions.pseudopodLobe !== undefined) {
        actionLine += `Hold-Mode${actions.pseudopodLobe ? '✓' : '✗'} `;
      }
      
      motilityInfo += actionLine;
    }
  }
  
  hudText!.setText(controls + message + driveStatus + motilityInfo);
}

/**
 * Generate a simple ASCII progress bar
 */
function generateProgressBar(value: number, length: number): string {
  const filled = Math.round(value * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
