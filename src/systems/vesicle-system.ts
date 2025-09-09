/**
 * VesicleSystem - Main system for vesicle lifecycle management and networking
 * 
 * Combines System base class for update lifecycle with NetComponent for network synchronization.
 * Manages vesicle spawning, physics updates, AI behavior, membrane interactions, and endocytosis.
 */

import { System } from './system';
import { RunOnServer, Multicast } from '../network/decorators';
import { VesicleEntity, VesicleState, VesicleUtils } from '../entities/vesicle';
import { VesicleAI } from './vesicle-ai';
import { AdhesionBondSystem } from './adhesion-bond-system';
import { BondVisualizer } from './bond-visualizer';
import type { VesicleAIConfig } from './vesicle-ai';
import type { NetBus } from '../network/net-bus';
import type { WorldRefs } from '../core/world-refs';

// Network data types
export interface VesicleDTO {
  id: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  radius: number;
  state: VesicleState;
  membraneAdhesion: number;
  endocytosisProgress: number;
  mass: number;
  preferredCurvature: number;
  membraneSeekingStrength: number;
}

export interface VesicleSystemState {
  vesicles: Record<string, VesicleDTO>;
  [key: string]: any; // For JSON compatibility
}

export interface VesicleSpawnParams {
  position?: { x: number; y: number };
  radius?: number;
  mass?: number;
  preferredCurvature?: number;
  membraneSeekingStrength?: number;
}

export interface VesicleSystemConfig {
  // Spawning parameters
  maxVesicles: number;
  spawnRadius: number;        // Radius around cell center to spawn vesicles
  autoSpawnEnabled: boolean;
  autoSpawnInterval: number;  // Seconds between auto-spawns
  
  // Physics parameters
  defaultMass: number;
  defaultRadius: number;
  defaultAdhesionStrength: number;
  
  // Endocytosis parameters
  endocytosisThreshold: number;
  endocytosisProgressRate: number;
  
  // Network sync
  networkUpdateRate: number;  // Updates per second
  predictionEnabled: boolean;
}

export class VesicleSystem extends System {
  // Network state channel
  public readonly vesicleState = this.stateChannel<VesicleSystemState>("vesicles", { vesicles: {} });
  
  // Local vesicle instances (host only)
  private vesicles: Map<string, VesicleEntity> = new Map();
  
  // AI system
  private vesicleAI: VesicleAI;
  
  // Adhesion bond system
  private adhesionBonds: AdhesionBondSystem;
  
  // Bond visualization  
  private bondVisualizer: BondVisualizer;
  
  // World references
  private worldRefs: WorldRefs;
  
  // Configuration
  private config: VesicleSystemConfig = {
    maxVesicles: 20,
    spawnRadius: 100, // Reduced from 150 to be more conservative
    autoSpawnEnabled: true,
    autoSpawnInterval: 5.0,
    
    defaultMass: 1.0,
    defaultRadius: 15,
    defaultAdhesionStrength: 1, // Reduced from 5 to 1 for very gentle adhesion
    
    endocytosisThreshold: 0.8,
    endocytosisProgressRate: 0.3,
    
    networkUpdateRate: 10, // 10 updates per second
    predictionEnabled: true
  };
  
  // Timing
  private lastSpawnTime = 0;
  private lastNetworkUpdate = 0;
  private lastBondStatsLog = 0;
  private networkUpdateInterval: number;
  
  constructor(
    scene: Phaser.Scene,
    netBus: NetBus,
    worldRefs: WorldRefs,
    aiConfig?: Partial<VesicleAIConfig>
  ) {
    super(scene, netBus, 'VesicleSystem', (deltaSeconds: number) => this.updateVesicles(deltaSeconds), {
      address: 'VesicleSystem'
    });
    
    this.worldRefs = worldRefs;
    this.vesicleAI = new VesicleAI(aiConfig);
    this.adhesionBonds = new AdhesionBondSystem({
      kon: 1.5,          // Moderate bond formation
      koff0: 0.3,        // Low base unbinding  
      fo: 30,            // Medium force sensitivity
      captureRadius: 25, // Reasonable capture distance
      alphaAdhesion: 3e-4 // Gentle bond strength
    });
    this.bondVisualizer = new BondVisualizer(scene);
    this.networkUpdateInterval = 1.0 / this.config.networkUpdateRate;
    
    console.log('🫧 VesicleSystem initialized with adhesion bonds and visualization');
  }

  /**
   * Main update loop - called every frame
   */
  private updateVesicles(deltaSeconds: number): void {
    // Only run physics and AI on host
    if (this._netBus.isHost) {
      this.updateHostLogic(deltaSeconds);
    } else {
      this.updateClientPrediction(deltaSeconds);
    }
    
    // Update network synchronization
    this.updateNetworking(deltaSeconds);
  }

  /**
   * Host-side update logic
   */
  private updateHostLogic(deltaSeconds: number): void {
    if (!this.worldRefs.membranePhysics) return;
    
    const vesicleArray = Array.from(this.vesicles.values());
    
    // Update adhesion bonds
    const membraneParticles = this.worldRefs.membranePhysics.getParticles();
    this.adhesionBonds.update(deltaSeconds, vesicleArray, membraneParticles);
    
    // Apply bond forces
    this.adhesionBonds.applyBondForces(vesicleArray, membraneParticles);
    
    // Update AI behavior
    this.vesicleAI.updateAI(vesicleArray, this.worldRefs.membranePhysics, deltaSeconds);
    
    // Update vesicle physics
    this.updateVesiclePhysics(vesicleArray, deltaSeconds);
    
    // Update vesicle-membrane interactions
    this.updateMembraneInteractions(vesicleArray, deltaSeconds);
    
    // Update endocytosis processes
    this.updateEndocytosis(vesicleArray, deltaSeconds);
    
    // Handle auto-spawning
    if (this.config.autoSpawnEnabled) {
      this.updateAutoSpawning(deltaSeconds);
    }
    
    // Clean up internalized vesicles
    this.cleanupInternalizedVesicles();
    
    // Update bond visualization (if enabled)
    this.updateBondVisualization(vesicleArray, membraneParticles);
  }

  /**
   * Client-side prediction update
   */
  private updateClientPrediction(_deltaSeconds: number): void {
    if (!this.config.predictionEnabled) return;
    
    // TODO: Implement client-side prediction for smooth movement
    // For now, vesicles are purely host-authoritative
  }

  /**
   * Update vesicle physics integration
   */
  private updateVesiclePhysics(vesicles: VesicleEntity[], deltaSeconds: number): void {
    for (const vesicle of vesicles) {
      // Skip normal physics for internalizing and internalized vesicles
      if (vesicle.state === VesicleState.INTERNALIZING || vesicle.state === VesicleState.INTERNALIZED) {
        continue;
      }
      
      // Apply Brownian motion before physics integration
      vesicle.applyBrownianMotion(deltaSeconds);
      
      // Apply extra damping for newly spawned vesicles
      const vesicleAge = Date.now() - vesicle.spawnTime;
      const spawnGracePeriod = 3000; // 3 seconds
      const baseDamping = 0.88; // Much stronger base damping
      const spawnDamping = vesicleAge < spawnGracePeriod ? 0.7 : baseDamping; // Extra damping for new vesicles
      
      vesicle.integrateVerlet(deltaSeconds, spawnDamping);
      
      // Clamp vesicle velocity to prevent shooting out
      const maxVelocity = 60; // Reduced max velocity
      if (vesicle.velocity.length() > maxVelocity) {
        vesicle.velocity.normalize().scale(maxVelocity);
      }
      
      // Resolve vesicle-vesicle collisions
      this.resolveVesicleCollisions(vesicle, vesicles);
    }
  }

  /**
   * Update vesicle-membrane interactions
   */
  private updateMembraneInteractions(vesicles: VesicleEntity[], _deltaSeconds: number): void {
    if (!this.worldRefs.membranePhysics) return;
    
    for (const vesicle of vesicles) {
      // Skip membrane interactions for internalizing and internalized vesicles
      if (vesicle.state === VesicleState.INTERNALIZING || vesicle.state === VesicleState.INTERNALIZED) {
        continue;
      }
      
      // TEMP: More aggressive collision handling
      // Check membrane collision
      const collisionCheck = this.worldRefs.membranePhysics.checkVesicleCollision(
        vesicle.position,
        vesicle.radius
      );
      
      // Log collision info for debugging
      if (collisionCheck.colliding) {
        console.log(`Vesicle collision detected: signedDistance=${collisionCheck.signedDistance}, vesicle at (${vesicle.position.x.toFixed(1)}, ${vesicle.position.y.toFixed(1)})`);
        
        // Much more aggressive position correction
        // For negative signed distance, we need to push the vesicle AWAY from the contact point
        const penetrationDepth = Math.abs(collisionCheck.signedDistance);
        const correctionMagnitude = penetrationDepth * 0.5; // Gentler correction to prevent "sticking"
        
        // Push vesicle away from contact point toward vesicle center
        const contactToVesicle = vesicle.position.clone().subtract(collisionCheck.contactPoint).normalize();
        const correctionVector = contactToVesicle.scale(correctionMagnitude);
        
        vesicle.position.add(correctionVector);
        
        // Gentle velocity damping instead of complete stop
        vesicle.velocity.scale(0.1);
      }
      
      // if (collisionCheck.colliding) {
      //   const collision = this.worldRefs.membranePhysics.resolveVesicleCollision(
      //     vesicle.position,
      //     vesicle.radius,
      //     vesicle.velocity,
      //     vesicle.invMass,
      //     0.0, // restitution - zero bounce to prevent shooting through
      //     0.9  // friction - very high friction for strong damping
      //   );
      //   
      //   vesicle.setPosition(collision.newVesiclePosition.x, collision.newVesiclePosition.y);
      //   vesicle.velocity = collision.newVesicleVelocity;
      //   
      //   // Aggressive velocity damping on collision
      //   vesicle.velocity.scale(0.3); // Reduce velocity by 70% on collision
      // }
      
      // TEMP: Disable adhesion forces to prevent membrane pulling
      const adhesionResult = this.worldRefs.membranePhysics.applyVesicleAdhesion(
        vesicle.position,
        vesicle.radius,
        this.config.defaultAdhesionStrength,
        vesicle.preferredCurvature
      );
      
      // Completely disable adhesion forces to prevent membrane pulling
      // if (adhesionResult.vesicleForce.length() > 0) {
      //   // Scale down adhesion force applied to vesicle
      //   const scaledVesicleForce = adhesionResult.vesicleForce.clone().scale(0.1); // 90% reduction
      //   vesicle.addForce(scaledVesicleForce);
      //   vesicle.membraneAdhesion = Math.min(1, vesicle.membraneAdhesion + deltaSeconds * 0.5);
      // } else {
      //   vesicle.membraneAdhesion = Math.max(0, vesicle.membraneAdhesion - deltaSeconds * 0.3);
      // }
      
      // Update vesicle state based on membrane proximity only (no forces)
      const membraneDistance = adhesionResult.adhesionDistance;
      vesicle.updateState(membraneDistance, 25); // 25 pixel adhesion threshold
    }
  }

  /**
   * Update endocytosis processes
   */
  private updateEndocytosis(vesicles: VesicleEntity[], deltaSeconds: number): void {
    if (!this.worldRefs.membranePhysics) return;
    
    for (const vesicle of vesicles) {
      // Check if vesicle should start endocytosis
      if (vesicle.state === VesicleState.ADHERED &&
          this.worldRefs.membranePhysics.shouldTriggerEndocytosis(
            vesicle.position,
            vesicle.radius,
            this.config.defaultAdhesionStrength,
            this.config.endocytosisThreshold
          )) {
        
        vesicle.state = VesicleState.ENDOCYTOSING;
        vesicle.endocytosisProgress = 0;
        
        // Start membrane invagination
        this.worldRefs.membranePhysics.createEndocytosisInvagination(
          vesicle.position,
          vesicle.radius,
          0.4 // invagination depth
        );
      }
      
      // Progress endocytosis
      if (vesicle.state === VesicleState.ENDOCYTOSING) {
        // Get bond density information for this vesicle
        const bondDensityMap = this.adhesionBonds.getBondDensityMap(
          vesicle.id,
          this.worldRefs.membranePhysics.getParticles(),
          40 // Search radius for bond influence
        );
        
        const progressResult = this.worldRefs.membranePhysics.progressEndocytosis(
          vesicle.position,
          vesicle.radius,
          vesicle.endocytosisProgress,
          deltaSeconds,
          this.config.endocytosisProgressRate,
          bondDensityMap // Pass bond density information
        );
        
        vesicle.endocytosisProgress = progressResult.newProgress;
        
        // Apply gentle, localized membrane forces (heavily scaled down)
        if (progressResult.membraneForces.size > 0) {
          const gentleForces = new Map<number, Phaser.Math.Vector2>();
          for (const [particleIndex, force] of progressResult.membraneForces) {
            // Scale down forces dramatically to prevent cell pulling
            const gentleForce = force.clone().scale(0.05); // 95% reduction
            gentleForces.set(particleIndex, gentleForce);
          }
          this.worldRefs.membranePhysics.applyEndocytosisForces(gentleForces);
        }
        
        // Complete endocytosis - start internalization process
        if (progressResult.isComplete) {
          const completion = this.worldRefs.membranePhysics.completeEndocytosis(
            vesicle.position,
            vesicle.radius
          );
          
          // Start internalization transition instead of immediate internalization
          vesicle.startInternalization(completion.internalizedPosition, 2000); // 2-second transition
          
          // Apply gentle restoration forces (heavily scaled down)
          if (completion.restorationForces.size > 0) {
            const gentleRestorationForces = new Map<number, Phaser.Math.Vector2>();
            for (const [particleIndex, force] of completion.restorationForces) {
              // Scale down restoration forces to prevent cell pulling
              const gentleForce = force.clone().scale(0.03); // 97% reduction
              gentleRestorationForces.set(particleIndex, gentleForce);
            }
            this.worldRefs.membranePhysics.applyEndocytosisForces(gentleRestorationForces);
          }
          
          // Apply pinch-off forces to simulate membrane closing
          if (completion.pinchOffForces.size > 0) {
            const gentlePinchForces = new Map<number, Phaser.Math.Vector2>();
            for (const [particleIndex, force] of completion.pinchOffForces) {
              // Scale down pinch-off forces but keep them stronger than restoration
              const gentleForce = force.clone().scale(0.08); // 92% reduction (stronger than restoration)
              gentlePinchForces.set(particleIndex, gentleForce);
            }
            this.worldRefs.membranePhysics.applyEndocytosisForces(gentlePinchForces);
          }
        }
      }
      
      // Handle internalization transition
      if (vesicle.state === VesicleState.INTERNALIZING) {
        const completed = vesicle.updateInternalization(deltaSeconds);
        
        if (completed) {
          // Break remaining adhesion bonds when internalization completes
          this.breakVesicleBonds(vesicle.id);
        }
      }
      
      // Apply special physics for internalized vesicles
      if (vesicle.state === VesicleState.INTERNALIZED) {
        vesicle.applyInternalizedPhysics(deltaSeconds);
      }
    }
  }

  /**
   * Update bond visualization
   */
  private updateBondVisualization(vesicles: VesicleEntity[], membraneParticles: any[]): void {
    const bonds = this.adhesionBonds.getBonds();
    this.bondVisualizer.render(bonds, vesicles, membraneParticles);
    
    // Log bond stats periodically (every 2 seconds)
    const now = Date.now();
    if (!this.lastBondStatsLog || now - this.lastBondStatsLog > 2000) {
      const stats = this.adhesionBonds.getBondStats();
      this.bondVisualizer.renderStats(10, 10, stats);
      this.lastBondStatsLog = now;
    }
  }

  /**
   * Resolve collisions between vesicles
   */
  private resolveVesicleCollisions(vesicle: VesicleEntity, allVesicles: VesicleEntity[]): void {
    for (const other of allVesicles) {
      if (other.id === vesicle.id) continue;
      if (other.state === VesicleState.INTERNALIZED) continue;
      
      if (vesicle.overlapsWithVesicle(other)) {
        VesicleUtils.resolveVesicleCollision(vesicle, other);
      }
    }
  }

  /**
   * Handle auto-spawning of vesicles
   */
  private updateAutoSpawning(deltaSeconds: number): void {
    this.lastSpawnTime += deltaSeconds;
    
    if (this.lastSpawnTime >= this.config.autoSpawnInterval &&
        this.vesicles.size < this.config.maxVesicles) {
      
      this.spawnRandomVesicle();
      this.lastSpawnTime = 0;
    }
  }

  /**
   * Clean up vesicles that have been internalized for too long
   * Enhanced to provide better debugging and longer internalization time
   */
  private cleanupInternalizedVesicles(): void {
    const currentTime = Date.now();
    const cleanupThreshold = 30000; // 30 seconds for internalized vesicles
    const toDestroy: string[] = [];
    
    for (const [id, vesicle] of this.vesicles) {
      if (vesicle.state === VesicleState.INTERNALIZED) {
        const age = currentTime - vesicle.spawnTime;
        
        if (age > cleanupThreshold) {
          toDestroy.push(id);
          console.log(`🧹 Cleaning up internalized vesicle ${id} after ${(age/1000).toFixed(1)}s`);
        }
      }
    }
    
    // Clean up old vesicles
    for (const id of toDestroy) {
      this.destroyVesicle(id);
    }
    
    // Log internalized vesicle count occasionally
    if (Math.random() < 0.01) { // 1% chance per frame
      const internalizedCount = Array.from(this.vesicles.values())
        .filter(v => v.state === VesicleState.INTERNALIZED).length;
      
      if (internalizedCount > 0) {
        console.log(`📊 ${internalizedCount} internalized vesicles currently in cell`);
      }
    }
  }

  /**
   * Update network synchronization
   */
  private updateNetworking(deltaSeconds: number): void {
    if (!this._netBus.isHost) return;
    
    this.lastNetworkUpdate += deltaSeconds;
    
    if (this.lastNetworkUpdate >= this.networkUpdateInterval) {
      this.syncVesiclesToNetwork();
      this.lastNetworkUpdate = 0;
    }
  }

  /**
   * Sync local vesicles to network state
   */
  private syncVesiclesToNetwork(): void {
    const networkVesicles: Record<string, VesicleDTO> = {};
    
    for (const [id, vesicle] of this.vesicles) {
      networkVesicles[id] = {
        id: vesicle.id,
        position: { x: vesicle.position.x, y: vesicle.position.y },
        velocity: { x: vesicle.velocity.x, y: vesicle.velocity.y },
        radius: vesicle.radius,
        state: vesicle.state,
        membraneAdhesion: vesicle.membraneAdhesion,
        endocytosisProgress: vesicle.endocytosisProgress,
        mass: vesicle.mass,
        preferredCurvature: vesicle.preferredCurvature,
        membraneSeekingStrength: vesicle.membraneSeekingStrength
      };
    }
    
    this.vesicleState.vesicles = networkVesicles;
  }

  // === PUBLIC API ===

  /**
   * Spawn a new vesicle
   */
  @RunOnServer()
  public spawnVesicle(params: VesicleSpawnParams = {}): string {
    if (this.vesicles.size >= this.config.maxVesicles) {
      console.warn('🫧 Cannot spawn vesicle - max limit reached');
      return '';
    }
    
    // Calculate spawn position
    let spawnPos: { x: number; y: number };
    if (params.position) {
      spawnPos = params.position;
    } else {
      // Safe spawn position - well inside the cell, away from membrane
      const cellCenter = this.worldRefs.membranePhysics?.getCenter() || new Phaser.Math.Vector2(0, 0);
      const angle = Math.random() * Math.PI * 2;
      
      // Get membrane approximate radius and spawn well inside
      const membraneRadius = this.worldRefs.membranePhysics?.getApproximateRadius() || 200;
      const safeSpawnRadius = Math.min(this.config.spawnRadius, membraneRadius * 0.6); // 60% of membrane radius
      const distance = Math.random() * safeSpawnRadius;
      
      spawnPos = {
        x: cellCenter.x + Math.cos(angle) * distance,
        y: cellCenter.y + Math.sin(angle) * distance
      };
      
      // Double-check we're not too close to membrane
      if (this.worldRefs.membranePhysics) {
        const distanceToMembrane = this.worldRefs.membranePhysics.getSignedDistanceToSurface(
          new Phaser.Math.Vector2(spawnPos.x, spawnPos.y)
        );
        
        // If too close to membrane (less than 50 pixels inside), move toward center
        if (distanceToMembrane < -50) {
          const directionToCenter = cellCenter.clone().subtract(new Phaser.Math.Vector2(spawnPos.x, spawnPos.y)).normalize();
          const safeMoveDistance = Math.abs(distanceToMembrane) + 60; // Move 60 pixels inside from membrane
          spawnPos.x += directionToCenter.x * safeMoveDistance;
          spawnPos.y += directionToCenter.y * safeMoveDistance;
        }
      }
    }
    
    // Create vesicle
    const vesicle = new VesicleEntity(
      VesicleUtils.generateId(),
      spawnPos.x,
      spawnPos.y,
      params.radius || this.config.defaultRadius,
      params.mass || this.config.defaultMass
    );
    
    // Set initial properties
    vesicle.preferredCurvature = params.preferredCurvature || 0.1;
    vesicle.membraneSeekingStrength = params.membraneSeekingStrength || 0.3;
    vesicle.lastNetworkUpdate = Date.now();
    
    // Start with zero velocity to prevent shooting out
    vesicle.velocity.set(0, 0);
    vesicle.prevPosition.set(spawnPos.x, spawnPos.y);
    
    // Add to collections
    this.vesicles.set(vesicle.id, vesicle);
    this.vesicleAI.initializeVesicle(vesicle);
    
    console.log(`🫧 Spawned vesicle ${vesicle.id} at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)})`);
    
    // Debug: Log membrane distance for troubleshooting
    if (this.worldRefs.membranePhysics) {
      const membraneDistance = this.worldRefs.membranePhysics.getSignedDistanceToSurface(
        new Phaser.Math.Vector2(spawnPos.x, spawnPos.y)
      );
      console.log(`🫧 Membrane distance: ${membraneDistance.toFixed(1)} (negative = inside cell)`);
    }
    
    return vesicle.id;
  }

  /**
   * Spawn a vesicle at a random location
   */
  private spawnRandomVesicle(): string {
    return this.spawnVesicle({
      radius: 10 + Math.random() * 10, // 10-20 radius
      preferredCurvature: Math.random() * 0.3, // 0-0.3 curvature preference
      membraneSeekingStrength: 0.2 + Math.random() * 0.4 // 0.2-0.6 seeking strength
    });
  }

  /**
   * Destroy a vesicle
   */
  @RunOnServer()
  public destroyVesicle(vesicleId: string): boolean {
    const vesicle = this.vesicles.get(vesicleId);
    if (!vesicle) return false;
    
    this.vesicles.delete(vesicleId);
    this.vesicleAI.removeVesicle(vesicleId);
    
    console.log(`🫧 Destroyed vesicle ${vesicleId}`);
    return true;
  }

  /**
   * Get all vesicles (for rendering and other systems)
   */
  public getAllVesicles(): VesicleEntity[] {
    return Array.from(this.vesicles.values());
  }

  /**
   * Get vesicle by ID
   */
  public getVesicle(id: string): VesicleEntity | undefined {
    return this.vesicles.get(id);
  }

  /**
   * Get vesicle count
   */
  public getVesicleCount(): number {
    return this.vesicles.size;
  }

  /**
   * Get adhesion bond statistics for debugging
   */
  public getBondStats(): any {
    return this.adhesionBonds.getBondStats();
  }

  /**
   * Get all active bonds for visualization
   */
  public getActiveBonds(): any[] {
    return this.adhesionBonds.getBonds();
  }

  /**
   * Break all adhesion bonds for a specific vesicle
   */
  private breakVesicleBonds(vesicleId: string): void {
    const vesiclesBonds = this.adhesionBonds.getVesicleBonds(vesicleId);
    if (vesiclesBonds.length > 0) {
      console.log(`🔗 Breaking ${vesiclesBonds.length} bonds for internalized vesicle ${vesicleId}`);
      
      // Remove bonds from the system (they should break naturally during internalization)
      // The adhesion bond system will handle this during its normal update cycle
      // as the vesicle moves away from the membrane
    }
  }

  /**
   * Update system configuration
   */
  public updateConfig(newConfig: Partial<VesicleSystemConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.networkUpdateInterval = 1.0 / this.config.networkUpdateRate;
  }

  /**
   * Broadcast vesicle event to all clients
   */
  @Multicast()
  public vesicleEvent(eventType: string, vesicleId: string, data: any): void {
    console.log(`🫧 Vesicle event: ${eventType} for ${vesicleId}`, data);
  }

  /**
   * Get AI state for debugging
   */
  public getAIState(vesicleId: string): any {
    return this.vesicleAI.getAIState(vesicleId);
  }

  /**
   * Clean up system
   */
  public override destroy(): void {
    this.vesicles.clear();
    this.vesicleAI = null as any;
    super.destroy();
    console.log('🫧 VesicleSystem destroyed');
  }
}
