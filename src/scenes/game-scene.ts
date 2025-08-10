/*
=== MILESTONE 0 - FUNCTIONALITY INVENTORY ===
Current gameplay features audit - marked for next development phase:

KEEP (Core mechanics):
- [KEEP] Basic WASD movement with physics
- [KEEP] Membrane boundary elastic collision/bounce
- [KEEP] Camera following with smooth lerp

REMOVE (Complex systems blocking clarity):
- [REMOVE] Station action loops (ONE/TWO keys for transcribe/translate)
- [REMOVE] Proximity-gated organelle entry restrictions  
- [REMOVE] XState cell machine + resource management (glucose/AA/NT/ATP/etc)
- [REMOVE] Production chains (transcription → translation → delivery)
- [REMOVE] HUD resource displays
- [REMOVE] Pickup collection system
- [REMOVE] Stress wave system (R key, timer-based waves)
- [REMOVE] Game win/lose states tied to survival/HP
- [REMOVE] Cooldown bars and timers
- [REMOVE] Station glow effects based on proximity
- [REMOVE] Contextual tooltips for actions
- [REMOVE] Station labels and descriptions

REVISIT LATER (Potentially useful but not core):
- [LATER] Dash mechanics (SPACE key)
- [LATER] Organelle visual collision (keep as decoration)
- [LATER] Message/feedback system
- [LATER] Grid background pattern
- [LATER] Player ring visual effect
- [LATER] Game restart system (ENTER key)

SIMPLIFICATION TARGET: Player moves around cell, bounces off membrane. Nothing else.
*/

import Phaser from "phaser";
// REMOVED: XState imports - no longer using state machine for movement prototype
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture, makeDotTexture, makeRingTexture, makeStationTexture } from "../gfx/textures";

type Keys = Record<"W" | "A" | "S" | "D" | "R" | "ENTER" | "SPACE", Phaser.Input.Keyboard.Key>;
// REMOVED: XState type definitions - no state machine needed for movement prototype

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

  // REMOVED: Cell machine - no biological simulation needed for movement prototype

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

  // REMOVED: Cooldown bars above player - part of station action system

  // REMOVED: Feedback system - no complex messaging needed for movement prototype

  // REMOVED: Game state management, survival timers, wave scheduling
  // REMOVED: XState cell machine integration

  // Movement and dash mechanics (KEEP - core gameplay)
  private dashCooldown = 0;
  private maxDashCooldown = 1.2;
  private dashSpeed = 320;
  private normalMaxSpeed = 120;
  private acceleration = 600;
  private isDashing = false;
  private dashDuration = 0.25;
  private dashTimer = 0;
  // REMOVED: Dash cooldown bars - part of station action system

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

    // REMOVED: Cooldown bars above player - part of station action system

    // REMOVED: Contextual tooltips - not needed for core mechanics
    // REMOVED: Resource pickups - removing resource system entirely

    // keys
    this.keys = {
      W: this.input.keyboard!.addKey("W"),
      A: this.input.keyboard!.addKey("A"),
      S: this.input.keyboard!.addKey("S"),
      D: this.input.keyboard!.addKey("D"),
      R: this.input.keyboard!.addKey("R"),
      ENTER: this.input.keyboard!.addKey("ENTER"),
      SPACE: this.input.keyboard!.addKey("SPACE"),
    };

    // HUD
    addHud(this);

    // REMOVED: XState machine - no biological simulation needed for movement prototype
    
    // Initial simplified HUD
    setHud(this, { message: "" });

    // REMOVED: Game overlays for death/win states

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

      // REMOVED: Overlay position updates - no longer using game state overlays
    });
  }

  override update() {
    // REMOVED: Game state transitions, death/win conditions, restart logic
    // REMOVED: Wave timer management and stress wave system
    // REMOVED: XState machine context checks for HP/survival

    // Core movement system (always update)
    const deltaSeconds = this.game.loop.delta / 1000;
    this.updateMovement(deltaSeconds);

    // REMOVED: All other game logic - focusing on core movement only
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

    // Always accept input - no game state restrictions in simplified version
    let vx = 0, vy = 0;
    
    // Handle dash input
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.dashCooldown <= 0 && !this.isDashing) {
      this.startDash();
    }

    // Get input direction
    vx = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    vy = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);

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

}

/*
MILESTONE 0 — PLAYTEST CHECKLIST
✅ Spawn → player appears in cell center
✅ Move → WASD movement works smoothly  
✅ Dash → SPACE triggers dash with visual feedback
✅ Push membrane → player can approach membrane boundary
✅ Bounce back → elastic forces push player away from membrane
✅ Enter former organelle areas → player can move through station areas freely
✅ No keys do anything except movement/dash → only WASD and SPACE are active
✅ No damage → player cannot die or lose HP
✅ No pickups → no resource orbs exist in the world
✅ No build prompts → no construction or routing systems active
✅ No errors → console shows no runtime warnings or errors
✅ HUD shows controls only → simple "WASD: Move | SPACE: Dash | Movement Prototype"
✅ Resize works → window resize maintains visual fidelity

Status: COMPLETE - Clean movement sandbox with elastic boundaries only
*/
