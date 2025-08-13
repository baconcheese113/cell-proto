/**
 * Milestone 12 - Throw & Membrane Interactions v1
 * 
 * Handles throwing mechanics for transcripts and vesicles with:
 * - One carry slot that preserves TTL
 * - Hold-to-aim with arc preview
 * - Parabolic flight simulation
 * - Magnet capture to correct targets
 * - Membrane trampoline effects
 * 
 * Integration points:
 * - Uses existing TTL system from transcripts/vesicles
 * - Respects proximity requirements from tile-action-controller
 * - Integrates with existing FSMs via correct handoff events
 */

import type { WorldRefs, Transcript, Vesicle } from "../core/world-refs";
import type { HexCoord } from "../hex/hex-grid";
import { SystemObject } from "./system-object";

// Story 12.2: Throw input & aim configuration
interface ThrowConfig {
  // Aiming
  aimHoldThreshold: number; // ms to hold before showing preview
  maxThrowDistance: number; // maximum throw range in pixels
  minThrowSpeed: number; // minimum throw speed
  maxThrowSpeed: number; // maximum throw speed
  
  // Physics
  gravity: number; // downward acceleration for arc
  groundHeight: number; // cytosol "floor" level
  
  // Performance
  maxActiveProjectiles: number; // performance budget
  
  // Speed gate
  maxPlayerSpeedForThrow: number; // can't throw while dashing fast
}

// Story 12.3: Thrown cargo state
export interface ThrownCargo {
  id: string;
  type: 'transcript' | 'vesicle';
  cargoId: string; // ID of the original transcript/vesicle
  
  // Physics state
  position: Phaser.Math.Vector2;
  velocity: Phaser.Math.Vector2;
  ttlMs: number; // inherited from original cargo
  
  // Original cargo data (preserved)
  originalCargo: Transcript | Vesicle;
  
  // Simulation
  onGround: boolean;
  bounceCount: number;
}

// Story 12.4: Magnet capture rules
interface MagnetRule {
  targetType: 'ER' | 'Golgi' | 'membrane';
  cargoType: 'transcript' | 'vesicle';
  cargoFilter?: (cargo: Transcript | Vesicle) => boolean;
  radius: number; // capture radius in pixels
  destFilter?: (hex: HexCoord) => boolean; // for membrane destination matching
}

// Story 12.2 & 12.7: Aiming state
interface AimState {
  isAiming: boolean;
  startTime: number;
  targetPosition: Phaser.Math.Vector2;
  power: number; // 0.0 to 1.0
  chargeLevel: number; // 0.0 to 1.0 charge level from hold time
  showPreview: boolean;
}

export class ThrowSystem extends SystemObject {
  private config: ThrowConfig;
  private thrownCargos: Map<string, ThrownCargo> = new Map();
  private nextThrownId = 1;
  
  // Story 12.2: Aiming state
  private aimState: AimState = {
    isAiming: false,
    startTime: 0,
    targetPosition: new Phaser.Math.Vector2(),
    power: 0,
    chargeLevel: 0,
    showPreview: false
  };
  
  // Story 12.4: Magnet capture rules
  private magnetRules: MagnetRule[] = [
    {
      targetType: 'ER',
      cargoType: 'transcript',
      radius: 40,
      cargoFilter: (_cargo) => true // All transcripts can go to ER
    },
    {
      targetType: 'Golgi',
      cargoType: 'vesicle',
      radius: 35,
      cargoFilter: (cargo) => {
        const vesicle = cargo as Vesicle;
        return vesicle.glyco === 'partial'; // Only partially glycosylated vesicles
      }
    },
    {
      targetType: 'membrane',
      cargoType: 'vesicle',
      radius: 30,
      cargoFilter: (cargo) => {
        const vesicle = cargo as Vesicle;
        return vesicle.glyco === 'complete'; // Only completed vesicles
      },
      destFilter: (_hex) => {
        // Only capture at correct destination hex
        // Will be implemented in Story 12.4
        return true; // TODO: Check vesicle.destHex matches hex
      }
    }
  ];
  
  // Story 12.7: VFX objects
  private aimPreviewGraphics?: Phaser.GameObjects.Graphics;
  private cargoGraphics?: Phaser.GameObjects.Graphics;
  
  constructor(
    scene: Phaser.Scene,
    private worldRefs: WorldRefs,
    private unifiedCargoSystem: any, // Will be properly typed when UnifiedCargoSystem is imported
    config: Partial<ThrowConfig> = {}
  ) {
    super(scene, "ThrowSystem", (deltaSeconds: number) => this.update(deltaSeconds));
    
    // Default configuration
    this.config = {
      aimHoldThreshold: 200, // ms
      maxThrowDistance: 200, // pixels
      minThrowSpeed: 100,
      maxThrowSpeed: 400,
      gravity: 300, // pixels/sec²
      groundHeight: 0, // cytosol level
      maxActiveProjectiles: 20,
      maxPlayerSpeedForThrow: 150, // can't throw while dashing fast
      ...config
    };
    
    this.initializeGraphics();
  }
  
  private initializeGraphics(): void {
    // Story 12.7: Create graphics objects for VFX
    this.aimPreviewGraphics = this.scene.add.graphics();
    this.aimPreviewGraphics.setDepth(5);
    this.worldRefs.cellRoot.add(this.aimPreviewGraphics);
    
    this.cargoGraphics = this.scene.add.graphics();
    this.cargoGraphics.setDepth(4);
    this.worldRefs.cellRoot.add(this.cargoGraphics);
  }
  
  override update(deltaSeconds: number): void {
    this.updateThrownCargos(deltaSeconds);
    this.renderVFX();
  }
  
  /**
   * Story 12.1: Check if player has a carried item
   */
  public hasCarriedItem(): boolean {
    return this.unifiedCargoSystem.isCarrying();
  }
  
  /**
   * Story 12.1: Get currently carried item (unified interface)
   */
  public getCarriedItem(): { type: 'transcript' | 'vesicle'; item: Transcript | Vesicle } | null {
    const carriedCargo = this.unifiedCargoSystem.getCarriedCargo();
    if (carriedCargo) {
      return {
        type: carriedCargo.type,
        item: carriedCargo.item
      };
    }
    return null;
  }  /**
   * Story 12.2: Start aiming (called on input down)
   */
  public startAiming(targetPosition: Phaser.Math.Vector2): boolean {
    // Story 12.9: Proximity & safety rules
    if (!this.hasCarriedItem()) {
      this.worldRefs.showToast("Not carrying anything to throw");
      return false;
    }
    
    // Story 12.2: Speed gate - can't throw while moving too fast
    const playerBody = this.getPlayerPhysicsBody();
    if (playerBody && playerBody.velocity.length() > this.config.maxPlayerSpeedForThrow) {
      this.worldRefs.showToast("Moving too fast to throw accurately");
      return false;
    }
    
    this.aimState = {
      isAiming: true,
      startTime: this.scene.time.now,
      targetPosition: targetPosition.clone(),
      power: 0,
      chargeLevel: 0,
      showPreview: false
    };
    
    return true;
  }
  
  /**
   * Story 12.2: Update aim target (called on input move)
   */
  public updateAimTarget(targetPosition: Phaser.Math.Vector2): void {
    if (!this.aimState.isAiming) return;
    
    this.aimState.targetPosition.copy(targetPosition);
    
    // Calculate power based on distance from player
    const playerPos = this.getPlayerPosition();
    const distance = Phaser.Math.Distance.BetweenPoints(playerPos, targetPosition);
    const clampedDistance = Math.min(distance, this.config.maxThrowDistance);
    this.aimState.power = clampedDistance / this.config.maxThrowDistance;
    
    // Show preview after hold threshold
    const holdTime = this.scene.time.now - this.aimState.startTime;
    this.aimState.showPreview = holdTime >= this.config.aimHoldThreshold;
  }
  
  /**
   * Update charge level (called continuously during aiming)
   */
  public updateChargeLevel(chargeLevel: number): void {
    if (!this.aimState.isAiming) return;
    this.aimState.chargeLevel = Math.max(0, Math.min(1, chargeLevel));
  }
  
  /**
   * Story 12.2: Execute throw (called on input up)
   */
  public executeThrow(): boolean {
    if (!this.aimState.isAiming) return false;
    
    const carriedItem = this.getCarriedItem();
    if (!carriedItem) return false;
    
    // Story 12.3: Create thrown projectile
    const thrownCargo = this.createThrownCargo(carriedItem);
    if (!thrownCargo) return false;
    
    // Remove from carried items
    this.removeFromCarried(carriedItem);
    
    // Reset aim state
    this.aimState.isAiming = false;
    this.aimState.showPreview = false;
    
    this.worldRefs.showToast(`Threw ${carriedItem.type}`);
    return true;
  }
  
  /**
   * Story 12.2: Cancel aiming
   */
  public cancelAiming(): void {
    this.aimState.isAiming = false;
    this.aimState.showPreview = false;
  }
  
  /**
   * Create a deep copy of cargo to preserve state during throw
   */
  private createCargoCopy(carriedItem: { type: 'transcript' | 'vesicle'; item: Transcript | Vesicle }): Transcript | Vesicle {
    if (carriedItem.type === 'transcript') {
      const transcript = carriedItem.item as Transcript;
      return {
        id: transcript.id,
        proteinId: transcript.proteinId,
        atHex: { q: transcript.atHex.q, r: transcript.atHex.r },
        ttlSeconds: transcript.ttlSeconds,
        worldPos: transcript.worldPos.clone(),
        isCarried: transcript.isCarried,
        moveAccumulator: transcript.moveAccumulator,
        destHex: transcript.destHex ? { q: transcript.destHex.q, r: transcript.destHex.r } : undefined,
        state: transcript.state,
        processingTimer: transcript.processingTimer,
        glycosylationState: transcript.glycosylationState
      };
    } else {
      const vesicle = carriedItem.item as Vesicle;
      return {
        id: vesicle.id,
        proteinId: vesicle.proteinId,
        atHex: { q: vesicle.atHex.q, r: vesicle.atHex.r },
        ttlMs: vesicle.ttlMs,
        worldPos: vesicle.worldPos.clone(),
        isCarried: vesicle.isCarried,
        destHex: { q: vesicle.destHex.q, r: vesicle.destHex.r },
        state: vesicle.state,
        glyco: vesicle.glyco,
        processingTimer: vesicle.processingTimer,
        routeCache: vesicle.routeCache ? [...vesicle.routeCache] : undefined,
        retryCounter: vesicle.retryCounter
      };
    }
  }

  /**
   * Story 12.3: Create thrown cargo projectile
   */
  private createThrownCargo(carriedItem: { type: 'transcript' | 'vesicle'; item: Transcript | Vesicle }): ThrownCargo | null {
    // Story 12.3: Performance budget check
    if (this.thrownCargos.size >= this.config.maxActiveProjectiles) {
      this.worldRefs.showToast("Too many active throws");
      return null;
    }

    const playerPos = this.getPlayerPosition();

    // Calculate throw velocity based on charge level
    const direction = new Phaser.Math.Vector2(
      this.aimState.targetPosition.x - playerPos.x,
      this.aimState.targetPosition.y - playerPos.y
    ).normalize();

    // Use charge level for speed calculation (minimum 20% power even at 0 charge)
    const effectivePower = Math.max(0.2, this.aimState.chargeLevel);
    const speed = Phaser.Math.Linear(
      this.config.minThrowSpeed,
      this.config.maxThrowSpeed,
      effectivePower
    );

    const velocity = direction.scale(speed);

    // Create a deep copy of the original cargo to preserve all state
    const originalCargoCopy = this.createCargoCopy(carriedItem);

    const thrownCargo: ThrownCargo = {
      id: `thrown_${this.nextThrownId++}`,
      type: carriedItem.type,
      cargoId: carriedItem.item.id,
      position: playerPos.clone(),
      velocity: velocity,
      ttlMs: carriedItem.type === 'transcript' 
        ? (carriedItem.item as Transcript).ttlSeconds * 1000
        : (carriedItem.item as Vesicle).ttlMs,
      originalCargo: originalCargoCopy,
      onGround: false,
      bounceCount: 0
    };

    this.thrownCargos.set(thrownCargo.id, thrownCargo);
    return thrownCargo;
  }

  /**
   * Check if a position is outside the hex grid boundaries
   */
  private isOutsideGrid(position: Phaser.Math.Vector2): boolean {
    return !this.worldRefs.hexGrid.getTileAtWorld(position.x, position.y);
  }

  /**
   * Check if thrown cargo has reached maximum travel distance
   */
  private isMaxDistanceReached(cargo: ThrownCargo, startPosition: Phaser.Math.Vector2): boolean {
    const travelDistance = Phaser.Math.Distance.BetweenPoints(startPosition, cargo.position);
    return travelDistance >= this.config.maxThrowDistance;
  }

  /**
   * Story 12.3: Update thrown cargo physics
   */
  private updateThrownCargos(deltaSeconds: number): void {
    for (const [id, cargo] of this.thrownCargos.entries()) {
      // Update TTL
      cargo.ttlMs -= deltaSeconds * 1000;
      
      if (cargo.ttlMs <= 0) {
        this.expireThrownCargo(cargo);
        this.thrownCargos.delete(id);
        continue;
      }
      
      // Skip physics if on ground
      if (cargo.onGround) continue;
      
      // For top-down cell view: Move in straight line (no gravity)
      cargo.position.x += cargo.velocity.x * deltaSeconds;
      cargo.position.y += cargo.velocity.y * deltaSeconds;

      // Check if cargo has hit hex grid boundaries or traveled far enough
      const startPosition = this.getPlayerPosition();
      
      if (this.isOutsideGrid(cargo.position) || this.isMaxDistanceReached(cargo, startPosition)) {
        // Land at current position
        cargo.onGround = true;
        cargo.velocity.set(0, 0);
        
        // If outside grid, move back to the nearest valid hex tile
        let landingPosition = cargo.position.clone();
        if (this.isOutsideGrid(cargo.position)) {
          // Find the nearest hex tile that's inside the grid
          const nearestHex = this.worldRefs.hexGrid.worldToHex(cargo.position.x, cargo.position.y);
          let validHex = nearestHex;
          
          // Search for the nearest valid hex in a spiral pattern
          for (let radius = 1; radius <= 5; radius++) {
            let found = false;
            for (let q = -radius; q <= radius && !found; q++) {
              for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius) && !found; r++) {
                const testHex = { q: nearestHex.q + q, r: nearestHex.r + r };
                if (this.worldRefs.hexGrid.getTile(testHex)) {
                  validHex = testHex;
                  found = true;
                }
              }
            }
            if (found) break;
          }
          
          landingPosition = this.worldRefs.hexGrid.hexToWorld(validHex);
        } else {
          // Snap to nearest hex tile within grid
          const nearestHex = this.worldRefs.hexGrid.worldToHex(cargo.position.x, cargo.position.y);
          landingPosition = this.worldRefs.hexGrid.hexToWorld(nearestHex);
        }
        
        cargo.position = landingPosition.clone();
        
        // Restore cargo to world for pickup
        this.restoreCargoToWorld(cargo);
        
        // Story 12.4: Check for magnet capture when landing
        this.checkMagnetCapture(cargo);
        
        // Remove from thrown cargo collection since it's now restored to world
        this.thrownCargos.delete(id);
      } else {
        // Story 12.4: Check for mid-air magnet capture
        this.checkMagnetCapture(cargo);
      }
    }
  }
  
  /**
   * Story 12.4: Check if thrown cargo can be captured by nearby targets
   */
  private checkMagnetCapture(cargo: ThrownCargo): void {
    for (const rule of this.magnetRules) {
      if (rule.cargoType !== cargo.type) continue;
      if (rule.cargoFilter && !rule.cargoFilter(cargo.originalCargo)) continue;
      
      const targets = this.findTargetsOfType(rule.targetType);
      
      for (const target of targets) {
        const distance = Phaser.Math.Distance.BetweenPoints(cargo.position, target.worldPos);
        
        if (distance <= rule.radius) {
          // Additional filtering for membrane destinations
          if (rule.targetType === 'membrane' && rule.destFilter) {
            const vesicle = cargo.originalCargo as Vesicle;
            if (!rule.destFilter(target.coord) || 
                !this.coordsEqual(vesicle.destHex, target.coord)) {
              continue; // Wrong membrane destination
            }
          }
          
          // Check line of sight (simple version - no obstacles for now)
          if (this.hasLineOfSight(cargo.position, target.worldPos)) {
            this.captureCargo(cargo, target, rule.targetType);
            return;
          }
        }
      }
    }
  }
  
  /**
   * Story 12.4: Execute cargo capture and handoff to correct system
   */
  private captureCargo(cargo: ThrownCargo, target: any, targetType: string): void {
    // Play capture VFX
    this.playCaptureVFX(cargo.position);
    
    // Restore cargo to original state for handoff
    const originalCargo = cargo.originalCargo;
    originalCargo.isCarried = false;
    originalCargo.atHex = target.coord;
    originalCargo.worldPos = target.worldPos.clone();
    
    // Handoff to appropriate system
    switch (targetType) {
      case 'ER':
        if (cargo.type === 'transcript') {
          this.worldRefs.transcripts.set(originalCargo.id, originalCargo as Transcript);
          // The existing ER system will pick this up automatically
        }
        break;
        
      case 'Golgi':
        if (cargo.type === 'vesicle') {
          const vesicle = originalCargo as Vesicle;
          vesicle.state = 'QUEUED_GOLGI';
          vesicle.processingTimer = 2.0; // Standard Golgi processing time
          this.worldRefs.vesicles.set(vesicle.id, vesicle);
        }
        break;
        
      case 'membrane':
        if (cargo.type === 'vesicle') {
          const vesicle = originalCargo as Vesicle;
          vesicle.state = 'INSTALLING';
          vesicle.processingTimer = 2.0; // Standard installation time
          this.worldRefs.vesicles.set(vesicle.id, vesicle);
        }
        break;
    }
    
    // Remove thrown cargo
    this.thrownCargos.delete(cargo.id);
    
    // Feedback
    this.worldRefs.showToast(`Captured by ${targetType}`);
  }
  
  /**
   * Story 12.3: Handle cargo expiry with VFX and restore to world
   */
  private expireThrownCargo(cargo: ThrownCargo): void {
    // Story 12.7: Play fizzle VFX
    this.playExpireVFX(cargo.position);
    
    // Restore cargo to world at landing position
    this.restoreCargoToWorld(cargo);
  }

  /**
   * Restore thrown cargo to the world as pickupable cargo
   */
  private restoreCargoToWorld(thrownCargo: ThrownCargo): void {
    const landingHex = this.worldRefs.hexGrid.worldToHex(thrownCargo.position.x, thrownCargo.position.y);
    const worldPos = this.worldRefs.hexGrid.hexToWorld(landingHex);
    
    // Use the original cargo reference with preserved state
    const originalCargo = thrownCargo.originalCargo;
    
    if (thrownCargo.type === 'transcript') {
      const transcript = originalCargo as Transcript;
      
      // Restore transcript to world position, preserving all original state
      transcript.isCarried = false;
      transcript.atHex = { q: landingHex.q, r: landingHex.r };
      transcript.worldPos = worldPos.clone();
      transcript.ttlSeconds = thrownCargo.ttlMs / 1000; // Update TTL from throw
      // All other state (state, glycosylationState, processingTimer, etc.) preserved from copy
      
      // Ensure it's in the world collection
      this.worldRefs.transcripts.set(transcript.id, transcript);
      
      // Remove from carried collection if it was there
      const carriedIndex = this.worldRefs.carriedTranscripts.findIndex(t => t.id === transcript.id);
      if (carriedIndex !== -1) {
        this.worldRefs.carriedTranscripts.splice(carriedIndex, 1);
      }
    } else {
      const vesicle = originalCargo as Vesicle;
      
      // Restore vesicle to world position, preserving all original state
      vesicle.isCarried = false;
      vesicle.atHex = { q: landingHex.q, r: landingHex.r };
      vesicle.worldPos = worldPos.clone();
      vesicle.ttlMs = thrownCargo.ttlMs; // Update TTL from throw
      // All other state (state, glyco, processingTimer, routeCache, etc.) preserved from copy
      
      // Ensure it's in the world collection
      this.worldRefs.vesicles.set(vesicle.id, vesicle);
      
      // Remove from carried collection if it was there
      const carriedIndex = this.worldRefs.carriedVesicles.findIndex(v => v.id === vesicle.id);
      if (carriedIndex !== -1) {
        this.worldRefs.carriedVesicles.splice(carriedIndex, 1);
      }
    }
  }
  
  /**
   * Story 12.7: Render aim preview and cargo visuals
   */
  private renderVFX(): void {
    if (!this.aimPreviewGraphics || !this.cargoGraphics) return;
    
    this.aimPreviewGraphics.clear();
    this.cargoGraphics.clear();
    
    // Render aim preview
    if (this.aimState.showPreview && this.aimState.isAiming) {
      this.renderAimPreview();
    }
    
    // Render thrown cargos
    this.renderThrownCargos();
  }
  
  /**
   * Story 12.7: Render aim preview arc
   */
  private renderAimPreview(): void {
    if (!this.aimPreviewGraphics) return;
    
    const playerPos = this.getPlayerPosition();
    const direction = new Phaser.Math.Vector2(
      this.aimState.targetPosition.x - playerPos.x,
      this.aimState.targetPosition.y - playerPos.y
    ).normalize();

    // Use charge level for speed calculation (minimum 20% power even at 0 charge)
    const effectivePower = Math.max(0.2, this.aimState.chargeLevel);
    const speed = Phaser.Math.Linear(
      this.config.minThrowSpeed,
      this.config.maxThrowSpeed,
      effectivePower
    );
    
    const velocity = direction.scale(speed);
    
    // Calculate arc points with boundary checking
    const arcPoints: Phaser.Math.Vector2[] = [];
    const steps = 20;
    const timeStep = 0.1;
    
    for (let i = 0; i <= steps; i++) {
      const t = i * timeStep;
      const x = playerPos.x + velocity.x * t;
      const y = playerPos.y + velocity.y * t; // Straight line for top-down view
      
      // Check if we've hit the hex grid boundary
      if (this.isOutsideGrid(new Phaser.Math.Vector2(x, y))) {
        break; // Stop preview at boundary
      }
      
      // Check if we've reached max throw distance
      const travelDistance = Phaser.Math.Distance.BetweenPoints(playerPos, { x, y });
      if (travelDistance >= this.config.maxThrowDistance) {
        arcPoints.push(new Phaser.Math.Vector2(x, y));
        break; // Stop at max distance
      }
      
      arcPoints.push(new Phaser.Math.Vector2(x, y));
    }
    
    // Render arc with charge-based styling
    if (arcPoints.length > 1) {
      const carriedItem = this.getCarriedItem();
      const baseColor = carriedItem?.type === 'transcript' ? 0xff4444 : 0x4444ff;
      
      // Vary line thickness and alpha based on charge level
      const lineWidth = 2 + (this.aimState.chargeLevel * 3); // 2-5px based on charge
      const alpha = 0.5 + (this.aimState.chargeLevel * 0.4); // 0.5-0.9 alpha based on charge
      
      this.aimPreviewGraphics.lineStyle(lineWidth, baseColor, alpha);
      this.aimPreviewGraphics.beginPath();
      this.aimPreviewGraphics.moveTo(arcPoints[0].x, arcPoints[0].y);
      
      for (let i = 1; i < arcPoints.length; i++) {
        this.aimPreviewGraphics.lineTo(arcPoints[i].x, arcPoints[i].y);
      }
      
      this.aimPreviewGraphics.strokePath();
      
      // Landing marker with charge-based size
      if (arcPoints.length > 0) {
        const landingPoint = arcPoints[arcPoints.length - 1];
        const markerSize = 6 + (this.aimState.chargeLevel * 8); // 6-14px based on charge
        
        this.aimPreviewGraphics.lineStyle(0, 0, 0);
        this.aimPreviewGraphics.fillStyle(baseColor, alpha);
        this.aimPreviewGraphics.fillCircle(landingPoint.x, landingPoint.y, markerSize);
      }
    }
    
    // Power indicator at aim position
    this.aimPreviewGraphics.lineStyle(0, 0, 0);
    this.aimPreviewGraphics.fillStyle(0xffffff, 0.3 + this.aimState.power * 0.4);
    const radius = 5 + this.aimState.power * 10;
    this.aimPreviewGraphics.fillCircle(
      this.aimState.targetPosition.x, 
      this.aimState.targetPosition.y, 
      radius
    );
  }
  
  /**
   * Story 12.7: Render thrown cargo objects
   */
  private renderThrownCargos(): void {
    if (!this.cargoGraphics) return;
    
    for (const cargo of this.thrownCargos.values()) {
      const color = cargo.type === 'transcript' ? 0xff4444 : 0x4444ff;
      const size = cargo.type === 'transcript' ? 6 : 8;
      
      // Cargo body
      this.cargoGraphics.lineStyle(1, color, 0.8);
      this.cargoGraphics.fillStyle(color, 0.6);
      this.cargoGraphics.fillCircle(cargo.position.x, cargo.position.y, size);
      this.cargoGraphics.strokeCircle(cargo.position.x, cargo.position.y, size);
      
      // Motion trail if moving
      if (!cargo.onGround && cargo.velocity.lengthSq() > 0) {
        const trailLength = Math.min(cargo.velocity.length() * 0.1, 20);
        const trailDir = cargo.velocity.clone().normalize().scale(-trailLength);
        
        this.cargoGraphics.lineStyle(2, color, 0.3);
        this.cargoGraphics.lineBetween(
          cargo.position.x, cargo.position.y,
          cargo.position.x + trailDir.x, cargo.position.y + trailDir.y
        );
      }
    }
  }
  
  // Helper methods
  private removeFromCarried(_carriedItem: { type: 'transcript' | 'vesicle'; item: Transcript | Vesicle }): void {
    // Use unified cargo system to clear carried cargo state
    this.unifiedCargoSystem.clearCarriedCargo();
  }
  
  private getPlayerPosition(): Phaser.Math.Vector2 {
    // Assuming player is accessible through scene or worldRefs
    // This will need to be adapted based on actual player access pattern
    const player = (this.scene as any).playerActor; // Adjust as needed
    return player ? player.getWorldPosition() : new Phaser.Math.Vector2(0, 0);
  }
  
  private getPlayerPhysicsBody(): Phaser.Physics.Arcade.Body | null {
    const player = (this.scene as any).playerActor;
    return player ? player.getPhysicsBody() : null;
  }
  
  private findTargetsOfType(targetType: string): Array<{ coord: HexCoord; worldPos: Phaser.Math.Vector2 }> {
    const targets: Array<{ coord: HexCoord; worldPos: Phaser.Math.Vector2 }> = [];
    
    // Find organelles of the specified type
    for (const organelle of this.worldRefs.organelleSystem.getAllOrganelles()) {
      if (organelle.type === targetType.toLowerCase()) {
        targets.push({
          coord: organelle.coord,
          worldPos: this.worldRefs.hexGrid.hexToWorld(organelle.coord)
        });
      }
    }
    
    // For membrane targets, add all membrane tiles
    if (targetType === 'membrane') {
      for (const tile of this.worldRefs.hexGrid.getMembraneTiles()) {
        targets.push({
          coord: tile.coord,
          worldPos: tile.worldPos.clone()
        });
      }
    }
    
    return targets;
  }
  
  private hasLineOfSight(_from: Phaser.Math.Vector2, _to: Phaser.Math.Vector2): boolean {
    // Simple LoS check - no obstacles for now
    // Could be enhanced to check for organelles blocking the path
    return true;
  }
  
  private coordsEqual(a: HexCoord, b: HexCoord): boolean {
    return a.q === b.q && a.r === b.r;
  }
  
  private playCaptureVFX(position: Phaser.Math.Vector2): void {
    // Story 12.7: Capture flash effect
    const flash = this.scene.add.circle(position.x, position.y, 15, 0xffffff, 0.8);
    flash.setDepth(6);
    this.worldRefs.cellRoot.add(flash);
    
    this.scene.tweens.add({
      targets: flash,
      scaleX: 2,
      scaleY: 2,
      alpha: 0,
      duration: 200,
      ease: "Power2",
      onComplete: () => flash.destroy()
    });
  }
  
  private playExpireVFX(position: Phaser.Math.Vector2): void {
    // Story 12.7: Fizzle effect for expired cargo
    const fizzle = this.scene.add.circle(position.x, position.y, 8, 0xffaa44, 0.6);
    fizzle.setDepth(6);
    this.worldRefs.cellRoot.add(fizzle);
    
    this.scene.tweens.add({
      targets: fizzle,
      scaleX: 0.1,
      scaleY: 0.1,
      alpha: 0,
      duration: 300,
      ease: "Back.easeIn",
      onComplete: () => fizzle.destroy()
    });
  }
}
