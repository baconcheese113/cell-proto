import Phaser from "phaser";

export type HudCtx = {
  message?: string;
  // Milestone 9: Motility information
  motilityInfo?: {
    speed: number;
    adhesionCount: number;
    atpDrain: number;
    mode: string;
    substrate: string;
    dashCooldown: number;
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

  const controls = "WASD: Move  |  SPACE: Dash  |  T: Toggle Drive Mode  |  G: Toggle Hex Grid  |  K: Add ATP";
  const message = ctx.message ? `\n${ctx.message}` : "";
  
  // Milestone 9: Drive mode indicator
  let driveStatus = "";
  if (ctx.driveMode !== undefined) {
    driveStatus = `\n🚗 Drive: ${ctx.driveMode ? 'ON' : 'OFF'}`;
  }
  
  // Milestone 9: Add motility information
  let motilityInfo = "";
  if (ctx.motilityInfo) {
    const info = ctx.motilityInfo;
    motilityInfo = `\n\n🏃 Motion: ${info.mode.toUpperCase()} | Speed: ${info.speed.toFixed(1)}`;
    motilityInfo += `\n🔗 Adhesion: ${Math.round(info.adhesionCount)} | Substrate: ${info.substrate}`;
    motilityInfo += `\n⚡ ATP Drain: ${info.atpDrain.toFixed(2)}/sec`;
    if (info.dashCooldown > 0) {
      motilityInfo += ` | Dash CD: ${info.dashCooldown.toFixed(1)}s`;
    }
  }
  
  hudText!.setText(controls + message + driveStatus + motilityInfo);
}
