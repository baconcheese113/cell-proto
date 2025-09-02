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
      // Stage 1: Invagination
      maxPocketDepth: 80,
      pocketFormationSpeed: 25, // Slower formation - was 120, now 25 pixels per second (3+ seconds to complete)
      pocketWidth: 60,
      
      // Stage 2: Scission
      scissionThreshold: 60, // 75% of max depth to start scission
      scissionWindowTime: 2000, // 2 seconds to complete scission
      minNeckDiameter: 10, // Minimum neck width for pinch-off
      compressionForce: 30,
      
      // Physics
      invaginationForce: 50, // Increased force for more visible deformation
      membraneStiffness: 0.8,
      pocketTension: 15,
      neckElasticity: 0.6,
      
      // Interaction
      activationDistance: 40,
      directionSensitivity: 0.8,
      cooperativeDistance: 25,
      
      // Visual
      showPocketOutline: true,
      showCompressionZones: true,
      pocketColor: 0xff6b35,
      scissionColor: 0x00ff88,
      vesicleColor: 0x4CAF50,
      
      // Debug options
      debugFreezeScission: true,  // Enable freeze for single-player testing
      debugExtendedScissionTime: 30000, // 30 seconds for testing
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
    const playerPos = this.player.getCellLocalPosition();
    const distanceFromCenter = playerPos.length();
    const membraneRadius = this.getMembraneRadius();
    
    // Player must be near the membrane but not outside
    const distanceFromMembrane = Math.abs(distanceFromCenter - membraneRadius);
    // console.log(`Player distance from membrane: ${distanceFromMembrane.toFixed(1)} (activation threshold: ${this.config.activationDistance}), playerPos: (${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}), membraneRadius: ${membraneRadius.toFixed(1)}`);
    return distanceFromMembrane <= this.config.activationDistance;
  }
  
  /**
   * Start endocytosis pocket formation
   */
  public startPocketFormation(inputDirection: Phaser.Math.Vector2): boolean {
    if (!this.canInitiateEndocytosis() || this.pocket.isActive) {
      return false;
    }
    
    const playerPos = this.player.getCellLocalPosition();
    
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
    
    if (this.pocket.stage === 'invagination') {
      this.updateInvaginationStage(inputDirection, deltaSeconds);
    } else if (this.pocket.stage === 'scission') {
      this.updateScissionStage(deltaSeconds);
    }
  }
  
  /**
   * Update invagination stage (pocket formation)
   */
  private updateInvaginationStage(inputDirection: Phaser.Math.Vector2, deltaSeconds: number): void {
    // Update pocket direction based on input
    if (inputDirection.lengthSq() > 0.1) {
      const inputInfluence = inputDirection.clone().normalize().scale(this.config.directionSensitivity * deltaSeconds);
      this.pocket.direction.add(inputInfluence).normalize();
      
      if (DEBUG_ENDOCYTOSIS && Math.random() < 0.05) { // 5% chance to log direction changes
        console.log(`🫧 Updated pocket direction: (${this.pocket.direction.x.toFixed(2)}, ${this.pocket.direction.y.toFixed(2)})`);
      }
    }
    
    // Increase pocket depth
    const depthIncrease = this.config.pocketFormationSpeed * deltaSeconds;
    const oldProgress = this.pocket.formationProgress;
    this.pocket.depth = Math.min(this.pocket.depth + depthIncrease, this.config.maxPocketDepth);
    this.pocket.formationProgress = this.pocket.depth / this.config.maxPocketDepth;
    
    // Log progress at significant milestones
    if (DEBUG_ENDOCYTOSIS && Math.floor(oldProgress * 10) !== Math.floor(this.pocket.formationProgress * 10)) {
      console.log(`🫧 Pocket formation progress: ${(this.pocket.formationProgress * 100).toFixed(0)}%`);
    }
    
    // Apply forces to membrane nodes
    this.applyPocketForces();
    
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
   * Transition from invagination to scission stage
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
    this.applyPocketForces();
    
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
    const playerPos = this.player.getCellLocalPosition();
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
   */
  private completeScission(): void {
    console.log('Endocytosis scission completed - creating vesicle');
    
    // Create vesicle at pocket center
    this.createVesicle();
    
    // Clean up membrane modifications
    this.restoreMembraneIntegrity();
    
    // Restore original membrane rest positions
    this.restoreOriginalRestPositions();
    
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
    
    // Notify other systems (simplified without eventBus)
    console.log('Endocytosis vesicle created at:', this.pocket.centerPosition);
    
    this.worldRefs.showToast("Endocytosis successful! Vesicle formed and captured!");
  }
  
  /**
   * Handle scission failure (timeout or other conditions)
   */
  private failScission(): void {
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Scission failed! Pocket will collapse back to membrane.`);
    }
    
    this.worldRefs.showToast("Scission failed! Pocket collapsing...");
    
    // Gradually return pocket to normal membrane state
    this.stopPocketFormation();
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
   */
  private calculateTargetNodes(): void {
    this.pocket.targetNodes = [];
    this.pocket.forcePattern = [];
    
    const nodes = this.membranePhysics.getParticles(); // Access particles array
    if (!nodes) return;
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const distance = node.position.distance(this.pocket.centerPosition);
      
      if (distance <= this.config.pocketWidth) {
        this.pocket.targetNodes.push(i);
        
        // Calculate force vector for this node
        const forceDirection = this.pocket.direction.clone();
        const falloff = 1 - (distance / this.config.pocketWidth);
        const forceMagnitude = this.config.invaginationForce * falloff;
        
        this.pocket.forcePattern.push(forceDirection.scale(forceMagnitude));
      }
    }
    
    if (DEBUG_ENDOCYTOSIS) {
      console.log(`🫧 Calculated ${this.pocket.targetNodes.length} target nodes for pocket`);
    }
  }
  
  /**
   * Apply forces to membrane nodes to create pocket invagination
   */
  private applyPocketForces(): void {
    // Alternative approach: Use membrane physics impact system for better integration
    // Apply forces during formation OR scission stages
    const shouldApplyForces = this.pocket.formationProgress > 0.1 || this.pocket.stage === 'scission';
    
    if (shouldApplyForces) {
      // Use formation progress for scaling, but ensure minimum force during scission
      const progressForScaling = this.pocket.stage === 'scission' 
        ? Math.max(this.pocket.formationProgress, 0.8) // Ensure strong force during scission
        : this.pocket.formationProgress;
      
      const impactForce = this.config.invaginationForce * progressForScaling;
      
      // Apply impact at pocket center with inward direction
      this.membranePhysics.applyImpact(
        this.pocket.centerPosition,
        impactForce,
        this.pocket.direction
      );
      
      if (DEBUG_ENDOCYTOSIS && Math.random() < 0.1) { // 10% chance to log
        const stage = this.pocket.stage === 'scission' ? ' [SCISSION]' : '';
        console.log(`🫧 Applied membrane impact${stage}: force=${impactForce.toFixed(1)}, progress=${(progressForScaling * 100).toFixed(1)}%`);
      }
    }
    
    // Keep original direct node approach as backup/additional effect
    const nodes = this.membranePhysics.getParticles(); // Access particles array
    if (!nodes) return;
    
    let appliedForces = 0;
    let totalForceMagnitude = 0;
    
    for (let i = 0; i < this.pocket.targetNodes.length; i++) {
      const nodeIndex = this.pocket.targetNodes[i];
      const node = nodes[nodeIndex];
      const baseForce = this.pocket.forcePattern[i];
      
      if (node && baseForce) {
        // Scale force by formation progress and depth
        const progressScale = this.pocket.stage === 'scission'
          ? Math.max(Math.sin(this.pocket.formationProgress * Math.PI), 0.8) // Maintain strong force during scission
          : Math.sin(this.pocket.formationProgress * Math.PI); // Smooth ramping during formation
        
        const depthScale = this.pocket.depth / this.config.maxPocketDepth;
        const scissionMultiplier = this.pocket.stage === 'scission' ? 1.5 : 1.0; // Extra force during scission
        const finalForce = baseForce.clone().scale(progressScale * depthScale * 0.5 * scissionMultiplier);
        
        // Apply the force via the proper force application method
        this.membranePhysics.applyForceToParticle(i, finalForce);
        
        // Track applied forces for debugging
        appliedForces++;
        totalForceMagnitude += finalForce.length();
      }
    }
    
    // Debug logging for direct force application
    if (DEBUG_ENDOCYTOSIS && appliedForces > 0 && Math.random() < 0.1) { // 10% chance to log
      const stage = this.pocket.stage === 'scission' ? ' [SCISSION]' : '';
      console.log(`🫧 Applied direct forces${stage} to ${appliedForces} nodes, total magnitude: ${totalForceMagnitude.toFixed(1)}`);
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
    
    // Draw pocket outline with thickness based on progress
    const lineWidth = 2 + 3 * this.pocket.formationProgress;
    this.pocketGraphics.lineStyle(lineWidth, this.config.pocketColor, alpha);
    this.pocketGraphics.strokeCircle(
      this.pocket.centerPosition.x,
      this.pocket.centerPosition.y,
      currentRadius
    );
    
    // Draw formation progress indicator (inner fill)
    if (this.pocket.formationProgress > 0.1) {
      this.pocketGraphics.fillStyle(this.config.pocketColor, alpha * 0.3);
      this.pocketGraphics.fillCircle(
        this.pocket.centerPosition.x,
        this.pocket.centerPosition.y,
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
    
    // Draw pocket (faded)
    const baseRadius = this.config.pocketWidth * 0.5;
    this.pocketGraphics.lineStyle(2, this.config.pocketColor, alpha * 0.5);
    this.pocketGraphics.strokeCircle(
      this.pocket.centerPosition.x,
      this.pocket.centerPosition.y,
      baseRadius
    );
    
    // Draw neck area
    this.pocketGraphics.lineStyle(3, this.config.scissionColor, alpha);
    this.pocketGraphics.strokeCircle(
      this.pocket.neckPosition.x,
      this.pocket.neckPosition.y,
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
        this.pocket.neckPosition.x,
        this.pocket.neckPosition.y,
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
    const playerPos = this.player.getCellLocalPosition();
    
    for (const zone of this.pocket.compressionZones) {
      const distanceToPlayer = playerPos.distance(zone);
      const isPlayerNearby = distanceToPlayer <= this.config.cooperativeDistance;
      
      // Base pulsing effect for compression zones
      const basePulse = alpha * (0.4 + 0.4 * Math.sin(Date.now() * 0.008));
      
      // Highlight if player is nearby
      const zoneAlpha = isPlayerNearby ? alpha * 0.9 : basePulse;
      const zoneColor = isPlayerNearby ? 0xffff00 : this.config.scissionColor; // Yellow when active
      const zoneRadius = this.config.cooperativeDistance * (isPlayerNearby ? 0.4 : 0.3);
      
      // Draw compression zone circle
      this.pocketGraphics.lineStyle(isPlayerNearby ? 4 : 2, zoneColor, zoneAlpha);
      this.pocketGraphics.strokeCircle(zone.x, zone.y, zoneRadius);
      
      // Fill zone if player is nearby
      if (isPlayerNearby) {
        this.pocketGraphics.fillStyle(zoneColor, alpha * 0.2);
        this.pocketGraphics.fillCircle(zone.x, zone.y, zoneRadius);
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
    const arrowLength = 30 + 40 * this.pocket.formationProgress;
    const arrowEnd = this.pocket.centerPosition.clone().add(
      this.pocket.direction.clone().scale(arrowLength)
    );
    
    // Arrow line
    this.pocketGraphics.lineStyle(3, this.config.pocketColor, alpha * 0.8);
    this.pocketGraphics.beginPath();
    this.pocketGraphics.moveTo(this.pocket.centerPosition.x, this.pocket.centerPosition.y);
    this.pocketGraphics.lineTo(arrowEnd.x, arrowEnd.y);
    this.pocketGraphics.strokePath();
    
    // Arrowhead
    const arrowHeadSize = 8;
    const angle = Math.atan2(this.pocket.direction.y, this.pocket.direction.x);
    const leftPoint = new Phaser.Math.Vector2(
      arrowEnd.x - arrowHeadSize * Math.cos(angle - Math.PI/6),
      arrowEnd.y - arrowHeadSize * Math.sin(angle - Math.PI/6)
    );
    const rightPoint = new Phaser.Math.Vector2(
      arrowEnd.x - arrowHeadSize * Math.cos(angle + Math.PI/6),
      arrowEnd.y - arrowHeadSize * Math.sin(angle + Math.PI/6)
    );
    
    this.pocketGraphics.beginPath();
    this.pocketGraphics.moveTo(arrowEnd.x, arrowEnd.y);
    this.pocketGraphics.lineTo(leftPoint.x, leftPoint.y);
    this.pocketGraphics.moveTo(arrowEnd.x, arrowEnd.y);
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
  private updateSystem(_deltaSeconds: number): void {
    if (this.pocket.isActive) {
      // Render visual feedback
      this.renderPocketVisualization();
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
   * Restore membrane integrity after scission
   */
  private restoreMembraneIntegrity(): void {
    if (!this.membranePhysics) return;
    
    // Gradually restore normal membrane forces
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
}
