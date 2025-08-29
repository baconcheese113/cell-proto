/**
 * ThrowSystem - Projectile throwing with multiplayer support
 * Replaces ThrowSystem with unified cargo types and networking
 */

import type { HexCoord } from '../hex/hex-grid';
import { System } from './system';
import { RunOnServer, Multicast } from '../network/decorators';
import type { CargoSystem } from './cargo-system';
import type { NetBus } from '@/network/net-bus';

/**
 * Projectile data for tracking thrown cargo
 */
interface Projectile {
  /** Unique identifier */
  id: string;
  
  /** Cargo being thrown */
  cargoId: string;
  
  /** Start position */
  startPos: HexCoord;
  
  /** Target position */
  targetPos: HexCoord;
  
  /** Current position (interpolated) */
  currentPos: { q: number; r: number };
  
  /** Throw velocity/power */
  velocity: number;
  
  /** Time when throw started */
  startTime: number;
  
  /** Expected flight duration */
  duration: number;
  
  /** Player who threw it */
  playerId: string;
}

/**
 * Network events for throw system
 */
interface ThrowStartEvent {
  projectileId: string;
  cargoId: string;
  playerId: string;
  startPos: HexCoord;
  targetPos: HexCoord;
  velocity: number;
  timestamp: number;
}

interface ThrowLandEvent {
  projectileId: string;
  cargoId: string;
  playerId: string;
  landingPos: HexCoord;
  timestamp: number;
}

/**
 * Networked projectile throwing system
 */
export class ThrowSystem extends System {
  public override readonly systemName = 'ThrowSystem';
  
  // State channels for network replication
  protected stateChannels = {
    projectiles: 'broadcast'
  } as const;
  
  // Internal state
  private projectiles = new Map<string, Projectile>();
  private nextProjectileId = 0;
  
  // Aiming state for ThrowInputController
  private isAiming = false;
  private aimTarget: Phaser.Math.Vector2 | null = null;
  private chargeLevel = 0; // 0.0 to 1.0
  
  constructor(bus: NetBus, scene: Phaser.Scene, private cargoSystem: CargoSystem) {
    super(scene, bus, 'ThrowSystem', (deltaSeconds: number) => this.update(deltaSeconds));
    console.log('🎯 ThrowSystem initialized');
  }
  
  /**
   * Update projectiles each frame
   */
  public override update(deltaSeconds: number): void {
    this.updateProjectiles(deltaSeconds);
  }
  
  /**
   * Throw cargo from one hex to another
   */
  @RunOnServer()
  public throwCargo(
    playerId: string, 
    cargoId: string, 
    startPos: HexCoord, 
    targetPos: HexCoord, 
    velocity: number = 5.0
  ): boolean {
    console.log(`🎯 Debug throwCargo: playerId=${playerId}, cargoId=${cargoId}, cargoSystem=${!!this.cargoSystem}`);
    
    if (!this.cargoSystem) {
      console.warn('🎯 CargoSystem not available for throw');
      return false;
    }
    
    // Start cargo transit in cargo system with player validation
    console.log(`🎯 About to call startCargoTransit with cargoId=${cargoId}, playerId=${playerId}`);
    const transitResult = this.cargoSystem.startCargoTransit(cargoId, playerId);
    console.log(`🎯 startCargoTransit result: ${transitResult}`);
    
    if (!transitResult) {
      console.warn(`🎯 Failed to start transit for cargo ${cargoId}`);
      return false;
    }
    
    // Calculate flight duration based on distance and velocity
    const distance = Math.sqrt(
      Math.pow(targetPos.q - startPos.q, 2) + 
      Math.pow(targetPos.r - startPos.r, 2)
    );
    const duration = Math.max(0.5, distance / velocity); // Minimum 0.5s flight time
    
    // Create projectile
    const projectileId = this.generateProjectileId();
    const projectile: Projectile = {
      id: projectileId,
      cargoId,
      startPos,
      targetPos,
      currentPos: { q: startPos.q, r: startPos.r },
      velocity,
      startTime: Date.now(),
      duration: duration * 1000, // Convert to milliseconds
      playerId
    };
    
    this.projectiles.set(projectileId, projectile);
    
    // Broadcast throw start event
    this.broadcastThrowStart({
      projectileId,
      cargoId,
      playerId,
      startPos,
      targetPos,
      velocity,
      timestamp: projectile.startTime
    });
    
    console.log(`🎯 Player ${playerId} threw cargo ${cargoId} from ${startPos.q},${startPos.r} to ${targetPos.q},${targetPos.r}`);
    
    // Reset aiming state after successful throw
    this.isAiming = false;
    this.aimTarget = null;
    this.chargeLevel = 0;
    console.log('🎯 ThrowSystem: Reset aiming state after successful throw');
    
    return true;
  }
  
  /**
   * Get all active projectiles (for rendering)
   */
  public getProjectiles(): Projectile[] {
    return Array.from(this.projectiles.values());
  }
  
  /**
   * Get projectile by ID
   */
  public getProjectile(projectileId: string): Projectile | null {
    return this.projectiles.get(projectileId) || null;
  }
  
  /**
   * Check if cargo is currently being thrown
   */
  public isCargoInFlight(cargoId: string): boolean {
    for (const projectile of this.projectiles.values()) {
      if (projectile.cargoId === cargoId) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Force land a projectile (emergency stop)
   */
  @RunOnServer()
  public forceProjectileLanding(projectileId: string, landingPos: HexCoord): boolean {
    const projectile = this.projectiles.get(projectileId);
    if (!projectile) {
      console.warn(`🎯 Projectile ${projectileId} not found for force landing`);
      return false;
    }
    
    return this.landProjectile(projectile, landingPos);
  }
  
  // Private helper methods
  
  /**
   * Update all projectiles
   */
  private updateProjectiles(_deltaSeconds: number): void {
    const now = Date.now();
    const landedProjectiles: Projectile[] = [];
    
    // Update each projectile
    for (const projectile of this.projectiles.values()) {
      const elapsed = now - projectile.startTime;
      const progress = Math.min(1.0, elapsed / projectile.duration);
      
      // Interpolate position
      projectile.currentPos.q = projectile.startPos.q + 
        (projectile.targetPos.q - projectile.startPos.q) * progress;
      projectile.currentPos.r = projectile.startPos.r + 
        (projectile.targetPos.r - projectile.startPos.r) * progress;
      
      // Update cargo worldPos for rendering during flight
      const cargo = this.cargoSystem.getCargo(projectile.cargoId);
      if (cargo && cargo.isThrown) {
        // Convert hex position to world position for rendering
        cargo.worldPos = this.cargoSystem['worldRefs'].hexGrid.hexToWorld(projectile.currentPos);
      }
      
      // Check if landed
      if (progress >= 1.0) {
        landedProjectiles.push(projectile);
      }
    }
    
    // Handle landed projectiles
    for (const projectile of landedProjectiles) {
      this.landProjectile(projectile, projectile.targetPos);
    }
  }
  
  /**
   * Land a projectile at specified position
   */
  private landProjectile(projectile: Projectile, landingPos: HexCoord): boolean {
    if (!this.cargoSystem) {
      console.warn('🎯 CargoSystem not available for landing');
      return false;
    }
    
    // End cargo transit in cargo system
    if (!this.cargoSystem.endCargoTransit(projectile.cargoId, landingPos)) {
      console.warn(`🎯 Failed to end transit for cargo ${projectile.cargoId}`);
      return false;
    }
    
    // Remove projectile
    this.projectiles.delete(projectile.id);
    
    // Broadcast landing event
    this.broadcastThrowLand({
      projectileId: projectile.id,
      cargoId: projectile.cargoId,
      playerId: projectile.playerId,
      landingPos,
      timestamp: Date.now()
    });
    
    console.log(`🎯 Projectile ${projectile.id} landed at ${landingPos.q},${landingPos.r}`);
    return true;
  }
  
  /**
   * Generate unique projectile ID
   */
  private generateProjectileId(): string {
    return `projectile_${Date.now()}_${++this.nextProjectileId}`;
  }
  
  /**
   * Network event broadcasts
   */
  
  @Multicast()
  private broadcastThrowStart(event: ThrowStartEvent): void {
    // Clients can use this to start visual effects, sounds, etc.
    console.log(`🌐 Throw started: ${event.cargoId} by ${event.playerId}`);
  }
  
  @Multicast()
  private broadcastThrowLand(event: ThrowLandEvent): void {
    // Clients can use this to show landing effects, sounds, etc.
    console.log(`🌐 Throw landed: ${event.cargoId} at ${event.landingPos.q},${event.landingPos.r}`);
  }
  
  /**
   * Get throw system statistics
   */
  public getStats(): {
    activeProjectiles: number;
    totalThrows: number;
  } {
    return {
      activeProjectiles: this.projectiles.size,
      totalThrows: this.nextProjectileId
    };
  }
  
  /**
   * Clear all projectiles (for cleanup/reset)
   */
  @RunOnServer()
  public clearAllProjectiles(): void {
    for (const projectile of this.projectiles.values()) {
      // Return cargo to world at current position
      const currentHex: HexCoord = {
        q: Math.round(projectile.currentPos.q),
        r: Math.round(projectile.currentPos.r)
      };
      
      if (this.cargoSystem) {
        this.cargoSystem.endCargoTransit(projectile.cargoId, currentHex);
      }
    }
    
    this.projectiles.clear();
    console.log('🎯 Cleared all projectiles');
  }
  
  /**
   * Get system state for serialization
   */
  public getState(): { projectiles: Map<string, Projectile> } {
    return {
      projectiles: new Map(this.projectiles)
    };
  }
  
  /**
   * Set system state from deserialization
   */
  public setState(state: { projectiles: Map<string, Projectile> }): void {
    this.projectiles = new Map(state.projectiles);
  }
  
  // Methods for ThrowInputController integration
  
  /**
   * Update the aiming target position
   */
  public updateAimTarget(targetPosition: Phaser.Math.Vector2): void {
    this.aimTarget = targetPosition.clone();
  }
  
  /**
   * Get current aim target
   */
  public getAimTarget(): Phaser.Math.Vector2 | null {
    return this.aimTarget;
  }
  
  /**
   * Update the charge level for the throw (0.0 to 1.0)
   */
  public updateChargeLevel(chargeLevel: number): void {
    this.chargeLevel = Math.max(0, Math.min(1, chargeLevel));
  }
  
  /**
   * Start aiming mode for a player
   */
  public startAiming(initialTarget: Phaser.Math.Vector2): boolean {
    console.log(`🎯 ThrowSystem.startAiming called: currentlyAiming=${this.isAiming}`);
    
    if (this.isAiming) {
      console.log('🎯 ThrowSystem: Already aiming, returning false');
      return false; // Already aiming
    }
    
    this.isAiming = true;
    this.aimTarget = initialTarget.clone();
    this.chargeLevel = 0;
    console.log('🎯 Started aiming mode in ThrowSystem');
    return true;
  }
  
  /**
   * Cancel aiming mode
   */
  public cancelAiming(): void {
    this.isAiming = false;
    this.aimTarget = null;
    this.chargeLevel = 0;
    console.log('🎯 Cancelled aiming mode');
  }
  
  /**
   * Execute the throw based on current aim and charge
   */
  public executeThrow(): boolean {
    if (!this.isAiming || !this.aimTarget || !this.cargoSystem) {
      console.warn('🎯 Cannot execute throw: not aiming or missing target/cargo system');
      return false;
    }
    
    // TODO: Get player position and cargo from CargoSystem
    // For now, this is a placeholder that resets aiming state
    console.log(`🎯 Executing throw to (${this.aimTarget.x}, ${this.aimTarget.y}) with charge ${this.chargeLevel}`);
    
    // Reset aiming state
    this.cancelAiming();
    
    // TODO: Actually execute the throw using existing throwCargo method
    return true;
  }
}
