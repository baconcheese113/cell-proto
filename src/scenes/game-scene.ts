import Phaser from "phaser";
import { createActor, type StateFrom, type ActorRefFrom } from "xstate";
import { cellMachine } from "../state/cell-machine";
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture, makeDotTexture, makeRingTexture, makeStationTexture } from "../gfx/textures";

type Keys = Record<"W" | "A" | "S" | "D" | "ONE" | "TWO" | "R" | "ENTER" | "SPACE", Phaser.Input.Keyboard.Key>;
type CellState = StateFrom<typeof cellMachine>;
type CellActor = ActorRefFrom<typeof cellMachine>;

export class GameScene extends Phaser.Scene {
  private grid!: Phaser.GameObjects.Image;
  private cellSprite!: Phaser.GameObjects.Image;
  private nucleusSprite!: Phaser.GameObjects.Image;
  private ribosomeSprite!: Phaser.GameObjects.Image;
  private peroxisomeSprite!: Phaser.GameObjects.Image;
  private chaperoneSprite!: Phaser.GameObjects.Image;

  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private ring!: Phaser.GameObjects.Image;
  private keys!: Keys;

  private cell!: CellActor;
  private lastTick = 0;

  private cellCenter = new Phaser.Math.Vector2(0, 0);
  private cellRadius = 220;
  private membraneThickness = 10;

  // Station labels and glow effects
  private nucleusLabel!: Phaser.GameObjects.Text;
  private ribosomeLabel!: Phaser.GameObjects.Text;
  private peroxisomeLabel!: Phaser.GameObjects.Text;
  private chaperoneLabel!: Phaser.GameObjects.Text;
  private nucleusGlow!: Phaser.GameObjects.Image;
  private ribosomeGlow!: Phaser.GameObjects.Image;
  private peroxisomeGlow!: Phaser.GameObjects.Image;
  private chaperoneGlow!: Phaser.GameObjects.Image;

  // Cooldown bars above player
  private transcribeCooldownBar!: Phaser.GameObjects.Rectangle;
  private translateCooldownBar!: Phaser.GameObjects.Rectangle;
  private transcribeCooldownBg!: Phaser.GameObjects.Rectangle;
  private translateCooldownBg!: Phaser.GameObjects.Rectangle;

  // Feedback system
  private currentMessage = "";
  private messageTimer = 0;

  // Game state management
  private gameState: "playing" | "dead" | "won" = "playing";
  private waveTimer = 30; // 30 seconds between waves
  private overlay!: Phaser.GameObjects.Container;
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayText!: Phaser.GameObjects.Text;
  private pulseOverlay!: Phaser.GameObjects.Rectangle;

  // Contextual tooltips
  private contextTooltip!: Phaser.GameObjects.Text;
  private contextTooltipBg!: Phaser.GameObjects.Rectangle;

  // Movement and dash mechanics
  private dashCooldown = 0;
  private maxDashCooldown = 1.2; // Slightly shorter cooldown for more responsive feel
  private dashSpeed = 320; // More balanced dash speed
  private normalMaxSpeed = 120; // Increased base speed for better navigation
  private acceleration = 600; // Smoother acceleration
  private isDashing = false;
  private dashDuration = 0.25; // Slightly shorter dash for snappiness
  private dashTimer = 0;
  private dashCooldownBar!: Phaser.GameObjects.Rectangle;
  private dashCooldownBg!: Phaser.GameObjects.Rectangle;

  // Elastic world mechanics
  private membraneSpringForce = 400; // Stronger membrane push-back
  private cameraLerpSpeed = 0.08; // Slightly more responsive camera
  private cameraSmoothTarget = new Phaser.Math.Vector2(0, 0);
  private lastMembraneHit = 0;

  private col = {
    bg: 0x0b0f14, gridMinor: 0x10141d, gridMajor: 0x182131,
    cellFill: 0x0f2030, membrane: 0x2b6cb0,
    nucleusFill: 0x122742, nucleusRim: 0x3779c2,
    riboFill: 0x173a3a, riboRim: 0x39b3a6,
    peroxiFill: 0x2a1a2a, peroxiRim: 0xd07de0,
    chaperoneFill: 0x2a3a1a, chaperoneRim: 0x88cc44,
    player: 0x66ffcc, playerRing: 0xbfffe6,
    glucose: 0xffc300, aa: 0x8ef58a, nt: 0x52a7ff
  };

  constructor() { super("game"); }

  create() {
    // grid - make it large enough to cover camera movement
    const view = this.scale.gameSize;
    const gridSize = Math.max(view.width, view.height) * 2; // Make grid 2x larger than viewport
    const gridKey = makeGridTexture(this, gridSize, gridSize, this.col.bg, this.col.gridMinor, this.col.gridMajor);
    this.grid = this.add.image(0, 0, gridKey).setOrigin(0.5, 0.5).setDepth(0);
    
    // Center the grid at the world center
    this.grid.setPosition(view.width * 0.5, view.height * 0.5);

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
    const chaperoneKey = makeCellTexture(this, 100, 8, this.col.chaperoneFill, this.col.chaperoneRim);
    this.chaperoneSprite = this.add.image(this.cellCenter.x + 120, this.cellCenter.y - 60, chaperoneKey).setDepth(2);

    this.add.image(this.nucleusSprite.x, this.nucleusSprite.y, makeStationTexture(this, "Nucleus")).setDepth(3).setAlpha(0.9);
    this.add.image(this.ribosomeSprite.x, this.ribosomeSprite.y, makeStationTexture(this, "Ribosome")).setDepth(3).setAlpha(0.9);
    this.add.image(this.peroxisomeSprite.x, this.peroxisomeSprite.y, makeStationTexture(this, "Peroxisome")).setDepth(3).setAlpha(0.9);
    this.add.image(this.chaperoneSprite.x, this.chaperoneSprite.y, makeStationTexture(this, "Chaperone")).setDepth(3).setAlpha(0.9);

    // Station glow effects (rings that appear when in range)
    const glowKey = makeRingTexture(this, 200, 6, 0x88ddff);
    this.nucleusGlow = this.add.image(this.nucleusSprite.x, this.nucleusSprite.y, glowKey).setDepth(1).setAlpha(0).setTint(this.col.nucleusRim);
    const riboGlowKey = makeRingTexture(this, 160, 6, 0x88ddff);
    this.ribosomeGlow = this.add.image(this.ribosomeSprite.x, this.ribosomeSprite.y, riboGlowKey).setDepth(1).setAlpha(0).setTint(this.col.riboRim);
    const peroxiGlowKey = makeRingTexture(this, 140, 6, 0x88ddff);
    this.peroxisomeGlow = this.add.image(this.peroxisomeSprite.x, this.peroxisomeSprite.y, peroxiGlowKey).setDepth(1).setAlpha(0).setTint(this.col.peroxiRim);
    const chaperoneGlowKey = makeRingTexture(this, 120, 6, 0x88ddff);
    this.chaperoneGlow = this.add.image(this.chaperoneSprite.x, this.chaperoneSprite.y, chaperoneGlowKey).setDepth(1).setAlpha(0).setTint(this.col.chaperoneRim);

    // Station labels
    this.nucleusLabel = this.add.text(this.nucleusSprite.x, this.nucleusSprite.y - 110, "Nucleus", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

    this.ribosomeLabel = this.add.text(this.ribosomeSprite.x, this.ribosomeSprite.y - 90, "Ribosome", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

    this.peroxisomeLabel = this.add.text(this.peroxisomeSprite.x, this.peroxisomeSprite.y - 80, "Peroxisome", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

    this.chaperoneLabel = this.add.text(this.chaperoneSprite.x, this.chaperoneSprite.y - 70, "Chaperone", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

    // player
    const pkey = makeDotTexture(this, 16, this.col.player);
    this.player = this.physics.add.sprite(this.cellCenter.x, this.cellCenter.y, pkey).setDepth(4);
    this.player.setCircle(8).setMaxVelocity(this.normalMaxSpeed).setDamping(true).setDrag(0.7);
    const rkey = makeRingTexture(this, 22, 3, this.col.playerRing);
    this.ring = this.add.image(this.player.x, this.player.y, rkey).setDepth(3).setAlpha(0.9);

    // Cooldown bars above player
    const barWidth = 30;
    const barHeight = 3;
    this.transcribeCooldownBg = this.add.rectangle(0, 0, barWidth, barHeight, 0x333333, 0.8).setDepth(6).setVisible(false);
    this.transcribeCooldownBar = this.add.rectangle(0, 0, barWidth, barHeight, 0x66ddff, 1).setDepth(7).setVisible(false);
    this.translateCooldownBg = this.add.rectangle(0, 0, barWidth, barHeight, 0x333333, 0.8).setDepth(6).setVisible(false);
    this.translateCooldownBar = this.add.rectangle(0, 0, barWidth, barHeight, 0x88ff66, 1).setDepth(7).setVisible(false);
    
    // Dash cooldown bar
    this.dashCooldownBg = this.add.rectangle(0, 0, barWidth, barHeight, 0x333333, 0.8).setDepth(6).setVisible(false);
    this.dashCooldownBar = this.add.rectangle(0, 0, barWidth, barHeight, 0xffaa44, 1).setDepth(7).setVisible(false);

    // Contextual tooltips
    this.contextTooltipBg = this.add.rectangle(0, 0, 300, 40, 0x001122, 0.9).setDepth(8).setVisible(false);
    this.contextTooltip = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#88ddff", align: "center"
    }).setOrigin(0.5).setDepth(9).setVisible(false);

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
      ENTER: this.input.keyboard!.addKey("ENTER"),
      SPACE: this.input.keyboard!.addKey("SPACE"),
    };

    // HUD
    addHud(this);

    // XState v5: actor + subscribe
    this.cell = createActor(cellMachine);
    this.cell.subscribe((state: CellState) => {
      const hudCtx = { ...state.context, message: this.currentMessage };
      setHud(this, hudCtx); // context matches HudCtx fields now
    });
    this.cell.start();

    // initial HUD draw
    const initialCtx = { ...this.cell.getSnapshot().context, message: this.currentMessage };
    setHud(this, initialCtx);

    // Create overlays for game states
    this.createOverlays();

    // resize regeneration
    this.scale.on("resize", (sz: Phaser.Structs.Size) => {
      const newWidth = Math.ceil(sz.width);
      const newHeight = Math.ceil(sz.height);
      
      // Regenerate grid texture with new larger dimensions
      const gridSize = Math.max(newWidth, newHeight) * 2;
      const key = makeGridTexture(this, gridSize, gridSize, this.col.bg, this.col.gridMinor, this.col.gridMajor);
      this.grid.setTexture(key).setOrigin(0.5, 0.5);
      this.grid.setPosition(newWidth * 0.5, newHeight * 0.5);
      
      // Re-center everything
      this.cellCenter.set(newWidth * 0.5, newHeight * 0.5);
      this.cellSprite.setPosition(this.cellCenter.x, this.cellCenter.y);
      
      // Update station positions
      this.nucleusSprite.setPosition(this.cellCenter.x - 80, this.cellCenter.y - 20);
      this.ribosomeSprite.setPosition(this.cellCenter.x + 100, this.cellCenter.y + 40);
      this.peroxisomeSprite.setPosition(this.cellCenter.x - 110, this.cellCenter.y + 80);
      this.chaperoneSprite.setPosition(this.cellCenter.x + 120, this.cellCenter.y - 60);
      
      // Update glow positions
      this.nucleusGlow.setPosition(this.nucleusSprite.x, this.nucleusSprite.y);
      this.ribosomeGlow.setPosition(this.ribosomeSprite.x, this.ribosomeSprite.y);
      this.peroxisomeGlow.setPosition(this.peroxisomeSprite.x, this.peroxisomeSprite.y);
      this.chaperoneGlow.setPosition(this.chaperoneSprite.x, this.chaperoneSprite.y);
      
      // Update label positions
      this.nucleusLabel.setPosition(this.nucleusSprite.x, this.nucleusSprite.y - 110);
      this.ribosomeLabel.setPosition(this.ribosomeSprite.x, this.ribosomeSprite.y - 90);
      this.peroxisomeLabel.setPosition(this.peroxisomeSprite.x, this.peroxisomeSprite.y - 80);
      this.chaperoneLabel.setPosition(this.chaperoneSprite.x, this.chaperoneSprite.y - 70);

      // Update overlay positions
      this.overlayBg.setSize(newWidth, newHeight).setPosition(newWidth / 2, newHeight / 2);
      this.overlayText.setPosition(newWidth / 2, newHeight / 2);
      this.pulseOverlay.setSize(newWidth, newHeight).setPosition(newWidth / 2, newHeight / 2);
    });
  }

  private createOverlays() {
    const view = this.scale.gameSize;
    
    // Main overlay container
    this.overlay = this.add.container(0, 0).setDepth(1000).setVisible(false).setScrollFactor(0);
    
    // Overlay background
    this.overlayBg = this.add.rectangle(view.width / 2, view.height / 2, view.width, view.height, 0x000000, 0.8);
    this.overlay.add(this.overlayBg);
    
    // Overlay text
    this.overlayText = this.add.text(view.width / 2, view.height / 2, "", {
      fontFamily: "monospace",
      fontSize: "24px",
      color: "#ffffff",
      align: "center",
      stroke: "#000000",
      strokeThickness: 2
    }).setOrigin(0.5);
    this.overlay.add(this.overlayText);

    // Pulse overlay for stress waves (full screen flash)
    this.pulseOverlay = this.add.rectangle(view.width / 2, view.height / 2, view.width, view.height, 0xff4444, 0)
      .setDepth(999).setScrollFactor(0);
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
    // Get current context for all checks
    const ctx = this.cell.getSnapshot().context;

    // Check for game state transitions
    if (this.gameState === "playing") {
      if (ctx.hp <= 0) {
        this.gameState = "dead";
        this.showOverlay("Cell died: oxidative stress\nPress Enter to restart");
        return;
      }
      if (ctx.survivalTimer <= 0) {
        this.gameState = "won";
        this.showOverlay("Survived!\nPress Enter to play again");
        return;
      }
    }

    // Handle restart input
    if ((this.gameState === "dead" || this.gameState === "won") && Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) {
      this.restartGame();
      return;
    }

    // Always update movement (including deceleration when game ends)
    const deltaSeconds = this.game.loop.delta / 1000;
    this.updateMovement(deltaSeconds);

    // Only process game logic when playing
    if (this.gameState !== "playing") return;

    // Wave timer management (independent of machine state timer)
    this.waveTimer -= deltaSeconds;
    if (this.waveTimer <= 0) {
      this.triggerStressWave();
      this.waveTimer = 30; // Reset to 30 seconds
    }

    // station ranges and glow effects
    const inNucleus = Phaser.Math.Distance.BetweenPoints(this.player, this.nucleusSprite) < 80;
    const inRibo    = Phaser.Math.Distance.BetweenPoints(this.player, this.ribosomeSprite) < 70;
    const inPeroxi  = Phaser.Math.Distance.BetweenPoints(this.player, this.peroxisomeSprite) < 65;
    const inChaperone = Phaser.Math.Distance.BetweenPoints(this.player, this.chaperoneSprite) < 55;

    // Update glow effects based on proximity
    this.nucleusGlow.setAlpha(inNucleus ? 0.4 : 0);
    this.ribosomeGlow.setAlpha(inRibo ? 0.4 : 0);
    this.peroxisomeGlow.setAlpha(inPeroxi ? 0.4 : 0);
    this.chaperoneGlow.setAlpha(inChaperone ? 0.4 : 0);

    // Update contextual tooltips
    this.updateContextualTooltips(inNucleus, inRibo, inChaperone, ctx);

    // Gated actions with feedback
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) {
      if (!inNucleus) {
        this.showMessage("Must be in nucleus to transcribe");
        this.flashStation(this.nucleusSprite, 0xff4444);
      } else if (ctx.nt < 2 || ctx.atp < 1 || ctx.cooldownTranscribe > 0) {
        const reason = ctx.cooldownTranscribe > 0 ? "Transcribe on cooldown" : "Need NT ≥2 and ATP ≥1 in nucleus";
        this.showMessage(reason);
        this.flashStation(this.nucleusSprite, 0xff4444);
      } else {
        this.cell.send({ type: "TRANSCRIBE" });
        this.flashStation(this.nucleusSprite, 0x44ff44);
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) {
      if (inChaperone) {
        // Chaperone repair action
        if (ctx.misfolded === 0 || ctx.atp < 1) {
          const reason = ctx.misfolded === 0 ? "No misfolded proteins to repair" : "Need ATP ≥1 to repair";
          this.showMessage(reason);
          this.flashStation(this.chaperoneSprite, 0xff4444);
        } else {
          this.cell.send({ type: "REPAIR_MISFOLDED" });
          this.showMessage("Protein repaired +1", 800);
          this.flashStation(this.chaperoneSprite, 0x44ff44);
        }
      } else if (!inRibo) {
        this.showMessage("Must be at ribosome to translate");
        this.flashStation(this.ribosomeSprite, 0xff4444);
      } else if (ctx.aa < 3 || ctx.atp < 1 || ctx.mrna === 0 || ctx.cooldownTranslate > 0) {
        const reason = ctx.cooldownTranslate > 0 ? "Translate on cooldown" : 
                      ctx.mrna === 0 ? "Need mRNA to translate" : "Need AA ≥3 and ATP ≥1 at ribosome";
        this.showMessage(reason);
        this.flashStation(this.ribosomeSprite, 0xff4444);
      } else {
        // Check for potential misfolding and show message
        const willMisfold = ctx.atp < 2 && Math.random() < 0.3;
        this.cell.send({ type: "TRANSLATE" });
        this.flashStation(this.ribosomeSprite, 0x44ff44);
        if (willMisfold && ctx.atp < 2) {
          this.time.delayedCall(100, () => {
            this.showMessage("Low ATP caused misfolding!", 1200);
          });
        }
      }
    }

    // Delivery with feedback
    if (inPeroxi && ctx.catalaseFree > 0) {
      this.cell.send({ type: "DELIVER_CATALASE" });
      // Check if delivery was successful by comparing context after send
      this.time.delayedCall(16, () => { // Small delay to ensure state update
        const newCtx = this.cell.getSnapshot().context;
        if (newCtx.catalaseFree < ctx.catalaseFree) {
          this.showMessage("Catalase armed +1", 800);
          this.flashStation(this.peroxisomeSprite, 0x44ff44);
        }
      });
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.cell.send({ type: "STRESS", amount: 40 });

    // Update cooldown bars
    this.updateCooldownBars(ctx);

    // Update message timer
    if (this.messageTimer > 0) {
      this.messageTimer -= this.game.loop.delta;
      if (this.messageTimer <= 0) {
        this.currentMessage = "";
        // Update HUD when message clears
        const hudCtx = { ...this.cell.getSnapshot().context, message: this.currentMessage };
        setHud(this, hudCtx);
      }
    }

    // tick biology at 4 Hz
    if (time - this.lastTick > 250) {
      this.cell.send({ type: "TICK", dt: 0.25 });
      this.lastTick = time;
    }
  }

  private updateMovement(deltaSeconds: number) {
    // Update dash timers
    if (this.dashTimer > 0) {
      this.dashTimer -= deltaSeconds;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        this.player.setMaxVelocity(this.normalMaxSpeed);
        // Reset ring effect
        this.ring.setScale(1).setAlpha(0.9);
      }
    }

    if (this.dashCooldown > 0) {
      this.dashCooldown -= deltaSeconds;
    }

    // Only accept input when the game is playing
    let vx = 0, vy = 0;
    if (this.gameState === "playing") {
      // Handle dash input
      if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.dashCooldown <= 0 && !this.isDashing) {
        this.startDash();
      }

      // Get input direction
      vx = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
      vy = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);
    }

    const inputDir = new Phaser.Math.Vector2(vx, vy);

    // Apply elastic membrane boundary forces
    const elasticForce = this.calculateElasticForces();
    
    if (inputDir.lengthSq() > 0) {
      inputDir.normalize();
      
      let baseAcceleration = this.acceleration;
      
      if (this.isDashing) {
        // During dash, higher acceleration for snappy feel
        baseAcceleration *= 2.5;
      } else {
        // Smooth acceleration ramp-up
        const currentSpeed = this.player.body.velocity.length();
        const speedRatio = currentSpeed / this.normalMaxSpeed;
        // Reduce acceleration as we approach max speed for smoother feel
        baseAcceleration *= (1 - speedRatio * 0.3);
      }
      
      const inputForce = inputDir.scale(baseAcceleration);
      const totalForce = inputForce.add(elasticForce);
      this.player.setAcceleration(totalForce.x, totalForce.y);
    } else {
      // No input - apply deceleration and elastic forces
      const currentVel = this.player.body.velocity;
      const deceleration = 600;
      
      let totalForce = elasticForce.clone();
      
      if (currentVel.lengthSq() > 0) {
        const decelDir = currentVel.clone().normalize().scale(-deceleration);
        totalForce.add(decelDir);
        
        // Stop completely when velocity gets very low
        if (currentVel.lengthSq() < 100) {
          this.player.setVelocity(0, 0);
          totalForce.set(0, 0);
        }
      }
      
      this.player.setAcceleration(totalForce.x, totalForce.y);
    }

    // Update camera smooth following
    this.updateCameraSmoothing();

    // Update ring position and visual effects
    this.ring.setPosition(this.player.x, this.player.y);
  }

  private startDash() {
    this.isDashing = true;
    this.dashTimer = this.dashDuration;
    this.dashCooldown = this.maxDashCooldown;
    
    // More moderate speed increase for better balance
    this.player.setMaxVelocity(this.dashSpeed);
    
    // Enhanced visual feedback - ring effect with more juice
    this.ring.setScale(1.8).setAlpha(1).setTint(0xffdd44);
    this.tweens.add({
      targets: this.ring,
      scale: 1,
      alpha: 0.9,
      duration: this.dashDuration * 1000,
      ease: "Back.easeOut"
    });
    
    // Reset tint after dash
    this.time.delayedCall(this.dashDuration * 1000, () => {
      this.ring.setTint(0xffffff);
    });

    // More subtle screen shake
    this.cameras.main.shake(80, 0.008);
    
    // Camera zoom effect for emphasis
    const originalZoom = this.cameras.main.zoom;
    this.cameras.main.setZoom(originalZoom * 1.05);
    this.tweens.add({
      targets: this.cameras.main,
      zoom: originalZoom,
      duration: this.dashDuration * 800,
      ease: "Power2"
    });
  }

  private calculateElasticForces(): Phaser.Math.Vector2 {
    const force = new Phaser.Math.Vector2(0, 0);
    const playerPos = new Phaser.Math.Vector2(this.player.x, this.player.y);
    
    // Membrane boundary spring force only
    const distanceFromCenter = Phaser.Math.Distance.BetweenPoints(playerPos, this.cellCenter);
    const maxDistance = this.cellRadius - this.player.width / 2;
    
    if (distanceFromCenter > maxDistance) {
      // Player is outside the membrane - push back
      const penetration = distanceFromCenter - maxDistance;
      const directionToCenter = new Phaser.Math.Vector2(
        this.cellCenter.x - playerPos.x,
        this.cellCenter.y - playerPos.y
      ).normalize();
      
      const springForce = directionToCenter.scale(penetration * this.membraneSpringForce);
      force.add(springForce);
      
      // Visual feedback for membrane hit
      if (this.time.now - this.lastMembraneHit > 200) {
        this.lastMembraneHit = this.time.now;
        this.createMembraneRipple(playerPos);
      }
    }
    
    // No organelle collision forces - player can move freely through organelles
    
    return force;
  }

  private createMembraneRipple(position: Phaser.Math.Vector2) {
    // Create a ripple effect at the membrane contact point
    const ripple = this.add.circle(position.x, position.y, 20, 0x66ccff, 0.3);
    ripple.setDepth(2);
    
    this.tweens.add({
      targets: ripple,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 300,
      ease: "Power2",
      onComplete: () => ripple.destroy()
    });
  }

  private updateCameraSmoothing() {
    // Set smooth camera target to follow player
    this.cameraSmoothTarget.set(this.player.x, this.player.y);
    
    // Get current camera center
    const currentCenterX = this.cameras.main.scrollX + this.cameras.main.width / 2;
    const currentCenterY = this.cameras.main.scrollY + this.cameras.main.height / 2;
    
    // Lerp camera towards target
    const newCenterX = Phaser.Math.Linear(currentCenterX, this.cameraSmoothTarget.x, this.cameraLerpSpeed);
    const newCenterY = Phaser.Math.Linear(currentCenterY, this.cameraSmoothTarget.y, this.cameraLerpSpeed);
    
    // Apply camera position
    this.cameras.main.centerOn(newCenterX, newCenterY);
  }

  private showMessage(message: string, duration = 1000) {
    this.currentMessage = message;
    this.messageTimer = duration;
    // Update HUD immediately when message is shown
    const hudCtx = { ...this.cell.getSnapshot().context, message: this.currentMessage };
    setHud(this, hudCtx);
  }

  private restartGame() {
    // Reset game state
    this.gameState = "playing";
    this.waveTimer = 30;
    this.currentMessage = "";
    this.messageTimer = 0;
    
    // Reset player position
    this.player.setPosition(this.cellCenter.x, this.cellCenter.y);
    this.player.setVelocity(0, 0);
    
    // Restart the cell machine with fresh context
    this.cell.stop();
    this.cell = createActor(cellMachine);
    this.cell.subscribe((state: CellState) => {
      const hudCtx = { ...state.context, message: this.currentMessage };
      setHud(this, hudCtx);
    });
    this.cell.start();
    
    // Hide overlay
    this.overlay.setVisible(false);
    
    // Update HUD
    const initialCtx = { ...this.cell.getSnapshot().context, message: this.currentMessage };
    setHud(this, initialCtx);
  }

  private showOverlay(text: string) {
    this.overlayText.setText(text);
    this.overlay.setVisible(true);
  }

  private triggerStressWave() {
    const ctx = this.cell.getSnapshot().context;
    const newStress = Math.min(100, ctx.stress + 20);
    this.cell.send({ type: "STRESS", amount: newStress });
    
    // Trigger pulse overlay
    this.pulseOverlay.setAlpha(0.3);
    this.tweens.add({
      targets: this.pulseOverlay,
      alpha: 0,
      duration: 300,
      ease: "Power2"
    });
  }

  private flashStation(station: Phaser.GameObjects.Image, color: number) {
    const originalTint = station.tint;
    station.setTint(color);
    this.time.delayedCall(150, () => {
      station.setTint(originalTint);
    });
  }

  private updateCooldownBars(ctx: any) {
    const barY = this.player.y - 30;
    
    // Transcribe cooldown bar
    if (ctx.cooldownTranscribe > 0) {
      const progress = ctx.cooldownTranscribe / 0.8; // 0.8s max cooldown
      const barWidth = 30 * progress;
      
      this.transcribeCooldownBg.setPosition(this.player.x, barY).setVisible(true);
      this.transcribeCooldownBar.setPosition(this.player.x - (30 - barWidth) / 2, barY)
        .setSize(barWidth, 3).setVisible(true);
    } else {
      this.transcribeCooldownBg.setVisible(false);
      this.transcribeCooldownBar.setVisible(false);
    }

    // Translate cooldown bar  
    if (ctx.cooldownTranslate > 0) {
      const progress = ctx.cooldownTranslate / 0.8; // 0.8s max cooldown
      const barWidth = 30 * progress;
      
      this.translateCooldownBg.setPosition(this.player.x, barY + 8).setVisible(true);
      this.translateCooldownBar.setPosition(this.player.x - (30 - barWidth) / 2, barY + 8)
        .setSize(barWidth, 3).setVisible(true);
    } else {
      this.translateCooldownBg.setVisible(false);
      this.translateCooldownBar.setVisible(false);
    }

    // Dash cooldown bar
    if (this.dashCooldown > 0) {
      const progress = this.dashCooldown / this.maxDashCooldown;
      const barWidth = 30 * progress;
      
      this.dashCooldownBg.setPosition(this.player.x, barY + 16).setVisible(true);
      this.dashCooldownBar.setPosition(this.player.x - (30 - barWidth) / 2, barY + 16)
        .setSize(barWidth, 3).setVisible(true);
    } else {
      this.dashCooldownBg.setVisible(false);
      this.dashCooldownBar.setVisible(false);
    }
  }

  private updateContextualTooltips(inNucleus: boolean, inRibo: boolean, inChaperone: boolean, ctx: any) {
    let tooltipText = "";
    let showTooltip = false;

    if (inNucleus && ctx.cooldownTranscribe <= 0) {
      const hasResources = ctx.nt >= 2 && ctx.atp >= 1;
      const permissionText = hasResources ? "✓ Ready" : "✗ Need NT≥2 & ATP≥1";
      tooltipText = `Press 1 to transcribe ${permissionText} (cost: 2 NT + 1 ATP → +1 mRNA)`;
      showTooltip = true;
    } else if (inRibo && ctx.cooldownTranslate <= 0) {
      const hasResources = ctx.mrna > 0 && ctx.aa >= 3 && ctx.atp >= 1;
      const permissionText = hasResources ? "✓ Ready" : "✗ Need mRNA & AA≥3 & ATP≥1";
      const riskText = ctx.atp < 2 ? " [LOW ATP: Risk misfolding!]" : "";
      tooltipText = `Press 2 to translate ${permissionText} (cost: 3 AA + 1 ATP → +1 Catalase)${riskText}`;
      showTooltip = true;
    } else if (inChaperone && ctx.misfolded > 0) {
      const hasResources = ctx.atp >= 1;
      const permissionText = hasResources ? "✓ Ready" : "✗ Need ATP≥1";
      tooltipText = `Press 2 to repair misfolded ${permissionText} (cost: 1 ATP → +1 Catalase)`;
      showTooltip = true;
    }

    if (showTooltip) {
      this.contextTooltip.setText(tooltipText);
      const tooltipY = this.player.y + 40;
      this.contextTooltip.setPosition(this.player.x, tooltipY);
      this.contextTooltipBg.setPosition(this.player.x, tooltipY);
      this.contextTooltipBg.setSize(this.contextTooltip.width + 20, 30);
      this.contextTooltip.setVisible(true);
      this.contextTooltipBg.setVisible(true);
    } else {
      this.contextTooltip.setVisible(false);
      this.contextTooltipBg.setVisible(false);
    }
  }

}
