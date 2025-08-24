/**
 * Milestone 12 - Membrane Trampoline System
 * 
 * Story 12.5: Make the membrane rim fun and useful for traversal
 * - Reflects player dashes into rim with angle of incidence
 * - Launch speed scales with dash speed × local membrane tension
 * - Brief control lockout during air time
 * - Soft cooldown to prevent pogo spam
 * - VFX ripples and trailing streaks
 */

import type { Player } from "@/actors/player";
import type { WorldRefs } from "../core/world-refs";
import { SystemObject } from "./system-object";

interface TrampolineConfig {
  // Physics
  baseReflectionForce: number; // base bounce force
  tensionMultiplier: number; // multiplies with dash speed
  maxLaunchSpeed: number; // cap on total launch velocity
  
  // Control lockout
  airControlLockout: number; // seconds of reduced control after launch
  airControlReduction: number; // how much to reduce control (0-1)
  
  // Cooldown system
  baseCooldown: number; // minimum time between launches
  perfectTimingWindow: number; // window for bonus timing
  perfectTimingBonus: number; // extra force for good timing
  
  // Membrane properties
  membraneDetectionRadius: number; // how close to membrane for bounce
  minimumDashSpeed: number; // minimum speed needed to trigger bounce
}

interface TrampolineLaunch {
  isActive: boolean;
  launchTime: number;
  lockoutRemaining: number;
  originalControlPower: number;
  launchDirection: Phaser.Math.Vector2;
  launchSpeed: number;
}

export class MembraneTrampoline extends SystemObject {
  private config: TrampolineConfig;
  private lastLaunchTime = 0;
  private currentLaunch: TrampolineLaunch = {
    isActive: false,
    launchTime: 0,
    lockoutRemaining: 0,
    originalControlPower: 1.0,
    launchDirection: new Phaser.Math.Vector2(),
    launchSpeed: 0
  };
  
  // VFX objects
  private rippleGraphics?: Phaser.GameObjects.Graphics;
  private trailGraphics?: Phaser.GameObjects.Graphics;
  
  constructor(
    scene: Phaser.Scene,
    private worldRefs: WorldRefs,
    config: Partial<TrampolineConfig> = {}
  ) {
    super(scene, "MembraneTrampoline", (deltaSeconds: number) => this.update(deltaSeconds));
    
    this.config = {
      baseReflectionForce: 250, // Increased from 250 for more obvious effect
      tensionMultiplier: 1.8,   // Increased from 1.8 for stronger bounces
      maxLaunchSpeed: 450,      // Increased from 450 for higher launches
      airControlLockout: 0.5,   // Increased to 500ms for more noticeable lockout
      airControlReduction: 0.8, // Increased to 80% control reduction
      baseCooldown: 1.0,        // Reduced from 1.5 for more frequent bounces
      perfectTimingWindow: 0.15, // Increased window for easier perfect timing
      perfectTimingBonus: 1.6,   // Increased bonus from 1.4
      membraneDetectionRadius: 15, // Increased from 15 for easier triggering
      minimumDashSpeed: 80,      // Reduced from 80 for easier triggering
      ...config
    };
    
    this.initializeGraphics();
  }
  
  private initializeGraphics(): void {
    this.rippleGraphics = this.scene.add.graphics();
    this.rippleGraphics.setDepth(3);
    this.worldRefs.cellRoot.add(this.rippleGraphics);
    
    this.trailGraphics = this.scene.add.graphics();
    this.trailGraphics.setDepth(3);
    this.worldRefs.cellRoot.add(this.trailGraphics);
  }
  
  override update(deltaSeconds: number): void {
    this.updateControlLockout(deltaSeconds);
    this.checkForTrampolineBounce();
    this.renderTrailEffects();
  }
  
  /**
   * Story 12.5: Check if player is dashing into membrane for bounce
   */
  private checkForTrampolineBounce(): void {
    const player = this.worldRefs.player;
    
    // Only check if player is dashing and moving fast enough
    const dashState = player.getDashState();
    const playerBody = player.getPhysicsBody();
    
    if (!dashState.isDashing || !playerBody) return;
    
    const currentSpeed = playerBody.velocity.length();
    if (currentSpeed < this.config.minimumDashSpeed) return;
    
    // Check cooldown
    const timeSinceLastLaunch = this.scene.time.now - this.lastLaunchTime;
    if (timeSinceLastLaunch < this.config.baseCooldown * 1000) return;
    
    // Check if near membrane
    const playerPos = player.getWorldPosition();
    const nearestMembranePoint = this.findNearestMembranePoint(playerPos);
    
    if (!nearestMembranePoint) return;
    
    const distanceToMembrane = Phaser.Math.Distance.BetweenPoints(playerPos, nearestMembranePoint.position);
    
    if (distanceToMembrane <= this.config.membraneDetectionRadius) {
      this.executeTrampolineLaunch(player, playerPos, nearestMembranePoint, currentSpeed);
    }
  }
  
  /**
   * Story 12.5: Execute the trampoline launch with angle reflection
   */
  private executeTrampolineLaunch(
    player: Player, 
    playerPos: Phaser.Math.Vector2, 
    membranePoint: { position: Phaser.Math.Vector2; normal: Phaser.Math.Vector2; tension: number },
    dashSpeed: number
  ): void {
    const playerBody = player.getPhysicsBody();
    if (!playerBody) return;
    
    // Calculate incident angle
    const velocity = new Phaser.Math.Vector2(playerBody.velocity.x, playerBody.velocity.y);
    const incidentDirection = velocity.clone().normalize();
    
    // Reflect off membrane normal (angle of incidence = angle of reflection)
    const reflectedDirection = this.reflectVector(incidentDirection, membranePoint.normal);
    
    // Calculate launch force based on dash speed and membrane tension
    let launchForce = this.config.baseReflectionForce + 
                     (dashSpeed * this.config.tensionMultiplier * membranePoint.tension);
    
    // Check for perfect timing bonus
    const timeSinceLastLaunch = (this.scene.time.now - this.lastLaunchTime) / 1000;
    const isNearCooldownEnd = Math.abs(timeSinceLastLaunch - this.config.baseCooldown) < this.config.perfectTimingWindow;
    
    if (isNearCooldownEnd) {
      launchForce *= this.config.perfectTimingBonus;
      this.createPerfectTimingVFX(playerPos);
      this.worldRefs.showToast("Perfect timing! +60% boost");
      console.log(`🏀 PERFECT TRAMPOLINE BOUNCE! Force: ${launchForce.toFixed(0)}`);
    } else {
      console.log(`🏀 Trampoline bounce! Force: ${launchForce.toFixed(0)}, Speed: ${dashSpeed.toFixed(0)}`);
    }
    
    // Cap the launch speed
    launchForce = Math.min(launchForce, this.config.maxLaunchSpeed);
    
    // Apply the launch force
    const launchVelocity = reflectedDirection.scale(launchForce);
    playerBody.setVelocity(launchVelocity.x, launchVelocity.y);
    
    // Set up control lockout
    this.currentLaunch = {
      isActive: true,
      launchTime: this.scene.time.now,
      lockoutRemaining: this.config.airControlLockout,
      originalControlPower: 1.0,
      launchDirection: reflectedDirection.clone(),
      launchSpeed: launchForce
    };
    
    // Update last launch time
    this.lastLaunchTime = this.scene.time.now;
    
    // Create VFX
    this.createRippleVFX(membranePoint.position, membranePoint.tension);
    this.createLaunchTrailVFX(playerPos, launchVelocity);
    
    this.worldRefs.showToast(`Membrane launch! ${Math.round(launchForce)} force`);
  }
  
  /**
   * Reflect a vector off a surface normal
   */
  private reflectVector(incident: Phaser.Math.Vector2, normal: Phaser.Math.Vector2): Phaser.Math.Vector2 {
    // R = I - 2(I·N)N
    const dotProduct = incident.dot(normal);
    const reflection = incident.clone().subtract(normal.clone().scale(2 * dotProduct));
    return reflection.normalize();
  }
  
  /**
   * Update control lockout system
   */
  private updateControlLockout(deltaSeconds: number): void {
    if (!this.currentLaunch.isActive) return;
    
    this.currentLaunch.lockoutRemaining -= deltaSeconds;
    
    if (this.currentLaunch.lockoutRemaining <= 0) {
      this.currentLaunch.isActive = false;
      // Could notify player system that full control is restored
    }
  }
  
  /**
   * Find the nearest membrane point with surface normal
   */
  private findNearestMembranePoint(playerPos: Phaser.Math.Vector2): { 
    position: Phaser.Math.Vector2; 
    normal: Phaser.Math.Vector2; 
    tension: number 
  } | null {
    const membraneTiles = this.worldRefs.hexGrid.getMembraneTiles();
    let closestPoint: { position: Phaser.Math.Vector2; normal: Phaser.Math.Vector2; tension: number } | null = null;
    let closestDistance = Infinity;
    
    for (const tile of membraneTiles) {
      const distance = Phaser.Math.Distance.BetweenPoints(playerPos, tile.worldPos);
      
      if (distance < closestDistance) {
        closestDistance = distance;
        
        // Calculate surface normal (pointing inward toward cell center)
        const centerDirection = new Phaser.Math.Vector2(0, 0).subtract(tile.worldPos).normalize();
        
        // Calculate local membrane tension (could be enhanced with actual tension values)
        const baseTension = 1.0;
        const distanceFromCenter = tile.worldPos.length();
        const tension = baseTension * (1 + distanceFromCenter * 0.001); // Slight variation
        
        closestPoint = {
          position: tile.worldPos.clone(),
          normal: centerDirection,
          tension: tension
        };
      }
    }
    
    return closestPoint;
  }
  
  /**
   * Create ripple VFX at membrane impact point
   */
  private createRippleVFX(position: Phaser.Math.Vector2, tension: number): void {
    // Create multiple ripples for more dramatic effect
    for (let i = 0; i < 3; i++) {
      const delay = i * 100;
      const ripple = this.scene.add.circle(position.x, position.y, 5 + i * 3, 0x66ccff, 0.8 - i * 0.2);
      ripple.setDepth(4);
      this.worldRefs.cellRoot.add(ripple);
      
      const maxScale = 4 + tension * 1.5 + i; // Much bigger ripples
      
      this.scene.tweens.add({
        targets: ripple,
        scaleX: maxScale,
        scaleY: maxScale,
        alpha: 0,
        duration: 600 + i * 200,
        delay: delay,
        ease: "Power2",
        onComplete: () => ripple.destroy()
      });
    }
    
    // Add a bright flash at impact point
    const flash = this.scene.add.circle(position.x, position.y, 15, 0xffffff, 1.0);
    flash.setDepth(5);
    this.worldRefs.cellRoot.add(flash);
    
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 0.1,
      scaleY: 0.1,
      duration: 150,
      ease: "Power2",
      onComplete: () => flash.destroy()
    });
  }
  
  /**
   * Create launch trail VFX
   */
  private createLaunchTrailVFX(startPos: Phaser.Math.Vector2, velocity: Phaser.Math.Vector2): void {
    const trailLength = velocity.length() * 0.3;
    const trailDirection = velocity.clone().normalize().scale(-trailLength);
    const endPos = startPos.clone().add(trailDirection);
    
    const trail = this.scene.add.line(0, 0, startPos.x, startPos.y, endPos.x, endPos.y, 0xffffff, 0.8);
    trail.setLineWidth(3);
    trail.setDepth(4);
    this.worldRefs.cellRoot.add(trail);
    
    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 600,
      ease: "Power2",
      onComplete: () => trail.destroy()
    });
  }
  
  /**
   * Create perfect timing bonus VFX
   */
  private createPerfectTimingVFX(position: Phaser.Math.Vector2): void {
    const flash = this.scene.add.circle(position.x, position.y, 20, 0xffff44, 0.9);
    flash.setDepth(5);
    this.worldRefs.cellRoot.add(flash);
    
    this.scene.tweens.add({
      targets: flash,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 300,
      ease: "Back.easeOut",
      onComplete: () => flash.destroy()
    });
  }
  
  /**
   * Render ongoing trail effects
   */
  private renderTrailEffects(): void {
    if (!this.trailGraphics) return;
    
    this.trailGraphics.clear();
    
    // Render launch trail if currently launched
    if (this.currentLaunch.isActive) {
      const player = this.worldRefs.player;
      const playerPos = player.getWorldPosition();
      const trailIntensity = this.currentLaunch.lockoutRemaining / this.config.airControlLockout;
      
      if (trailIntensity > 0) {
        const trailLength = this.currentLaunch.launchSpeed * 0.1 * trailIntensity;
        const trailEnd = playerPos.clone().subtract(
          this.currentLaunch.launchDirection.clone().scale(trailLength)
        );
        
        this.trailGraphics.lineStyle(3, 0xffffff, trailIntensity * 0.6);
        this.trailGraphics.lineBetween(playerPos.x, playerPos.y, trailEnd.x, trailEnd.y);
      }
    }
  }
  
  /**
   * Get current control reduction factor during launch
   */
  public getControlReduction(): number {
    if (!this.currentLaunch.isActive) return 1.0;
    
    const lockoutProgress = 1 - (this.currentLaunch.lockoutRemaining / this.config.airControlLockout);
    return 1.0 - (this.config.airControlReduction * (1 - lockoutProgress));
  }
  
  /**
   * Check if currently in trampoline cooldown
   */
  public isOnCooldown(): boolean {
    const timeSinceLastLaunch = (this.scene.time.now - this.lastLaunchTime) / 1000;
    return timeSinceLastLaunch < this.config.baseCooldown;
  }
  
  /**
   * Get remaining cooldown time
   */
  public getCooldownRemaining(): number {
    const timeSinceLastLaunch = (this.scene.time.now - this.lastLaunchTime) / 1000;
    return Math.max(0, this.config.baseCooldown - timeSinceLastLaunch);
  }
}
