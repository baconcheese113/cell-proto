import Phaser from "phaser";
import { createActor, type StateFrom, type ActorRefFrom } from "xstate";
import { cellMachine } from "../state/cell-machine";
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture, makeDotTexture, makeRingTexture, makeStationTexture } from "../gfx/textures";

type Keys = Record<"W" | "A" | "S" | "D" | "ONE" | "TWO" | "R", Phaser.Input.Keyboard.Key>;
type CellState = StateFrom<typeof cellMachine>;
type CellActor = ActorRefFrom<typeof cellMachine>;

export class GameScene extends Phaser.Scene {
  private grid!: Phaser.GameObjects.Image;
  private cellSprite!: Phaser.GameObjects.Image;
  private nucleusSprite!: Phaser.GameObjects.Image;
  private ribosomeSprite!: Phaser.GameObjects.Image;
  private peroxisomeSprite!: Phaser.GameObjects.Image;

  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private ring!: Phaser.GameObjects.Image;
  private keys!: Keys;

  private cell!: CellActor;
  private lastTick = 0;

  private cellCenter = new Phaser.Math.Vector2(0, 0);
  private cellRadius = 220;
  private membraneThickness = 10;

  private col = {
    bg: 0x0b0f14, gridMinor: 0x10141d, gridMajor: 0x182131,
    cellFill: 0x0f2030, membrane: 0x2b6cb0,
    nucleusFill: 0x122742, nucleusRim: 0x3779c2,
    riboFill: 0x173a3a, riboRim: 0x39b3a6,
    peroxiFill: 0x2a1a2a, peroxiRim: 0xd07de0,
    player: 0x66ffcc, playerRing: 0xbfffe6,
    glucose: 0xffc300, aa: 0x8ef58a, nt: 0x52a7ff
  };

  constructor() { super("game"); }

  create() {
    // grid
    const view = this.scale.gameSize;
    const gridKey = makeGridTexture(this, view.width, view.height, this.col.bg, this.col.gridMinor, this.col.gridMajor);
    this.grid = this.add.image(0, 0, gridKey).setOrigin(0, 0).setDepth(0);

    // center cell
    this.cellCenter.set(view.width * 0.5, view.height * 0.5);
    const cellKey = makeCellTexture(this, this.cellRadius * 2 + this.membraneThickness * 2, this.membraneThickness, this.col.cellFill, this.col.membrane);
    this.cellSprite = this.add.image(this.cellCenter.x, this.cellCenter.y, cellKey).setDepth(1);

    // stations
    const nucleusKey = makeCellTexture(this, 180, 8, this.col.nucleusFill, this.col.nucleusRim);
    this.nucleusSprite = this.add.image(this.cellCenter.x - 80, this.cellCenter.y - 20, nucleusKey).setDepth(2);
    const riboKey = makeCellTexture(this, 140, 8, this.col.riboFill, this.col.riboRim);
    this.ribosomeSprite = this.add.image(this.cellCenter.x + 100, this.cellCenter.y + 40, riboKey).setDepth(2);
    const peroxiKey = makeCellTexture(this, 120, 8, this.col.peroxiFill, this.col.peroxiRim);
    this.peroxisomeSprite = this.add.image(this.cellCenter.x - 110, this.cellCenter.y + 80, peroxiKey).setDepth(2);

    this.add.image(this.nucleusSprite.x, this.nucleusSprite.y, makeStationTexture(this, "Nucleus")).setDepth(3).setAlpha(0.9);
    this.add.image(this.ribosomeSprite.x, this.ribosomeSprite.y, makeStationTexture(this, "Ribosome")).setDepth(3).setAlpha(0.9);
    this.add.image(this.peroxisomeSprite.x, this.peroxisomeSprite.y, makeStationTexture(this, "Peroxisome")).setDepth(3).setAlpha(0.9);

    // player
    const pkey = makeDotTexture(this, 16, this.col.player);
    this.player = this.physics.add.sprite(this.cellCenter.x, this.cellCenter.y, pkey).setDepth(4);
    this.player.setCircle(8).setMaxVelocity(200).setDamping(true).setDrag(0.9);
    const rkey = makeRingTexture(this, 22, 3, this.col.playerRing);
    this.ring = this.add.image(this.player.x, this.player.y, rkey).setDepth(3).setAlpha(0.9);

    // pickups
    this.spawnPickup(this.cellCenter.x + 170, this.cellCenter.y - 100, "glucose", this.col.glucose);
    this.spawnPickup(this.cellCenter.x - 160, this.cellCenter.y - 120, "aa", this.col.aa);
    this.spawnPickup(this.cellCenter.x + 130, this.cellCenter.y + 120, "nt", this.col.nt);

    // keys
    this.keys = {
      W: this.input.keyboard!.addKey("W"),
      A: this.input.keyboard!.addKey("A"),
      S: this.input.keyboard!.addKey("S"),
      D: this.input.keyboard!.addKey("D"),
      ONE: this.input.keyboard!.addKey("ONE"),
      TWO: this.input.keyboard!.addKey("TWO"),
      R: this.input.keyboard!.addKey("R"),
    };

    // HUD
    addHud(this);

    // XState v5: actor + subscribe
    this.cell = createActor(cellMachine);
    this.cell.subscribe((state: CellState) => {
      setHud(this, state.context); // context matches HudCtx fields now
    });
    this.cell.start();

    // initial HUD draw
    setHud(this, this.cell.getSnapshot().context);

    // resize regeneration
    this.scale.on("resize", (sz: Phaser.Structs.Size) => {
      const key = makeGridTexture(this, Math.ceil(sz.width), Math.ceil(sz.height), this.col.bg, this.col.gridMinor, this.col.gridMajor);
      this.grid.setTexture(key).setDisplaySize(sz.width, sz.height);
      this.cellCenter.set(sz.width * 0.5, sz.height * 0.5);
      this.cellSprite.setPosition(this.cellCenter.x, this.cellCenter.y);
    });
  }

  private spawnPickup(x: number, y: number, kind: "glucose" | "aa" | "nt", color: number) {
    const c = this.add.circle(x, y, 12, color).setData("kind", kind).setDepth(3);
    this.physics.add.existing(c, true);
    this.physics.add.overlap(this.player, c as any, () => {
      this.cell.send({ type: "PICKUP", kind });
      (c as any).fillColor = color ^ 0xffffff;
      this.time.delayedCall(160, () => (c as any).fillColor = color);
    });
  }

  override update(time: number) {
    // movement
    const vx = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    const vy = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);
    const v = new Phaser.Math.Vector2(vx, vy).normalize().scale(200);
    this.player.setVelocity(v.x, v.y);
    this.ring.setPosition(this.player.x, this.player.y);

    // station ranges
    const inNucleus = Phaser.Math.Distance.BetweenPoints(this.player, this.nucleusSprite) < 80;
    const inRibo    = Phaser.Math.Distance.BetweenPoints(this.player, this.ribosomeSprite) < 70;
    const inPeroxi  = Phaser.Math.Distance.BetweenPoints(this.player, this.peroxisomeSprite) < 65;

    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE) && inNucleus) this.cell.send({ type: "TRANSCRIBE" });
    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO) && inRibo)    this.cell.send({ type: "TRANSLATE" });
    if (inPeroxi) this.cell.send({ type: "DELIVER_CATALASE" });
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.cell.send({ type: "STRESS", amount: 40 });

    // tick biology at 4 Hz
    if (time - this.lastTick > 250) {
      this.cell.send({ type: "TICK", dt: 0.25 });
      this.lastTick = time;
    }
  }
}
