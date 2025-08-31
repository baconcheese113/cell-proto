import type { WorldRefs } from '../core/world-refs';
import { EndocytosisSystem } from './endocytosis-system';
import { Player } from '../actors/player';

const DEBUG_ENDOCYTOSIS_INPUT = true;

/**
 * Configuration for endocytosis input controls
 */
export interface EndocytosisInputConfig {
  // Input mappings
  activationKey: string;      // Key to hold for endocytosis (default: 'C')
  useDirectionalInput: boolean; // Use WASD for pocket direction
  debugScissionKey: string;   // Temporary key for single-player scission testing (default: 'X')
  debugFreezeToggleKey: string; // Key to toggle debug freeze state (default: 'F')
  
  // Input behavior
  holdToFormPocket: boolean;  // Must hold key to form pocket
  minFormationTime: number;   // Minimum time to form viable pocket (ms)
  
  // Sensitivity
  directionSensitivity: number; // How responsive to WASD input
}

/**
 * Endocytosis Input Controller - Handle player input for membrane pocket formation
 * 
 * This controller manages the input for endocytosis pocket formation, allowing the player
 * to initiate and control membrane invagination using keyboard controls from the nanobot perspective.
 */
export class EndocytosisInputController {
  private config: EndocytosisInputConfig;
  private isFormingPocket = false;
  private formationStartTime = 0;
  private lastDirectionInput = new Phaser.Math.Vector2();
  
  // Input state tracking
  private keyState: Record<string, boolean> = {};
  
  constructor(
    private scene: Phaser.Scene,
    private worldRefs: WorldRefs,
    private endocytosisSystem: EndocytosisSystem,
    _player: Player, // Keep reference for future use
    config: Partial<EndocytosisInputConfig> = {}
  ) {
    this.config = {
      activationKey: 'C',
      useDirectionalInput: true,
      debugScissionKey: 'X',
      debugFreezeToggleKey: 'F',
      holdToFormPocket: true,
      minFormationTime: 500, // 0.5 seconds minimum
      directionSensitivity: 1.0,
      ...config
    };
    
    this.initializeInput();
  }
  
  private initializeInput(): void {
    // Set up keyboard input listeners
    this.scene.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      this.keyState[event.code] = true;
      this.handleKeyDown(event.code);
    });
    
    this.scene.input.keyboard?.on('keyup', (event: KeyboardEvent) => {
      this.keyState[event.code] = false;
      this.handleKeyUp(event.code);
    });
    
    if (DEBUG_ENDOCYTOSIS_INPUT) {
      console.log('🫧 Endocytosis input controller initialized');
    }
  }
  
  private handleKeyDown(keyCode: string): void {
    const activationKeyCode = `Key${this.config.activationKey}`;
    const debugScissionKeyCode = `Key${this.config.debugScissionKey}`;
    const debugFreezeToggleKeyCode = `Key${this.config.debugFreezeToggleKey}`;

    console.log(`🫧 Key down: ${keyCode}`, `debugFreezeToggleKeyCode: ${debugFreezeToggleKeyCode}`, `debugScissionKeyCode: ${debugScissionKeyCode}`, `activationKeyCode: ${activationKeyCode}`);
    
    // Start pocket formation when activation key is pressed
    if (keyCode === activationKeyCode && !this.isFormingPocket) {
      console.log(`🫧 Activation key ${this.config.activationKey} pressed`);
      this.startPocketFormation();
    }
    
    // Debug scission shortcut for single-player testing
    if (keyCode === debugScissionKeyCode) {
      console.log(`🫧 Debug scission key ${this.config.debugScissionKey} pressed - use freeze toggle (${this.config.debugFreezeToggleKey}) instead for better testing`);
      // Note: Using freeze toggle is better for single-player testing
    }
    
    // Debug freeze toggle
    if (keyCode === debugFreezeToggleKeyCode) {
      console.log(`🫧 Debug freeze toggle key ${this.config.debugFreezeToggleKey} pressed`);
      this.endocytosisSystem.toggleDebugFreeze();
    }
  }
  
  private handleKeyUp(keyCode: string): void {
    const activationKeyCode = `Key${this.config.activationKey}`;
    
    // Stop pocket formation when activation key is released (but not during scission)
    if (keyCode === activationKeyCode && this.isFormingPocket) {
      const currentStage = this.endocytosisSystem.getCurrentStage();
      
      if (currentStage === 'scission') {
        // Don't stop formation during scission stage
        if (DEBUG_ENDOCYTOSIS_INPUT) {
          console.log(`🫧 Key released during scission stage - pocket maintained`);
        }
        this.worldRefs.showToast("Scission stage active - use compression zones to complete!");
        
        // Update internal state but don't stop the pocket
        this.isFormingPocket = false;
      } else {
        // Normal stop for invagination stage
        this.stopPocketFormation();
      }
    }
  }
  
  private startPocketFormation(): void {
    // Check if player can start endocytosis
    if (!this.endocytosisSystem.canInitiateEndocytosis()) {
      this.worldRefs.showToast("Move closer to membrane for endocytosis");
      return;
    }
    
    this.isFormingPocket = true;
    this.formationStartTime = this.scene.time.now;
    
    // Get initial directional input
    const initialDirection = this.getCurrentDirectionInput();
    
    // Start the endocytosis system
    const success = this.endocytosisSystem.startPocketFormation(initialDirection);
    
    if (success) {
      if (DEBUG_ENDOCYTOSIS_INPUT) {
        console.log(`🫧 Started pocket formation with direction (${initialDirection.x.toFixed(2)}, ${initialDirection.y.toFixed(2)})`);
      }
    } else {
      this.isFormingPocket = false;
    }
  }
  
  private stopPocketFormation(): void {
    if (!this.isFormingPocket) return;
    
    const formationTime = this.scene.time.now - this.formationStartTime;
    
    if (formationTime < this.config.minFormationTime) {
      this.worldRefs.showToast(`Hold ${this.config.activationKey} longer to form pocket`);
    }
    
    this.endocytosisSystem.stopPocketFormation();
    this.isFormingPocket = false;
    
    if (DEBUG_ENDOCYTOSIS_INPUT) {
      console.log(`🫧 Stopped pocket formation after ${formationTime}ms`);
    }
  }
  
  /**
   * Get current directional input from WASD keys
   */
  private getCurrentDirectionInput(): Phaser.Math.Vector2 {
    if (!this.config.useDirectionalInput) {
      return new Phaser.Math.Vector2();
    }
    
    let x = 0, y = 0;
    
    if (this.keyState['KeyW']) y -= 1;
    if (this.keyState['KeyS']) y += 1;
    if (this.keyState['KeyA']) x -= 1;
    if (this.keyState['KeyD']) x += 1;
    
    const direction = new Phaser.Math.Vector2(x, y);
    if (direction.lengthSq() > 0) {
      direction.normalize().scale(this.config.directionSensitivity);
    }
    
    return direction;
  }
  
  /**
   * Main update method - call this from the game scene update loop
   */
  public update(deltaSeconds: number): void {
    if (!this.isFormingPocket) return;
    
    // Update directional input
    const currentDirection = this.getCurrentDirectionInput();
    
    // Only update if direction has changed significantly
    if (currentDirection.distance(this.lastDirectionInput) > 0.1) {
      this.lastDirectionInput.copy(currentDirection);
      
      if (DEBUG_ENDOCYTOSIS_INPUT && currentDirection.lengthSq() > 0.1) {
        console.log(`🫧 Direction input: (${currentDirection.x.toFixed(2)}, ${currentDirection.y.toFixed(2)})`);
      }
    }
    
    // Update the endocytosis system with current input and show progress
    this.endocytosisSystem.updatePocketFormation(this.lastDirectionInput, deltaSeconds);
    
    // Show formation progress every few frames
    if (DEBUG_ENDOCYTOSIS_INPUT && Math.random() < 0.02) { // 2% chance to show progress
      const inputState = this.getInputState();
      console.log(`🫧 Formation progress: ${(inputState.formationProgress * 100).toFixed(1)}%, deltaSeconds: ${deltaSeconds.toFixed(3)}`);
    }
  }
  
  /**
   * Get the current state for UI feedback
   */
  public getInputState(): {
    isFormingPocket: boolean;
    formationProgress: number;
    canInitiate: boolean;
  } {
    const pocketState = this.endocytosisSystem.getPocketState();
    
    return {
      isFormingPocket: this.isFormingPocket,
      formationProgress: pocketState.formationProgress,
      canInitiate: this.endocytosisSystem.canInitiateEndocytosis()
    };
  }
  
  /**
   * Get help text for UI display
   */
  public getControlHints(): string {
    const hints = [];
    
    if (this.endocytosisSystem.canInitiateEndocytosis()) {
      hints.push(`Hold ${this.config.activationKey}: Start endocytosis`);
    } else {
      hints.push(`Move to membrane edge for endocytosis`);
    }
    
    if (this.config.useDirectionalInput) {
      hints.push(`WASD: Control pocket direction`);
    }
    
    return hints.join(' | ');
  }
  
  /**
   * Clean up input listeners
   */
  public destroy(): void {
    // Clean up keyboard listeners
    this.scene.input.keyboard?.off('keydown');
    this.scene.input.keyboard?.off('keyup');
    
    if (DEBUG_ENDOCYTOSIS_INPUT) {
      console.log('🫧 Endocytosis input controller destroyed');
    }
  }
}
