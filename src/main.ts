/*
MILESTONE 0 — FUNCTIONALITY AUDIT
Current Systems in cell-proto:

MAIN ENTRY MODULE:
Phaser game initialization - KEEP (core framework)
Scene configuration - KEEP (game scene only)
Physics configuration - KEEP (needed for movement)
Scale/resize handling - KEEP (responsive gameplay)

Status: Keep as-is - minimal and focused
*/

import Phaser from "phaser";
import { GameScene } from "./scenes/game-scene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0b0f14",
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: 960, height: 540 },
  physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: [GameScene],
});
