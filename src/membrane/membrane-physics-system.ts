/**
 * Membrane Physics System - Realistic Plasma Membrane Simulation
 * 
 * Implements a biophysically accurate membrane model with:
 * - Lipid bilayer fluid mechanics
 * - Surface tension and elasticity
 * - Wave propagation and damping
 * - Impact-generated ripples
 * - Osmotic pressure effects
 * - Curvature energy minimization
 * - Network replication of membrane deformations
 */

import { SystemObject } from "../systems/system-object";
import { Multicast } from "../network/decorators";
import type { NetBus } from "../network/net-bus";
import type { WorldRefs } from "../core/world-refs";

// Debug flag - set to true to enable membrane physics debugging
const DEBUG_MEMBRANE = false;

export interface MembraneNode {
  /** Node position in cell-local coordinates */
  position: Phaser.Math.Vector2;
  
  /** Current velocity for physics integration */
  velocity: Phaser.Math.Vector2;
  
  /** Forces acting on this node this frame */
  force: Phaser.Math.Vector2;
  
  /** Rest position (equilibrium position) */
  restPosition: Phaser.Math.Vector2;
  
  /** Angular position around the circle (0 to 2π) */
  angle: number;
  
  /** Distance from cell center at rest */
  restRadius: number;
  
  /** Current distance from cell center */
  currentRadius: number;
  
  /** Mass for physics calculations */
  mass: number;
  
  /** Membrane protein density at this location (affects stiffness) */
  proteinDensity: number;
}

export interface MembranePhysicsConfig {
  /** Number of nodes around the membrane perimeter */
  nodeCount: number;
  
  /** Base membrane radius */
  radius: number;
  
  /** Surface tension coefficient (N/m) */
  surfaceTension: number;
  
  /** Elastic modulus (Pa) - resistance to stretching */
  elasticModulus: number;
  
  /** Bending modulus (J) - resistance to curvature */
  bendingModulus: number;
  
  /** Viscous damping coefficient */
  dampingCoefficient: number;
  
  /** Internal osmotic pressure */
  osmoticPressure: number;
  
  /** Mass of each membrane node */
  nodeMass: number;
  
  /** Time step for physics integration */
  timeStep: number;
  
  /** Maximum allowed deformation (as fraction of radius) */
  maxDeformation: number;
  
  /** Wave propagation speed (m/s) */
  waveSpeed: number;
  
  /** Impact response strength */
  impactSensitivity: number;
}

export interface ImpactEvent {
  /** Position of impact in cell-local coordinates */
  position: Phaser.Math.Vector2;
  
  /** Force magnitude of the impact */
  force: number;
  
  /** Direction of impact force (unit vector) */
  direction: Phaser.Math.Vector2;
  
  /** Timestamp of impact */
  timestamp: number;
  
  /** Type of impact (collision, dash, etc.) */
  type: 'collision' | 'dash' | 'organelle' | 'external';
}

export class MembranePhysicsSystem extends SystemObject {
  private config: MembranePhysicsConfig;
  private nodes: MembraneNode[] = [];
  private recentImpacts: ImpactEvent[] = [];
  
  // Graphics for rendering
  private membraneGraphics!: Phaser.GameObjects.Graphics;
  
  // Physics state
  private currentTime: number = 0;
  private accumulatedDelta: number = 0;
  
  // Performance optimizations - pre-computed constants and object pooling
  private adjacentRestLength: number = 0;
  private diagonalRestLength: number = 0;
  private forceThreshold: number = 0.001; // Skip tiny forces for performance
  private tempVector1: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  private tempVector2: Phaser.Math.Vector2 = new Phaser.Math.Vector2();

  // Network integration - hybrid approach compatible with @Multicast decorator
  private _netBus?: NetBus;  // Expected by @Multicast decorator
  readonly netAddress: string;  // Expected by @Multicast decorator
  
  constructor(
    scene: Phaser.Scene,
    private worldRefs: WorldRefs,
    netBus?: NetBus
  ) {
    super(scene, "MembranePhysics", (deltaSeconds: number) => this.update(deltaSeconds));
    
    this._netBus = netBus;
    this.netAddress = "MembranePhysics";  // Stable address for networking
    
    // Use hardcoded configuration optimized for this game
    this.config = {
      nodeCount: 144,         // Increased for smoother curves
      radius: 216,
      surfaceTension: 0.072,
      elasticModulus: 1e6,
      bendingModulus: 20e-18,
      dampingCoefficient: 0.15, // Optimized for stability
      osmoticPressure: 100,
      nodeMass: 1e-15,
      timeStep: 1/60,
      maxDeformation: 0.4,    // 40% max deformation
      waveSpeed: 400,
      impactSensitivity: 1.2  // Enhanced impact response
    };
    
    // Pre-compute physics constants for optimization
    this.updatePhysicsConstants();
    
    this.initializeNodes();
    this.initializeGraphics();
    
    // Register with NetBus if provided
    if (this._netBus) {
      this._netBus.registerInstance(this, "MembranePhysics");
    }
    
    if (DEBUG_MEMBRANE) {
      console.log(`🧬 Membrane Physics System initialized with ${this.config.nodeCount} nodes`);
    }
  }
  
  private initializeNodes(): void {
    this.nodes = [];
    
    for (let i = 0; i < this.config.nodeCount; i++) {
      const angle = (i / this.config.nodeCount) * Math.PI * 2;
      const x = Math.cos(angle) * this.config.radius;
      const y = Math.sin(angle) * this.config.radius;
      
      const node: MembraneNode = {
        position: new Phaser.Math.Vector2(x, y),
        velocity: new Phaser.Math.Vector2(0, 0),
        force: new Phaser.Math.Vector2(0, 0),
        restPosition: new Phaser.Math.Vector2(x, y),
        angle: angle,
        restRadius: this.config.radius,
        currentRadius: this.config.radius,
        mass: this.config.nodeMass,
        proteinDensity: 0.1 + Math.random() * 0.2 // Vary protein density
      };
      
      this.nodes.push(node);
    }
  }
  
  private updatePhysicsConstants(): void {
    // Pre-compute rest lengths for optimization
    this.adjacentRestLength = (2 * Math.PI * this.config.radius) / this.config.nodeCount;
    this.diagonalRestLength = (4 * Math.PI * this.config.radius) / this.config.nodeCount;
    
    // Adjust force threshold based on system size for better performance
    this.forceThreshold = Math.max(0.001, this.config.radius * 0.00001);
  }

  private initializeGraphics(): void {
    // Main membrane rendering
    this.membraneGraphics = this.scene.add.graphics();
    this.membraneGraphics.setDepth(2);
    this.membraneGraphics.setVisible(true); // Ensure visibility
    this.worldRefs.cellRoot.add(this.membraneGraphics);
    
    if (DEBUG_MEMBRANE) {
      console.log('🧬 Membrane graphics initialized and added to cellRoot');
    }
  }
  
  /**
   * Apply an impact force to the membrane at a specific location in cell-local coordinates
   * This is the main method for applying membrane impacts with network replication
   */
  public applyImpact(
    cellLocalPosition: Phaser.Math.Vector2,
    force: number,
    direction: Phaser.Math.Vector2,
    type: ImpactEvent['type'] = 'collision'
  ): void {
    // Convert to world coordinates for consistent replication
    const worldPosition = new Phaser.Math.Vector2(
      cellLocalPosition.x + this.worldRefs.cellRoot.x,
      cellLocalPosition.y + this.worldRefs.cellRoot.y
    );
    
    // Always use multicast for membrane impacts (works for both host and clients)
    this.replicateMembraneImpact(
      { x: worldPosition.x, y: worldPosition.y },
      force,
      { x: direction.x, y: direction.y },
      type
    );
  }

  /**
   * Networked membrane impact replication - multicast to all clients
   */
  @Multicast()
  private replicateMembraneImpact(
    worldPosition: { x: number; y: number },
    force: number,
    direction: { x: number; y: number },
    type: ImpactEvent['type']
  ): void {
    // Convert world position to cell-local coordinates
    const cellRootPos = new Phaser.Math.Vector2(this.worldRefs.cellRoot.x, this.worldRefs.cellRoot.y);
    const cellLocalPos = new Phaser.Math.Vector2(worldPosition.x, worldPosition.y).subtract(cellRootPos);
    const directionVector = new Phaser.Math.Vector2(direction.x, direction.y);
    
    // Apply the impact locally on all clients
    this.applyImpactInternal(cellLocalPos, force, directionVector, type);
    
    if (DEBUG_MEMBRANE) {
      console.log(`🌐 Replicated membrane impact at (${cellLocalPos.x.toFixed(1)}, ${cellLocalPos.y.toFixed(1)}) force=${force.toFixed(1)} type=${type}`);
    }
  }

  /**
   * Internal method that actually applies the impact (used by both local and replicated calls)
   */
  private applyImpactInternal(
    cellLocalPosition: Phaser.Math.Vector2,
    force: number,
    direction: Phaser.Math.Vector2,
    type: ImpactEvent['type']
  ): void {
    // For collision type impacts, use the provided position directly since it's already calculated
    // For other types, find the closest membrane point
    let impactPosition = cellLocalPosition;
    if (type !== 'collision') {
      impactPosition = this.findClosestMembranePoint(cellLocalPosition);
    }
    
    const impact: ImpactEvent = {
      position: impactPosition,
      force: force * this.config.impactSensitivity,
      direction: direction.clone().normalize(),
      timestamp: this.currentTime,
      type: type
    };
    
    this.recentImpacts.push(impact);
    
    // Apply immediate force to nearby nodes
    this.applyImpactToNodes(impact);
    
    if (DEBUG_MEMBRANE) {
      console.log(`🌊 Membrane impact at (${impactPosition.x.toFixed(1)}, ${impactPosition.y.toFixed(1)}) force=${force.toFixed(1)} type=${type}`);
    }
  }

  private findClosestMembranePoint(targetPosition: Phaser.Math.Vector2): Phaser.Math.Vector2 {
    let closestDistance = Infinity;
    let closestPoint = targetPosition.clone();
    
    // Find the membrane node closest to the target position
    for (const node of this.nodes) {
      const distance = node.position.distance(targetPosition);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPoint = node.position.clone();
      }
    }
    
    // If the target is inside the membrane, project it to the membrane surface
    const centerDistance = targetPosition.length();
    if (centerDistance < this.config.radius * 0.8) {
      // Point is inside membrane, project to surface
      if (centerDistance > 0) {
        closestPoint = targetPosition.clone().normalize().scale(this.config.radius);
      } else {
        // Point is at center, choose arbitrary surface point
        closestPoint = new Phaser.Math.Vector2(this.config.radius, 0);
      }
    }
    
    return closestPoint;
  }
  
  private applyImpactToNodes(impact: ImpactEvent): void {
    const impactRadius = 60; // Even larger influence radius for better effects
    let affectedNodes = 0;
    let totalForceApplied = 0;
    
    for (const node of this.nodes) {
      const distance = node.position.distance(impact.position);
      
      if (distance < impactRadius) {
        // Calculate falloff (inverse square law with minimum)
        const falloff = Math.max(0.1, 1 / (1 + distance * distance / (impactRadius * impactRadius)));
        
        // Apply force in impact direction - much stronger force for visible deformation
        const forceVector = impact.direction.clone().scale(impact.force * falloff * 20.0); // 20x stronger
        node.force.add(forceVector);
        
        // Add some radial component for more natural deformation
        const radialDirection = node.position.clone().subtract(impact.position).normalize();
        const radialForce = radialDirection.scale(impact.force * falloff * 6.0); // 6x stronger
        node.force.add(radialForce);
        
        // Add some velocity for persistence
        const velocityImpulse = forceVector.clone().scale(0.1);
        node.velocity.add(velocityImpulse);
        
        affectedNodes++;
        totalForceApplied += forceVector.length() + radialForce.length();
      }
    }
    
    // Debug log impact effectiveness - only when debugging enabled
    if (DEBUG_MEMBRANE && affectedNodes > 0 && Math.random() < 0.2) {
      console.log(`⚡ Impact affected ${affectedNodes} nodes with total force ${totalForceApplied.toFixed(1)}`);
    }
  }
  
  override update(deltaSeconds: number): void {
    this.currentTime += deltaSeconds;
    this.accumulatedDelta += deltaSeconds;
    
    // Debug: occasionally log that update is being called (only when debugging enabled)
    if (DEBUG_MEMBRANE && Math.random() < 0.01) {
      console.log(`🧬 Membrane physics update: deltaSeconds=${deltaSeconds.toFixed(3)}, nodes=${this.nodes.length}`);
    }
    
    // Use fixed timestep for physics stability
    while (this.accumulatedDelta >= this.config.timeStep) {
      this.updatePhysics(this.config.timeStep);
      this.accumulatedDelta -= this.config.timeStep;
    }
    
    this.cleanupOldImpacts();
    this.renderMembrane();
  }
  
  private updatePhysics(dt: number): void {
    // Clear forces
    for (const node of this.nodes) {
      node.force.set(0, 0);
    }
    
    // Apply membrane forces
    this.applyElasticForces();
    this.applyRadialRestoringForces();
    this.applySurfaceTensionForces();
    this.applyBendingForces();
    this.applyOsmoticPressure();
    this.applyDamping();
    
    // Integrate motion
    this.integrateMotion(dt);
    
    // Apply constraints
    this.applyConstraints();
  }
  
  private applyElasticForces(): void {
    // Primary springs between adjacent nodes - optimized with pre-computed rest length
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const nextNode = this.nodes[(i + 1) % this.nodes.length];
      
      // Use pre-computed rest length instead of calculating each time
      const restLength = this.adjacentRestLength;
      
      // Reuse temp vector for displacement calculation
      const displacement = this.tempVector1.copy(nextNode.position).subtract(node.position);
      const currentLength = displacement.length();
      
      if (currentLength > 0 && currentLength < 1000) { // Sanity check to prevent explosion
        // Elastic force proportional to extension
        const extension = currentLength - restLength;
        const springForce = extension * 0.5; // Increased spring strength significantly
        
        // Skip tiny forces for performance
        if (Math.abs(springForce) > this.forceThreshold) {
          displacement.normalize().scale(springForce);
          node.force.add(displacement);
          nextNode.force.subtract(displacement);
        }
      }
    }
    
    // Secondary springs for better stability and wave propagation - optimized
    // Connect every other node (creates diagonal springs)
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const secondNode = this.nodes[(i + 2) % this.nodes.length];
      
      // Use pre-computed diagonal rest length
      const restLength = this.diagonalRestLength;
      
      const displacement = this.tempVector2.copy(secondNode.position).subtract(node.position);
      const currentLength = displacement.length();
      
      if (currentLength > 0 && currentLength < 1000) {
        const extension = currentLength - restLength;
        const springForce = extension * 0.2; // Weaker diagonal springs
        
        // Skip tiny forces for performance
        if (Math.abs(springForce) > this.forceThreshold) {
          displacement.normalize().scale(springForce);
          node.force.add(displacement);
          secondNode.force.subtract(displacement);
        }
      }
    }
  }
  
  private applyRadialRestoringForces(): void {
    // Force that pulls each node back to its rest radius
    // This is the key to maintaining membrane equilibrium
    for (const node of this.nodes) {
      const currentRadius = node.position.length();
      
      if (currentRadius > 0) {
        const radiusError = currentRadius - node.restRadius;
        
        // Skip tiny corrections for performance
        if (Math.abs(radiusError) > this.forceThreshold) {
          // Reuse temp vector for direction calculation
          this.tempVector1.copy(node.position).normalize();
          
          // Gentler restoring force to allow visible deformation
          const restoringForce = radiusError * 0.3; // Force magnitude
          this.tempVector1.scale(-restoringForce);
          node.force.add(this.tempVector1);
        }
      }
    }
  }
  
  private applySurfaceTensionForces(): void {
    // Surface tension tries to minimize perimeter and create wave propagation
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const prevNode = this.nodes[(i - 1 + this.nodes.length) % this.nodes.length];
      const nextNode = this.nodes[(i + 1) % this.nodes.length];
      
      // Calculate local curvature and wave propagation using temp vectors
      const v1 = this.tempVector1.copy(node.position).subtract(prevNode.position);
      const v2 = this.tempVector2.copy(nextNode.position).subtract(node.position);
      
      const v1Length = v1.length();
      const v2Length = v2.length();
      
      if (v1Length > this.forceThreshold && v2Length > this.forceThreshold) {
        v1.normalize();
        v2.normalize();
        
        // Surface tension force (smoothing)
        const curvatureVector = v2.subtract(v1).scale(0.05); // Increased for better wave effects
        node.force.add(curvatureVector);
        
        // Wave propagation force - helps disturbances travel around the membrane
        // Reuse tempVector1 for average position calculation
        this.tempVector1.copy(prevNode.position).add(nextNode.position).scale(0.5);
        this.tempVector1.subtract(node.position).scale(0.02);
        node.force.add(this.tempVector1);
      }
    }
  }
  
  private applyBendingForces(): void {
    // Bending resistance (prevents sharp kinks) - optimized with temp vectors
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const prevNode = this.nodes[(i - 1 + this.nodes.length) % this.nodes.length];
      const nextNode = this.nodes[(i + 1) % this.nodes.length];
      
      // Second derivative approximation (curvature) - using temp vector for calculation
      const secondDerivative = this.tempVector1.copy(nextNode.position)
        .subtract(this.tempVector2.copy(node.position).scale(2))  // Use temp vector for 2x scaling
        .add(prevNode.position);
      
      const bendingForce = secondDerivative.scale(-0.0001); // Much smaller force
      
      // Only apply if force is significant enough
      if (bendingForce.lengthSq() > this.forceThreshold * this.forceThreshold) {
        node.force.add(bendingForce);
      }
    }
  }
  
  private applyOsmoticPressure(): void {
    // Internal pressure pushes outward
    for (const node of this.nodes) {
      const centerDirection = node.position.clone();
      if (centerDirection.length() > 0) {
        centerDirection.normalize();
        const pressureForce = centerDirection.scale(0.02); // Reduced osmotic pressure significantly
        node.force.add(pressureForce);
      }
    }
  }
  
  private applyDamping(): void {
    // Viscous damping
    for (const node of this.nodes) {
      const dampingForce = node.velocity.clone().scale(-this.config.dampingCoefficient);
      node.force.add(dampingForce);
    }
  }
  
  private integrateMotion(dt: number): void {
    // Verlet integration for stability
    for (const node of this.nodes) {
      // Check for NaN or extreme values before integration
      if (isNaN(node.force.x) || isNaN(node.force.y) || 
          Math.abs(node.force.x) > 10000 || Math.abs(node.force.y) > 10000) {
        console.warn('Extreme force detected, resetting node');
        node.force.set(0, 0);
        node.velocity.set(0, 0);
        // Reset position to rest position
        node.position.copy(node.restPosition);
        node.currentRadius = node.restRadius;
        continue;
      }
      
      // Acceleration with mass scaling
      const acceleration = node.force.clone().scale(1 / node.mass);
      
      // Limit acceleration to prevent explosion
      const maxAcceleration = 1000;
      if (acceleration.length() > maxAcceleration) {
        acceleration.normalize().scale(maxAcceleration);
      }
      
      // Update velocity with damping
      node.velocity.add(acceleration.clone().scale(dt));
      
      // Limit velocity to prevent explosion
      const maxVelocity = 100;
      if (node.velocity.length() > maxVelocity) {
        node.velocity.normalize().scale(maxVelocity);
      }
      
      // Update position
      node.position.add(node.velocity.clone().scale(dt));
      
      // Update current radius with safety check
      if (node.position && typeof node.position.length === 'function') {
        const newRadius = node.position.length();
        if (isNaN(newRadius) || newRadius < 10 || newRadius > 1000) {
          // Reset to safe position
          node.position.copy(node.restPosition);
          node.currentRadius = node.restRadius;
          node.velocity.set(0, 0);
        } else {
          node.currentRadius = newRadius;
        }
      } else {
        console.error('Invalid node position detected during physics integration:', node.position);
        node.position.copy(node.restPosition);
        node.currentRadius = node.restRadius;
        node.velocity.set(0, 0);
      }
    }
  }
  
  private applyConstraints(): void {
    // Prevent excessive deformation
    const maxRadius = this.config.radius * (1 + this.config.maxDeformation);
    const minRadius = this.config.radius * (1 - this.config.maxDeformation);
    
    // Track if we need equilibrium correction
    let needsCorrection = false;
    const avgRadius = this.nodes.reduce((sum, node) => sum + node.currentRadius, 0) / this.nodes.length;
    
    for (const node of this.nodes) {
      // Individual node constraints
      if (node.currentRadius > maxRadius) {
        node.position.normalize().scale(maxRadius);
        node.currentRadius = maxRadius;
        // Reflect velocity component
        const radialComponent = node.velocity.dot(node.position.clone().normalize());
        if (radialComponent > 0) {
          const radialVelocity = node.position.clone().normalize().scale(radialComponent);
          node.velocity.subtract(radialVelocity.scale(1.5)); // Damped reflection
        }
        needsCorrection = true;
      } else if (node.currentRadius < minRadius) {
        node.position.normalize().scale(minRadius);
        node.currentRadius = minRadius;
        // Reflect velocity component
        const radialComponent = node.velocity.dot(node.position.clone().normalize());
        if (radialComponent < 0) {
          const radialVelocity = node.position.clone().normalize().scale(radialComponent);
          node.velocity.subtract(radialVelocity.scale(1.5)); // Damped reflection
        }
        needsCorrection = true;
      }
      
      // Global stability check - if average radius is drifting, apply correction
      if (Math.abs(avgRadius - this.config.radius) > 20) {
        needsCorrection = true;
      }
    }
    
    // Apply equilibrium correction if needed
    if (needsCorrection) {
      this.applyEquilibriumCorrection(avgRadius);
    }
  }
  
  private applyEquilibriumCorrection(currentAvgRadius: number): void {
    // Gently pull the entire membrane back toward equilibrium
    const radiusError = currentAvgRadius - this.config.radius;
    const correctionStrength = 0.02; // Gentle correction
    
    for (const node of this.nodes) {
      if (node.position.length() > 0) {
        const direction = node.position.clone().normalize();
        const correction = direction.scale(-radiusError * correctionStrength);
        node.force.add(correction);
      }
    }
    
    // Log correction events
    if (Math.abs(radiusError) > 5) {
      if (DEBUG_MEMBRANE) {
        console.log(`🧬 Membrane equilibrium correction: radius error=${radiusError.toFixed(1)}`);
      }
    }
  }
  
  private cleanupOldImpacts(): void {
    const maxAge = 5.0; // Keep impacts for 5 seconds
    this.recentImpacts = this.recentImpacts.filter(
      impact => this.currentTime - impact.timestamp < maxAge
    );
  }
  
  private renderMembrane(): void {
    this.membraneGraphics.clear();
    
    if (this.nodes.length === 0) {
      console.warn('No membrane nodes to render');
      return;
    }
    
    // Create a realistic cell membrane appearance using improved spline rendering
    this.membraneGraphics.lineStyle(4, 0x4a90e2, 0.8); // Blue membrane with transparency
    
    // Add spline curve through all nodes with better interpolation
    const splinePoints: Phaser.Math.Vector2[] = [];
    
    // For better spline smoothness, we can add the last few points at the beginning
    // and the first few points at the end to help with circular interpolation
    const numWrapPoints = 2;
    
    // Add wrap-around points from the end
    for (let i = this.nodes.length - numWrapPoints; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      splinePoints.push(new Phaser.Math.Vector2(node.position.x, node.position.y));
    }
    
    // Add all main points
    for (const node of this.nodes) {
      splinePoints.push(new Phaser.Math.Vector2(node.position.x, node.position.y));
    }
    
    // Add wrap-around points from the beginning
    for (let i = 0; i < numWrapPoints; i++) {
      const node = this.nodes[i];
      splinePoints.push(new Phaser.Math.Vector2(node.position.x, node.position.y));
    }
    
    // Create spline curve for smooth organic appearance
    const spline = new Phaser.Curves.Spline(splinePoints);
    
    // Extract only the middle portion of the spline (the actual membrane)
    const startT = numWrapPoints / (splinePoints.length - 1);
    const endT = (splinePoints.length - 1 - numWrapPoints) / (splinePoints.length - 1);
    
    // Get points along the spline for the actual membrane
    const resolution = Math.max(128, this.nodes.length * 2); // Higher resolution for smoother curves
    const membranePoints: Phaser.Math.Vector2[] = [];
    
    for (let i = 0; i <= resolution; i++) {
      const t = startT + (endT - startT) * (i / resolution);
      const point = spline.getPoint(t);
      membranePoints.push(point);
    }
    
    // Draw the smooth membrane curve
    this.membraneGraphics.beginPath();
    if (membranePoints.length > 0) {
      this.membraneGraphics.moveTo(membranePoints[0].x, membranePoints[0].y);
      for (let i = 1; i < membranePoints.length; i++) {
        this.membraneGraphics.lineTo(membranePoints[i].x, membranePoints[i].y);
      }
      this.membraneGraphics.closePath();
    }
    this.membraneGraphics.strokePath();
    
    // Add subtle inner glow by stroking a slightly smaller version
    this.membraneGraphics.lineStyle(2, 0x357abd, 0.3);
    this.membraneGraphics.beginPath();
    
    const innerScale = 0.97;
    if (membranePoints.length > 0) {
      this.membraneGraphics.moveTo(membranePoints[0].x * innerScale, membranePoints[0].y * innerScale);
      for (let i = 1; i < membranePoints.length; i++) {
        this.membraneGraphics.lineTo(membranePoints[i].x * innerScale, membranePoints[i].y * innerScale);
      }
      this.membraneGraphics.closePath();
    }
    this.membraneGraphics.strokePath();
  }

  /**
   * Get the membrane boundary for physics interactions
   */
  public getMembraneRadiusAt(angle: number): number {
    // Safety check: ensure nodes are initialized
    if (!this.nodes || this.nodes.length === 0) {
      console.warn('Membrane nodes not initialized, using default radius');
      return this.config.radius;
    }
    
    // Normalize angle to 0-2π range to prevent negative indices
    angle = ((angle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    
    // Find the two nodes that bracket this angle
    const nodeAngle = (2 * Math.PI) / this.nodes.length;
    const index = Math.floor(angle / nodeAngle) % this.nodes.length;
    const nextIndex = (index + 1) % this.nodes.length;
    
    const node1 = this.nodes[index];
    const node2 = this.nodes[nextIndex];
    
    // Additional safety check with detailed logging
    if (!node1 || !node2) {
      console.warn(`Invalid membrane nodes at indices ${index}, ${nextIndex}. Array length: ${this.nodes.length}`);
      return this.config.radius;
    }
    
    if (node1.currentRadius === undefined || node2.currentRadius === undefined || 
        isNaN(node1.currentRadius) || isNaN(node2.currentRadius)) {
      console.warn(`Membrane nodes have invalid currentRadius: node1=${node1.currentRadius}, node2=${node2.currentRadius}. Using default radius.`);
      return this.config.radius;
    }
    
    // Interpolate between the two nodes
    const t = (angle - index * nodeAngle) / nodeAngle;
    return node1.currentRadius * (1 - t) + node2.currentRadius * t;
  }
  
  /**
   * Get membrane elasticity at a specific angle (for physics interactions)
   */
  public getMembraneElasticityAt(angle: number): number {
    const baseElasticity = 0.3;
    const proteinDensity = this.getProteinDensityAt(angle);
    
    // Higher protein density = higher elasticity
    return baseElasticity * (1 + proteinDensity);
  }
  
  private getProteinDensityAt(angle: number): number {
    // Safety check: ensure nodes are initialized
    if (!this.nodes || this.nodes.length === 0) {
      return 0.15; // Default protein density
    }
    
    const nodeAngle = (2 * Math.PI) / this.nodes.length;
    const index = Math.floor(angle / nodeAngle);
    
    if (index >= this.nodes.length || !this.nodes[index]) {
      return 0.15; // Default protein density
    }
    
    return this.nodes[index].proteinDensity;
  }
  
  /**
   * Get membrane normal vector at a specific angle
   */
  public getMembraneNormalAt(angle: number): Phaser.Math.Vector2 {
    const nodeAngle = (2 * Math.PI) / this.nodes.length;
    const index = Math.floor(angle / nodeAngle);
    const nextIndex = (index + 1) % this.nodes.length;
    
    const node1 = this.nodes[index];
    const node2 = this.nodes[nextIndex];
    
    // Calculate tangent vector
    const tangent = node2.position.clone().subtract(node1.position).normalize();
    
    // Normal is perpendicular to tangent (outward)
    return new Phaser.Math.Vector2(-tangent.y, tangent.x);
  }
  
  /**
   * Debug method to check membrane physics system state
   */
  public getDebugInfo(): string {
    const nodeCount = this.nodes?.length || 0;
    const firstNodeRadius = this.nodes?.[0]?.currentRadius;
    const hasValidNodes = this.nodes?.every(node => 
      node && 
      typeof node.currentRadius === 'number' && 
      !isNaN(node.currentRadius)
    );
    
    return `Nodes: ${nodeCount}, FirstRadius: ${firstNodeRadius?.toFixed(1)}, Valid: ${hasValidNodes}`;
  }

  /**
   * Cleanup when system is destroyed
   */
  public override destroy(): void {
    this.membraneGraphics?.destroy();
    
    super.destroy();
  }
}
