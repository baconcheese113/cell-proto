import Phaser from "phaser";
import type { HexGrid, HexCoord, HexTile } from "../hex/hex-grid";
import type { MembranePhysicsSystem } from "../membrane/membrane-physics-system";

interface PlayerConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  normalMaxSpeed: number;
  acceleration: number;
  dashSpeed: number;
  dashDuration: number;
  maxDashCooldown: number;
  playerColor: number;
  ringColor: number;
  cellCenter: Phaser.Math.Vector2;
  cellRadius: number;
  cellRoot?: Phaser.GameObjects.Container; // HOTFIX H5: Add cellRoot for membrane effects
  membranePhysics?: MembranePhysicsSystem; // NEW: Dynamic membrane physics
}

export class Player extends Phaser.GameObjects.Container {
  private sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private ring: Phaser.GameObjects.Image;
  private cargoIndicator?: Phaser.GameObjects.Image; // Changed to Image for better positioning
  private hexGrid: HexGrid;
  
  // Movement properties
  private normalMaxSpeed: number;
  private dashSpeed: number;
  private dashDuration: number;
  private maxDashCooldown: number;
  private dashCooldown = 0;
  private isDashing = false;
  private dashTimer = 0;
  
  // Cell boundary properties
  // private lastMembraneHit = 0; // REMOVED: Only used by old elastic forces system
  private membranePhysics?: MembranePhysicsSystem; // NEW: Dynamic membrane physics reference
  
  // Bounce-house collision parameters
  private bounceRestitution = .9; // Reduced from 0.55 for more stable bounce
  private bounceFrictionTangent = 0.001; // Increased from 0.10 for more damping
  private impactImpulseScale = 60; // Reduced from 0.75 for gentler membrane response
  private minImpactSpeed = 0; // Increased from 20 to reduce micro-bounces
  private bodyRadius = 4; // Player collision radius
  private lastBounceFrame = -1; // Prevent multiple bounces per frame
  
  // Current position tracking
  private currentTileRef: HexTile | null = null;
  
  // Network mode flag - when true, disables local physics movement
  private networkControlled = false;

  constructor(config: PlayerConfig, hexGrid: HexGrid) {
    super(config.scene, config.x, config.y);
    
    this.hexGrid = hexGrid;
    this.normalMaxSpeed = config.normalMaxSpeed;
    this.dashSpeed = config.dashSpeed;
    this.dashDuration = config.dashDuration;
    this.maxDashCooldown = config.maxDashCooldown;
    this.membranePhysics = config.membranePhysics; // NEW: Store membrane physics reference

    // Create sprite with physics body
    const pkey = this.makePlayerTexture(config.playerColor);
    this.sprite = config.scene.physics.add.sprite(0, 0, pkey) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.sprite.setCircle(8).setMaxVelocity(this.normalMaxSpeed).setDamping(true).setDrag(0.7);
    this.sprite.setDepth(4);

    // Create ring indicator
    const rkey = this.makeRingTexture(config.ringColor);
    this.ring = config.scene.add.image(0, 0, rkey);
    this.ring.setDepth(3).setAlpha(0.9);

    // Create cargo indicator textures and initial indicator
    this.makeCargoIndicatorTextures();
    this.cargoIndicator = this.scene.add.image(0, 0, 'cargo_transcript');
    this.cargoIndicator.setPosition(20, -20); // Set relative position within container
    this.cargoIndicator.setDepth(5);
    this.cargoIndicator.setVisible(false); // Initially hidden
    
    // Add to container
    this.add([this.sprite, this.ring, this.cargoIndicator]);
    
    // Add container to scene
    config.scene.add.existing(this);
    
    // Set container position
    this.setPosition(config.x, config.y);
    
    this.setDepth(4);
  }

  private makePlayerTexture(color: number): string {
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(color);
    graphics.fillCircle(8, 8, 8);
    
    const key = `player_${color}`;
    graphics.generateTexture(key, 16, 16);
    graphics.destroy();
    
    return key;
  }

  private makeRingTexture(color: number): string {
    const graphics = this.scene.add.graphics();
    graphics.lineStyle(3, color);
    graphics.strokeCircle(11, 11, 11);
    
    const key = `player_ring_${color}`;
    graphics.generateTexture(key, 22, 22);
    graphics.destroy();
    
    return key;
  }

  private makeCargoIndicatorTextures(): void {
    // Create transcript indicator texture (red)
    const transcriptGraphics = this.scene.add.graphics();
    transcriptGraphics.fillStyle(0xff4444, 0.8);
    transcriptGraphics.fillCircle(8, 8, 8);
    transcriptGraphics.lineStyle(2, 0xffffff, 1);
    transcriptGraphics.strokeCircle(8, 8, 8);
    transcriptGraphics.generateTexture('cargo_transcript', 16, 16);
    transcriptGraphics.destroy();

    // Create vesicle indicator texture (blue)
    const vesicleGraphics = this.scene.add.graphics();
    vesicleGraphics.fillStyle(0x4444ff, 0.8);
    vesicleGraphics.fillCircle(8, 8, 8);
    vesicleGraphics.lineStyle(2, 0xffffff, 1);
    vesicleGraphics.strokeCircle(8, 8, 8);
    vesicleGraphics.generateTexture('cargo_vesicle', 16, 16);
    vesicleGraphics.destroy();

    // Create empty texture for when not carrying
    const emptyGraphics = this.scene.add.graphics();
    emptyGraphics.generateTexture('cargo_none', 1, 1);
    emptyGraphics.destroy();
  }

  /**
   * Main update method called each frame (ORIGINAL MECHANICS)
   */
  override update(deltaSeconds: number, keys: Record<string, Phaser.Input.Keyboard.Key>) {
    // Skip movement processing if under network control
    if (this.networkControlled) {
      // Only update camera to follow player, but don't process movement
      this.updateCameraSmoothing();
      return;
    }
    
    // Get input direction (ORIGINAL METHOD)
    const vx = (keys['D'].isDown ? 1 : 0) - (keys['A'].isDown ? 1 : 0);
    const vy = (keys['S'].isDown ? 1 : 0) - (keys['W'].isDown ? 1 : 0);
    
    const inputDir = new Phaser.Math.Vector2(vx, vy);
    
    // Handle dash input
    if (Phaser.Input.Keyboard.JustDown(keys['SPACE'])) {
      this.startDash();
    }
    
    // Update movement with ORIGINAL mechanics
    this.updateMovement(inputDir, deltaSeconds * 1000); // Convert to milliseconds
    
    // Update camera to follow player
    this.updateCameraSmoothing();
  }

  /**
   * Update player movement based on input forces with XPBD membrane collision
   */
  updateMovement(inputDirection: Phaser.Math.Vector2, delta: number) {
    // Update dash cooldown
    if (this.dashCooldown > 0) {
      this.dashCooldown -= delta / 1000;
    }

    // Handle dashing
    if (this.isDashing) {
      this.dashTimer -= delta / 1000;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        this.sprite.setMaxVelocity(this.normalMaxSpeed);
        this.ring.setScale(1).setAlpha(0.9);
      }
    }

    // Apply membrane collision before arcade physics integration
    if (this.membranePhysics) {
      this.handleMembraneCollision();
    }

    // DISABLED: Old elastic forces system - replaced by bounce-house collision
    // const elasticForce = this.calculateElasticForces();
    
    // Apply movement force (ORIGINAL LOGIC)
    if (inputDirection.lengthSq() > 0) {
      inputDirection.normalize();
      
      let baseAcceleration = 600; // Original acceleration value
      
      // ORIGINAL: Dash increases acceleration, not just max speed
      if (this.isDashing) {
        baseAcceleration *= 2.5;
      } else {
        // ORIGINAL: Dynamic acceleration based on current speed
        const currentSpeed = this.sprite.body.velocity.length();
        const speedRatio = currentSpeed / this.normalMaxSpeed;
        baseAcceleration *= (1 - speedRatio * 0.3);
      }
      
      const inputForce = inputDirection.scale(baseAcceleration);
      // Note: Elastic forces now handled by bounce-house collision system
      this.sprite.setAcceleration(inputForce.x, inputForce.y);
    } else {
      // ORIGINAL: Proper deceleration when no input
      const currentVel = this.sprite.body.velocity;
      const deceleration = 600;
      
      // Note: Elastic forces now handled by bounce-house collision system
      let totalForce = new Phaser.Math.Vector2(0, 0);
      
      if (currentVel.lengthSq() > 0) {
        const decelDir = currentVel.clone().normalize().scale(-deceleration);
        totalForce.add(decelDir);
        
        if (currentVel.lengthSq() < 100) {
          this.sprite.setVelocity(0, 0);
          totalForce.set(0, 0);
        }
      }
      
      this.sprite.setAcceleration(totalForce.x, totalForce.y);
    }

    // Update ring position to follow sprite
    this.ring.setPosition(this.sprite.x, this.sprite.y);
    
    // Update cargo indicator to follow sprite
    if (this.cargoIndicator) {
      this.cargoIndicator.setPosition(this.sprite.x + 20, this.sprite.y - 20);
    }
    
    // Update current tile tracking
    this.updateCurrentTile();
  }

  /**
   * Handle bounce-house membrane collision with proper recoil and membrane squish
   */
  private handleMembraneCollision(): void {
    if (!this.membranePhysics) return;
    
    // Throttle to one collision per frame to prevent jitter
    const currentFrame = this.scene.game.loop.frame;
    if (this.lastBounceFrame === currentFrame) return;

    const body = this.sprite.body;
    if (!body) return;

    // Step 1: Get positions and calculate collision geometry
    const pLocal = this.getCellLocalPosition();
    const c = this.membranePhysics.getCenter(); // center-of-mass
    const rel = pLocal.clone().subtract(c);
    const dist = rel.length();
    
    if (dist < 0.001) return; // Too close to center
    
    const angle = Math.atan2(rel.y, rel.x);
    const r = this.membranePhysics.getMembraneRadiusAt(angle); // uses center-of-mass
    const allowed = r - this.bodyRadius;
    const penetration = dist - allowed;
    
    // If penetration <= 0, no collision
    if (penetration <= 0) return;
    
    // Step 2: Compute outward normal
    const n = rel.clone().normalize();
    
    // Step 3: Gentle positional correction (only move 50% of penetration to prevent jitter)
    const correctionFactor = 0.5; // Reduced from 1.0 to prevent position oscillation
    const corr = n.clone().scale(-penetration * correctionFactor); // negative → move inward
    this.x += corr.x;
    this.y += corr.y; // player is parented to cellRoot
    
    // Step 4: Velocity bounce
    const v = new Phaser.Math.Vector2(body.velocity.x, body.velocity.y);
    const vn = v.dot(n);
    
    if (vn > this.minImpactSpeed) {
      // Mark this frame as having processed a collision
      this.lastBounceFrame = currentFrame;
      
      // Reflect and add restitution
      const vReflected = v.clone().subtract(n.clone().scale((1 + this.bounceRestitution) * vn));
      
      // Tangential friction
      const vt = vReflected.clone().subtract(n.clone().scale(vReflected.dot(n))); // tangent component
      vReflected.subtract(vt.clone().scale(this.bounceFrictionTangent));
      
      // Apply new velocity to arcade physics
      body.setVelocity(vReflected.x, vReflected.y);
      
      // Feed equal & opposite impulse into membrane
      const impulseMag = (1 + this.bounceRestitution) * vn;
      const j = n.clone().scale(impulseMag * this.impactImpulseScale);
      this.membranePhysics.applyImpulseAt(pLocal, j); // in cell-local coords
      
      // Debug log occasionally
      if (Math.random() < 0.05) {
        console.log(`🏀 BOUNCE-HOUSE: penetration=${penetration.toFixed(1)}, vn=${vn.toFixed(1)}, impulse=${j.length().toFixed(1)}`);
      }
    }
  }

  /**
   * Initiate dash if not on cooldown
   */
  startDash(): boolean {
    if (this.dashCooldown <= 0 && !this.isDashing) {
      this.isDashing = true;
      this.dashTimer = this.dashDuration;
      this.dashCooldown = this.maxDashCooldown;
      this.sprite.setMaxVelocity(this.dashSpeed);
      
      // Visual feedback
      this.ring.setScale(1.8).setAlpha(1).setTint(0xffdd44);
      this.scene.tweens.add({
        targets: this.ring,
        scale: 1,
        alpha: 0.9,
        duration: this.dashDuration * 1000,
        ease: "Back.easeOut"
      });
      
      this.scene.time.delayedCall(this.dashDuration * 1000, () => {
        this.ring.setTint(0xffffff);
      });

      // Camera shake and zoom
      this.scene.cameras.main.shake(80, 0.008);
      
      const originalZoom = this.scene.cameras.main.zoom;
      this.scene.cameras.main.setZoom(originalZoom * 1.05);
      this.scene.tweens.add({
        targets: this.scene.cameras.main,
        zoom: originalZoom,
        duration: this.dashDuration * 800,
        ease: "Power2"
      });
      
      return true;
    }
    return false;
  }

  /**
   * Update camera to smoothly follow player
   */
  private updateCameraSmoothing() {
    const playerPos = this.getCellLocalPosition();
    const camera = this.scene.cameras.main;
    
    const currentCenterX = camera.scrollX + camera.width / 2;
    const currentCenterY = camera.scrollY + camera.height / 2;
    
    const cameraLerpSpeed = 0.08;
    const newCenterX = Phaser.Math.Linear(currentCenterX, playerPos.x, cameraLerpSpeed);
    const newCenterY = Phaser.Math.Linear(currentCenterY, playerPos.y, cameraLerpSpeed);
    
    camera.centerOn(newCenterX, newCenterY);
  }

  /**
   * Get position relative to cell center
   * Note: Player is added to cellRoot, so this returns cell-local coordinates
   */
  getCellLocalPosition(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.x + this.sprite.x, this.y + this.sprite.y);
  }


  /**
   * Get current velocity from physics body
   */
  getVelocity(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      this.sprite.body?.velocity.x ?? 0,
      this.sprite.body?.velocity.y ?? 0
    );
  }

  /**
   * Set network control mode - when enabled, disables local physics movement
   */
  setNetworkControlled(enabled: boolean): void {
    this.networkControlled = enabled;
    if (enabled) {
      // Stop any current velocity when switching to network control
      this.sprite.setVelocity(0, 0);
    }
  }

  /**
   * Get the hex coordinate of the tile the player is currently standing on
   */
  getHexCoord(): HexCoord | null {
    const worldPos = this.getCellLocalPosition();
    return this.hexGrid.worldToHex(worldPos.x, worldPos.y);
  }

  /**
   * Get the player's current hex tile
   */
  getCurrentHex(): HexTile | null {
    const coord = this.getHexCoord();
    if (!coord) return null;
    return this.hexGrid.getTile(coord) || null;
  }

  /**
   * Get read-only access to current tile (cached)
   */
  getCurrentTile(): HexTile | null {
    return this.currentTileRef;
  }

  /**
   * Update the cached current tile reference
   */
  private updateCurrentTile() {
    this.currentTileRef = this.getCurrentHex();
  }

  /**
   * Get current dash state for UI display
   */
  getDashState(): { isOnCooldown: boolean; cooldownRemaining: number; isDashing: boolean } {
    return {
      isOnCooldown: this.dashCooldown > 0,
      cooldownRemaining: this.dashCooldown,
      isDashing: this.isDashing
    };
  }

  /**
   * Check if player can currently dash
   */
  canDash(): boolean {
    return this.dashCooldown <= 0 && !this.isDashing;
  }

  /**
   * Get physics body for collision detection
   */
  getPhysicsBody(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }

  /**
   * Update cargo indicator based on what's being carried
   */
  public updateCargoIndicator(cargoType: string | null): void {
    if (!this.cargoIndicator) return;
    
    if (cargoType) {
      this.cargoIndicator.setVisible(true);
      
      if (cargoType === 'transcript') {
        this.cargoIndicator.setTexture('cargo_transcript');
      } else if (cargoType === 'vesicle') {
        this.cargoIndicator.setTexture('cargo_vesicle');
      }
    } else {
      this.cargoIndicator.setVisible(false);
    }
  }

  /**
   * Update cargo indicator position for throw preview
   */
  public updateCargoIndicatorPosition(relativePosition: Phaser.Math.Vector2, chargeLevel: number): void {
    if (!this.cargoIndicator || !this.cargoIndicator.visible) return;
    
    // Position cargo indicator relative to sprite
    this.cargoIndicator.setPosition(
      this.sprite.x + relativePosition.x,
      this.sprite.y + relativePosition.y
    );
    
    // Scale and pulse based on charge level
    const scale = 1.0 + (chargeLevel * 0.3); // Grow up to 30% with charge
    const alpha = 0.7 + (chargeLevel * 0.3); // Brighten with charge
    
    this.cargoIndicator.setScale(scale);
    this.cargoIndicator.setAlpha(alpha);
    
    // Add a subtle rotation to show it's "ready to throw"
    if (chargeLevel > 0) {
      const rotation = Math.sin(this.scene.time.now / 200) * 0.1; // Subtle oscillation
      this.cargoIndicator.setRotation(rotation);
    } else {
      this.cargoIndicator.setRotation(0);
    }
  }

  /**
   * Reset cargo indicator to default position
   */
  public resetCargoIndicatorPosition(): void {
    if (!this.cargoIndicator) return;
    
    this.cargoIndicator.setPosition(this.sprite.x + 20, this.sprite.y - 20);
    this.cargoIndicator.setScale(1.0);
    this.cargoIndicator.setAlpha(1.0);
    this.cargoIndicator.setRotation(0);
  }

  /**
   * Apply membrane boundary force to keep player inside cell
   */
  applyMembraneForce(cellCenter: Phaser.Math.Vector2, cellRadius: number, springForce: number): Phaser.Math.Vector2 {
    const playerPos = this.getCellLocalPosition();
    const distanceFromCenter = Phaser.Math.Distance.Between(
      playerPos.x, playerPos.y,
      cellCenter.x, cellCenter.y
    );

    if (distanceFromCenter > cellRadius) {
      // Calculate force to push player back toward center
      const forceDirection = new Phaser.Math.Vector2(
        cellCenter.x - playerPos.x,
        cellCenter.y - playerPos.y
      ).normalize();
      
      const penetration = distanceFromCenter - cellRadius;
      const forceMagnitude = penetration * springForce;
      
      return forceDirection.scale(forceMagnitude);
    }

    return new Phaser.Math.Vector2(0, 0);
  }

  /**
   * Synchronize visual components (ring and cargo indicator) with sprite position
   * This should be called when position is updated externally (e.g., network updates)
   */
  syncVisualComponents(): void {
    // Update ring position to follow sprite
    this.ring.setPosition(this.sprite.x, this.sprite.y);
    
    // Update cargo indicator to follow sprite
    if (this.cargoIndicator) {
      this.cargoIndicator.setPosition(this.sprite.x + 20, this.sprite.y - 20);
    }
  }

  /**
   * Set the membrane physics system for collision detection
   */
  setMembranePhysics(membranePhysics: MembranePhysicsSystem): void {
    this.membranePhysics = membranePhysics;
  }
}
