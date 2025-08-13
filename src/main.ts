import Phaser from "phaser";
import { GameScene } from "./scenes/game-scene";
import { MotilityCourseScene } from "./scenes/motility-course-scene";

// Prevent right-click context menu on the game canvas
document.addEventListener('contextmenu', (e) => {
  if (e.target instanceof HTMLCanvasElement) {
    e.preventDefault();
  }
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0b0f14",
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: 960, height: 540 },
  physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: [GameScene, MotilityCourseScene],
});
