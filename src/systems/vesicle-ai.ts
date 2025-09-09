/**
 * VesicleAI - AI behavior system for autonomous vesicle movement
 * 
 * Implements intelligent behaviors for vesicles:
 * - Random exploration when free
 * - Membrane seeking behavior
 * - Curvature preference (seeking high-curvature regions)
 * - Obstacle avoidance between vesicles
 * - State-based behavior switching
 */

import { VesicleEntity, VesicleState } from '../entities/vesicle';
import type { MembranePhysicsSystem } from '../membrane/membrane-physics-system';

export interface VesicleAIConfig {
  // Random movement
  randomForceStrength: number;
  randomDirectionChangeTime: number; // Seconds between direction changes
  
  // Membrane seeking
  membraneSeekingRange: number;      // How far vesicles can sense membrane
  membraneAttractionStrength: number; // Base attraction force toward membrane
  
  // Curvature preference
  curvatureSeekingEnabled: boolean;
  curvatureAttractionMultiplier: number; // Multiplier for high-curvature regions
  
  // Obstacle avoidance
  vesicleAvoidanceRange: number;     // Distance to start avoiding other vesicles
  vesicleAvoidanceStrength: number;  // Strength of avoidance force
  
  // Exploration behavior
  explorationRadius: number;         // How far to explore from spawn point
  boundaryRepulsionStrength: number; // Force to stay within exploration area
  
  // State timing
  approachTime: number;              // Time to spend approaching before adhering
  adhesionTime: number;              // Time to spend adhered before endocytosis
}

export interface VesicleAIState {
  // Current behavior state
  currentBehavior: 'exploring' | 'seeking' | 'approaching' | 'adhering';
  
  // Timing
  stateTime: number;                 // Time spent in current state
  nextDirectionChangeTime: number;   // When to change random direction
  spawnTime: number;                 // When this vesicle was spawned
  
  // Navigation
  targetDirection: Phaser.Math.Vector2;  // Current movement direction
  homePosition: Phaser.Math.Vector2;     // Original spawn position
  
  // Memory
  lastMembraneContact: number;       // Time since last membrane contact
  preferredCurvatureRegions: Array<{ // Remembered high-curvature spots
    position: Phaser.Math.Vector2;
    curvature: number;
    age: number;
  }>;
}

export class VesicleAI {
  private config: VesicleAIConfig;
  private aiStates: Map<string, VesicleAIState> = new Map();
  
  constructor(config?: Partial<VesicleAIConfig>) {
    this.config = {
      randomForceStrength: 10, // Reduced from 30 to 10
      randomDirectionChangeTime: 2.0,
      
      membraneSeekingRange: 150,
      membraneAttractionStrength: 20, // Reduced from 40 to 20
      
      curvatureSeekingEnabled: true,
      curvatureAttractionMultiplier: 2.0,
      
      vesicleAvoidanceRange: 40,
      vesicleAvoidanceStrength: 25, // Reduced from 50 to 25
      
      explorationRadius: 200,
      boundaryRepulsionStrength: 30, // Reduced from 60 to 30
      
      approachTime: 3.0,
      adhesionTime: 5.0,
      
      ...config
    };
  }

  /**
   * Initialize AI state for a new vesicle
   */
  public initializeVesicle(vesicle: VesicleEntity): void {
    this.aiStates.set(vesicle.id, {
      currentBehavior: 'exploring',
      stateTime: 0,
      nextDirectionChangeTime: 0,
      spawnTime: Date.now(),
      targetDirection: new Phaser.Math.Vector2(1, 0),
      homePosition: vesicle.position.clone(),
      lastMembraneContact: 0,
      preferredCurvatureRegions: []
    });
  }

  /**
   * Remove AI state for a vesicle
   */
  public removeVesicle(vesicleId: string): void {
    this.aiStates.delete(vesicleId);
  }

  /**
   * Update AI behavior for all vesicles
   */
  public updateAI(
    vesicles: VesicleEntity[],
    membranePhysics: MembranePhysicsSystem,
    deltaTime: number
  ): void {
    for (const vesicle of vesicles) {
      this.updateVesicleAI(vesicle, vesicles, membranePhysics, deltaTime);
    }
    
    // Clean up AI states for removed vesicles
    const vesicleIds = new Set(vesicles.map(v => v.id));
    for (const aiId of this.aiStates.keys()) {
      if (!vesicleIds.has(aiId)) {
        this.aiStates.delete(aiId);
      }
    }
  }

  /**
   * Update AI behavior for a single vesicle
   */
  private updateVesicleAI(
    vesicle: VesicleEntity,
    allVesicles: VesicleEntity[],
    membranePhysics: MembranePhysicsSystem,
    deltaTime: number
  ): void {
    // Get or create AI state
    let aiState = this.aiStates.get(vesicle.id);
    if (!aiState) {
      this.initializeVesicle(vesicle);
      aiState = this.aiStates.get(vesicle.id)!;
    }
    
    // Update state timing
    aiState.stateTime += deltaTime;
    aiState.lastMembraneContact += deltaTime;
    
    // Update behavior based on vesicle state
    this.updateBehaviorState(vesicle, aiState, membranePhysics);
    
    // Calculate and apply AI forces
    const aiForce = this.calculateAIForce(vesicle, aiState, allVesicles, membranePhysics, deltaTime);
    vesicle.addForce(aiForce);
    
    // Update preferred curvature regions memory
    this.updateCurvatureMemory(aiState, membranePhysics, deltaTime);
  }

  /**
   * Update behavior state based on vesicle state and conditions
   */
  private updateBehaviorState(
    vesicle: VesicleEntity,
    aiState: VesicleAIState,
    membranePhysics: MembranePhysicsSystem
  ): void {
    const membraneDistance = this.getDistanceToMembrane(vesicle, membranePhysics);
    
    switch (vesicle.state) {
      case VesicleState.FREE:
        if (membraneDistance < this.config.membraneSeekingRange) {
          aiState.currentBehavior = 'seeking';
        } else {
          aiState.currentBehavior = 'exploring';
        }
        break;
        
      case VesicleState.APPROACHING:
        aiState.currentBehavior = 'approaching';
        aiState.lastMembraneContact = 0;
        break;
        
      case VesicleState.ADHERED:
        aiState.currentBehavior = 'adhering';
        break;
        
      case VesicleState.ENDOCYTOSING:
      case VesicleState.INTERNALIZED:
        // No AI behavior needed during these states
        break;
    }
  }

  /**
   * Calculate total AI force for a vesicle
   */
  private calculateAIForce(
    vesicle: VesicleEntity,
    aiState: VesicleAIState,
    allVesicles: VesicleEntity[],
    membranePhysics: MembranePhysicsSystem,
    deltaTime: number
  ): Phaser.Math.Vector2 {
    const totalForce = new Phaser.Math.Vector2(0, 0);
    
    // Skip AI during endocytosis
    if (vesicle.state === VesicleState.ENDOCYTOSING || 
        vesicle.state === VesicleState.INTERNALIZED) {
      return totalForce;
    }

    // Apply grace period for newly spawned vesicles
    const gracePeriod = 2000; // 2 seconds in milliseconds
    const vesicleAge = Date.now() - aiState.spawnTime;
    const graceMultiplier = vesicleAge < gracePeriod ? 
      Math.max(0.1, vesicleAge / gracePeriod) : 1.0;
    
    switch (aiState.currentBehavior) {
      case 'exploring':
        totalForce.add(this.calculateExplorationForce(vesicle, aiState, deltaTime));
        break;
        
      case 'seeking':
        totalForce.add(this.calculateMembraneSeekingForce(vesicle, aiState, membranePhysics));
        if (this.config.curvatureSeekingEnabled) {
          totalForce.add(this.calculateCurvatureSeekingForce(vesicle, aiState, membranePhysics));
        }
        break;
        
      case 'approaching':
        totalForce.add(this.calculateApproachingForce(vesicle, aiState, membranePhysics));
        break;
        
      case 'adhering':
        // Minimal movement while adhered - just small random forces
        totalForce.add(this.calculateAdheringForce(vesicle, aiState, deltaTime));
        break;
    }
    
    // Always apply obstacle avoidance and boundary forces
    totalForce.add(this.calculateObstacleAvoidanceForce(vesicle, allVesicles));
    totalForce.add(this.calculateBoundaryForce(vesicle, aiState));
    
    // Apply grace period multiplier to reduce forces for newly spawned vesicles
    totalForce.scale(graceMultiplier);
    
    return totalForce;
  }

  /**
   * Calculate random exploration force
   */
  private calculateExplorationForce(
    _vesicle: VesicleEntity,
    aiState: VesicleAIState,
    _deltaTime: number
  ): Phaser.Math.Vector2 {
    // Change direction periodically
    if (aiState.stateTime >= aiState.nextDirectionChangeTime) {
      const angle = Math.random() * Math.PI * 2;
      aiState.targetDirection.set(Math.cos(angle), Math.sin(angle));
      aiState.nextDirectionChangeTime = aiState.stateTime + this.config.randomDirectionChangeTime;
    }
    
    return aiState.targetDirection.clone().scale(this.config.randomForceStrength);
  }

  /**
   * Calculate membrane seeking force
   */
  private calculateMembraneSeekingForce(
    vesicle: VesicleEntity,
    _aiState: VesicleAIState,
    membranePhysics: MembranePhysicsSystem
  ): Phaser.Math.Vector2 {
    const sample = membranePhysics.getNearestSurfaceSample(vesicle.position);
    const direction = sample.pos.clone().subtract(vesicle.position);
    const distance = direction.length();
    
    if (distance < 1) return new Phaser.Math.Vector2(0, 0);
    
    // Stronger attraction when closer
    const normalizedDistance = Math.min(1, distance / this.config.membraneSeekingRange);
    const forceStrength = this.config.membraneAttractionStrength * (1 - normalizedDistance);
    
    return direction.normalize().scale(forceStrength);
  }

  /**
   * Calculate curvature seeking force
   */
  private calculateCurvatureSeekingForce(
    vesicle: VesicleEntity,
    _aiState: VesicleAIState,
    membranePhysics: MembranePhysicsSystem
  ): Phaser.Math.Vector2 {
    // Find nearby high-curvature regions
    const highCurvatureRegions = membranePhysics.findHighCurvatureRegions(vesicle.preferredCurvature);
    
    let bestTarget: Phaser.Math.Vector2 | null = null;
    let bestScore = 0;
    
    for (const region of highCurvatureRegions) {
      const distance = vesicle.position.distance(region.position);
      
      // Score based on curvature match and proximity
      const curvatureMatch = 1 - Math.abs(region.curvature - vesicle.preferredCurvature);
      const proximityScore = Math.max(0, 1 - distance / this.config.membraneSeekingRange);
      const score = curvatureMatch * proximityScore * region.curvature;
      
      if (score > bestScore) {
        bestScore = score;
        bestTarget = region.position;
      }
    }
    
    if (bestTarget && bestScore > 0.3) {
      const direction = bestTarget.clone().subtract(vesicle.position);
      const distance = direction.length();
      
      if (distance > 1) {
        const forceStrength = this.config.membraneAttractionStrength * 
                            this.config.curvatureAttractionMultiplier * bestScore;
        return direction.normalize().scale(forceStrength);
      }
    }
    
    return new Phaser.Math.Vector2(0, 0);
  }

  /**
   * Calculate precise approaching force
   */
  private calculateApproachingForce(
    vesicle: VesicleEntity,
    _aiState: VesicleAIState,
    membranePhysics: MembranePhysicsSystem
  ): Phaser.Math.Vector2 {
    // More precise movement toward membrane
    const sample = membranePhysics.getNearestSurfaceSample(vesicle.position);
    const direction = sample.pos.clone().subtract(vesicle.position);
    const distance = direction.length();
    
    if (distance < 1) return new Phaser.Math.Vector2(0, 0);
    
    // Stronger, more focused force
    const forceStrength = this.config.membraneAttractionStrength * 1.5;
    return direction.normalize().scale(forceStrength);
  }

  /**
   * Calculate small adhering forces
   */
  private calculateAdheringForce(
    _vesicle: VesicleEntity,
    _aiState: VesicleAIState,
    _deltaTime: number
  ): Phaser.Math.Vector2 {
    // Small random movements while adhered
    const randomForce = new Phaser.Math.Vector2(
      (Math.random() - 0.5) * this.config.randomForceStrength * 0.2,
      (Math.random() - 0.5) * this.config.randomForceStrength * 0.2
    );
    
    return randomForce;
  }

  /**
   * Calculate obstacle avoidance force
   */
  private calculateObstacleAvoidanceForce(
    vesicle: VesicleEntity,
    allVesicles: VesicleEntity[]
  ): Phaser.Math.Vector2 {
    const avoidanceForce = new Phaser.Math.Vector2(0, 0);
    
    for (const other of allVesicles) {
      if (other.id === vesicle.id) continue;
      
      const direction = vesicle.position.clone().subtract(other.position);
      const distance = direction.length();
      
      if (distance < this.config.vesicleAvoidanceRange && distance > 0) {
        const avoidanceStrength = this.config.vesicleAvoidanceStrength * 
                                (1 - distance / this.config.vesicleAvoidanceRange);
        avoidanceForce.add(direction.normalize().scale(avoidanceStrength));
      }
    }
    
    return avoidanceForce;
  }

  /**
   * Calculate boundary repulsion force
   */
  private calculateBoundaryForce(
    vesicle: VesicleEntity,
    aiState: VesicleAIState
  ): Phaser.Math.Vector2 {
    const toHome = vesicle.position.clone().subtract(aiState.homePosition);
    const distanceFromHome = toHome.length();
    
    if (distanceFromHome > this.config.explorationRadius) {
      // Force back toward home
      const excess = distanceFromHome - this.config.explorationRadius;
      const forceStrength = this.config.boundaryRepulsionStrength * (excess / this.config.explorationRadius);
      return toHome.normalize().scale(-forceStrength);
    }
    
    return new Phaser.Math.Vector2(0, 0);
  }

  /**
   * Update memory of preferred curvature regions
   */
  private updateCurvatureMemory(
    aiState: VesicleAIState,
    membranePhysics: MembranePhysicsSystem,
    deltaTime: number
  ): void {
    if (!this.config.curvatureSeekingEnabled) return;
    
    // Age existing memories
    for (let i = aiState.preferredCurvatureRegions.length - 1; i >= 0; i--) {
      const region = aiState.preferredCurvatureRegions[i];
      region.age += deltaTime;
      
      // Remove old memories
      if (region.age > 30) { // 30 second memory
        aiState.preferredCurvatureRegions.splice(i, 1);
      }
    }
    
    // Occasionally scan for new high-curvature regions
    if (Math.random() < 0.1) { // 10% chance per frame
      const highCurvatureRegions = membranePhysics.findHighCurvatureRegions();
      
      for (const region of highCurvatureRegions) {
        // Check if we already know about this region
        const existing = aiState.preferredCurvatureRegions.find(known => 
          known.position.distance(region.position) < 20
        );
        
        if (!existing && aiState.preferredCurvatureRegions.length < 5) {
          aiState.preferredCurvatureRegions.push({
            position: region.position.clone(),
            curvature: region.curvature,
            age: 0
          });
        }
      }
    }
  }

  /**
   * Get distance from vesicle to membrane
   */
  private getDistanceToMembrane(
    vesicle: VesicleEntity,
    membranePhysics: MembranePhysicsSystem
  ): number {
    const sample = membranePhysics.getNearestSurfaceSample(vesicle.position);
    return vesicle.position.distance(sample.pos);
  }

  /**
   * Update AI configuration
   */
  public updateConfig(newConfig: Partial<VesicleAIConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get AI state for debugging
   */
  public getAIState(vesicleId: string): VesicleAIState | undefined {
    return this.aiStates.get(vesicleId);
  }

  /**
   * Get all AI states for debugging
   */
  public getAllAIStates(): Map<string, VesicleAIState> {
    return new Map(this.aiStates);
  }
}
