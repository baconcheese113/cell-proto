import Phaser from "phaser";

export type HudCtx = {
  message?: string;
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

  const controls = "WASD: Move  |  SPACE: Dash  |  G: Toggle Hex Grid  |  Movement Prototype";
  const message = ctx.message ? `\n${ctx.message}` : "";
  
  hudText!.setText(controls + message);
}
