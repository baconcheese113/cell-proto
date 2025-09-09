/**
 * VesicleEntity - Individual vesicle with XPBD physics integration
 * 
 * Vesicles are small spherical particles that can interact with the cell membrane
 * through collision, adhesion, and endocytosis processes. They follow the same
 * ConstraintParticle interface as membrane particles for seamless XPBD integration.
 */

// No direct Vector2 import needed - using Phaser.Math.Vector2

/**
 * Vesicle states during membrane interaction
 */
export enum VesicleState {
  FREE = 'free',           // Moving freely in cytoplasm
  APPROACHING = 'approaching', // Moving toward membrane
  ADHERED = 'adhered',     // Stuck to membrane surface
  ENDOCYTOSING = 'endocytosing', // Being engulfed by membrane
  INTERNALIZING = 'internalizing', // Transition phase - membrane pinching off
  INTERNALIZED = 'internalized'  // Fully inside membrane invagination
}

/**
 * VesicleEntity - Compatible with XPBD ConstraintParticle interface
 */
export class VesicleEntity {
  // Core ConstraintParticle interface properties
  public position: Phaser.Math.Vector2;
  public velocity: Phaser.Math.Vector2;
  public prevPosition: Phaser.Math.Vector2;
  public mass: number;
  public invMass: number;

  // Force accumulation for proper physics
  private accumulatedForce: Phaser.Math.Vector2;

  // Vesicle-specific properties
  public readonly id: string;
  public radius: number;
  public state: VesicleState;
  
  // Membrane interaction properties
  public membraneAdhesion: number = 0; // 0-1, strength of membrane attachment
  public preferredCurvature: number;   // Curvature value vesicle prefers
  public endocytosisProgress: number = 0; // 0-1, how far endocytosis has progressed
  
  // Internalization properties
  public internalizationProgress: number = 0; // 0-1, progress of membrane pinch-off
  public targetInternalPosition?: Phaser.Math.Vector2; // Final position inside cell
  public membraneBreakTime: number = 0; // Time when membrane connection should break
  
  // AI behavior properties
  public targetPosition?: Phaser.Math.Vector2;     // Where vesicle wants to move
  public membraneSeekingStrength: number; // How strongly attracted to membrane
  
  // Active Brownian motion properties
  public thermalNoise: number = 15.0;     // Thermal jitter intensity
  public selfPropulsion: number = 0.0;    // Self-propulsion velocity magnitude
  public propulsionDirection: Phaser.Math.Vector2; // Direction of self-propulsion
  public directionChangeRate: number = 2.0; // How often to change direction (per second)
  private lastDirectionChange: number = 0;
  
  // Network synchronization
  public lastNetworkUpdate: number = 0;
  public networkId?: string;
  public spawnTime: number = Date.now();

  constructor(
    id: string,
    x: number,
    y: number,
    radius: number = 15,
    mass: number = 1.0
  ) {
    this.id = id;
    this.position = new Phaser.Math.Vector2(x, y);
    this.velocity = new Phaser.Math.Vector2(0, 0);
    this.prevPosition = new Phaser.Math.Vector2(x, y);
    this.accumulatedForce = new Phaser.Math.Vector2(0, 0);
    this.radius = radius;
    this.mass = mass;
    this.invMass = mass > 0 ? 1.0 / mass : 0;
    this.state = VesicleState.FREE;
    
    // Default AI parameters
    this.preferredCurvature = 0.1; // Slight preference for curved surfaces
    this.membraneSeekingStrength = 0.3; // Moderate membrane attraction
    
    // Initialize Brownian motion
    this.propulsionDirection = new Phaser.Math.Vector2(
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
  }

  /**
   * Update vesicle physics using XPBD integration
   * This follows the same pattern as membrane particles
   */
  public integrateVerlet(deltaTime: number, damping: number = 0.99): void {
    if (this.invMass === 0) return; // Static vesicle
    
    // Store current position
    const currentPos = this.position.clone();
    
    // Calculate acceleration from accumulated forces
    const acceleration = this.accumulatedForce.clone().scale(this.invMass * deltaTime);
    
    // Verlet integration: pos = pos + (pos - prevPos) * damping + acceleration * dt^2
    const displacement = currentPos.clone().subtract(this.prevPosition).scale(damping);
    
    this.position.add(displacement).add(acceleration);
    this.prevPosition = currentPos;
    
    // Update velocity from position change
    this.velocity = this.position.clone().subtract(this.prevPosition).scale(1 / deltaTime);
    
    // Clear forces after integration
    this.clearForces();
  }

  /**
   * Apply force to vesicle (accumulates for next integration)
   */
  public addForce(force: Phaser.Math.Vector2): void {
    if (this.invMass === 0) return;
    
    // Accumulate forces instead of directly modifying velocity
    this.accumulatedForce.add(force);
  }

  /**
   * Clear accumulated forces (call after physics integration)
   */
  public clearForces(): void {
    this.accumulatedForce.set(0, 0);
  }

  /**
   * Apply active Brownian motion (thermal noise + self-propulsion)
   */
  public applyBrownianMotion(deltaTime: number): void {
    if (this.invMass === 0) return;
    
    // Thermal noise - Gaussian random kicks
    const thermalForce = new Phaser.Math.Vector2(
      (Math.random() - 0.5) * 2,  // -1 to 1
      (Math.random() - 0.5) * 2   // -1 to 1
    ).scale(this.thermalNoise * Math.sqrt(deltaTime));
    
    this.addForce(thermalForce);
    
    // Self-propulsion (optional)
    if (this.selfPropulsion > 0) {
      // Change direction occasionally
      const now = Date.now() / 1000; // Convert to seconds
      if (now - this.lastDirectionChange > 1.0 / this.directionChangeRate) {
        // Add some randomness to direction change
        const angle = Math.random() * Math.PI * 0.3 - Math.PI * 0.15; // ±27 degrees
        this.propulsionDirection.rotate(angle);
        this.lastDirectionChange = now;
      }
      
      const propulsionForce = this.propulsionDirection.clone().scale(this.selfPropulsion);
      this.addForce(propulsionForce);
    }
  }

  /**
   * Apply impulse for immediate velocity change
   */
  public addImpulse(impulse: Phaser.Math.Vector2): void {
    if (this.invMass === 0) return;
    
    const velocityChange = impulse.clone().scale(this.invMass);
    this.velocity.add(velocityChange);
  }

  /**
   * Set position directly (useful for constraints and collision response)
   */
  public setPosition(x: number, y: number): void {
    this.position.set(x, y);
  }

  /**
   * Get distance to another point
   */
  public distanceTo(point: Phaser.Math.Vector2): number {
    return this.position.distance(point);
  }

  /**
   * Get distance to another vesicle (center-to-center)
   */
  public distanceToVesicle(other: VesicleEntity): number {
    return this.distanceTo(other.position);
  }

  /**
   * Check if this vesicle overlaps with another
   */
  public overlapsWithVesicle(other: VesicleEntity): boolean {
    const distance = this.distanceToVesicle(other);
    return distance < (this.radius + other.radius);
  }

  /**
   * Get collision information with another vesicle
   */
  public getCollisionWithVesicle(other: VesicleEntity): {
    overlapping: boolean;
    penetration: number;
    normal: Phaser.Math.Vector2;
  } {
    const direction = other.position.clone().subtract(this.position);
    const distance = direction.length();
    const requiredDistance = this.radius + other.radius;
    
    const overlapping = distance < requiredDistance;
    const penetration = overlapping ? requiredDistance - distance : 0;
    const normal = distance > 0 ? direction.normalize() : new Phaser.Math.Vector2(1, 0);
    
    return { overlapping, penetration, normal };
  }

  /**
   * Update vesicle state based on membrane proximity and adhesion
   */
  public updateState(membraneDistance: number, adhesionThreshold: number = 25): void {
    switch (this.state) {
      case VesicleState.FREE:
        if (membraneDistance < adhesionThreshold * 2) {
          this.state = VesicleState.APPROACHING;
        }
        break;
        
      case VesicleState.APPROACHING:
        if (membraneDistance < adhesionThreshold) {
          this.state = VesicleState.ADHERED;
          this.membraneAdhesion = 0.5; // Start with medium adhesion
        } else if (membraneDistance > adhesionThreshold * 3) {
          this.state = VesicleState.FREE;
        }
        break;
        
      case VesicleState.ADHERED:
        if (this.membraneAdhesion > 0.8 && this.endocytosisProgress === 0) {
          this.state = VesicleState.ENDOCYTOSING;
        } else if (membraneDistance > adhesionThreshold * 1.5) {
          this.state = VesicleState.FREE;
          this.membraneAdhesion = 0;
        }
        break;
        
      case VesicleState.ENDOCYTOSING:
        if (this.endocytosisProgress >= 1.0) {
          this.state = VesicleState.INTERNALIZING;
          this.internalizationProgress = 0;
        }
        break;
        
      case VesicleState.INTERNALIZING:
        if (this.internalizationProgress >= 1.0) {
          this.state = VesicleState.INTERNALIZED;
        }
        break;
        
      case VesicleState.INTERNALIZED:
        // Vesicle is inside membrane pocket - special handling needed
        break;
    }
  }

  /**
   * Generate random movement force for AI behavior
   */
  public generateRandomForce(strength: number = 50): Phaser.Math.Vector2 {
    const angle = Math.random() * Math.PI * 2;
    return new Phaser.Math.Vector2(
      Math.cos(angle) * strength,
      Math.sin(angle) * strength
    );
  }

  /**
   * Generate force toward target position
   */
  public generateSeekingForce(target: Phaser.Math.Vector2, strength: number = 100): Phaser.Math.Vector2 {
    const direction = target.clone().subtract(this.position);
    const distance = direction.length();
    
    if (distance < 5) return new Phaser.Math.Vector2(0, 0); // Close enough
    
    return direction.normalize().scale(strength);
  }

  /**
   * Start internalization process - sets target position and begins transition
   */
  public startInternalization(targetPosition: Phaser.Math.Vector2, duration: number = 2000): void {
    this.state = VesicleState.INTERNALIZING;
    this.targetInternalPosition = targetPosition.clone();
    this.internalizationProgress = 0;
    this.membraneBreakTime = Date.now() + duration;
    
    console.log(`🫧 Vesicle ${this.id} starting internalization - moving to internal position`);
  }

  /**
   * Update internalization progress and position
   */
  public updateInternalization(deltaTime: number): boolean {
    if (this.state !== VesicleState.INTERNALIZING || !this.targetInternalPosition) {
      return false;
    }
    
    // Progress based on time (2-second internalization)
    this.internalizationProgress = Math.min(1, this.internalizationProgress + deltaTime * 0.5);
    
    // Smoothly interpolate position toward target
    const lerpFactor = this.internalizationProgress * this.internalizationProgress; // Ease-in
    const targetOffset = this.targetInternalPosition.clone().subtract(this.position);
    const movement = targetOffset.scale(lerpFactor * deltaTime * 2); // Smooth movement
    
    this.position.add(movement);
    
    // Apply different physics when internalizing - higher damping, less Brownian motion
    this.velocity.scale(0.85); // Strong damping during internalization
    
    // Complete internalization
    if (this.internalizationProgress >= 1.0) {
      this.state = VesicleState.INTERNALIZED;
      this.setPosition(this.targetInternalPosition.x, this.targetInternalPosition.y);
      console.log(`🫧 Vesicle ${this.id} internalization complete`);
      return true;
    }
    
    return false;
  }

  /**
   * Apply internalized vesicle physics - different behavior inside cell
   */
  public applyInternalizedPhysics(deltaTime: number): void {
    if (this.state !== VesicleState.INTERNALIZED) return;
    
    // Stronger damping inside cell
    this.velocity.scale(0.9);
    
    // Reduced Brownian motion intensity when internalized
    const internalThermalNoise = this.thermalNoise * 0.3; // 70% reduction
    const thermalForce = new Phaser.Math.Vector2(
      (Math.random() - 0.5) * internalThermalNoise * deltaTime,
      (Math.random() - 0.5) * internalThermalNoise * deltaTime
    );
    
    this.addForce(thermalForce);
    
    // No self-propulsion when internalized
    // Internal vesicles are more passive
  }

  /**
   * Serialize vesicle state for network synchronization
   */
  public serialize(): {
    id: string;
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    radius: number;
    state: VesicleState;
    membraneAdhesion: number;
    endocytosisProgress: number;
  } {
    return {
      id: this.id,
      position: { x: this.position.x, y: this.position.y },
      velocity: { x: this.velocity.x, y: this.velocity.y },
      radius: this.radius,
      state: this.state,
      membraneAdhesion: this.membraneAdhesion,
      endocytosisProgress: this.endocytosisProgress
    };
  }

  /**
   * Deserialize vesicle state from network data
   */
  public static deserialize(data: ReturnType<VesicleEntity['serialize']>): VesicleEntity {
    const vesicle = new VesicleEntity(
      data.id,
      data.position.x,
      data.position.y,
      data.radius
    );
    
    vesicle.velocity.set(data.velocity.x, data.velocity.y);
    vesicle.state = data.state;
    vesicle.membraneAdhesion = data.membraneAdhesion;
    vesicle.endocytosisProgress = data.endocytosisProgress;
    
    return vesicle;
  }

  /**
   * Create a copy of this vesicle
   */
  public clone(): VesicleEntity {
    const clone = new VesicleEntity(
      this.id + '_clone',
      this.position.x,
      this.position.y,
      this.radius,
      this.mass
    );
    
    clone.velocity = this.velocity.clone();
    clone.prevPosition = this.prevPosition.clone();
    clone.state = this.state;
    clone.membraneAdhesion = this.membraneAdhesion;
    clone.preferredCurvature = this.preferredCurvature;
    clone.endocytosisProgress = this.endocytosisProgress;
    clone.membraneSeekingStrength = this.membraneSeekingStrength;
    
    if (this.targetPosition) {
      clone.targetPosition = this.targetPosition.clone();
    }
    
    return clone;
  }
}

/**
 * Utility functions for vesicle management
 */
export class VesicleUtils {
  /**
   * Generate unique vesicle ID
   */
  static generateId(): string {
    return `vesicle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create random vesicle within bounds
   */
  static createRandom(
    bounds: { x: number; y: number; width: number; height: number },
    radiusRange: { min: number; max: number } = { min: 10, max: 20 }
  ): VesicleEntity {
    const id = VesicleUtils.generateId();
    const x = bounds.x + Math.random() * bounds.width;
    const y = bounds.y + Math.random() * bounds.height;
    const radius = radiusRange.min + Math.random() * (radiusRange.max - radiusRange.min);
    
    return new VesicleEntity(id, x, y, radius);
  }

  /**
   * Calculate vesicle-vesicle collision response
   */
  static resolveVesicleCollision(vesicle1: VesicleEntity, vesicle2: VesicleEntity): void {
    const collision = vesicle1.getCollisionWithVesicle(vesicle2);
    
    if (!collision.overlapping) return;
    
    // Calculate mass-weighted position correction
    const totalInvMass = vesicle1.invMass + vesicle2.invMass;
    if (totalInvMass === 0) return; // Both static
    
    const correction = collision.normal.clone().scale(collision.penetration);
    
    // Apply position corrections
    const correction1 = correction.clone().scale(-vesicle1.invMass / totalInvMass);
    const correction2 = correction.clone().scale(vesicle2.invMass / totalInvMass);
    
    vesicle1.position.add(correction1);
    vesicle2.position.add(correction2);
    
    // Apply velocity corrections (simple bounce)
    const relativeVelocity = vesicle2.velocity.clone().subtract(vesicle1.velocity);
    const velocityAlongNormal = relativeVelocity.dot(collision.normal);
    
    if (velocityAlongNormal > 0) return; // Objects separating
    
    const restitution = 0.7; // Bounce factor
    const impulseScalar = -(1 + restitution) * velocityAlongNormal / totalInvMass;
    const impulse = collision.normal.clone().scale(impulseScalar);
    
    vesicle1.addImpulse(impulse.clone().scale(-1));
    vesicle2.addImpulse(impulse);
  }
}
