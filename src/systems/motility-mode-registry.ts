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
  };
  
  mesenchymal: {
    adhesionMaturity: number;       // 0-1, how mature current adhesions are
    proteaseActive: boolean;
    proteaseTimeRemaining: number;  // seconds of active protease effect
    pathCleared: boolean;           // whether current location has cleared ECM
  };
  
  amoeboid: {
    protrusion: {
      phase: number;                // 0-1 cycle phase for protrusion pulses
      intensity: number;            // current pulse strength
    };
    handbrakeAvailable: boolean;    // can use handbrake turn
    handbrakeCooldown: number;      // seconds until handbrake available
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
        burstRequested: false
      },
      
      mesenchymal: {
        adhesionMaturity: 0,
        proteaseActive: false,
        proteaseTimeRemaining: 0,
        pathCleared: false
      },
      
      amoeboid: {
        protrusion: {
          phase: 0,
          intensity: 0
        },
        handbrakeAvailable: true,
        handbrakeCooldown: 0
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
  update(deltaSeconds: number): void {
    const deltaMs = deltaSeconds * 1000;
    
    // Update blebbing state
    if (this.state.blebbing.isInBurst) {
      this.state.blebbing.burstTimeRemaining -= deltaMs;
      if (this.state.blebbing.burstTimeRemaining <= 0) {
        this.state.blebbing.isInBurst = false;
        const mode = this.getMode('blebbing');
        this.state.blebbing.cooldownRemaining = mode?.params.blebCooldownMs || 2500;
      }
    } else {
      this.state.blebbing.cooldownRemaining = Math.max(0, 
        this.state.blebbing.cooldownRemaining - deltaMs);
    }
    
    // Handle bleb burst requests
    if (this.state.blebbing.burstRequested && this.state.blebbing.cooldownRemaining <= 0) {
      this.startBlebBurst();
      this.state.blebbing.burstRequested = false;
    }
    
    // Update mesenchymal state
    if (this.state.mesenchymal.proteaseActive) {
      this.state.mesenchymal.proteaseTimeRemaining = Math.max(0,
        this.state.mesenchymal.proteaseTimeRemaining - deltaSeconds);
      
      if (this.state.mesenchymal.proteaseTimeRemaining <= 0) {
        this.state.mesenchymal.proteaseActive = false;
      }
    }
    
    // Update amoeboid state
    this.state.amoeboid.handbrakeCooldown = Math.max(0, 
      this.state.amoeboid.handbrakeCooldown - deltaSeconds);
    
    if (this.state.amoeboid.handbrakeCooldown <= 0) {
      this.state.amoeboid.handbrakeAvailable = true;
    }
    
    // Update protrusion cycle
    this.state.amoeboid.protrusion.phase += deltaSeconds * 2.0; // 2 Hz cycle
    if (this.state.amoeboid.protrusion.phase > 1.0) {
      this.state.amoeboid.protrusion.phase -= 1.0;
    }
    
    // Calculate protrusion intensity (sine wave)
    this.state.amoeboid.protrusion.intensity = 
      (Math.sin(this.state.amoeboid.protrusion.phase * Math.PI * 2) + 1) * 0.5;
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
        break;
        
      case 'mesenchymal':
        this.state.mesenchymal.adhesionMaturity = 0;
        this.state.mesenchymal.proteaseActive = false;
        this.state.mesenchymal.proteaseTimeRemaining = 0;
        break;
        
      case 'amoeboid':
        this.state.amoeboid.protrusion.phase = 0;
        this.state.amoeboid.protrusion.intensity = 0;
        break;
    }
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
