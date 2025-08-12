/**
 * Cell Motility System v2 - Motility Modes
 * 
 * Manages whole-cell locomotion with multiple motility modes:
 * - Amoeboid: fast turns, protrusion cycles, good in soft spaces
 * - Blebbing: burst movement, poor steering, excels in low adhesion
 * - Mesenchymal: adhesion-heavy, protease trails, excels on ECM
 */

import { SystemObject } from './system-object';
import type { WorldRefs } from '../core/world-refs';
import { CellSpaceSystem } from '../core/cell-space-system';
import { MotilityModeRegistry } from './motility-mode-registry';
import type { SubstrateType } from './motility-modes.config';

export type LocomotionMode = 'idle' | 'crawl' | 'dash' | 'blebBurst' | 'mesenchymalCrawl' | 'amoeboidCrawl';

export interface MotilityConfig {
  // Legacy compatibility - these get overridden by mode configs
  crawlMaxSpeed: number;
  crawlTurnRate: number;
  crawlATPPerSecond: number;
  
  // Physics constants
  polarityDecayRate: number;
  membraneElasticity: number;
  collisionDamping: number;
  
  // Adhesion base settings
  baseAdhesionCount: number;
  adhesionDecayRate: number;
  adhesionSpawnRate: number;
  adhesionATPPerSecond: number;
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
  
  /** Adhesion maturity for mesenchymal mode (0-1) */
  maturity: number;
  
  /** Time since adhesions started building */
  buildTime: number;
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
  
  // Mode-specific state
  effectiveSpeed: number;                  // speed after all modifiers
  effectiveTurnRate: number;               // turn rate after all modifiers
}

export class CellMotility extends SystemObject {
  private worldRefs: WorldRefs;
  private cellSpace: CellSpaceSystem;
  private motilityState: MotilityState;
  private config: MotilityConfig;
  private modeRegistry: MotilityModeRegistry;
  
  // Input state
  private inputVector: { x: number; y: number } = { x: 0, y: 0 };
  private actionRequested: string | null = null;
  
  // Drive mode control
  private driveMode: boolean = false;
  
  constructor(scene: Phaser.Scene, worldRefs: WorldRefs, cellSpace: CellSpaceSystem) {
    super(scene, 'CellMotility', (dt) => this.updateMotility(dt));
    
    this.worldRefs = worldRefs;
    this.cellSpace = cellSpace;
    this.modeRegistry = new MotilityModeRegistry();
    
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
      this.requestAction('blebBurst');
    }
    
    if (keys.X && Phaser.Input.Keyboard.JustDown(keys.X)) {
      this.requestAction('proteaseToggle');
    }
    
    if (keys.Z && Phaser.Input.Keyboard.JustDown(keys.Z)) {
      this.requestAction('handbrake');
    }
    
    if (keys.TAB && Phaser.Input.Keyboard.JustDown(keys.TAB)) {
      this.cycleMode();
    }
  }
  
  private createDefaultConfig(): MotilityConfig {
    return {
      // Legacy compatibility
      crawlMaxSpeed: 20.0,
      crawlTurnRate: 2.0,
      crawlATPPerSecond: 0.5,
      
      // Physics
      polarityDecayRate: 1.0,
      membraneElasticity: 0.3,
      collisionDamping: 0.7,
      
      // Adhesion base settings
      baseAdhesionCount: 10,
      adhesionDecayRate: 2.0,
      adhesionSpawnRate: 5.0,
      adhesionATPPerSecond: 0.02
    };
  }
  
  private createInitialState(): MotilityState {
    return {
      mode: 'idle',
      velocity: { x: 0, y: 0 },
      speed: 0,
      effectiveSpeed: 0,
      effectiveTurnRate: 2.0,
      
      polarity: {
        magnitude: 0,
        direction: 0,
        targetDirection: 0,
        timeSinceInput: 0
      },
      
      adhesion: {
        count: this.config.baseAdhesionCount,
        targetCount: this.config.baseAdhesionCount,
        frontBias: 0,
        maturity: 0,
        buildTime: 0
      },
      
      currentSubstrate: 'FIRM',
      atpDrainPerSecond: 0,
      
      isColliding: false,
      collisionNormal: null,
      
      membraneSquash: 0,
      membraneSquashDirection: 0
    };
  }
  
  private setupInputHandlers(): void {
    // Mode cycling (TAB)
    this.scene.input.keyboard?.on('keydown-TAB', () => {
      if (this.driveMode) this.cycleMode();
    });
    
    // Mode-specific actions
    this.scene.input.keyboard?.on('keydown-SPACE', () => {
      if (this.driveMode) this.requestAction('blebBurst');
    });
    
    this.scene.input.keyboard?.on('keydown-X', () => {
      if (this.driveMode) this.requestAction('proteaseToggle');
    });
    
    this.scene.input.keyboard?.on('keydown-Z', () => {
      if (this.driveMode) this.requestAction('handbrake');
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
  
  private requestAction(action: string): void {
    this.actionRequested = action;
  }
  
  private cycleMode(): void {
    this.modeRegistry.cycleMode();
  }
  
  private updateMotility(deltaSeconds: number): void {
    // Update cell space transform
    this.cellSpace.update(deltaSeconds);
    
    // Update mode registry
    this.modeRegistry.update(deltaSeconds);
    
    // Handle action requests
    if (this.actionRequested) {
      this.modeRegistry.requestAction(this.actionRequested as any);
      this.actionRequested = null;
    }
    
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
  }
  
  private updatePolarity(deltaSeconds: number): void {
    const polarity = this.motilityState.polarity;
    const currentMode = this.modeRegistry.getCurrentMode();
    
    if (this.inputVector.x !== 0 || this.inputVector.y !== 0) {
      // Build up polarity toward input direction
      const targetMag = Math.min(1.0, polarity.magnitude + deltaSeconds * 2.0);
      polarity.magnitude = targetMag;
      
      // Smoothly turn toward target direction
      const angleDiff = this.getAngleDifference(polarity.direction, polarity.targetDirection);
      const turnRate = currentMode.params.turnResponsiveness * this.motilityState.effectiveTurnRate * deltaSeconds;
      polarity.direction += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnRate);
    } else {
      // Decay polarity when idle
      polarity.timeSinceInput += deltaSeconds;
      const decayFactor = Math.exp(-this.config.polarityDecayRate * polarity.timeSinceInput);
      polarity.magnitude *= decayFactor;
    }
  }
  
  private updateLocomotionMode(_deltaSeconds: number): void {
    const modeState = this.modeRegistry.getState();
    // currentMode is used below in the switch statement but TS doesn't see it
    // const currentMode = this.modeRegistry.getCurrentMode();
    
    // Determine locomotion mode based on motility mode and state
    if (modeState.currentModeId === 'blebbing' && modeState.blebbing.isInBurst) {
      this.motilityState.mode = 'blebBurst';
    } else if (this.inputVector.x !== 0 || this.inputVector.y !== 0) {
      switch (modeState.currentModeId) {
        case 'amoeboid':
          this.motilityState.mode = 'amoeboidCrawl';
          break;
        case 'mesenchymal':
          this.motilityState.mode = 'mesenchymalCrawl';
          break;
        default:
          this.motilityState.mode = 'crawl';
      }
    } else {
      this.motilityState.mode = 'idle';
    }
  }
  
  private updateAdhesion(deltaSeconds: number): void {
    const adhesion = this.motilityState.adhesion;
    const currentMode = this.modeRegistry.getCurrentMode();
    const modeState = this.modeRegistry.getState();
    
    if (this.motilityState.mode !== 'idle') {
      // Active movement - adjust adhesions based on mode
      if (modeState.currentModeId === 'blebbing' && modeState.blebbing.isInBurst) {
        // Blebbing suppresses adhesion during burst
        adhesion.targetCount = this.config.baseAdhesionCount * 0.2;
        adhesion.frontBias = 0;
      } else {
        // Normal adhesion behavior
        adhesion.targetCount = this.config.baseAdhesionCount + 
          (this.motilityState.speed * this.config.adhesionSpawnRate);
        adhesion.frontBias = currentMode.params.adhesionFrontBias;
      }
      
      // Mesenchymal mode tracks adhesion maturity
      if (modeState.currentModeId === 'mesenchymal') {
        adhesion.buildTime += deltaSeconds;
        const buildTimeNeeded = currentMode.params.adhesionBuildTime || 2.0;
        adhesion.maturity = Math.min(1.0, adhesion.buildTime / buildTimeNeeded);
      } else {
        adhesion.maturity = 1.0; // Other modes have instant mature adhesions
        adhesion.buildTime = 0;
      }
    } else {
      // Decay adhesions when idle
      adhesion.targetCount = Math.max(0, adhesion.count - 
        this.config.adhesionDecayRate * deltaSeconds);
      adhesion.frontBias *= 0.95; // slowly center
      adhesion.buildTime = 0;
      adhesion.maturity = 0;
    }
    
    // Release rear adhesions based on mode
    const rearReleaseRate = currentMode.params.rearReleaseRate;
    if (this.motilityState.speed > 0.1) {
      adhesion.count = Math.max(adhesion.targetCount * 0.5, 
        adhesion.count - rearReleaseRate * deltaSeconds);
    }
    
    // Smoothly adjust adhesion count
    const diff = adhesion.targetCount - adhesion.count;
    adhesion.count += diff * deltaSeconds * 3.0;
    adhesion.count = Math.max(0, adhesion.count);
  }
  
  private updateMovement(deltaSeconds: number): void {
    const currentMode = this.modeRegistry.getCurrentMode();
    const modeState = this.modeRegistry.getState();
    
    let targetSpeed = 0;
    let baseTurnRate = currentMode.params.turnResponsiveness * 2.0;
    
    // Calculate target speed based on locomotion mode
    switch (this.motilityState.mode) {
      case 'amoeboidCrawl':
        targetSpeed = currentMode.params.baseSpeed * this.motilityState.polarity.magnitude;
        
        // Add protrusion pulse for amoeboid
        const protrusionBoost = 1.0 + 0.2 * modeState.amoeboid.protrusion.intensity * 
          this.motilityState.polarity.magnitude;
        targetSpeed *= protrusionBoost;
        break;
        
      case 'blebBurst':
        targetSpeed = currentMode.params.blebBurstSpeed || currentMode.params.baseSpeed * 2;
        baseTurnRate *= 0.3; // Poor steering during burst
        break;
        
      case 'mesenchymalCrawl':
        targetSpeed = currentMode.params.baseSpeed * this.motilityState.polarity.magnitude;
        
        // Speed scales with adhesion maturity
        targetSpeed *= (0.3 + 0.7 * this.motilityState.adhesion.maturity);
        break;
        
      case 'crawl':
        targetSpeed = currentMode.params.baseSpeed * this.motilityState.polarity.magnitude;
        break;
    }
    
    // Apply substrate effects
    const substrateScalars = this.modeRegistry.getSubstrateScalars(this.motilityState.currentSubstrate);
    targetSpeed *= substrateScalars.speedMultiplier;
    baseTurnRate *= substrateScalars.turnMultiplier;
    
    // Apply adhesion efficiency
    const adhesionFactor = Math.min(1.0, this.motilityState.adhesion.count / this.config.baseAdhesionCount);
    const efficiency = substrateScalars.adhesionEfficiency;
    targetSpeed *= (1.0 - efficiency + efficiency * adhesionFactor);
    
    // Check ATP availability
    if (!this.hasEnoughATP(this.motilityState.atpDrainPerSecond * deltaSeconds)) {
      targetSpeed *= 0.1; // Severely reduced speed when out of ATP
    }
    
    // Store effective values for UI
    this.motilityState.effectiveSpeed = targetSpeed;
    this.motilityState.effectiveTurnRate = baseTurnRate;
    
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
    const currentMode = this.modeRegistry.getCurrentMode();
    
    // Base decay rate affected by membrane tension
    const decayRate = 5.0 * (1.0 + currentMode.params.tension);
    this.motilityState.membraneSquash *= Math.exp(-deltaSeconds * decayRate);
    
    // Add deformation based on acceleration and mode tension
    const accel = this.motilityState.speed / currentMode.params.baseSpeed;
    if (accel > 0.1) {
      const deformation = accel * 0.2 * (1.0 - currentMode.params.tension * 0.5);
      this.motilityState.membraneSquash = Math.max(this.motilityState.membraneSquash, deformation);
      this.motilityState.membraneSquashDirection = this.motilityState.polarity.direction;
    }
  }
  
  private updateEnergyConsumption(): void {
    const currentMode = this.modeRegistry.getCurrentMode();
    const modeState = this.modeRegistry.getState();
    
    let drain = 0;
    
    // Base motility cost
    if (this.motilityState.mode !== 'idle') {
      const speedFactor = this.motilityState.speed / currentMode.params.baseSpeed;
      drain += currentMode.params.atpPerSec * speedFactor;
    }
    
    // Adhesion maintenance cost
    drain += this.motilityState.adhesion.count * this.config.adhesionATPPerSecond;
    
    // Protease cost for mesenchymal mode
    if (modeState.currentModeId === 'mesenchymal' && modeState.mesenchymal.proteaseActive) {
      drain += currentMode.params.proteasePerSec || 0;
    }
    
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
  
  private hasEnoughATP(amount: number): boolean {
    const currentATP = this.worldRefs.playerInventory.getAmount('ATP') || 0;
    return currentATP >= amount;
  }
  
  // ATP consumption for mode-specific bursts (may be used later)
  // private consumeATP(amount: number): void {
  //   this.worldRefs.playerInventory.take('ATP', amount);
  // }
  
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
  
  getModeRegistry(): MotilityModeRegistry {
    return this.modeRegistry;
  }
  
  updateConfig(updates: Partial<MotilityConfig>): void {
    Object.assign(this.config, updates);
  }
  
  // Preset configurations
  setSpeedPreset(preset: 'slow' | 'default' | 'fast'): void {
    let multiplier = 1.0;
    
    switch (preset) {
      case 'slow':
        multiplier = 0.6;
        break;
      case 'fast':
        multiplier = 1.5;
        break;
    }
    
    this.config.crawlMaxSpeed = 20.0 * multiplier;
    this.config.crawlATPPerSecond = 0.5 * multiplier;
  }
}
