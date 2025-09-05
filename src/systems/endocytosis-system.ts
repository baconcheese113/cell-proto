import { SystemObject } from './system-object';
import type { WorldRefs } from '../core/world-refs';
import { MembranePhysicsSystem } from '../membrane/membrane-physics-system';
import { Player } from '../actors/player';

const DEBUG_ENDOCYTOSIS = true;

/**
 * Configuration for endocytosis pocket formation
 */
export interface EndocytosisConfig {
  // Pocket formation parameters (Stage 1)
  maxPocketDepth: number;        // Maximum depth of invagination (pixels)
  pocketFormationSpeed: number;  // Speed of pocket formation
  pocketWidth: number;           // Width of the pocket opening
  
  // Scission parameters (Stage 2)
  scissionThreshold: number;     // Pocket depth at which scission can begin
  scissionWindowTime: number;    // Time window for successful scission (ms)
  minNeckDiameter: number;       // Minimum neck diameter for pinch-off
  compressionForce: number;      // Force needed to compress neck
  
  // Physics parameters
  invaginationForce: number;     // Force applied to create invagination
  membraneStiffness: number;     // Resistance to deformation
  pocketTension: number;         // Tension trying to close the pocket
  neckElasticity: number;        // How elastic the neck is during compression
  
  // Interaction parameters
  activationDistance: number;    // Distance from membrane to activate
  directionSensitivity: number;  // How responsive to directional input
  cooperativeDistance: number;   // Distance for second player to help with scission
  
  // Visual feedback
  showPocketOutline: boolean;    // Show visual indication of pocket formation
  showCompressionZones: boolean; // Show where players can compress neck
  pocketColor: number;           // Color for pocket visualization
  scissionColor: number;         // Color for scission visualization
  vesicleColor: number;          // Color for created vesicles
  
  // Debug options
  debugFreezeScission: boolean;  // Freeze scission stage indefinitely for testing
  debugExtendedScissionTime: number; // Extended time for scission testing (ms)
}

/**
 * State of current endocytosis pocket formation
 */
export interface EndocytosisPocket {
  isActive: boolean;             // Whether pocket formation is active
  stage: 'invagination' | 'scission' | 'complete'; // Current stage of endocytosis
  centerPosition: Phaser.Math.Vector2;  // Center point of the pocket (cell-local)
  depth: number;                 // Current pocket depth (0 to maxPocketDepth)
  direction: Phaser.Math.Vector2; // Direction of pocket formation (inward)
  formationProgress: number;     // Progress from 0 to 1
  
  // Stage 2: Scission mechanics
  neckPosition: Phaser.Math.Vector2;     // Position where neck forms
  neckDiameter: number;                  // Current neck width
  compressionZones: Phaser.Math.Vector2[]; // Positions where players can compress
  scissionProgress: number;              // Progress of neck pinch-off (0 to 1)
  scissionTimer: number;                 // Time window for successful scission
  
  // Physics state
  targetNodes: number[];         // Indices of membrane nodes being affected
  forcePattern: Phaser.Math.Vector2[]; // Force vectors for each affected node
  
  // Rest position backup for restoration
  originalRestPositions: Map<number, { position: Phaser.Math.Vector2; radius: number }>; // Backup of original rest positions
}

/**
 * Endocytosis System - Physics-based membrane pocket formation
 * 
 * This system allows the player (nanobot) to create endocytosis pockets by physically
 * manipulating the cell membrane from the inside. The player uses directional input
 * to create invaginations that can capture external materials.
 */
export class EndocytosisSystem extends SystemObject {
  private config: EndocytosisConfig;
  private pocket: EndocytosisPocket;
  
  // Input integration
  private lastDirectionInput = new Phaser.Math.Vector2(0, 0);
  
  // Visual feedback
  private pocketGraphics!: Phaser.GameObjects.Graphics;
  private createdVesicles: Phaser.GameObjects.Arc[] = [];
  
  constructor(
    scene: Phaser.Scene,
    private worldRefs: WorldRefs,
    private membranePhysics: MembranePhysicsSystem,
    private player: Player,
    config: Partial<EndocytosisConfig> = {}
  ) {
    super(scene, 'EndocytosisSystem', (deltaSeconds: number) => this.updateSystem(deltaSeconds));
    
    this.config = {
      // Stage 1: Invagination - Localized pocket for teardrop effect
      maxPocketDepth: 150, // Reduced from 400 - more reasonable for localized effect
      pocketFormationSpeed: 20, // Reduced from 40 - more controlled
      pocketWidth: 25, // Smaller working area for localized effect
      
      // Stage 2: Scission
      scissionThreshold: 999, // Very high threshold to disable scission for testing
      scissionWindowTime: 3000,
      minNeckDiameter: 8,
      compressionForce: 20,
      
      // Physics - Localized compliant membrane for teardrop effect
      invaginationForce: 40, // Reduced from 80 - more controlled pulling
      membraneStiffness: 0.6, // Increased from 0.2 - prevent whole membrane distortion
      pocketTension: 8, // Increased from 2 - maintain membrane integrity
      neckElasticity: 0.8,
      
      // Interaction
      activationDistance: 30,
      directionSensitivity: 1.2,
      cooperativeDistance: 20,
      
      // Visual
      showPocketOutline: true,
      showCompressionZones: true,
      pocketColor: 0xff6b35,
      scissionColor: 0x00ff88,
      vesicleColor: 0x4CAF50,
      
      // Debug options
      debugFreezeScission: false,
      debugExtendedScissionTime: 30000,
      ...config
    };
    
    this.pocket = {
      isActive: false,
      stage: 'invagination',
      centerPosition: new Phaser.Math.Vector2(),
      depth: 0,
      direction: new Phaser.Math.Vector2(),
      formationProgress: 0,
      neckPosition: new Phaser.Math.Vector2(),
      neckDiameter: 0,
      compressionZones: [],
      scissionProgress: 0,
      scissionTimer: 0,
      targetNodes: [],
      forcePattern: [],
      originalRestPositions: new Map()
    };
    
    this.initializeGraphics();
  }
  
  private initializeGraphics(): void {
    this.pocketGraphics = this.scene.add.graphics();
    this.pocketGraphics.setDepth(3); // Above membrane but below UI
    // Position graphics using physics-based positioning
    if (this.worldRefs.scene) {
      this.worldRefs.scene.positionVisualElement(this.pocketGraphics, 0, 0);
    }
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log('🫧 Endocytosis graphics initialized');
    }
  }
  
  /**
   * Check if player can initiate endocytosis at current position
   */
  public canInitiateEndocytosis(): boolean {
    const playerPos = this.player.getCellLocalCoordinates();
    const distanceFromCenter = playerPos.length();
    const membraneRadius = this.getMembraneRadius();
    
    // Player must be near the membrane but not outside
    const distanceFromMembrane = Math.abs(distanceFromCenter - membraneRadius);
    // console.log(`Player distance from membrane: ${distanceFromMembrane.toFixed(1)} (activation threshold: ${this.config.activationDistance}), playerPos: (${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}), membraneRadius: ${membraneRadius.toFixed(1)}`);
    return distanceFromMembrane <= this.config.activationDistance; // && !this.pocket.isActive;
  }
  
  /**
   * Get debug info for activation issues
   */
  public getActivationDebugInfo(): string {
    const playerPos = this.player.getCellLocalCoordinates();
    const distanceFromCenter = playerPos.length();
    const membraneRadius = this.getMembraneRadius();
    const distanceFromMembrane = Math.abs(distanceFromCenter - membraneRadius);
    
    return `playerPos ${JSON.stringify(playerPos)} - ${membraneRadius.toFixed(1)} distance ${distanceFromMembrane.toFixed(1)} > ${this.config.activationDistance}, pocket active: ${this.pocket.isActive}`;
  }
  
  /**
   * Start endocytosis pocket formation
   */
  public startPocketFormation(inputDirection: Phaser.Math.Vector2): boolean {
    if (!this.canInitiateEndocytosis() || this.pocket.isActive) {
      return false;
    }
    
    const playerPos = this.player.getCellLocalCoordinates();
    
    // Find the closest membrane point as pocket center
    const membraneRadius = this.getMembraneRadius();
    const directionToMembrane = playerPos.clone().normalize();
    const pocketCenter = directionToMembrane.scale(membraneRadius);
    
    // Pocket formation direction (inward from membrane)
    const pocketDirection = directionToMembrane.clone().negate();
    
    // Apply directional input to modify pocket direction
    if (inputDirection.lengthSq() > 0.1) {
      const inputInfluence = inputDirection.clone().normalize().scale(this.config.directionSensitivity);
      pocketDirection.add(inputInfluence).normalize();
    }
    
    this.pocket = {
      isActive: true,
      stage: 'invagination',
      centerPosition: pocketCenter,
      depth: 0,
      direction: pocketDirection,
      formationProgress: 0,
      neckPosition: pocketCenter.clone(),
      neckDiameter: this.config.pocketWidth,
      compressionZones: [],
      scissionProgress: 0,
      scissionTimer: 0,
      targetNodes: [],
      forcePattern: [],
      originalRestPositions: new Map()
    };
    
    // Calculate which membrane nodes will be affected
    this.calculateTargetNodes();
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Started endocytosis pocket at (${pocketCenter.x.toFixed(1)}, ${pocketCenter.y.toFixed(1)})`);
    }
    
    this.worldRefs.showToast("Creating endocytosis pocket...");
    return true;
  }
  
  /**
   * Update pocket formation with directional input
   */
  public updatePocketFormation(inputDirection: Phaser.Math.Vector2, deltaSeconds: number): void {
    if (!this.pocket.isActive) return;
    
    // EMERGENCY BRAKE: If debug freeze is active, stop all force application
    if (this.config.debugFreezeScission) {
      console.log('🛑 Debug freeze active - skipping force application');
      return;
    }
    
    if (this.pocket.stage === 'invagination') {
      this.updateInvaginationStage(inputDirection, deltaSeconds);
    } else if (this.pocket.stage === 'scission') {
      this.updateScissionStage(deltaSeconds);
    }
  }
  
  /**
   * Update invagination stage (pocket formation)
   * FIXED: Only progress when player is actively pulling
   */
  private updateInvaginationStage(inputDirection: Phaser.Math.Vector2, deltaSeconds: number): void {
    // CRITICAL FIX: Only progress if player is actively providing directional input
    const hasActiveInput = inputDirection.lengthSq() > 0.01; // Threshold for "active" input
    
    if (!hasActiveInput) {
      // Player not actively pulling - pause formation but maintain state
      if (DEBUG_ENDOCYTOSIS && Math.random() < 0.02) {
        console.log(`🫧 No active input - pocket formation PAUSED at ${(this.pocket.formationProgress * 100).toFixed(1)}%`);
      }
      // Don't apply forces, don't progress - just maintain current pocket
      return;
    }
    
    // Update pocket direction based on input (only when actively pulling)
    // DISABLED: Since we use inward forces, we don't need direction updates that cause spinning
    // if (inputDirection.lengthSq() > 0.1) {
    //   const inputInfluence = inputDirection.clone().normalize().scale(this.config.directionSensitivity * deltaSeconds);
    //   this.pocket.direction.add(inputInfluence).normalize();
    //   
    //   if (DEBUG_ENDOCYTOSIS && Math.random() < 0.05) {
    //     console.log(`🫧 Updated pocket direction: (${this.pocket.direction.x.toFixed(2)}, ${this.pocket.direction.y.toFixed(2)})`);
    //   }
    // }
    
    // PLAYER-CONTROLLED PROGRESSION: Scale speed by input intensity
    const inputIntensity = Math.min(inputDirection.length(), 1.0);
    const baseSpeed = this.config.pocketFormationSpeed;
    const actualSpeed = baseSpeed * inputIntensity; // Stronger input = faster pulling
    
    const depthIncrease = actualSpeed * deltaSeconds;
    const oldProgress = this.pocket.formationProgress;
    this.pocket.depth = Math.min(this.pocket.depth + depthIncrease, this.config.maxPocketDepth);
    this.pocket.formationProgress = this.pocket.depth / this.config.maxPocketDepth;
    
    // Log progress at significant milestones (only when actually progressing)
    if (DEBUG_ENDOCYTOSIS && Math.floor(oldProgress * 10) !== Math.floor(this.pocket.formationProgress * 10)) {
      console.log(`🫧 Active pulling progress: ${(this.pocket.formationProgress * 100).toFixed(0)}% (intensity: ${inputIntensity.toFixed(2)})`);
    }
    
    // Apply forces to membrane nodes (only when actively pulling)
    this.applyPocketForces(deltaSeconds);
    
    // Check if ready for scission stage
    if (this.pocket.depth >= this.config.scissionThreshold) {
      this.transitionToScissionStage();
    }
    
    // Check if pocket is fully formed (auto-complete if no scission)
    if (this.pocket.formationProgress >= 1.0) {
      this.completePocketFormation();
    }
  }
  
  /**
   * Transition from invagination to scission stage - TEMPORARILY DISABLED
   */
  private transitionToScissionStage(): void {
    this.pocket.stage = 'scission';
    
    // Set timer based on debug configuration
    if (this.config.debugFreezeScission) {
      this.pocket.scissionTimer = Number.MAX_SAFE_INTEGER; // Effectively infinite
      console.log(`🫧 Debug: Scission stage frozen for testing!`);
    } else {
      this.pocket.scissionTimer = this.config.debugExtendedScissionTime || this.config.scissionWindowTime;
    }
    
    this.pocket.scissionProgress = 0;
    this.pocket.neckDiameter = this.config.pocketWidth * 0.3; // Start with narrow neck
    
    // Calculate neck position (closer to membrane surface)
    const neckDepthRatio = 0.3; // Neck at 30% of current depth
    this.pocket.neckPosition = this.pocket.centerPosition.clone().add(
      this.pocket.direction.clone().scale(this.pocket.depth * neckDepthRatio)
    );
    
    // Calculate compression zones (where players can dash to compress neck)
    this.pocket.compressionZones = this.calculateCompressionZones();
    
    if (DEBUG_ENDOCYTOSIS) {
      const timerDesc = this.config.debugFreezeScission ? "FROZEN" : `${this.pocket.scissionTimer}ms`;
      console.log(`🫧 Transitioned to scission stage! Neck diameter: ${this.pocket.neckDiameter.toFixed(1)}, timer: ${timerDesc}`);
    }
    
    const message = this.config.debugFreezeScission 
      ? "Debug: Scission stage frozen! Move around and test compression zones!"
      : "Pocket ready for scission! Dash into compression zones to pinch off vesicle!";
    this.worldRefs.showToast(message);
  }
  
  /**
   * Update scission stage (neck compression and pinch-off)
   */
  private updateScissionStage(deltaSeconds: number): void {
    // Countdown scission timer (unless frozen for debug)
    if (!this.config.debugFreezeScission) {
      this.pocket.scissionTimer -= deltaSeconds * 1000;
    }
    
    // CRITICAL: Continue applying primary pocket forces to maintain shape
    this.applyPocketForces(deltaSeconds);
    
    // Additional holding forces for extra stability
    this.applyHoldingForces();
    
    // Check for player compression attempts
    this.checkForNeckCompression();
    
    // Natural neck compression over time (simulating dynamin activity) - much slower
    const naturalCompressionRate = 1; // Reduced from 5 to 1 pixel per second
    this.pocket.neckDiameter = Math.max(
      this.pocket.neckDiameter - naturalCompressionRate * deltaSeconds,
      0
    );
    
    // Update scission progress
    const maxDiameter = this.config.pocketWidth * 0.3;
    this.pocket.scissionProgress = Math.max(0, 1 - (this.pocket.neckDiameter / maxDiameter));
    
    // Check for successful scission
    if (this.pocket.neckDiameter <= this.config.minNeckDiameter) {
      this.completeScission();
      return;
    }
    
    // Check for scission timeout (unless frozen)
    if (!this.config.debugFreezeScission && this.pocket.scissionTimer <= 0) {
      this.failScission();
    }
  }
  
  /**
   * Calculate compression zones around the neck
   */
  private calculateCompressionZones(): Phaser.Math.Vector2[] {
    const zones: Phaser.Math.Vector2[] = [];
    const neckPos = this.pocket.neckPosition;
    const zoneRadius = this.config.cooperativeDistance;
    
    // Create 4 compression zones around the neck (north, south, east, west)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const zonePos = new Phaser.Math.Vector2(
        neckPos.x + Math.cos(angle) * zoneRadius,
        neckPos.y + Math.sin(angle) * zoneRadius
      );
      zones.push(zonePos);
    }
    
    return zones;
  }
  
  /**
   * Check if any player is compressing the neck
   */
  private checkForNeckCompression(): void {
    // Get player position in cell-local coordinates
    const playerPos = this.player.getCellLocalCoordinates();
    const playerVelocity = this.player.getVelocity();
    const dashState = this.player.getDashState();
    
    // Check for any movement or active dashing
    const isMoving = playerVelocity.length() > 50; // Moving at reasonable speed
    const isNearby = isMoving || dashState.isDashing;
    
    if (isNearby) {
      for (const zone of this.pocket.compressionZones) {
        const distance = playerPos.distance(zone);
        if (distance <= this.config.cooperativeDistance) {
          // Calculate compression force based on movement type
          let compressionMultiplier = 1.0;
          if (dashState.isDashing) {
            compressionMultiplier = 3.0; // Dash is much more effective
          } else if (isMoving) {
            compressionMultiplier = 1.5; // Normal movement still works
          }
          
          // Apply compression force
          const deltaSeconds = 0.016; // Assume ~60fps
          const compressionAmount = this.config.compressionForce * compressionMultiplier * deltaSeconds;
          this.pocket.neckDiameter = Math.max(
            this.pocket.neckDiameter - compressionAmount,
            0
          );
          
          if (DEBUG_ENDOCYTOSIS) {
            const action = dashState.isDashing ? "DASH" : "movement";
            console.log(`🫧 Player ${action} compression! Neck diameter: ${this.pocket.neckDiameter.toFixed(1)}, distance: ${distance.toFixed(1)}, progress: ${(this.pocket.scissionProgress * 100).toFixed(1)}%`);
          }
          
          // Provide force feedback to membrane
          this.applyCompressionFeedback(zone, compressionMultiplier);
          
          break; // Only process one zone per frame
        }
      }
    }
  }
  
  /**
   * Apply visual/physical feedback when compressing the neck
   */
  private applyCompressionFeedback(compressionZone: Phaser.Math.Vector2, intensity: number): void {
    if (!this.membranePhysics) return;
    
    // Apply small compression force toward the neck center
    const forceDirection = this.pocket.neckPosition.clone().subtract(compressionZone).normalize();
    const compressionForce = 10 * intensity;
    
    this.membranePhysics.applyImpact(
      compressionZone,
      compressionForce,
      forceDirection
    );
  }
  
  /**
   * Complete successful scission (vesicle formation)
   * UPDATED: Now uses proper XPBD membrane scission
   */
  private completeScission(): void {
    console.log('Endocytosis scission completed - creating vesicle with XPBD membrane physics');
    
    // Perform actual membrane scission using membrane physics
    const vesicleRadius = this.config.pocketWidth * 0.4;
    const scissionSuccess = this.membranePhysics.performMembraneScission(
      this.pocket.centerPosition,
      vesicleRadius
    );
    
    if (scissionSuccess) {
      // Create visual vesicle to represent the separated membrane
      this.createVesicle();
      
      console.log(`🫧 XPBD membrane scission successful - vesicle formed at (${this.pocket.centerPosition.x.toFixed(1)}, ${this.pocket.centerPosition.y.toFixed(1)})`);
      this.worldRefs.showToast("Endocytosis successful! Membrane vesicle formed!");
    } else {
      console.warn('🫧 XPBD membrane scission failed - insufficient particles');
      this.worldRefs.showToast("Scission failed - pocket not deep enough!");
      this.failScission();
      return;
    }
    
    // Clean up membrane modifications (this is now handled by membrane physics)
    // No need to restore manually since membrane physics manages the scission
    
    // Reset pocket state
    this.pocket.isActive = false;
    this.pocket.stage = 'invagination';
    this.pocket.formationProgress = 0;
    this.pocket.scissionProgress = 0;
    this.pocket.scissionTimer = 0;
    this.pocket.compressionZones = [];
    this.pocket.depth = 0;
    this.pocket.neckDiameter = 0;
    
    // Clear visuals
    this.pocketGraphics.clear();
    
    // Notify other systems
    console.log('Endocytosis vesicle created successfully with membrane separation');
  }
  
  /**
   * Handle scission failure (timeout or other conditions)
   */
  private failScission(): void {
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Scission failed! Pocket will collapse back to membrane.`);
    }
    
    // Use the new membrane physics-based restoration
    this.handleScissionFailure();
  }
  
  /**
   * Stop pocket formation (player released control)
   * Note: Will not stop if pocket has reached scission stage
   */
  public stopPocketFormation(): void {
    if (!this.pocket.isActive) return;
    
    // Don't stop pocket formation if we've reached scission stage
    if (this.pocket.stage === 'scission') {
      if (DEBUG_ENDOCYTOSIS) {
        console.log(`🫧 Pocket is in scission stage - not stopping formation`);
      }
      this.worldRefs.showToast("Scission stage active - pocket maintained for completion!");
      return;
    }
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Stopped endocytosis pocket at ${(this.pocket.formationProgress * 100).toFixed(1)}% completion`);
    }
    
    // Restore original membrane rest positions
    this.restoreOriginalRestPositions();
    
    // Allow membrane to return to normal shape
    this.pocket.isActive = false;
    this.pocket.depth = 0;
    this.pocket.formationProgress = 0;
    this.pocket.stage = 'invagination';
    this.pocket.scissionProgress = 0;
    this.pocket.scissionTimer = 0;
    this.pocket.compressionZones = [];
    
    this.worldRefs.showToast("Pocket formation cancelled");
  }
  
  /**
   * Complete pocket formation and create vesicle
   */
  private completePocketFormation(): void {
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Completed endocytosis pocket formation`);
    }
    
    // TODO: Create endocytic vesicle and capture any external materials
    // For now, just provide feedback
    this.worldRefs.showToast("Endocytosis pocket complete! Vesicle formed.");
    
    this.pocket.isActive = false;
    this.pocket.depth = 0;
    this.pocket.formationProgress = 0;
  }
  
  /**
   * Calculate which membrane nodes will be affected by the pocket
   * UPDATED: Select only 3 closest nodes within small radius for localized inward pocket
   */
  private calculateTargetNodes(): void {
    this.pocket.targetNodes = [];
    this.pocket.forcePattern = [];
    
    const nodes = this.membranePhysics.getParticles();
    if (!nodes) return;
    
    // Convert pocket center from cell-local to world coordinates for distance calculations
    const cellCenter = this.membranePhysics.getCenter();
    const worldPocketCenter = new Phaser.Math.Vector2(
      this.pocket.centerPosition.x + cellCenter.x,
      this.pocket.centerPosition.y + cellCenter.y
    );
    
    // Only consider nodes within a small radius for localized effect
    const localRadius = 25; // Small radius for localized teardrop
    const nodeDistances: Array<{index: number, distance: number}> = [];
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const distance = node.position.distance(worldPocketCenter);
      if (distance <= localRadius) { // Only nodes within small radius
        nodeDistances.push({index: i, distance});
      }
    }
    
    // Sort by distance and take only the closest 3 nodes for very localized effect
    nodeDistances.sort((a, b) => a.distance - b.distance);
    const targetCount = Math.min(3, nodeDistances.length); // Only 3 nodes for localized teardrop
    
    for (let i = 0; i < targetCount; i++) {
      const nodeData = nodeDistances[i];
      const node = nodes[nodeData.index];
      this.pocket.targetNodes.push(nodeData.index);
      
      // Calculate INWARD force toward cell center (using world coordinates)
      const inwardDirection = cellCenter.clone().subtract(node.position).normalize();
      
      // Localized force pattern with quadratic falloff for teardrop shape
      const distanceFactor = 1.0 - (nodeData.distance / localRadius);
      const proximityBonus = Math.pow(distanceFactor, 1.5); // Stronger falloff for teardrop
      const forceMagnitude = this.config.invaginationForce * proximityBonus;
      
      this.pocket.forcePattern.push(inwardDirection.scale(forceMagnitude));
      
      if (DEBUG_ENDOCYTOSIS && i < 3) { // Log all nodes since we only have 3
        console.log(`🫧 Inward node ${i+1}: distance=${nodeData.distance.toFixed(1)}px, force=${forceMagnitude.toFixed(1)}, inward=true`);
      }
    }
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Selected ${this.pocket.targetNodes.length} nodes for inward pocket formation`);
    }
  }
  
  /**
   * Apply forces to membrane nodes to create pocket invagination
   * UPDATED: Much stronger forces for compliant nodes to enable deep pulling
   */
  private applyPocketForces(deltaSeconds: number = 1/60): void {
    if (!this.membranePhysics) return;
    
    // Primary approach: Use membrane physics built-in invagination with stronger scaling
    if (this.pocket.formationProgress > 0.02) { // Start sooner for immediate feedback
      const currentDepth = this.pocket.depth;
      
      // Moderate depth scaling for localized teardrop effect
      const scaledDepth = currentDepth * 0.3; // Reduced from 0.8 for localized effect
      
      this.membranePhysics.createMembraneInvagination(
        this.pocket.centerPosition,
        this.pocket.direction,
        this.config.pocketWidth * 0.4, // Smaller radius for localized effect - was 0.8
        scaledDepth
      );
      
      if (DEBUG_ENDOCYTOSIS && Math.random() < 0.1) {
        console.log(`🫧 Strong XPBD invagination: depth=${currentDepth.toFixed(1)}, applied=${scaledDepth.toFixed(1)}, progress=${(this.pocket.formationProgress * 100).toFixed(1)}%`);
      }
    }
    
    // Apply stronger backup forces for the compliant nodes
    this.applyBackupForces(deltaSeconds);
  }
  
  /**
   * Backup force application method (stronger for compliant nodes)
   */
  private applyBackupForces(deltaSeconds: number): void {
    const nodes = this.membranePhysics.getParticles();
    if (!nodes) return;
    
    let appliedForces = 0;
    let totalForceMagnitude = 0;
    const MAX_TOTAL_FORCE = 80.0; // Reduced from 200 for localized effect
    const MAX_INDIVIDUAL_FORCE = 25.0; // Reduced from 50 for controlled pulling
    
    for (let i = 0; i < this.pocket.targetNodes.length; i++) {
      const nodeIndex = this.pocket.targetNodes[i];
      const node = nodes[nodeIndex];
      const baseForce = this.pocket.forcePattern[i];
      
      if (node && baseForce) {
        // Ultra strong force scaling for super stretchy nodes
        // Give closest nodes dramatically stronger forces for extreme stretching
        const proximityBonus = Math.max(0.3, 1.0 - (i * 0.05)); // Much stronger bonus gradient
        
        const progressScale = this.pocket.stage === 'scission'
          ? 0.4 * proximityBonus // Stronger during scission too
          : Math.sin(this.pocket.formationProgress * Math.PI * 0.5) * 0.5 * proximityBonus; // Much stronger backup forces
        
        const timeDecay = Math.max(0.6, 1.0 - (this.pocket.formationProgress * 0.1)); // Less decay
        const dampening = Math.min(deltaSeconds * 60, 1.0);
        
        const forceMultiplier = progressScale * timeDecay * dampening;
        const finalForce = baseForce.clone().scale(forceMultiplier);
        
        // Less strict force limiting to allow stronger pulling
        const forceMagnitude = finalForce.length();
        if (forceMagnitude > MAX_INDIVIDUAL_FORCE) {
          finalForce.normalize().scale(MAX_INDIVIDUAL_FORCE);
        }
        
        if (totalForceMagnitude + forceMagnitude > MAX_TOTAL_FORCE) {
          break; // Stop applying more forces
        }
        
        // Apply the stronger force
        const particleIndex = this.pocket.targetNodes[i];
        this.membranePhysics.applyForceToParticle(particleIndex, finalForce);
        
        appliedForces++;
        totalForceMagnitude += finalForce.length();
        
        if (DEBUG_ENDOCYTOSIS && i < 3 && Math.random() < 0.05) {
          console.log(`🫧 Strong force on node ${i+1}: ${finalForce.length().toFixed(1)}, bonus=${proximityBonus.toFixed(2)}`);
        }
      }
    }
    
    // More frequent logging for stronger forces
    if (DEBUG_ENDOCYTOSIS && appliedForces > 0 && Math.random() < 0.05) {
      console.log(`🫧 Applied ${appliedForces} strong forces, total: ${totalForceMagnitude.toFixed(1)}`);
    }
  }
  
  /**
   * Apply holding forces to maintain pocket shape during scission stage
   * NEW APPROACH: Selective rigidity - maintain pocket walls but allow neck compression
   */
  private applyHoldingForces(): void {
    if (!this.membranePhysics) return;
    
    // NEW APPROACH: Instead of fighting membrane physics, work WITH it
    // Modify the rest positions so the membrane naturally maintains the pocket shape
    // BUT only for nodes that are NOT near the neck area (to allow compression)
    const nodes = this.membranePhysics.getParticles();
    if (!nodes) return;
    
    let modifiedNodes = 0;
    let skippedNeckNodes = 0;
    
    // Define neck area radius for flexibility - larger radius to catch more nodes
    const neckFlexibilityRadius = this.config.pocketWidth * 0.6; // Increased from 0.4 to 0.6
    
    // DEBUG: Log neck position and target nodes for analysis
    if (DEBUG_ENDOCYTOSIS && Math.random() < 0.05) { // 5% chance to log
      console.log(`🫧 DEBUG: Neck at (${this.pocket.neckPosition.x.toFixed(1)}, ${this.pocket.neckPosition.y.toFixed(1)}), flexRadius: ${neckFlexibilityRadius.toFixed(1)}`);
      console.log(`🫧 DEBUG: Target nodes: ${this.pocket.targetNodes.length}, checking distances...`);
    }
    
    for (let i = 0; i < this.pocket.targetNodes.length; i++) {
      const nodeIndex = this.pocket.targetNodes[i];
      const node = nodes[nodeIndex];
      
      if (node) {
        // Check if this node is near the neck area
        const distanceFromNeck = node.position.distance(this.pocket.neckPosition);
        const isNearNeck = distanceFromNeck < neckFlexibilityRadius;
        
        // DEBUG: Log distance calculations for a few nodes
        if (DEBUG_ENDOCYTOSIS && Math.random() < 0.02 && i < 5) { // Log first few nodes occasionally
          console.log(`🫧 DEBUG: Node ${nodeIndex} at (${node.position.x.toFixed(1)}, ${node.position.y.toFixed(1)}), distance from neck: ${distanceFromNeck.toFixed(1)}, isNear: ${isNearNeck}`);
        }
        
        // Note: restPosition/restRadius manipulation not supported in current membrane physics API
        // The endocytosis system would need significant refactoring to work with the current
        // ConstraintParticle interface which doesn't have restPosition/restRadius properties
        
        if (isNearNeck) {
          skippedNeckNodes++;
        } else {
          modifiedNodes++;
        }
      }
    }
    
    if (DEBUG_ENDOCYTOSIS && Math.random() < 0.1) { // 10% chance to log
      console.log(`🫧 Selective rigidity: ${modifiedNodes} pocket nodes rigidified, ${skippedNeckNodes} neck nodes kept flexible`);
    }
  }
  
  /**
   * Restore original rest positions when endocytosis ends
   */
  private restoreOriginalRestPositions(): void {
    if (!this.membranePhysics || !this.pocket.originalRestPositions.size) return;
    
    const nodes = this.membranePhysics.getParticles();
    if (!nodes) return;
    
    let restoredNodes = 0;
    
    // Restore all backed up rest positions
    // Note: restPosition/restRadius properties don't exist on current ConstraintParticle
    // Endocytosis system needs to be redesigned for current membrane physics API
    console.warn("Endocytosis: rest position restoration not supported in current membrane physics version");
    
    // Clear the backup
    this.pocket.originalRestPositions.clear();
    this.pocket.originalRestPositions.clear();
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Restored original rest positions for ${restoredNodes} nodes`);
    }
  }
  
  /**
   * Render visual feedback for pocket formation
   */
  private renderPocketVisualization(): void {
    this.pocketGraphics.clear();
    
    if (!this.pocket.isActive || !this.config.showPocketOutline) return;
    
    if (this.pocket.stage === 'invagination') {
      this.renderInvaginationStage();
    } else if (this.pocket.stage === 'scission') {
      this.renderScissionStage();
    }
  }
  
  /**
   * Render invagination stage visualization
   */
  private renderInvaginationStage(): void {
    const alpha = 0.7 * Math.max(0.3, this.pocket.formationProgress); // Minimum visibility
    const baseRadius = this.config.pocketWidth * 0.5;
    const currentRadius = baseRadius * (0.8 + 0.4 * this.pocket.formationProgress); // Grows with progress
    
    // Convert cell-local coordinates to world coordinates for rendering
    const cellCenter = this.membranePhysics.getCenter();
    const worldX = this.pocket.centerPosition.x + cellCenter.x;
    const worldY = this.pocket.centerPosition.y + cellCenter.y;
    
    // Draw pocket outline with thickness based on progress
    const lineWidth = 2 + 3 * this.pocket.formationProgress;
    this.pocketGraphics.lineStyle(lineWidth, this.config.pocketColor, alpha);
    this.pocketGraphics.strokeCircle(
      worldX,
      worldY,
      currentRadius
    );
    
    // Draw formation progress indicator (inner fill)
    if (this.pocket.formationProgress > 0.1) {
      this.pocketGraphics.fillStyle(this.config.pocketColor, alpha * 0.3);
      this.pocketGraphics.fillCircle(
        worldX,
        worldY,
        currentRadius * this.pocket.formationProgress
      );
    }
    
    // Draw direction indicator arrow (more prominent)
    if (this.pocket.formationProgress > 0.05) {
      this.renderDirectionArrow(alpha);
    }
  }
  
  /**
   * Render scission stage visualization
   */
  private renderScissionStage(): void {
    const alpha = 0.8;
    
    // Convert cell-local coordinates to world coordinates for rendering
    const cellCenter = this.membranePhysics.getCenter();
    const worldCenterX = this.pocket.centerPosition.x + cellCenter.x;
    const worldCenterY = this.pocket.centerPosition.y + cellCenter.y;
    const worldNeckX = this.pocket.neckPosition.x + cellCenter.x;
    const worldNeckY = this.pocket.neckPosition.y + cellCenter.y;
    
    // Draw pocket (faded)
    const baseRadius = this.config.pocketWidth * 0.5;
    this.pocketGraphics.lineStyle(2, this.config.pocketColor, alpha * 0.5);
    this.pocketGraphics.strokeCircle(
      worldCenterX,
      worldCenterY,
      baseRadius
    );
    
    // Draw neck area
    this.pocketGraphics.lineStyle(3, this.config.scissionColor, alpha);
    this.pocketGraphics.strokeCircle(
      worldNeckX,
      worldNeckY,
      this.pocket.neckDiameter * 0.5
    );
    
    // Draw compression zones if enabled
    if (this.config.showCompressionZones) {
      this.renderCompressionZones(alpha);
    }
    
    // Draw scission progress
    if (this.pocket.scissionProgress > 0.1) {
      const progressRadius = (this.pocket.neckDiameter * 0.5) * (1 - this.pocket.scissionProgress);
      this.pocketGraphics.fillStyle(this.config.scissionColor, alpha * 0.4);
      this.pocketGraphics.fillCircle(
        worldNeckX,
        worldNeckY,
        progressRadius
      );
    }
    
    // Draw timer visualization
    this.renderScissionTimer(alpha);
  }
  
  /**
   * Render compression zones for cooperative gameplay
   */
  private renderCompressionZones(alpha: number): void {
    const playerPos = this.player.getCellLocalCoordinates();
    const cellCenter = this.membranePhysics.getCenter();
    
    for (const zone of this.pocket.compressionZones) {
      const distanceToPlayer = playerPos.distance(zone);
      const isPlayerNearby = distanceToPlayer <= this.config.cooperativeDistance;
      
      // Base pulsing effect for compression zones
      const basePulse = alpha * (0.4 + 0.4 * Math.sin(Date.now() * 0.008));
      
      // Highlight if player is nearby
      const zoneAlpha = isPlayerNearby ? alpha * 0.9 : basePulse;
      const zoneColor = isPlayerNearby ? 0xffff00 : this.config.scissionColor; // Yellow when active
      const zoneRadius = this.config.cooperativeDistance * (isPlayerNearby ? 0.4 : 0.3);
      
      // Convert cell-local coordinates to world coordinates for rendering
      const worldZoneX = zone.x + cellCenter.x;
      const worldZoneY = zone.y + cellCenter.y;
      
      // Draw compression zone circle
      this.pocketGraphics.lineStyle(isPlayerNearby ? 4 : 2, zoneColor, zoneAlpha);
      this.pocketGraphics.strokeCircle(worldZoneX, worldZoneY, zoneRadius);
      
      // Fill zone if player is nearby
      if (isPlayerNearby) {
        this.pocketGraphics.fillStyle(zoneColor, alpha * 0.2);
        this.pocketGraphics.fillCircle(worldZoneX, worldZoneY, zoneRadius);
      }
      
      // Add arrow pointing toward neck
      const directionToNeck = this.pocket.neckPosition.clone().subtract(zone).normalize();
      const arrowStart = zone.clone().add(directionToNeck.clone().scale(8));
      const arrowEnd = zone.clone().add(directionToNeck.clone().scale(18));
      
      this.pocketGraphics.lineStyle(3, zoneColor, zoneAlpha);
      this.pocketGraphics.beginPath();
      this.pocketGraphics.moveTo(arrowStart.x, arrowStart.y);
      this.pocketGraphics.lineTo(arrowEnd.x, arrowEnd.y);
      this.pocketGraphics.strokePath();
      
      // Add arrowhead if player is nearby
      if (isPlayerNearby) {
        const arrowheadSize = 6;
        const angle = Math.atan2(directionToNeck.y, directionToNeck.x);
        const leftPoint = new Phaser.Math.Vector2(
          arrowEnd.x - arrowheadSize * Math.cos(angle - Math.PI/6),
          arrowEnd.y - arrowheadSize * Math.sin(angle - Math.PI/6)
        );
        const rightPoint = new Phaser.Math.Vector2(
          arrowEnd.x - arrowheadSize * Math.cos(angle + Math.PI/6),
          arrowEnd.y - arrowheadSize * Math.sin(angle + Math.PI/6)
        );
        
        this.pocketGraphics.beginPath();
        this.pocketGraphics.moveTo(arrowEnd.x, arrowEnd.y);
        this.pocketGraphics.lineTo(leftPoint.x, leftPoint.y);
        this.pocketGraphics.moveTo(arrowEnd.x, arrowEnd.y);
        this.pocketGraphics.lineTo(rightPoint.x, rightPoint.y);
        this.pocketGraphics.strokePath();
      }
    }
  }
  
  /**
   * Render scission timer as progress bar
   */
  private renderScissionTimer(alpha: number): void {
    const barWidth = 40;
    const barHeight = 6;
    const barPos = this.pocket.neckPosition.clone().add(new Phaser.Math.Vector2(0, -25));
    
    if (this.config.debugFreezeScission) {
      // Show "FROZEN" indicator instead of timer
      this.pocketGraphics.fillStyle(0x00ffff, alpha * 0.8); // Cyan for frozen
      this.pocketGraphics.fillRect(barPos.x - barWidth/2, barPos.y - barHeight/2, barWidth, barHeight);
      
      // Pulsing effect to indicate frozen state
      const pulseAlpha = alpha * (0.5 + 0.5 * Math.sin(Date.now() * 0.005));
      this.pocketGraphics.fillStyle(0xffffff, pulseAlpha);
      this.pocketGraphics.fillRect(barPos.x - barWidth/2 + 2, barPos.y - barHeight/2 + 1, barWidth - 4, barHeight - 2);
      return;
    }
    
    // Normal timer display
    const baseTime = this.config.debugExtendedScissionTime || this.config.scissionWindowTime;
    const timerProgress = Math.min(1, this.pocket.scissionTimer / baseTime);
    
    // Background
    this.pocketGraphics.fillStyle(0x333333, alpha * 0.5);
    this.pocketGraphics.fillRect(barPos.x - barWidth/2, barPos.y - barHeight/2, barWidth, barHeight);
    
    // Progress
    const progressColor = timerProgress > 0.3 ? this.config.scissionColor : 0xff3333; // Red when low
    this.pocketGraphics.fillStyle(progressColor, alpha);
    this.pocketGraphics.fillRect(
      barPos.x - barWidth/2, 
      barPos.y - barHeight/2, 
      barWidth * timerProgress, 
      barHeight
    );
  }
  
  /**
   * Render direction arrow for invagination stage
   */
  private renderDirectionArrow(alpha: number): void {
    const cellCenter = this.membranePhysics.getCenter();
    const arrowLength = 30 + 40 * this.pocket.formationProgress;
    const arrowEnd = this.pocket.centerPosition.clone().add(
      this.pocket.direction.clone().scale(arrowLength)
    );
    
    // Convert to world coordinates
    const worldStartX = this.pocket.centerPosition.x + cellCenter.x;
    const worldStartY = this.pocket.centerPosition.y + cellCenter.y;
    const worldEndX = arrowEnd.x + cellCenter.x;
    const worldEndY = arrowEnd.y + cellCenter.y;
    
    // Arrow line
    this.pocketGraphics.lineStyle(3, this.config.pocketColor, alpha * 0.8);
    this.pocketGraphics.beginPath();
    this.pocketGraphics.moveTo(worldStartX, worldStartY);
    this.pocketGraphics.lineTo(worldEndX, worldEndY);
    this.pocketGraphics.strokePath();
    
    // Arrowhead
    const arrowHeadSize = 8;
    const angle = Math.atan2(this.pocket.direction.y, this.pocket.direction.x);
    const leftPoint = new Phaser.Math.Vector2(
      worldEndX - arrowHeadSize * Math.cos(angle - Math.PI/6),
      worldEndY - arrowHeadSize * Math.sin(angle - Math.PI/6)
    );
    const rightPoint = new Phaser.Math.Vector2(
      worldEndX - arrowHeadSize * Math.cos(angle + Math.PI/6),
      worldEndY - arrowHeadSize * Math.sin(angle + Math.PI/6)
    );
    
    this.pocketGraphics.beginPath();
    this.pocketGraphics.moveTo(worldEndX, worldEndY);
    this.pocketGraphics.lineTo(leftPoint.x, leftPoint.y);
    this.pocketGraphics.moveTo(worldEndX, worldEndY);
    this.pocketGraphics.lineTo(rightPoint.x, rightPoint.y);
    this.pocketGraphics.strokePath();
  }
  
  /**
   * Get current membrane radius (approximate)
   */
  private getMembraneRadius(): number {
    // Use the membrane physics system's radius
    return this.membranePhysics.getApproximateRadius();
  }
  
  /**
   * Get current pocket state for external systems
   */
  public getPocketState(): EndocytosisPocket {
    return { ...this.pocket }; // Return copy to prevent external modification
  }
  
  /**
   * Main update loop
   */
  private updateSystem(deltaSeconds: number): void {
    if (this.pocket.isActive) {
      // CRITICAL FIX: Actually call the pocket formation update logic
      // This was missing and is why endocytosis never progressed
      const inputDirection = this.getLastDirectionInput(); // Get from input controller
      this.updatePocketFormation(inputDirection, deltaSeconds);
      
      // Render visual feedback
      this.renderPocketVisualization();
    }
  }
  
  /**
   * Get the last direction input for pocket formation
   * This receives input from the input controller
   */
  private getLastDirectionInput(): Phaser.Math.Vector2 {
    return this.lastDirectionInput.clone();
  }
  
  /**
   * PUBLIC API: Update direction input from input controller
   * This method is called by the EndocytosisInputController
   */
  public updateDirectionInput(direction: Phaser.Math.Vector2): void {
    this.lastDirectionInput.copy(direction);
  }
  
  /**
   * PUBLIC API: Handle pocket formation start from input controller
   */
  public handlePocketFormationStart(inputDirection: Phaser.Math.Vector2): boolean {
    const success = this.startPocketFormation(inputDirection);
    
    if (success && DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Input controller started pocket formation with direction: (${inputDirection.x.toFixed(2)}, ${inputDirection.y.toFixed(2)})`);
      
      // Provide clear instructions to the player
      this.worldRefs.showToast("Hold C and use WASD to pull membrane at your own pace!");
    }
    
    return success;
  }
  
  /**
   * PUBLIC API: Handle pocket formation stop from input controller
   */
  public handlePocketFormationStop(): void {
    this.stopPocketFormation();
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Input controller stopped pocket formation`);
    }
  }
  
  /**
   * Cleanup when system is destroyed
   */
  override destroy(): void {
    if (this.pocketGraphics) {
      this.pocketGraphics.destroy();
    }
    
    // Clean up created vesicles
    this.createdVesicles.forEach(vesicle => {
      if (vesicle && vesicle.scene) {
        vesicle.destroy();
      }
    });
    this.createdVesicles = [];
    
    super.destroy();
  }
  
  /**
   * Create a vesicle from completed endocytosis
   */
  private createVesicle(): void {
    // For now, create a simple visual vesicle
    // In a full implementation, this would create a proper game entity
    const vesicle = this.scene.add.circle(
      this.pocket.centerPosition.x,
      this.pocket.centerPosition.y,
      this.config.pocketWidth * 0.35, // Smaller than pocket
      this.config.vesicleColor || 0x4CAF50,
      0.6
    );
    
    // Position vesicle using physics-based positioning
    if (this.worldRefs.scene) {
      this.worldRefs.scene.positionVisualElement(vesicle, 0, 0);
    }
    
    // Add border
    vesicle.setStrokeStyle(2, this.config.vesicleColor || 0x4CAF50, 0.8);
    
    // Animate vesicle creation
    vesicle.setScale(0.1);
    this.scene.tweens.add({
      targets: vesicle,
      scaleX: 1,
      scaleY: 1,
      duration: 300,
      ease: 'Back.easeOut'
    });
    
    // Store vesicle reference for cleanup
    this.createdVesicles.push(vesicle);
    
    // Optional: Auto-remove vesicle after time
    this.scene.time.delayedCall(10000, () => {
      if (vesicle && vesicle.scene) {
        this.scene.tweens.add({
          targets: vesicle,
          alpha: 0,
          duration: 1000,
          onComplete: () => {
            vesicle.destroy();
            const index = this.createdVesicles.indexOf(vesicle);
            if (index > -1) {
              this.createdVesicles.splice(index, 1);
            }
          }
        });
      }
    });
  }
  
  /**
   * Debug method to toggle scission freeze state
   */
  public toggleDebugFreeze(): void {
    this.config.debugFreezeScission = !this.config.debugFreezeScission;
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Debug freeze toggled: ${this.config.debugFreezeScission ? 'FROZEN' : 'UNFROZEN'}`);
    }
    
    const message = this.config.debugFreezeScission 
      ? "Debug: Scission stage FROZEN! Take your time to test!"
      : "Debug: Scission stage UNFROZEN! Timer is now active!";
    this.worldRefs.showToast(message);
  }
  
  /**
   * Debug method to get current pocket stage for input controller
   */
  public getCurrentStage(): string {
    return this.pocket.stage;
  }
  
  /**
   * Debug method to check if pocket is active
   */
  public isPocketActive(): boolean {
    return this.pocket.isActive;
  }
  
  /**
   * Restore membrane integrity after scission (legacy method - now handled by membrane physics)
   */
  private restoreMembraneIntegrity(): void {
    if (!this.membranePhysics) return;
    
    // Legacy approach kept for backward compatibility
    // Modern approach uses membrane physics scission methods
    const restoreForce = this.config.invaginationForce * 0.3;
    
    // Apply gentle outward forces to close the gap
    const outwardDirection = new Phaser.Math.Vector2(0, -1); // Outward from center
    this.membranePhysics.applyImpact(
      this.pocket.centerPosition,
      restoreForce,
      outwardDirection
    );
    
    // Additional restoration at neck position if it exists
    if (this.pocket.neckDiameter > 0) {
      const inwardDirection = new Phaser.Math.Vector2(0, 1); // Inward toward center
      this.membranePhysics.applyImpact(
        this.pocket.neckPosition,
        restoreForce * 1.5,
        inwardDirection
      );
    }
  }
  
  /**
   * Handle scission failure using membrane physics restoration
   */
  private handleScissionFailure(): void {
    // Use the restoration method when scission fails
    this.restoreMembraneIntegrity();
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Scission failed! Using membrane physics to restore integrity.`);
    }
    
    this.worldRefs.showToast("Scission failed! Membrane restoring...");
    this.stopPocketFormation();
  }
}
