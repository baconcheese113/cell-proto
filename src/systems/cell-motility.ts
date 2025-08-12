/**
 * Cell Motility System
 * 
 * Manages whole-cell locomotion including polarity, adhesion, substrate interaction,
 * and locomotion modes (crawl/dash). Extends SystemObject for automatic lifecycle.
 */

import { SystemObject } from './system-object';
import type { WorldRefs } from '../core/world-refs';
import { CellSpaceSystem } from '../core/cell-space-system';

export type LocomotionMode = 'idle' | 'crawl' | 'dash';
export type SubstrateType = 'SOFT' | 'FIRM' | 'STICKY';

export interface MotilityConfig {
  // Crawl mode
  crawlMaxSpeed: number;           // hex/second
  crawlTurnRate: number;           // radians/second
  crawlATPPerSecond: number;       // ATP cost
  
  // Dash mode
  dashSpeed: number;               // hex/second during dash
  dashDuration: number;            // seconds
  dashCooldown: number;            // seconds
  dashATPCost: number;             // ATP spike cost
  dashTurnPenalty: number;         // turn rate multiplier during dash
  
  // Adhesion
  baseAdhesionCount: number;       // base adhesion points
  adhesionDecayRate: number;       // adhesions lost per second when not moving
  adhesionSpawnRate: number;       // adhesions gained per second when moving forward
  adhesionEfficiency: number;      // speed multiplier from adhesions
  adhesionATPPerSecond: number;    // ATP cost per adhesion
  
  // Substrate effects
  substrateSpeedMultipliers: Record<SubstrateType, number>;
  substrateTurnMultipliers: Record<SubstrateType, number>;
  
  // Physics
  polarityDecayRate: number;       // polarity decay when idle
  membraneElasticity: number;      // membrane deformation response
  collisionDamping: number;        // collision response damping
}

export interface PolarityState {
  /** Current polarity vector magnitude (0-1) */
  magnitude: number;
  
  /** Polarity direction in cell-space (radians) */
  direction: number;
  
  /** Target direction from input */
  targetDirection: number;
  
  /** Time since last input */
  timeSinceInput: number;
}

export interface AdhesionState {
  /** Current number of active adhesions */
  count: number;
  
  /** Target adhesion count */
  targetCount: number;
  
  /** Front-to-rear adhesion bias (-1 = all rear, +1 = all front) */
  frontBias: number;
}

export interface MotilityState {
  mode: LocomotionMode;
  
  // Current movement
  velocity: { x: number; y: number };      // hex/second in world space
  speed: number;                           // current speed magnitude
  
  // Polarity
  polarity: PolarityState;
  
  // Adhesion
  adhesion: AdhesionState;
  
  // Dash state
  dashTimeRemaining: number;
  dashCooldownRemaining: number;
  
  // Substrate
  currentSubstrate: SubstrateType;
  
  // Energy tracking
  atpDrainPerSecond: number;
  
  // Collision state
  isColliding: boolean;
  collisionNormal: { x: number; y: number } | null;
  
  // Membrane deformation
  membraneSquash: number;                  // compression factor (0-1)
  membraneSquashDirection: number;         // direction of squash (radians)
}

export class CellMotility extends SystemObject {
  private worldRefs: WorldRefs;
  private cellSpace: CellSpaceSystem;
  private motilityState: MotilityState;
  private config: MotilityConfig;
  
  // Input state
  private inputVector: { x: number; y: number } = { x: 0, y: 0 };
  private dashRequested: boolean = false;
  
  // Drive mode control
  private driveMode: boolean = false;
  
  constructor(scene: Phaser.Scene, worldRefs: WorldRefs, cellSpace: CellSpaceSystem) {
    super(scene, 'CellMotility', (dt) => this.updateMotility(dt));
    
    this.worldRefs = worldRefs;
    this.cellSpace = cellSpace;
    
    this.config = this.createDefaultConfig();
    this.motilityState = this.createInitialState();
    
    this.setupInputHandlers();
  }
  
  /** Set drive mode - when true, this system handles WASD input */
  public setDriveMode(enabled: boolean): void {
    this.driveMode = enabled;
    if (!enabled) {
      // Clear input when disabling drive mode
      this.inputVector.x = 0;
      this.inputVector.y = 0;
    }
  }
  
  /** Manual input control for drive mode */
  public updateInput(keys: any): void {
    if (!this.driveMode) return;
    
    let x = 0, y = 0;
    
    if (keys.W?.isDown) y -= 1;
    if (keys.S?.isDown) y += 1;
    if (keys.A?.isDown) x -= 1;
    if (keys.D?.isDown) x += 1;
    
    this.setInput(x, y);
    
    if (keys.SPACE && Phaser.Input.Keyboard.JustDown(keys.SPACE)) {
      this.requestDash();
    }
  }
  
  private createDefaultConfig(): MotilityConfig {
    return {
      // Crawl
      crawlMaxSpeed: 20.0,
      crawlTurnRate: 2.0,
      crawlATPPerSecond: 0.5,
      
      // Dash
      dashSpeed: 6.0,
      dashDuration: 1.0,
      dashCooldown: 3.0,
      dashATPCost: 5.0,
      dashTurnPenalty: 0.3,
      
      // Adhesion
      baseAdhesionCount: 10,
      adhesionDecayRate: 2.0,
      adhesionSpawnRate: 5.0,
      adhesionEfficiency: 0.8,
      adhesionATPPerSecond: 0.02,
      
      // Substrate
      substrateSpeedMultipliers: {
        SOFT: 0.7,
        FIRM: 1.0,
        STICKY: 0.5
      },
      substrateTurnMultipliers: {
        SOFT: 1.2,
        FIRM: 1.0,
        STICKY: 1.5
      },
      
      // Physics
      polarityDecayRate: 1.0,
      membraneElasticity: 0.3,
      collisionDamping: 0.7
    };
  }
  
  private createInitialState(): MotilityState {
    return {
      mode: 'idle',
      velocity: { x: 0, y: 0 },
      speed: 0,
      
      polarity: {
        magnitude: 0,
        direction: 0,
        targetDirection: 0,
        timeSinceInput: 0
      },
      
      adhesion: {
        count: this.config.baseAdhesionCount,
        targetCount: this.config.baseAdhesionCount,
        frontBias: 0
      },
      
      dashTimeRemaining: 0,
      dashCooldownRemaining: 0,
      
      currentSubstrate: 'FIRM',
      atpDrainPerSecond: 0,
      
      isColliding: false,
      collisionNormal: null,
      
      membraneSquash: 0,
      membraneSquashDirection: 0
    };
  }
  
  private setupInputHandlers(): void {
    // WASD input handling - only active in drive mode
    this.scene.input.keyboard?.on('keydown-W', () => {
      if (this.driveMode) this.setInput(0, -1);
    });
    this.scene.input.keyboard?.on('keydown-A', () => {
      if (this.driveMode) this.setInput(-1, 0);
    });
    this.scene.input.keyboard?.on('keydown-S', () => {
      if (this.driveMode) this.setInput(0, 1);
    });
    this.scene.input.keyboard?.on('keydown-D', () => {
      if (this.driveMode) this.setInput(1, 0);
    });
    
    this.scene.input.keyboard?.on('keyup-W', () => {
      if (this.driveMode) this.clearInput();
    });
    this.scene.input.keyboard?.on('keyup-A', () => {
      if (this.driveMode) this.clearInput();
    });
    this.scene.input.keyboard?.on('keyup-S', () => {
      if (this.driveMode) this.clearInput();
    });
    this.scene.input.keyboard?.on('keyup-D', () => {
      if (this.driveMode) this.clearInput();
    });
    
    // Dash input (Space) - only active in drive mode
    this.scene.input.keyboard?.on('keydown-SPACE', () => {
      if (this.driveMode) this.requestDash();
    });
  }
  
  private setInput(x: number, y: number): void {
    this.inputVector.x = x;
    this.inputVector.y = y;
    
    if (x !== 0 || y !== 0) {
      // Update polarity target
      this.motilityState.polarity.targetDirection = Math.atan2(y, x);
      this.motilityState.polarity.timeSinceInput = 0;
    }
  }
  
  private clearInput(): void {
    // Check if any movement keys are still pressed
    const keys = this.scene.input.keyboard;
    if (!keys) return;
    
    const w = keys.checkDown(keys.addKey('W'));
    const a = keys.checkDown(keys.addKey('A'));
    const s = keys.checkDown(keys.addKey('S'));
    const d = keys.checkDown(keys.addKey('D'));
    
    if (!w && !a && !s && !d) {
      this.inputVector.x = 0;
      this.inputVector.y = 0;
    }
  }
  
  private requestDash(): void {
    if (this.motilityState.dashCooldownRemaining <= 0 && this.motilityState.mode !== 'dash') {
      this.dashRequested = true;
    }
  }
  
  private updateMotility(deltaSeconds: number): void {
    // Update cell space transform
    this.cellSpace.update(deltaSeconds);
    
    // Update locomotion state
    this.updatePolarity(deltaSeconds);
    this.updateLocomotionMode(deltaSeconds);
    this.updateAdhesion(deltaSeconds);
    this.updateMovement(deltaSeconds);
    this.updateSubstrate();
    this.updateMembraneDeformation(deltaSeconds);
    this.updateEnergyConsumption();
    
    // Apply movement to cell space
    this.applyCellSpaceMovement(deltaSeconds);
    
    // Update timers
    this.updateTimers(deltaSeconds);
  }
  
  private updatePolarity(deltaSeconds: number): void {
    const polarity = this.motilityState.polarity;
    
    if (this.inputVector.x !== 0 || this.inputVector.y !== 0) {
      // Build up polarity toward input direction
      const targetMag = Math.min(1.0, polarity.magnitude + deltaSeconds * 2.0);
      polarity.magnitude = targetMag;
      
      // Smoothly turn toward target direction
      const angleDiff = this.getAngleDifference(polarity.direction, polarity.targetDirection);
      const turnRate = this.config.crawlTurnRate * deltaSeconds;
      polarity.direction += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnRate);
    } else {
      // Decay polarity when idle
      polarity.timeSinceInput += deltaSeconds;
      const decayFactor = Math.exp(-this.config.polarityDecayRate * polarity.timeSinceInput);
      polarity.magnitude *= decayFactor;
    }
  }
  
  private updateLocomotionMode(_deltaSeconds: number): void {
    // Handle dash requests
    if (this.dashRequested && this.motilityState.dashCooldownRemaining <= 0) {
      this.startDash();
      this.dashRequested = false;
    }
    
    // Update mode based on state
    if (this.motilityState.dashTimeRemaining > 0) {
      this.motilityState.mode = 'dash';
    } else if (this.inputVector.x !== 0 || this.inputVector.y !== 0) {
      this.motilityState.mode = 'crawl';
    } else {
      this.motilityState.mode = 'idle';
    }
  }
  
  private startDash(): void {
    if (this.hasEnoughATP(this.config.dashATPCost)) {
      this.motilityState.dashTimeRemaining = this.config.dashDuration;
      this.motilityState.dashCooldownRemaining = this.config.dashCooldown;
      this.consumeATP(this.config.dashATPCost);
      
      // Brief membrane squash forward
      this.motilityState.membraneSquash = 0.3;
      this.motilityState.membraneSquashDirection = this.motilityState.polarity.direction;
    }
  }
  
  private updateAdhesion(deltaSeconds: number): void {
    const adhesion = this.motilityState.adhesion;
    
    if (this.motilityState.mode === 'crawl' || this.motilityState.mode === 'dash') {
      // Spawn adhesions when moving forward
      adhesion.targetCount = this.config.baseAdhesionCount + 
        (this.motilityState.speed * this.config.adhesionSpawnRate);
      adhesion.frontBias = Math.min(1.0, this.motilityState.speed * 0.5);
    } else {
      // Decay adhesions when idle
      adhesion.targetCount = Math.max(0, adhesion.count - 
        this.config.adhesionDecayRate * deltaSeconds);
      adhesion.frontBias *= 0.95; // slowly center
    }
    
    // Smoothly adjust adhesion count
    const diff = adhesion.targetCount - adhesion.count;
    adhesion.count += diff * deltaSeconds * 3.0;
    adhesion.count = Math.max(0, adhesion.count);
  }
  
  private updateMovement(deltaSeconds: number): void {
    let targetSpeed = 0;
    let maxTurnRate = this.config.crawlTurnRate;
    
    // Calculate target speed based on mode
    switch (this.motilityState.mode) {
      case 'crawl':
        targetSpeed = this.config.crawlMaxSpeed * this.motilityState.polarity.magnitude;
        break;
      case 'dash':
        targetSpeed = this.config.dashSpeed;
        maxTurnRate *= this.config.dashTurnPenalty;
        break;
    }
    
    // Apply substrate effects
    const substrateMult = this.config.substrateSpeedMultipliers[this.motilityState.currentSubstrate];
    const substrateTurn = this.config.substrateTurnMultipliers[this.motilityState.currentSubstrate];
    targetSpeed *= substrateMult;
    maxTurnRate *= substrateTurn;
    
    // Apply adhesion efficiency
    const adhesionFactor = Math.min(1.0, this.motilityState.adhesion.count / this.config.baseAdhesionCount);
    targetSpeed *= (1.0 - this.config.adhesionEfficiency + this.config.adhesionEfficiency * adhesionFactor);
    
    // Check ATP availability
    if (!this.hasEnoughATP(this.motilityState.atpDrainPerSecond * deltaSeconds)) {
      targetSpeed *= 0.1; // Severely reduced speed when out of ATP
    }
    
    // Smooth speed changes
    const speedDiff = targetSpeed - this.motilityState.speed;
    this.motilityState.speed += speedDiff * deltaSeconds * 4.0;
    
    // Calculate velocity in world space
    const forward = this.cellSpace.getForwardVector();
    this.motilityState.velocity.x = forward.x * this.motilityState.speed;
    this.motilityState.velocity.y = forward.y * this.motilityState.speed;
    
    // Apply collision damping
    if (this.motilityState.isColliding && this.motilityState.collisionNormal) {
      const normal = this.motilityState.collisionNormal;
      const dot = this.motilityState.velocity.x * normal.x + this.motilityState.velocity.y * normal.y;
      if (dot > 0) {
        // Remove velocity component toward obstacle
        this.motilityState.velocity.x -= normal.x * dot * this.config.collisionDamping;
        this.motilityState.velocity.y -= normal.y * dot * this.config.collisionDamping;
      }
    }
  }
  
  private updateSubstrate(): void {
    // Get substrate at current cell position
    const transform = this.cellSpace.getTransform();
    const substrate = (this.worldRefs as any).substrateSystem;
    
    if (substrate) {
      this.motilityState.currentSubstrate = substrate.getSubstrateAt(transform.position.x, transform.position.y);
      
      // Check for collision with obstacles
      const collision = substrate.checkObstacleCollision(transform.position.x, transform.position.y, 30);
      this.motilityState.isColliding = collision.colliding;
      this.motilityState.collisionNormal = collision.normal || null;
      
      if (collision.colliding) {
        // Add extra membrane squash at collision point
        this.motilityState.membraneSquash = Math.max(this.motilityState.membraneSquash, 0.4);
        if (collision.normal) {
          this.motilityState.membraneSquashDirection = Math.atan2(collision.normal.y, collision.normal.x);
        }
      }
    } else {
      // Fallback when substrate system not available
      this.motilityState.currentSubstrate = 'FIRM';
    }
  }
  
  private updateMembraneDeformation(deltaSeconds: number): void {
    // Decay membrane squash
    this.motilityState.membraneSquash *= Math.exp(-deltaSeconds * 5.0);
    
    // Add deformation based on acceleration
    const accel = this.motilityState.speed / this.config.crawlMaxSpeed;
    if (accel > 0.1) {
      this.motilityState.membraneSquash = Math.max(this.motilityState.membraneSquash, accel * 0.2);
      this.motilityState.membraneSquashDirection = this.motilityState.polarity.direction;
    }
  }
  
  private updateEnergyConsumption(): void {
    let drain = 0;
    
    // Base locomotion cost
    if (this.motilityState.mode === 'crawl') {
      drain += this.config.crawlATPPerSecond * (this.motilityState.speed / this.config.crawlMaxSpeed);
    }
    
    // Adhesion maintenance cost
    drain += this.motilityState.adhesion.count * this.config.adhesionATPPerSecond;
    
    this.motilityState.atpDrainPerSecond = drain;
  }
  
  private applyCellSpaceMovement(deltaSeconds: number): void {
    const transform = this.cellSpace.getTransform();
    const newX = transform.position.x + this.motilityState.velocity.x * deltaSeconds * 50; // Scale for hex grid
    const newY = transform.position.y + this.motilityState.velocity.y * deltaSeconds * 50;
    
    this.cellSpace.setTargetPosition(newX, newY);
    
    // Update cell rotation to match polarity
    if (this.motilityState.polarity.magnitude > 0.1) {
      const worldRotation = this.motilityState.polarity.direction;
      this.cellSpace.setTargetRotation(worldRotation);
    }
  }
  
  private updateTimers(deltaSeconds: number): void {
    this.motilityState.dashTimeRemaining = Math.max(0, this.motilityState.dashTimeRemaining - deltaSeconds);
    this.motilityState.dashCooldownRemaining = Math.max(0, this.motilityState.dashCooldownRemaining - deltaSeconds);
  }
  
  private hasEnoughATP(amount: number): boolean {
    const currentATP = this.worldRefs.playerInventory.getAmount('ATP') || 0;
    return currentATP >= amount;
  }
  
  private consumeATP(amount: number): void {
    this.worldRefs.playerInventory.take('ATP', amount);
  }
  
  private getAngleDifference(current: number, target: number): number {
    let diff = target - current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  }
  
  // Public getters for UI and debugging
  getState(): Readonly<MotilityState> {
    return this.motilityState;
  }
  
  getConfig(): Readonly<MotilityConfig> {
    return this.config;
  }
  
  updateConfig(updates: Partial<MotilityConfig>): void {
    Object.assign(this.config, updates);
  }
  
  // Preset configurations
  setSpeedPreset(preset: 'slow' | 'default' | 'fast'): void {
    const baseConfig = this.createDefaultConfig();
    let multiplier = 1.0;
    
    switch (preset) {
      case 'slow':
        multiplier = 0.6;
        break;
      case 'fast':
        multiplier = 1.5;
        break;
    }
    
    this.config.crawlMaxSpeed = baseConfig.crawlMaxSpeed * multiplier;
    this.config.dashSpeed = baseConfig.dashSpeed * multiplier;
    this.config.crawlATPPerSecond = baseConfig.crawlATPPerSecond * multiplier;
    this.config.dashATPCost = baseConfig.dashATPCost * multiplier;
  }
}
