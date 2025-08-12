import Phaser from "phaser";
import type { HexGrid, HexCoord, HexTile } from "../hex/hex-grid";
import type { Transcript } from "../core/world-refs";

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
}

export class Player extends Phaser.GameObjects.Container {
  private sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private ring: Phaser.GameObjects.Image;
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
  private cellCenter: Phaser.Math.Vector2;
  private cellRadius: number;
  private lastMembraneHit = 0;
  private cellRoot?: Phaser.GameObjects.Container; // HOTFIX H5: Store cellRoot for membrane effects
  
  // Transcript carrying
  private carriedTranscripts: Transcript[] = [];
  private readonly CARRY_CAPACITY = 2;
  
  // Current position tracking
  private currentTileRef: HexTile | null = null;

  constructor(config: PlayerConfig, hexGrid: HexGrid) {
    super(config.scene, config.x, config.y);
    
    this.hexGrid = hexGrid;
    this.normalMaxSpeed = config.normalMaxSpeed;
    this.dashSpeed = config.dashSpeed;
    this.dashDuration = config.dashDuration;
    this.maxDashCooldown = config.maxDashCooldown;
    this.cellCenter = config.cellCenter;
    this.cellRadius = config.cellRadius;
    this.cellRoot = config.cellRoot; // HOTFIX H5: Store cellRoot reference

    // Create sprite with physics body
    const pkey = this.makePlayerTexture(config.playerColor);
    this.sprite = config.scene.physics.add.sprite(0, 0, pkey) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.sprite.setCircle(8).setMaxVelocity(this.normalMaxSpeed).setDamping(true).setDrag(0.7);
    this.sprite.setDepth(4);

    // Create ring indicator
    const rkey = this.makeRingTexture(config.ringColor);
    this.ring = config.scene.add.image(0, 0, rkey);
    this.ring.setDepth(3).setAlpha(0.9);

    // Add to container
    this.add([this.sprite, this.ring]);
    
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

  /**
   * Main update method called each frame (ORIGINAL MECHANICS)
   */
  override update(deltaSeconds: number, keys: Record<string, Phaser.Input.Keyboard.Key>) {
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
   * Update player movement based on input forces (ORIGINAL MECHANICS RESTORED)
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

    // Calculate membrane boundary forces
    const elasticForce = this.calculateElasticForces();
    
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
      const totalForce = inputForce.add(elasticForce);
      this.sprite.setAcceleration(totalForce.x, totalForce.y);
    } else {
      // ORIGINAL: Proper deceleration when no input
      const currentVel = this.sprite.body.velocity;
      const deceleration = 600;
      
      let totalForce = elasticForce.clone();
      
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
    
    // Update current tile tracking
    this.updateCurrentTile();
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
   * Calculate elastic forces to keep player within cell membrane (INCREASED BOUNCINESS)
   */
  private calculateElasticForces(): Phaser.Math.Vector2 {
    const force = new Phaser.Math.Vector2(0, 0);
    const playerPos = this.getWorldPosition();
    
    const distanceFromCenter = Phaser.Math.Distance.BetweenPoints(playerPos, this.cellCenter);
    const maxDistance = this.cellRadius - this.sprite.width / 2; // Use actual player size
    
    if (distanceFromCenter > maxDistance) {
      const penetration = distanceFromCenter - maxDistance;
      const directionToCenter = new Phaser.Math.Vector2(
        this.cellCenter.x - playerPos.x,
        this.cellCenter.y - playerPos.y
      ).normalize();
      
      // INCREASED spring force for more bouncy membrane feel
      const membraneSpringForce = 600; // Increased from 400 for more bounciness
      const springForce = directionToCenter.scale(penetration * membraneSpringForce);
      force.add(springForce);
      
      // Create visual feedback (throttled)
      if (this.scene.time.now - this.lastMembraneHit > 150) { // Reduced throttle for more responsive feedback
        this.lastMembraneHit = this.scene.time.now;
        this.createMembraneRipple(playerPos);
      }
    }
    
    return force;
  }

  /**
   * Create visual ripple effect when hitting membrane
   */
  private createMembraneRipple(position: Phaser.Math.Vector2) {
    const ripple = this.scene.add.circle(position.x, position.y, 20, 0x66ccff, 0.3);
    ripple.setDepth(2);
    
    // HOTFIX H5: Add ripple to cellRoot if available, so it moves with the cell
    if (this.cellRoot) {
      this.cellRoot.add(ripple);
    }
    
    this.scene.tweens.add({
      targets: ripple,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 300,
      ease: "Power2",
      onComplete: () => ripple.destroy()
    });
  }

  /**
   * Update camera to smoothly follow player
   */
  private updateCameraSmoothing() {
    const playerPos = this.getWorldPosition();
    const camera = this.scene.cameras.main;
    
    const currentCenterX = camera.scrollX + camera.width / 2;
    const currentCenterY = camera.scrollY + camera.height / 2;
    
    const cameraLerpSpeed = 0.08;
    const newCenterX = Phaser.Math.Linear(currentCenterX, playerPos.x, cameraLerpSpeed);
    const newCenterY = Phaser.Math.Linear(currentCenterY, playerPos.y, cameraLerpSpeed);
    
    camera.centerOn(newCenterX, newCenterY);
  }

  /**
   * Get world position of the player
   */
  getWorldPosition(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.x + this.sprite.x, this.y + this.sprite.y);
  }

  /**
   * Get the hex coordinate of the tile the player is currently standing on
   */
  getHexCoord(): HexCoord | null {
    const worldPos = this.getWorldPosition();
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
   * Update carried transcript positions to orbit around player
   */
  updateCarriedTranscripts() {
    if (this.carriedTranscripts.length > 0) {
      const playerWorldPos = this.getWorldPosition();
      const orbitRadius = 25; // Distance from player center
      
      for (let i = 0; i < this.carriedTranscripts.length; i++) {
        const transcript = this.carriedTranscripts[i];
        
        // Calculate orbit position
        const angle = (i / this.carriedTranscripts.length) * Math.PI * 2;
        const offsetX = Math.cos(angle) * orbitRadius;
        const offsetY = Math.sin(angle) * orbitRadius;
        
        transcript.worldPos.set(
          playerWorldPos.x + offsetX,
          playerWorldPos.y + offsetY
        );
      }
    }
  }

  /**
   * Try to pick up a transcript at the current location
   */
  pickupTranscript(transcript: Transcript): boolean {
    if (this.carriedTranscripts.length >= this.CARRY_CAPACITY) {
      return false; // Already at capacity
    }
    
    transcript.isCarried = true;
    this.carriedTranscripts.push(transcript);
    return true;
  }

  /**
   * Drop the first carried transcript at current location
   */
  dropTranscript(): Transcript | null {
    if (this.carriedTranscripts.length === 0) {
      return null;
    }
    
    const transcript = this.carriedTranscripts.shift()!;
    transcript.isCarried = false;
    
    // Set transcript position to current player hex
    const currentHex = this.getCurrentHex();
    if (currentHex) {
      transcript.atHex = { q: currentHex.coord.q, r: currentHex.coord.r };
      const worldPos = this.hexGrid.hexToWorld(transcript.atHex);
      transcript.worldPos.set(worldPos.x, worldPos.y);
    }
    
    return transcript;
  }

  /**
   * Get the list of carried transcripts (read-only)
   */
  getCarriedTranscripts(): readonly Transcript[] {
    return this.carriedTranscripts;
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
   * Apply membrane boundary force to keep player inside cell
   */
  applyMembraneForce(cellCenter: Phaser.Math.Vector2, cellRadius: number, springForce: number): Phaser.Math.Vector2 {
    const playerPos = this.getWorldPosition();
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
}
