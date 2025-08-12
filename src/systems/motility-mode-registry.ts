/**
 * Motility Mode Registry
 * 
 * Central registry for motility modes with mode switching and state management.
 */

import { 
  MOTILITY_MODES, 
  SUBSTRATE_SCALARS, 
  MOTILITY_PRESETS,
  applyPresetToMode,
  type MotilityModeId, 
  type MotilityModeDefinition,
  type SubstrateType 
} from './motility-modes.config';

export interface MotilityModeState {
  // Core state
  currentModeId: MotilityModeId;
  availableModes: MotilityModeId[];
  
  // Mode-specific state
  blebbing: {
    burstTimeRemaining: number;     // ms remaining in current burst
    cooldownRemaining: number;      // ms until next burst available
    isInBurst: boolean;
    burstRequested: boolean;
    // V2: Chain mechanics
    pressure: number;               // 0-1, internal pressure meter
    chainWindow: number;            // ms remaining in chain timing window
    refractory: number;             // ms remaining in steering penalty
    chainCount: number;             // number of chained bursts in sequence
  };
  
  mesenchymal: {
    adhesionMaturity: number;       // 0-1, how mature current adhesions are
    proteaseActive: boolean;
    proteaseTimeRemaining: number;  // seconds of active protease effect
    pathCleared: boolean;           // whether current location has cleared ECM
    // V2: Track mechanics
    trackStrength: number;          // 0-1, current track effectiveness
    leftAdhesionMaturity: number;   // 0-1, left side adhesion maturity
    rightAdhesionMaturity: number;  // 0-1, right side adhesion maturity
    anchorDropWarning: boolean;     // UI warning for potential anchor drop
  };
  
  amoeboid: {
    protrusion: {
      phase: number;                // 0-1 cycle phase for protrusion pulses
      intensity: number;            // current pulse strength
    };
    handbrakeAvailable: boolean;    // can use handbrake turn
    handbrakeCooldown: number;      // seconds until handbrake available
    // V2: Pseudopod mechanics
    pulse: number;                  // 0-maxBank, stored pseudopod energy
    aimDirection: number;           // radians, aimed lobe direction
    isAiming: boolean;              // actively aiming a lobe
    handbrakeActive: boolean;       // currently executing handbrake
    handbrakeTimeRemaining: number; // seconds of handbrake effect left
  };
}

export class MotilityModeRegistry {
  private modeDefinitions: Map<MotilityModeId, MotilityModeDefinition>;
  private state: MotilityModeState;
  private currentPreset: keyof typeof MOTILITY_PRESETS = 'arcade';
  
  constructor() {
    this.modeDefinitions = new Map();
    this.loadModes();
    this.state = this.createInitialState();
  }
  
  private loadModes(): void {
    // Load all modes with current preset applied
    Object.values(MOTILITY_MODES).forEach(mode => {
      const scaledMode = applyPresetToMode(mode, this.currentPreset);
      this.modeDefinitions.set(mode.id, scaledMode);
    });
  }
  
  private createInitialState(): MotilityModeState {
    return {
      currentModeId: 'amoeboid',
      availableModes: ['amoeboid', 'blebbing', 'mesenchymal'],
      
      blebbing: {
        burstTimeRemaining: 0,
        cooldownRemaining: 0,
        isInBurst: false,
        burstRequested: false,
        // V2: Chain mechanics
        pressure: 1.0,
        chainWindow: 0,
        refractory: 0,
        chainCount: 0
      },
      
      mesenchymal: {
        adhesionMaturity: 0,
        proteaseActive: false,
        proteaseTimeRemaining: 0,
        pathCleared: false,
        // V2: Track mechanics
        trackStrength: 0,
        leftAdhesionMaturity: 0,
        rightAdhesionMaturity: 0,
        anchorDropWarning: false
      },
      
      amoeboid: {
        protrusion: {
          phase: 0,
          intensity: 0
        },
        handbrakeAvailable: true,
        handbrakeCooldown: 0,
        // V2: Pseudopod mechanics
        pulse: 10.0,  // Start with full pulse bank
        aimDirection: 0,
        isAiming: false,
        handbrakeActive: false,
        handbrakeTimeRemaining: 0
      }
    };
  }
  
  /**
   * Get current active mode definition
   */
  getCurrentMode(): MotilityModeDefinition {
    const mode = this.modeDefinitions.get(this.state.currentModeId);
    if (!mode) {
      throw new Error(`Mode not found: ${this.state.currentModeId}`);
    }
    return mode;
  }
  
  /**
   * Get mode by ID
   */
  getMode(modeId: MotilityModeId): MotilityModeDefinition | null {
    return this.modeDefinitions.get(modeId) || null;
  }
  
  /**
   * Get all available modes
   */
  getAvailableModes(): MotilityModeDefinition[] {
    return this.state.availableModes
      .map(id => this.modeDefinitions.get(id))
      .filter(Boolean) as MotilityModeDefinition[];
  }
  
  /**
   * Switch to a different mode
   */
  switchMode(modeId: MotilityModeId): boolean {
    if (!this.state.availableModes.includes(modeId)) {
      return false;
    }
    
    if (this.state.currentModeId === modeId) {
      return true; // Already in this mode
    }
    
    // Reset mode-specific state when switching
    this.resetModeState(this.state.currentModeId);
    
    this.state.currentModeId = modeId;
    return true;
  }
  
  /**
   * Cycle to next available mode
   */
  cycleMode(): MotilityModeId {
    const currentIndex = this.state.availableModes.indexOf(this.state.currentModeId);
    const nextIndex = (currentIndex + 1) % this.state.availableModes.length;
    const nextMode = this.state.availableModes[nextIndex];
    
    this.switchMode(nextMode);
    return nextMode;
  }
  
  /**
   * Get substrate interaction scalars for current mode
   */
  getSubstrateScalars(substrate: SubstrateType): {
    speedMultiplier: number;
    turnMultiplier: number;
    adhesionEfficiency: number;
  } {
    const modeScalars = SUBSTRATE_SCALARS[this.state.currentModeId];
    return modeScalars?.[substrate] || { speedMultiplier: 1, turnMultiplier: 1, adhesionEfficiency: 1 };
  }
  
  /**
   * Request a mode-specific action (like bleb burst)
   */
  requestAction(action: 'blebBurst' | 'proteaseToggle' | 'handbrake'): boolean {
    switch (action) {
      case 'blebBurst':
        if (this.state.currentModeId === 'blebbing' && 
            this.state.blebbing.cooldownRemaining <= 0 && 
            !this.state.blebbing.isInBurst) {
          this.state.blebbing.burstRequested = true;
          return true;
        }
        return false;
        
      case 'proteaseToggle':
        if (this.state.currentModeId === 'mesenchymal') {
          this.state.mesenchymal.proteaseActive = !this.state.mesenchymal.proteaseActive;
          return true;
        }
        return false;
        
      case 'handbrake':
        if (this.state.currentModeId === 'amoeboid' && 
            this.state.amoeboid.handbrakeAvailable) {
          this.state.amoeboid.handbrakeAvailable = false;
          this.state.amoeboid.handbrakeCooldown = 3.0; // 3 second cooldown
          return true;
        }
        return false;
    }
    
    return false;
  }
  
  /**
   * Update mode-specific timers and state
   */
  update(deltaSeconds: number, currentSpeed: number = 0, turnRate: number = 0): void {
    const deltaMs = deltaSeconds * 1000;
    
    // Update blebbing state
    this.updateBlebbingState(deltaMs, deltaSeconds);
    
    // Update mesenchymal state
    this.updateMesenchymalState(deltaSeconds, currentSpeed, turnRate);
    
    // Update amoeboid state
    this.updateAmoeboidState(deltaSeconds, currentSpeed);
    
    // Update protrusion cycle
    this.state.amoeboid.protrusion.phase += deltaSeconds * 2.0; // 2 Hz cycle
    if (this.state.amoeboid.protrusion.phase > 1.0) {
      this.state.amoeboid.protrusion.phase -= 1.0;
    }
    
    // Calculate protrusion intensity (sine wave)
    this.state.amoeboid.protrusion.intensity = 
      (Math.sin(this.state.amoeboid.protrusion.phase * Math.PI * 2) + 1) * 0.5;
  }

  private updateBlebbingState(deltaMs: number, deltaSeconds: number): void {
    const mode = this.getMode('blebbing');
    if (!mode) return;

    // Update burst state
    if (this.state.blebbing.isInBurst) {
      this.state.blebbing.burstTimeRemaining -= deltaMs;
      if (this.state.blebbing.burstTimeRemaining <= 0) {
        this.state.blebbing.isInBurst = false;
        
        // V2: Start chain window after burst ends
        this.state.blebbing.chainWindow = mode.params.blebChainWindowMs || 300;
        
        // Set cooldown
        const cooldown = mode.params.blebCooldownMs || 2500;
        this.state.blebbing.cooldownRemaining = cooldown;
      }
    } else {
      this.state.blebbing.cooldownRemaining = Math.max(0, 
        this.state.blebbing.cooldownRemaining - deltaMs);
    }

    // V2: Update chain window
    if (this.state.blebbing.chainWindow > 0) {
      this.state.blebbing.chainWindow -= deltaMs;
      if (this.state.blebbing.chainWindow <= 0) {
        // Missed chain window - enter refractory period
        if (this.state.blebbing.chainCount > 0) {
          this.state.blebbing.refractory = mode.params.blebRefractoryMs || 1200;
          this.state.blebbing.chainCount = 0;
        }
      }
    }

    // V2: Update refractory period
    if (this.state.blebbing.refractory > 0) {
      this.state.blebbing.refractory -= deltaMs;
    }

    // V2: Pressure builds when idle, depletes during bursts
    if (this.state.blebbing.isInBurst) {
      this.state.blebbing.pressure = Math.max(0, this.state.blebbing.pressure - deltaSeconds * 2.0);
    } else {
      this.state.blebbing.pressure = Math.min(1.0, this.state.blebbing.pressure + deltaSeconds * 0.5);
    }

    // Handle bleb burst requests
    if (this.state.blebbing.burstRequested && this.state.blebbing.cooldownRemaining <= 0) {
      this.startBlebBurst();
      this.state.blebbing.burstRequested = false;
    }
  }

  private updateMesenchymalState(deltaSeconds: number, currentSpeed: number, turnRate: number): void {
    const mode = this.getMode('mesenchymal');
    if (!mode) return;

    // Update protease state
    if (this.state.mesenchymal.proteaseActive) {
      this.state.mesenchymal.proteaseTimeRemaining = Math.max(0,
        this.state.mesenchymal.proteaseTimeRemaining - deltaSeconds);
      
      if (this.state.mesenchymal.proteaseTimeRemaining <= 0) {
        this.state.mesenchymal.proteaseActive = false;
      }
    }

    // V2: Update adhesion maturity based on forward movement
    const maturityRate = currentSpeed > 0 ? (currentSpeed / mode.params.baseSpeed) : -0.5;
    const maturityTime = mode.params.mesenchymalMaturityTime || 2.0;
    const maturityDelta = (maturityRate / maturityTime) * deltaSeconds;
    
    this.state.mesenchymal.leftAdhesionMaturity = Math.max(0, Math.min(1, 
      this.state.mesenchymal.leftAdhesionMaturity + maturityDelta));
    this.state.mesenchymal.rightAdhesionMaturity = Math.max(0, Math.min(1, 
      this.state.mesenchymal.rightAdhesionMaturity + maturityDelta));

    // V2: Check for anchor drop due to excessive turning
    const turnThreshold = mode.params.mesenchymalTurnThreshold || 0.8;
    if (Math.abs(turnRate) > turnThreshold) {
      // Drop anchors on the inner side of the turn
      if (turnRate > 0) { // Turning right, drop left anchors
        this.state.mesenchymal.leftAdhesionMaturity *= 0.3;
      } else { // Turning left, drop right anchors
        this.state.mesenchymal.rightAdhesionMaturity *= 0.3;
      }
      this.state.mesenchymal.anchorDropWarning = true;
    } else {
      this.state.mesenchymal.anchorDropWarning = false;
    }

    // V2: Track strength decays over time
    this.state.mesenchymal.trackStrength = Math.max(0, 
      this.state.mesenchymal.trackStrength - deltaSeconds * (mode.params.mesenchymalTrackDecayRate || 0.1));

    // Overall maturity is average of both sides
    this.state.mesenchymal.adhesionMaturity = 
      (this.state.mesenchymal.leftAdhesionMaturity + this.state.mesenchymal.rightAdhesionMaturity) / 2;
  }

  private updateAmoeboidState(deltaSeconds: number, currentSpeed: number): void {
    const mode = this.getMode('amoeboid');
    if (!mode) return;

    // Update handbrake cooldown
    this.state.amoeboid.handbrakeCooldown = Math.max(0, 
      this.state.amoeboid.handbrakeCooldown - deltaSeconds);
    
    if (this.state.amoeboid.handbrakeCooldown <= 0) {
      this.state.amoeboid.handbrakeAvailable = true;
    }

    // V2: Update handbrake active state
    if (this.state.amoeboid.handbrakeActive) {
      this.state.amoeboid.handbrakeTimeRemaining -= deltaSeconds;
      if (this.state.amoeboid.handbrakeTimeRemaining <= 0) {
        this.state.amoeboid.handbrakeActive = false;
      }
    }

    // V2: Pulse regeneration (faster when coasting)
    const regenRate = mode.params.amoeboidPulseRegenRate || 2.0;
    const maxBank = mode.params.amoeboidPulseMaxBank || 10.0;
    const speedFactor = currentSpeed < mode.params.baseSpeed * 0.3 ? 2.0 : 1.0; // 2x regen when slow
    
    this.state.amoeboid.pulse = Math.min(maxBank, 
      this.state.amoeboid.pulse + regenRate * speedFactor * deltaSeconds);
  }
  
  private startBlebBurst(): void {
    const mode = this.getMode('blebbing');
    if (!mode) return;
    
    this.state.blebbing.isInBurst = true;
    this.state.blebbing.burstTimeRemaining = mode.params.blebDurationMs || 800;
  }
  
  private resetModeState(modeId: MotilityModeId): void {
    switch (modeId) {
      case 'blebbing':
        this.state.blebbing.isInBurst = false;
        this.state.blebbing.burstTimeRemaining = 0;
        this.state.blebbing.burstRequested = false;
        this.state.blebbing.pressure = 1.0;
        this.state.blebbing.chainWindow = 0;
        this.state.blebbing.refractory = 0;
        this.state.blebbing.chainCount = 0;
        break;
        
      case 'mesenchymal':
        this.state.mesenchymal.adhesionMaturity = 0;
        this.state.mesenchymal.proteaseActive = false;
        this.state.mesenchymal.proteaseTimeRemaining = 0;
        this.state.mesenchymal.trackStrength = 0;
        this.state.mesenchymal.leftAdhesionMaturity = 0;
        this.state.mesenchymal.rightAdhesionMaturity = 0;
        this.state.mesenchymal.anchorDropWarning = false;
        break;
        
      case 'amoeboid':
        this.state.amoeboid.protrusion.phase = 0;
        this.state.amoeboid.protrusion.intensity = 0;
        this.state.amoeboid.pulse = 10.0; // Reset to full pulse bank
        this.state.amoeboid.aimDirection = 0;
        this.state.amoeboid.isAiming = false;
        this.state.amoeboid.handbrakeActive = false;
        this.state.amoeboid.handbrakeTimeRemaining = 0;
        break;
    }
  }

  /**
   * V2: Start aiming a pseudopod lobe
   */
  startPseudopodAim(direction: number): boolean {
    if (this.state.currentModeId !== 'amoeboid' || this.state.amoeboid.pulse <= 0) {
      return false;
    }
    
    this.state.amoeboid.isAiming = true;
    this.state.amoeboid.aimDirection = direction;
    return true;
  }

  /**
   * V2: Fire pseudopod lobe in aimed direction
   */
  firePseudopodLobe(): { success: boolean; force: number; direction: number } {
    if (!this.state.amoeboid.isAiming || this.state.amoeboid.pulse <= 0) {
      return { success: false, force: 0, direction: 0 };
    }

    const mode = this.getMode('amoeboid');
    if (!mode) return { success: false, force: 0, direction: 0 };

    // Calculate force based on pulse energy
    const maxForce = mode.params.amoeboidLobeForce || 15.0;
    const pulseRatio = Math.min(1.0, this.state.amoeboid.pulse / (mode.params.amoeboidPulseMaxBank || 10.0));
    const force = maxForce * pulseRatio;

    // Consume pulse energy
    this.state.amoeboid.pulse = Math.max(0, this.state.amoeboid.pulse - 2.0);
    this.state.amoeboid.isAiming = false;

    return { 
      success: true, 
      force: force, 
      direction: this.state.amoeboid.aimDirection 
    };
  }

  /**
   * V2: Activate handbrake for sharp pivot
   */
  activateHandbrake(): boolean {
    if (this.state.currentModeId !== 'amoeboid' || !this.state.amoeboid.handbrakeAvailable) {
      return false;
    }

    const mode = this.getMode('amoeboid');
    if (!mode) return false;

    this.state.amoeboid.handbrakeActive = true;
    this.state.amoeboid.handbrakeTimeRemaining = mode.params.amoeboidHandbrakeDuration || 0.4;
    this.state.amoeboid.handbrakeAvailable = false;
    this.state.amoeboid.handbrakeCooldown = 3.0; // 3 second cooldown

    return true;
  }

  /**
   * V2: Chain bleb burst (if in timing window)
   */
  chainBlebBurst(): { success: boolean; isChain: boolean; cost: number } {
    if (this.state.currentModeId !== 'blebbing') {
      return { success: false, isChain: false, cost: 0 };
    }

    const mode = this.getMode('blebbing');
    if (!mode) return { success: false, isChain: false, cost: 0 };

    const baseCost = mode.params.atpPerBurst || 4.0;
    let cost = baseCost;
    let isChain = false;

    // Check if we're in chain window
    if (this.state.blebbing.chainWindow > 0) {
      const chainMultiplier = mode.params.blebChainCostMultiplier || 0.9;
      const chainPenalty = mode.params.atpChainPenalty || 1.2;
      
      cost = baseCost * chainMultiplier * Math.pow(chainPenalty, this.state.blebbing.chainCount);
      isChain = true;
      this.state.blebbing.chainCount++;
      this.state.blebbing.chainWindow = mode.params.blebChainWindowMs || 300; // Reset window
    } else if (this.state.blebbing.refractory > 0 || this.state.blebbing.cooldownRemaining > 0) {
      return { success: false, isChain: false, cost: 0 };
    }

    this.startBlebBurst();
    return { success: true, isChain, cost };
  }
  
  /**
   * Set the current preset and reload all modes
   */
  setPreset(preset: keyof typeof MOTILITY_PRESETS): void {
    this.currentPreset = preset;
    this.loadModes();
  }
  
  /**
   * Get current preset name
   */
  getCurrentPreset(): string {
    return MOTILITY_PRESETS[this.currentPreset].name;
  }

  /**
   * Get V2 state meters for UI display
   */
  getStateMeter(meter: 'pulse' | 'pressure' | 'leftMaturity' | 'rightMaturity' | 'trackStrength'): number {
    switch (meter) {
      case 'pulse':
        return this.state.amoeboid.pulse;
      case 'pressure':
        return this.state.blebbing.pressure;
      case 'leftMaturity':
        return this.state.mesenchymal.leftAdhesionMaturity;
      case 'rightMaturity':
        return this.state.mesenchymal.rightAdhesionMaturity;
      case 'trackStrength':
        return this.state.mesenchymal.trackStrength;
      default:
        return 0;
    }
  }

  /**
   * Get all state meters for debugging
   */
  getAllStateMeters(): Record<string, number> {
    return {
      // Amoeboid
      pulse: this.state.amoeboid.pulse,
      aimDirection: this.state.amoeboid.aimDirection,
      handbrakeTimeRemaining: this.state.amoeboid.handbrakeTimeRemaining,
      
      // Blebbing
      pressure: this.state.blebbing.pressure,
      chainWindow: this.state.blebbing.chainWindow,
      refractory: this.state.blebbing.refractory,
      chainCount: this.state.blebbing.chainCount,
      
      // Mesenchymal
      leftMaturity: this.state.mesenchymal.leftAdhesionMaturity,
      rightMaturity: this.state.mesenchymal.rightAdhesionMaturity,
      trackStrength: this.state.mesenchymal.trackStrength
    };
  }

  /**
   * Check if specific mode actions are available
   */
  isActionAvailable(action: 'blebBurst' | 'proteaseToggle' | 'handbrake' | 'pseudopodLobe'): boolean {
    switch (action) {
      case 'blebBurst':
        return this.state.currentModeId === 'blebbing' && 
               this.state.blebbing.cooldownRemaining <= 0 && 
               !this.state.blebbing.isInBurst &&
               this.state.blebbing.refractory <= 0;
               
      case 'proteaseToggle':
        return this.state.currentModeId === 'mesenchymal';
        
      case 'handbrake':
        return this.state.currentModeId === 'amoeboid' && 
               this.state.amoeboid.handbrakeAvailable &&
               !this.state.amoeboid.handbrakeActive;
               
      case 'pseudopodLobe':
        return this.state.currentModeId === 'amoeboid' && 
               this.state.amoeboid.pulse > 0;
               
      default:
        return false;
    }
  }

  /**
   * Get chain timing window progress (0-1) for blebbing
   */
  getChainWindowProgress(): number {
    const mode = this.getMode('blebbing');
    if (!mode || this.state.blebbing.chainWindow <= 0) return 0;
    
    const maxWindow = mode.params.blebChainWindowMs || 300;
    return this.state.blebbing.chainWindow / maxWindow;
  }
  
  /**
   * Get current mode state (readonly)
   */
  getState(): Readonly<MotilityModeState> {
    return this.state;
  }
  
  /**
   * Unlock a new mode (for progression)
   */
  unlockMode(modeId: MotilityModeId): void {
    if (!this.state.availableModes.includes(modeId)) {
      this.state.availableModes.push(modeId);
    }
  }
  
  /**
   * Lock a mode (for specific levels)
   */
  lockMode(modeId: MotilityModeId): void {
    const index = this.state.availableModes.indexOf(modeId);
    if (index >= 0) {
      this.state.availableModes.splice(index, 1);
      
      // Switch to first available mode if current mode was locked
      if (this.state.currentModeId === modeId && this.state.availableModes.length > 0) {
        this.switchMode(this.state.availableModes[0]);
      }
    }
  }
}
