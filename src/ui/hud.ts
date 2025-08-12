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
  };
  // Milestone 9: Drive mode status
  driveMode?: boolean;
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
  }
  
  hudText!.setText(controls + message + driveStatus + motilityInfo);
}
