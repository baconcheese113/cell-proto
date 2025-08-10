/*
MILESTONE 0 — FUNCTIONALITY AUDIT
Current Systems in cell-proto:

HUD MODULE:
Resource displays (ATP, AA, NT, mRNA, etc.) - REMOVE
Objectives panel - REMOVE
Cooldown displays - REMOVE
Stress/HP meters - REMOVE
Complex HUD context types - REMOVE

Target: Replace with minimal movement controls display only
Status: Major simplification needed - only show "WASD to move, SPACE to dash"
*/

import Phaser from "phaser";

// Simplified HUD context - only needs message for prototype feedback
export type HudCtx = {
  message?: string;
};

let hudText: Phaser.GameObjects.Text | null = null;

export function addHud(scene: Phaser.Scene) {
  hudText?.destroy(); 
  hudText = null;

  // Simple controls display
  hudText = scene.add.text(14, 12, "", {
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#cfe",
    align: "left",
  }).setDepth(1000).setScrollFactor(0);
}

export function setHud(scene: Phaser.Scene, ctx: HudCtx) {
  if (!hudText) addHud(scene);

  const controls = "WASD: Move  |  SPACE: Dash  |  Movement Prototype";
  const message = ctx.message ? `\n${ctx.message}` : "";
  
  hudText!.setText(controls + message);
}
