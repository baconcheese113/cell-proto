import Phaser from "phaser";
import { GameScene } from "./scenes/game-scene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0b0f14",
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: 960, height: 540 },
  physics: { default: "matter", matter: { gravity: { x: 0, y: 0 }, enableSleeping: false } },
  scene: [GameScene],
});
