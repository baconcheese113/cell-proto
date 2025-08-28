/**
 * Milestone 12 - Throw Input Controller
 * 
 * Story 12.2: Clean, predictable throws on mouse/keyboard and gamepad
 * - Hold to aim (mouse pos / right stick); thin arc preview with predicted landing
 * - Release to throw; configurable throw speed/arc; optional light charge curve
 * - Throw only when speed < threshold (no wild throws at full dash)
 * 
 * Integration with existing input system and new throw mechanics.
 */

import type { WorldRefs } from "../core/world-refs";
import type { ThrowSystem } from "./throw-system";
import type { CargoSystem } from "./cargo-system";
import type { NetBundle } from "../app/net-bundle";
import type { Player } from "../actors/player";

export interface ThrowInputConfig {
  // Input mappings
  mouseAiming: boolean; // Use mouse for aiming direction
  gamepadSupport: boolean; // Support gamepad right stick
  
  // Input behavior
  quickThrowThreshold: number; // ms for quick throw vs aimed throw
  chargeTime: number; // ms for full charge
  
  // Sensitivity
  mouseSensitivity: number; // Mouse movement sensitivity
  gamepadDeadzone: number; // Right stick deadzone
}

export class ThrowInputController {
  private config: ThrowInputConfig;
  private isAiming = false;
  private aimStartTime = 0;
  private lastMousePos = new Phaser.Math.Vector2();
  
  // Input objects
  private gamepad?: Phaser.Input.Gamepad.Gamepad;
  
  constructor(
    private scene: Phaser.Scene,
    private worldRefs: WorldRefs,
    private throwSystem: ThrowSystem,
    private cargoSystem: CargoSystem,
    private net: NetBundle,
    private playerActor: Player,
    config: Partial<ThrowInputConfig> = {}
  ) {
    console.log(`🎯 ThrowInputController: Constructor called with net: ${!!this.net}`);
    this.config = {
      mouseAiming: true,
      gamepadSupport: true,
      quickThrowThreshold: 200, // ms
      chargeTime: 1500, // ms for full charge
      mouseSensitivity: 1.0,
      gamepadDeadzone: 0.15,
      ...config
    };
    
    console.log(`🎯 ThrowInputController: NetBundle injected successfully: ${!!this.net}`);
    this.initializeInput();
  }
  
  private initializeInput(): void {
    // Set up mouse input
    if (this.config.mouseAiming) {
      this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        this.handleMouseMove(pointer);
      });
      
      // Add mouse click support for throwing
      this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.rightButtonDown()) {
          console.log("🎯 Right mouse down detected");
          pointer.event.preventDefault(); // Prevent browser context menu
          this.startAiming();
        }
      });
      
      this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        console.log(`🎯 Pointer up detected: isAiming=${this.isAiming}, button=${pointer.button}`);
        
        // Check if we were aiming (right button was down) and now releasing
        if (this.isAiming) {
          console.log("🎯 Right mouse up detected (while aiming)");
          pointer.event.preventDefault(); // Prevent browser context menu  
          this.executeThrow();
        } else {
          console.log("🎯 Right mouse up detected (but not aiming)");
        }
      });
    }
    
    // Set up gamepad (if available)
    if (this.config.gamepadSupport && this.scene.input.gamepad) {
      this.scene.input.gamepad.on('connected', (gamepad: Phaser.Input.Gamepad.Gamepad) => {
        this.gamepad = gamepad;
      });
    }
  }
  
  /**
   * Main update method - call this from the game scene update loop
   */
  public update(): void {
    this.updateGamepadInput();
    
    // Update aiming continuously while charging
    if (this.isAiming) {
      this.updateAiming();
    }
  }
  
  /**
   * Update aiming target and charge level while aiming
   */
  private updateAiming(): void {
    if (!this.isAiming) return;
    
    const holdTime = this.scene.time.now - this.aimStartTime;
    const chargeLevel = Math.min(holdTime / this.config.chargeTime, 1.0);
    
    // Get current target position
    let targetPosition: Phaser.Math.Vector2;
    
    if (this.config.mouseAiming && this.scene.input.activePointer) {
      // Use stored mouse coordinates and convert to cell-local coordinates
      const worldX = this.lastMousePos.x;
      const worldY = this.lastMousePos.y;
      
      // Convert world coordinates to cell-local coordinates
      const cellRoot = this.worldRefs.cellRoot;
      const localX = worldX - cellRoot.x;
      const localY = worldY - cellRoot.y;
      
      targetPosition = new Phaser.Math.Vector2(localX, localY);
    } else {
      // Use gamepad or default position
      const playerPos = this.getPlayerPosition();
      targetPosition = new Phaser.Math.Vector2(playerPos.x + 80, playerPos.y);
    }
    
    // Update throw system with new target
    this.throwSystem.updateAimTarget(targetPosition);
    
    // Update cargo indicator position to show throw direction
    this.updateCargoIndicatorPosition(targetPosition, chargeLevel);
  }
  
  /**
   * Update the cargo indicator position to show throw direction
   */
  private updateCargoIndicatorPosition(targetPosition: Phaser.Math.Vector2, chargeLevel: number): void {
    const player = this.playerActor;
    if (!player) return;
    
    const playerPos = this.getPlayerPosition();
    const direction = new Phaser.Math.Vector2(
      targetPosition.x - playerPos.x,
      targetPosition.y - playerPos.y
    ).normalize();
    
    // Position cargo indicator around player in throw direction
    const radius = 25 + (chargeLevel * 15); // Increase radius with charge
    const cargoPos = direction.scale(radius);
    
    player.updateCargoIndicatorPosition(cargoPos, chargeLevel);
  }
  
  /**
   * Handle gamepad input for throwing
   */
  private updateGamepadInput(): void {
    if (!this.gamepad) return;
    
    // Use right bumper (R1) for throwing - check button state
    const throwButtonPressed = this.gamepad.R1 > 0.5; // Treat as pressed if > 0.5
    
    // Hold-to-aim mode for gamepad
    if (throwButtonPressed && !this.isAiming) {
      console.log("🎯 Gamepad throw button pressed");
      this.startAiming();
    } else if (!throwButtonPressed && this.isAiming) {
      console.log("🎯 Gamepad throw button released");
      this.executeThrow();
    }
    
    // Update aim direction with right stick
    if (this.isAiming) {
      const rightStick = this.gamepad.rightStick;
      if (rightStick.length() > this.config.gamepadDeadzone) {
        const playerPos = this.getPlayerPosition();
        const aimDistance = 100; // Base aim distance for gamepad
        
        const targetPos = new Phaser.Math.Vector2(
          playerPos.x + rightStick.x * aimDistance,
          playerPos.y + rightStick.y * aimDistance
        );
        
        this.throwSystem.updateAimTarget(targetPos);
      }
    }
  }
  
  /**
   * Handle mouse movement for aiming
   */
  private handleMouseMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isAiming || !this.config.mouseAiming) return;
    
    // Store the pointer coordinates for use in updateAiming
    // Don't convert coordinates here - let updateAiming handle it
    this.lastMousePos.set(pointer.worldX, pointer.worldY);
  }
  
  /**
   * Check if player is carrying something
   */
  private isCarryingSomething(): boolean {
    const playerInventory = this.cargoSystem.getMyPlayerInventory();
    console.log(`🔍 ThrowController.isCarryingSomething(): isCarrying=${!!playerInventory}, localId=${this.net.bus.localId}, inventory.length=${playerInventory.length}`);
    return !!playerInventory;
  }

  /**
   * Execute throw using unified cargo and throw systems
   */
  private executeNetworkAwareThrow(): boolean {
    console.log(`🎯 Executing throw via ThrowSystem`);
    
    // Calculate charge level
    const holdTime = this.scene.time.now - this.aimStartTime;
    const chargeLevel = Math.min(holdTime / this.config.chargeTime, 1.0);
    
    // Get current player position as hex coordinates
    const playerPos = this.playerActor.getHexCoord();
    if (!playerPos) {
      console.warn('🎯 Could not get player position for throw');
      return false;
    }
    
    // Get the first cargo item from player inventory
    const playerInventory = this.cargoSystem.getMyPlayerInventory();
    if (playerInventory.length === 0) {
      console.warn('🎯 No cargo to throw');
      return false;
    }
    
    const cargoToThrow = playerInventory[0];
    
    // Convert aim target to hex coordinates
    const aimTarget = this.throwSystem.getAimTarget();
    if (!aimTarget) {
      console.warn('🎯 No aim target set');
      return false;
    }
    
    // Use proper world-to-hex coordinate conversion
    const targetHex = this.worldRefs.hexGrid.worldToHex(aimTarget.x, aimTarget.y);
    
    // Calculate velocity based on charge level (higher charge = faster projectile)
    const baseVelocity = 3.0;
    const maxVelocity = 8.0;
    const velocity = baseVelocity + (chargeLevel * (maxVelocity - baseVelocity));
    
    console.log(`🎯 Throwing cargo ${cargoToThrow.id} from (${playerPos.q}, ${playerPos.r}) to (${targetHex.q}, ${targetHex.r}) with velocity ${velocity}`);
    
    // Use the actual throwCargo method instead of the placeholder executeThrow
    const success = this.throwSystem.throwCargo(
      this.net.bus.localId,
      cargoToThrow.id,
      playerPos,
      targetHex,
      velocity
    );
    
    console.log(`🎯 ThrowSystem throwCargo result: ${success}`);
    
    // MULTIPLAYER FIX: Reset client-side aiming state regardless of server result
    // This ensures clients can throw multiple times even though throwCargo() only runs on server
    this.throwSystem.cancelAiming();
    console.log(`🎯 Client-side: Reset ThrowSystem aiming state after throw attempt`);
    
    return success;
  }

  /**
   * Start the aiming process
   */
  private startAiming(): void {
    console.log(`🎯 StartAiming called: currently isAiming=${this.isAiming}`);
    
    // If already aiming, don't start again
    if (this.isAiming) {
      console.log("🎯 Already aiming, ignoring duplicate startAiming call");
      return;
    }
    
    // Check if player can throw (multiplayer-aware)
    if (!this.isCarryingSomething()) {
      console.log("❌ Not carrying anything to throw");
      this.worldRefs.showToast("Not carrying anything to throw");
      return;
    }
    
    // Check player speed (safety gate)
    const player = this.playerActor;
    if (player) {
      const body = player.getPhysicsBody();
      if (body && body.velocity.length() > 150) { // Speed threshold from config
        this.worldRefs.showToast("Moving too fast to aim");
        return;
      }
    }
    
    this.isAiming = true;
    this.aimStartTime = this.scene.time.now;
    console.log(`🎯 Aiming started: isAiming=${this.isAiming}, aimStartTime=${this.aimStartTime}`);
    
    // Get initial aim position
    let initialTarget: Phaser.Math.Vector2;
    
    if (this.config.mouseAiming && this.scene.input.activePointer) {
      // Use current mouse position and convert to cellRoot coordinates
      const pointer = this.scene.input.activePointer;
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      
      // Store initial mouse position
      this.lastMousePos.set(worldX, worldY);
      
      // Convert to cellRoot-relative coordinates
      const cellRoot = this.worldRefs.cellRoot;
      const localX = worldX - cellRoot.x;
      const localY = worldY - cellRoot.y;
      
      initialTarget = new Phaser.Math.Vector2(localX, localY);
    } else {
      // Use position in front of player
      const playerPos = this.getPlayerPosition();
      const player = this.playerActor;
      const playerBody = player ? player.getPhysicsBody() : null;
      
      if (playerBody && playerBody.velocity.length() > 10) {
        // Use movement direction
        const direction = new Phaser.Math.Vector2(playerBody.velocity.x, playerBody.velocity.y).normalize();
        initialTarget = playerPos.clone().add(direction.scale(80));
      } else {
        // Default forward direction
        initialTarget = new Phaser.Math.Vector2(playerPos.x + 80, playerPos.y);
      }
    }
    
    // Start aiming in throw system
    const success = this.throwSystem.startAiming(initialTarget);
    
    if (!success) {
      this.isAiming = false;
      return;
    }
    
    // Visual feedback
    this.worldRefs.showToast("Aiming... (hold and move mouse/stick)");
    
    // Could add subtle screen effects here
    this.scene.cameras.main.setZoom(this.scene.cameras.main.zoom * 1.1);
  }
  
  /**
   * Execute the throw
   */
  private executeThrow(): void {
    console.log("🎯 ExecuteThrow called, isAiming:", this.isAiming);
    if (!this.isAiming) return;
    
    const holdTime = this.scene.time.now - this.aimStartTime;
    console.log("🎯 Hold time:", holdTime, "ms");
    
    // Require minimum hold time to prevent accidental immediate throws
    if (holdTime < 50) { // 50ms minimum hold time
      console.log("🎯 Too quick, ignoring");
      return;
    }
    
    // Check for quick throw vs aimed throw
    if (holdTime < this.config.quickThrowThreshold) {
      this.worldRefs.showToast("Quick throw!");
    } else {
      const chargeLevel = Math.min(holdTime / this.config.chargeTime, 1.0);
      this.worldRefs.showToast(`Charged throw! ${Math.round(chargeLevel * 100)}%`);
    }
    
    // Execute throw in throw system
    console.log(`🎯 Executing throw`);
    const success = this.executeNetworkAwareThrow();
    console.log(`🎯 Throw execution result: ${success}`);
    
    // Reset state
    this.isAiming = false;
    console.log(`🎯 Aiming reset: isAiming=${this.isAiming}`);
    
    // Reset cargo indicator position
    const player = this.playerActor;
    if (player) {
      player.resetCargoIndicatorPosition();
    }
    
    // Reset camera zoom
    this.scene.tweens.add({
      targets: this.scene.cameras.main,
      zoom: 1.0,
      duration: 200,
      ease: "Power2"
    });
    
    if (success) {
      // Slight screen shake for feedback
      this.scene.cameras.main.shake(50, 0.005);
    }
  }
  
  /**
   * Cancel the aiming process
   */
  public cancelAiming(): void {
    console.log(`🎯 ThrowInputController: cancelAiming called, isAiming: ${this.isAiming}`);
    
    // Always clear the ThrowSystem state, even if our local isAiming is false
    this.throwSystem.cancelAiming();
    console.log(`🎯 ThrowInputController: Called throwSystem.cancelAiming()`);
    
    // Only proceed with other cleanup if we were actually aiming
    if (!this.isAiming) {
      console.log(`🎯 ThrowInputController: isAiming was false, but still cleared ThrowSystem`);
      return;
    }
    
    this.isAiming = false;
    
    // Reset cargo indicator position
    const player = this.playerActor;
    if (player) {
      player.resetCargoIndicatorPosition();
      console.log(`🎯 ThrowInputController: Reset cargo indicator position`);
    }
    
    // Reset camera zoom
    this.scene.tweens.add({
      targets: this.scene.cameras.main,
      zoom: 1.0,
      duration: 200,
      ease: "Power2"
    });
    
    this.worldRefs.showToast("Aiming canceled");
  }
  
  /**
   * Check if currently aiming
   */
  public isCurrentlyAiming(): boolean {
    return this.isAiming;
  }
  
  /**
   * Get aiming progress (0-1) for UI display
   */
  public getAimingProgress(): number {
    if (!this.isAiming) return 0;
    
    const holdTime = this.scene.time.now - this.aimStartTime;
    return Math.min(1, holdTime / 1000); // Normalize to 1 second max
  }
  
  private getPlayerPosition(): Phaser.Math.Vector2 {
    const player = this.playerActor;
    return player ? player.getWorldPosition() : new Phaser.Math.Vector2(0, 0);
  }
  
  /**
   * Cleanup method
   */
  public destroy(): void {
    if (this.isAiming) {
      this.cancelAiming();
    }
    
    // Remove event listeners
    if (this.config.mouseAiming) {
      this.scene.input.off('pointermove');
      this.scene.input.off('pointerdown');
      this.scene.input.off('pointerup');
    }
  }
}
