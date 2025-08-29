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

export interface VisualEffects {
  /** Cell membrane visual state */
  membraneState: 'normal' | 'extending' | 'retracting' | 'blebbing';
  
  /** Visual pulses or flashes */
  pulse: {
    active: boolean;
    intensity: number;  // 0-1
    color: string;      // hex color
  };
  
  /** Particle trails */
  trail: {
    active: boolean;
    type: 'adhesion' | 'protease' | 'cytoplasm';
    opacity: number;    // 0-1
  };
  
  /** Animation state */
  animation: {
    phase: number;      // 0-1 animation cycle
    speed: number;      // animation speed multiplier
  };
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
  
  // V2: Visual effects state
  private visualEffects: VisualEffects;
  
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
    this.visualEffects = this.createDefaultVisualEffects();
    
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
    
    // V2: Mode-specific input handling
    const currentMode = this.modeRegistry.getCurrentMode();
    
    if (currentMode.id === 'amoeboid') {
      this.handleAmoeboidInput(keys, x, y);
    } else if (currentMode.id === 'blebbing') {
      this.handleBlebbingInput(keys);
    } else if (currentMode.id === 'mesenchymal') {
      this.handleMesenchymalInput(keys);
    }
    
    // Legacy action handling
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

  /**
   * V2: Handle amoeboid-specific input (pseudopod aiming)
   */
  private handleAmoeboidInput(keys: any, inputX: number, inputY: number): void {
    // Hold SPACE to aim pseudopod lobe
    if (keys.SPACE?.isDown && !this.modeRegistry.getState().amoeboid.isAiming) {
      // Start aiming in movement direction
      const aimDirection = Math.atan2(inputY, inputX);
      this.modeRegistry.startPseudopodAim(aimDirection);
    }
    
    // Release SPACE to fire lobe
    if (keys.SPACE && Phaser.Input.Keyboard.JustUp(keys.SPACE)) {
      const result = this.modeRegistry.firePseudopodLobe();
      if (result.success) {
        this.applyPseudopodForce(result.force, result.direction);
      }
    }
    
    // Z for handbrake
    if (keys.Z && Phaser.Input.Keyboard.JustDown(keys.Z)) {
      const success = this.modeRegistry.activateHandbrake();
      if (success) {
        this.applyHandbrakeEffect();
      }
    }
  }

  /**
   * V2: Handle blebbing-specific input (chain timing)
   */
  private handleBlebbingInput(keys: any): void {
    // SPACE for bleb burst with chain detection
    if (keys.SPACE && Phaser.Input.Keyboard.JustDown(keys.SPACE)) {
      const result = this.modeRegistry.chainBlebBurst();
      if (result.success) {
        this.triggerBlebBurst(result.isChain, result.cost);
      }
    }
  }

  /**
   * V2: Handle mesenchymal-specific input
   */
  private handleMesenchymalInput(keys: any): void {
    // X for protease toggle
    if (keys.X && Phaser.Input.Keyboard.JustDown(keys.X)) {
      this.modeRegistry.requestAction('proteaseToggle');
      this.updateProteaseEffect();
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
  
  private createDefaultVisualEffects(): VisualEffects {
    return {
      membraneState: 'normal',
      pulse: {
        active: false,
        intensity: 0,
        color: '#ffffff'
      },
      trail: {
        active: false,
        type: 'cytoplasm',
        opacity: 0
      },
      animation: {
        phase: 0,
        speed: 1.0
      }
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
    
    // Update mode registry with current motion state
    this.modeRegistry.update(
      deltaSeconds, 
      this.motilityState.speed, 
      this.motilityState.effectiveTurnRate
    );
    
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
    this.updateVisualEffects(deltaSeconds);
    
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
        
        // V2: Apply handbrake effects
        if (modeState.amoeboid.handbrakeActive) {
          targetSpeed *= 0.85; // Speed reduction during handbrake
          baseTurnRate *= 2.0;  // Enhanced turning
        }
        break;
        
      case 'blebBurst':
        targetSpeed = currentMode.params.blebBurstSpeed || currentMode.params.baseSpeed * 2;
        baseTurnRate *= 0.3; // Poor steering during burst
        
        // V2: Apply refractory steering penalty
        if (modeState.blebbing.refractory > 0) {
          const penalty = currentMode.params.blebRefractorySteeringPenalty || 0.4;
          baseTurnRate *= (1.0 - penalty);
        }
        break;
        
      case 'mesenchymalCrawl':
        targetSpeed = currentMode.params.baseSpeed * this.motilityState.polarity.magnitude;
        
        // V2: Speed scales with adhesion maturity (dual-side system)
        const leftMaturity = modeState.mesenchymal.leftAdhesionMaturity;
        const rightMaturity = modeState.mesenchymal.rightAdhesionMaturity;
        const avgMaturity = (leftMaturity + rightMaturity) / 2;
        
        const minSpeed = currentMode.params.mesenchymalMaturitySpeedMin || 0.3;
        const maxSpeed = currentMode.params.mesenchymalMaturitySpeedMax || 1.0;
        const maturitySpeedFactor = minSpeed + (maxSpeed - minSpeed) * avgMaturity;
        
        targetSpeed *= maturitySpeedFactor;
        
        // V2: Apply track strength bonus
        if (this.motilityState.currentSubstrate === 'ECM' && modeState.mesenchymal.trackStrength > 0) {
          targetSpeed *= (1.0 + 0.3 * modeState.mesenchymal.trackStrength);
        }
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
    
    // V2: Dynamic energy curves per mode
    if (this.motilityState.mode !== 'idle') {
      const speedFactor = this.motilityState.speed / currentMode.params.baseSpeed;
      let baseDrain = currentMode.params.atpPerSec;
      
      // Apply mode-specific energy curves
      switch (modeState.currentModeId) {
        case 'amoeboid':
          // Faster regeneration when slow, higher cost at high speed
          const idleMultiplier = currentMode.params.atpIdleMultiplier || 0.3;
          const highSpeedMultiplier = currentMode.params.atpHighSpeedMultiplier || 1.5;
          
          if (speedFactor < 0.3) {
            baseDrain *= idleMultiplier;
          } else if (speedFactor > 0.8) {
            baseDrain *= highSpeedMultiplier;
          }
          break;
          
        case 'blebbing':
          // Near-zero cost when idle, chain penalties
          const blebIdleMultiplier = currentMode.params.atpIdleMultiplier || 0.1;
          
          if (speedFactor < 0.1) {
            baseDrain *= blebIdleMultiplier;
          }
          
          // Additional cost for active chains
          if (modeState.blebbing.chainCount > 0) {
            const chainPenalty = currentMode.params.atpChainPenalty || 1.2;
            baseDrain *= Math.pow(chainPenalty, modeState.blebbing.chainCount - 1);
          }
          break;
          
        case 'mesenchymal':
          // Reduced cost when using established tracks
          if (this.motilityState.currentSubstrate === 'ECM' && modeState.mesenchymal.trackStrength > 0) {
            baseDrain *= (1.0 - 0.2 * modeState.mesenchymal.trackStrength);
          }
          break;
      }
      
      drain += baseDrain * speedFactor;
    }
    
    // Adhesion maintenance cost
    drain += this.motilityState.adhesion.count * this.config.adhesionATPPerSecond;
    
    // V2: Protease cost only while actively painting trails
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
  
  private updateVisualEffects(deltaSeconds: number): void {
    const currentMode = this.modeRegistry.getCurrentMode();
    const modeState = this.modeRegistry.getState();
    
    // Update animation phase
    this.visualEffects.animation.phase += deltaSeconds * this.visualEffects.animation.speed;
    if (this.visualEffects.animation.phase > 1.0) {
      this.visualEffects.animation.phase -= 1.0;
    }
    
    // Mode-specific visual effects
    switch (modeState.currentModeId) {
      case 'amoeboid':
        // Amoeboid: Membrane extending/retracting with pulses
        if (modeState.amoeboid.protrusion.intensity > 0.5) {
          this.visualEffects.membraneState = 'extending';
          this.visualEffects.pulse.active = true;
          this.visualEffects.pulse.intensity = modeState.amoeboid.protrusion.intensity;
          this.visualEffects.pulse.color = '#4CAF50'; // Green for growth
        } else {
          this.visualEffects.membraneState = 'normal';
          this.visualEffects.pulse.active = false;
        }
        
        // Handbrake visual feedback
        if (modeState.amoeboid.handbrakeActive) {
          this.visualEffects.pulse.color = '#FF9800'; // Orange for enhanced turning
          this.visualEffects.animation.speed = 1.5;
        } else {
          this.visualEffects.animation.speed = 1.0;
        }
        break;
        
      case 'blebbing':
        // Blebbing: Pressure buildup and burst effects
        if (modeState.blebbing.pressure > 0.8) {
          this.visualEffects.membraneState = 'blebbing';
          this.visualEffects.pulse.active = true;
          this.visualEffects.pulse.intensity = modeState.blebbing.pressure;
          this.visualEffects.pulse.color = '#2196F3'; // Blue for pressure
        } else if (modeState.blebbing.refractory > 0) {
          this.visualEffects.membraneState = 'retracting';
          this.visualEffects.pulse.color = '#9E9E9E'; // Gray for cooldown
        } else {
          this.visualEffects.membraneState = 'normal';
          this.visualEffects.pulse.active = false;
        }
        
        // Chain timing window visual
        if (modeState.blebbing.chainWindow > 0) {
          this.visualEffects.animation.speed = 2.0; // Fast animation during chain window
        }
        break;
        
      case 'mesenchymal':
        // Mesenchymal: Adhesion maturity and protease trail effects
        const leftMaturity = modeState.mesenchymal.leftAdhesionMaturity;
        const rightMaturity = modeState.mesenchymal.rightAdhesionMaturity;
        const avgMaturity = (leftMaturity + rightMaturity) / 2;
        
        if (avgMaturity > 0.7) {
          this.visualEffects.membraneState = 'extending';
          this.visualEffects.pulse.active = true;
          this.visualEffects.pulse.intensity = avgMaturity;
          this.visualEffects.pulse.color = '#9C27B0'; // Purple for mature adhesions
        } else {
          this.visualEffects.membraneState = 'normal';
          this.visualEffects.pulse.active = false;
        }
        
        // Protease trail effects
        if (modeState.mesenchymal.proteaseActive && modeState.mesenchymal.trackStrength > 0) {
          this.visualEffects.trail.active = true;
          this.visualEffects.trail.type = 'protease';
          this.visualEffects.trail.opacity = Math.min(0.8, modeState.mesenchymal.trackStrength);
        } else {
          this.visualEffects.trail.active = false;
        }
        break;
    }
    
    // General movement trail
    if (this.motilityState.speed > 0.5 && !this.visualEffects.trail.active) {
      this.visualEffects.trail.active = true;
      this.visualEffects.trail.type = 'cytoplasm';
      this.visualEffects.trail.opacity = Math.min(0.4, this.motilityState.speed / currentMode.params.baseSpeed);
    } else if (this.motilityState.speed < 0.1 && this.visualEffects.trail.type === 'cytoplasm') {
      this.visualEffects.trail.active = false;
    }
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
  
  // V2: Visual effects getter
  getVisualEffects(): Readonly<VisualEffects> {
    return this.visualEffects;
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

  /**
   * V2: Get state meters for HUD display
   */
  getStateMeter(meter: 'pulse' | 'pressure' | 'leftMaturity' | 'rightMaturity' | 'trackStrength'): number {
    return this.modeRegistry.getStateMeter(meter);
  }

  /**
   * V2: Get all state meters for debugging
   */
  getAllStateMeters(): Record<string, number> {
    return this.modeRegistry.getAllStateMeters();
  }

  /**
   * V2: Check if specific actions are available
   */
  isActionAvailable(action: 'blebBurst' | 'proteaseToggle' | 'handbrake' | 'pseudopodLobe'): boolean {
    return this.modeRegistry.isActionAvailable(action);
  }

  /**
   * V2: Get chain timing window progress for blebbing
   */
  getChainWindowProgress(): number {
    return this.modeRegistry.getChainWindowProgress();
  }

  /**
   * V2: Start aiming pseudopod lobe (amoeboid mode)
   */
  startPseudopodAim(direction: number): boolean {
    return this.modeRegistry.startPseudopodAim(direction);
  }

  /**
   * V2: Fire pseudopod lobe 
   */
  firePseudopodLobe(): { success: boolean; force: number; direction: number } {
    return this.modeRegistry.firePseudopodLobe();
  }

  /**
   * V2: Activate handbrake for sharp pivot
   */
  activateHandbrake(): boolean {
    return this.modeRegistry.activateHandbrake();
  }

  /**
   * V2: Chain bleb burst (if in timing window)
   */
  chainBlebBurst(): { success: boolean; isChain: boolean; cost: number } {
    return this.modeRegistry.chainBlebBurst();
  }

  /**
   * V2: Apply pseudopod force in specified direction
   */
  private applyPseudopodForce(force: number, direction: number): void {
    // Convert force to velocity impulse
    const impulseX = Math.cos(direction) * force;
    const impulseY = Math.sin(direction) * force;
    
    // Add impulse to current velocity
    this.motilityState.velocity.x += impulseX;
    this.motilityState.velocity.y += impulseY;
    
    // Update speed
    this.motilityState.speed = Math.sqrt(
      this.motilityState.velocity.x ** 2 + this.motilityState.velocity.y ** 2
    );
    
    // Brief membrane deformation in lobe direction
    this.motilityState.membraneSquash = Math.min(0.3, this.motilityState.membraneSquash + 0.15);
    this.motilityState.membraneSquashDirection = direction;
  }

  /**
   * V2: Apply handbrake pivot effect
   */
  private applyHandbrakeEffect(): void {
    const mode = this.modeRegistry.getCurrentMode();
    const handbrakeForce = mode.params.amoeboidHandbrakeForce || 8.0;
    
    // Reduce front adhesions temporarily, increase rear tension
    this.motilityState.adhesion.frontBias -= 0.3;
    this.motilityState.effectiveSpeed *= 0.85; // Slight speed dip
    
    // Increase turn responsiveness for sharp pivot
    this.motilityState.effectiveTurnRate *= 2.0;
    
    // Apply brief brake force opposite to movement
    if (this.motilityState.speed > 0) {
      const brakeDirection = Math.atan2(this.motilityState.velocity.y, this.motilityState.velocity.x) + Math.PI;
      const brakeX = Math.cos(brakeDirection) * handbrakeForce * 0.5;
      const brakeY = Math.sin(brakeDirection) * handbrakeForce * 0.5;
      
      this.motilityState.velocity.x += brakeX;
      this.motilityState.velocity.y += brakeY;
    }
  }

  /**
   * V2: Trigger bleb burst with chain mechanics
   */
  private triggerBlebBurst(isChain: boolean, atpCost: number): void {
    const mode = this.modeRegistry.getCurrentMode();
    const burstSpeed = mode.params.blebBurstSpeed || 35.0;
    
    // Apply burst in current polarity direction
    const burstX = Math.cos(this.motilityState.polarity.direction) * burstSpeed;
    const burstY = Math.sin(this.motilityState.polarity.direction) * burstSpeed;
    
    // Set velocity directly for burst
    this.motilityState.velocity.x = burstX;
    this.motilityState.velocity.y = burstY;
    this.motilityState.speed = burstSpeed;
    
    // V2: Chain effects
    if (isChain) {
      // Chained bursts get slight speed bonus
      this.motilityState.velocity.x *= 1.1;
      this.motilityState.velocity.y *= 1.1;
      this.motilityState.speed *= 1.1;
    }
    
    // Consume ATP
    // TODO: Integrate with ATP system when available
    console.log(`Bleb burst: Chain=${isChain}, Cost=${atpCost.toFixed(1)}`);
    
    // Membrane effects
    this.motilityState.membraneSquash = 0.4;
    this.motilityState.membraneSquashDirection = this.motilityState.polarity.direction;
  }

  /**
   * V2: Update protease track effects
   */
  private updateProteaseEffect(): void {
    const modeState = this.modeRegistry.getState();
    
    if (modeState.mesenchymal.proteaseActive) {
      // Mark current location as having protease track
      // TODO: Integrate with substrate system for spatial tracking
      console.log('Protease trail activated at current location');
      
      // Improve local ECM resistance
      if (this.motilityState.currentSubstrate === 'ECM') {
        this.motilityState.effectiveSpeed *= 1.2; // Temporary speed boost on ECM
      }
    }
  }
}
