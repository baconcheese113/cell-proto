import { System } from '../systems/system';
import type { NetBus } from '../network/net-bus';
import { RunOnServer } from '../network/decorators';

interface ConstraintParticle {
  position: Phaser.Math.Vector2;
  prevPosition: Phaser.Math.Vector2;
  velocity: Phaser.Math.Vector2;
  xPred: Phaser.Math.Vector2; // XPBD predicted position
  invMass: number; // 1/mass, 0 = immovable
  radius: number; // For collision detection
  deltaPosition: Phaser.Math.Vector2; // Accumulated position corrections
  id: number;
  isFrozen: boolean;
}

/**
 * Membrane state for network replication
 */
interface MembraneState {
  particles: Array<{ position: { x: number; y: number }; velocity: { x: number; y: number } }>;
  center: { x: number; y: number };
  [key: string]: any; // For JSON compatibility
}

/**
 * Default membrane physics parameters - serves as both type definition and default values
 * These control the XPBD physics simulation behavior
 */
export const DEFAULT_MEMBRANE_PARAMETERS = {
  // === MAIN MEMBRANE CONTROL KNOBS ===
  // Adjust these to tune behavior - your primary controls!
  alphaEdge: 3e-4,              // Lower = stretchier membrane (your main control!)
  alphaArea: 1e-4,              // Lower = more volume flexibility  
  alphaBend: 2e-4,              // Lower = softer bending
  
  // === SIMULATION PARAMETERS ===
  substeps: 2,                  // Number of physics substeps per frame (performance optimized)
  solverIterations: 8,          // Constraint solver iterations per substep (performance optimized)
  damping: 0.998,               // Velocity damping (0.97-0.99 range)
  maxVelocity: 150,             // Velocity clamp to prevent instability
  
  // === COLLISION RESPONSE ===
  impactImpulseScale: 120,      // Impulse strength for collisions
  
  // === ADAPTIVE COMPLIANCE FOR MEMBRANE EXTRUSION ===
  impactSofteningFrames: 10,    // How long to soften after impact (frames)
  impactSofteningFactor: 3.0,   // How much to soften (multiplier)
  
  // === ENDOCYTOSIS-SPECIFIC PARAMETERS ===
  endocytosisCompliance: 0.15,  // Special compliance for endocytosis
  endocytosisRadius: 25,        // Radius of endocytosis effect
  endocytosisDepthScale: 0.15,  // Depth scaling factor
  
  // === CENTER ANCHORING ===
  centerAnchorCompliance: 2e-3, // Center anchor strength
  
  // === ACTIVE BROWNIAN MOTION ===
  membraneNoise: 8.0,           // Thermal noise intensity for membrane
  membraneActiveForce: 0.0,     // Self-propulsion for active patches
  noiseCorrelationTime: 0.5     // How long noise persists (seconds)
};

export type MembraneParameters = typeof DEFAULT_MEMBRANE_PARAMETERS;

export class MembranePhysicsSystem extends System {
  private particles: ConstraintParticle[] = [];
  private graphics: Phaser.GameObjects.Graphics;
  
  // Missing properties that were removed during conversion
  private pendingForces: Map<number, Phaser.Math.Vector2> = new Map();
  private recentImpacts: Map<number, number> = new Map(); // particle index -> frames remaining
  
  // Internal simulation state
  private _dt: number = 1/60;
  private restEdge: number[] = [];
  private restArea: number = 0;
  
  // Center-of-mass tracking
  private centerPosition: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
  private centerAnchor: Phaser.Math.Vector2 | null = null;
  
  // Force accumulation and impact tracking
  // Additional membranes for collision detection
  private additionalMembranes: MembranePhysicsSystem[] = [];
  
  // Network replication - will be initialized in constructor
  private readonly membraneState: MembraneState;
  private readonly membraneParameters: MembraneParameters;
  constructor(scene: Phaser.Scene, bus: NetBus, config: {
    particles: Phaser.Math.Vector2[];
    restArea?: number;
    timeStep?: number;
    parent?: Phaser.GameObjects.Container;
    id?: string; // Unique identifier for state channel keys
  }) {
    super(
      scene,
      bus,
      'MembranePhysics',
      (deltaTime) => this.update(deltaTime),
      { address: 'MembranePhysics' }
    );
    
    // Initialize state channels with unique keys based on id
    const instanceId = config.id || 'default';
    this.membraneState = this.stateChannel<MembraneState>(`membrane-${instanceId}`, {
      particles: [],
      center: { x: 0, y: 0 }
    });
    this.membraneParameters = this.stateChannel<MembraneParameters>(`membraneParameters-${instanceId}`, DEFAULT_MEMBRANE_PARAMETERS);
    
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(1);
    
    if (config.parent) {
      config.parent.add(this.graphics);
    }
    
    this.initializeParticles(config.particles);
    
    // Store rest edge lengths for XPBD
    this.restEdge = [];
    for (let i = 0; i < this.particles.length; i++) {
      const j = (i + 1) % this.particles.length;
      const edge = this.particles[j].position.clone().subtract(this.particles[i].position);
      this.restEdge.push(edge.length());
    }
    
    this.restArea = config.restArea || this.calculateCurrentArea();
    
    console.log(`🧬 XPBD Membrane initialized: ${this.particles.length} particles, rest area: ${this.restArea.toFixed(1)}`);
  }

  /**
   * Get the parameters state channel for direct UI access
   */
  public getParametersStateChannel() {
    return this.membraneParameters;
  }

  private initializeParticles(positions: Phaser.Math.Vector2[]) {
    this.particles = positions.map((pos, index) => ({
      position: pos.clone(),
      prevPosition: pos.clone(),
      velocity: new Phaser.Math.Vector2(0, 0),
      xPred: pos.clone(), // XPBD predicted position
      invMass: 1.0, // All particles have equal mass initially
      radius: 2.0, // Small radius for collision detection
      deltaPosition: new Phaser.Math.Vector2(0, 0),
      id: index,
      isFrozen: false
    }));
  }

  private calculateCurrentArea(): number {
    // Shoelace formula for polygon area
    let area = 0;
    const n = this.particles.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pi = this.particles[i].position;
      const pj = this.particles[j].position;
      area += pi.x * pj.y - pj.x * pi.y;
    }
    
    return Math.abs(area) / 2;
  }

  /**
   * Main XPBD physics simulation step
   */
  public override update(deltaTime: number) {
    // Sync from network state if we're a client
    this.syncFromNetworkState();
    
    // Apply membrane Brownian motion
    this.applyMembraneBrownianMotion(deltaTime);
    
    // 1) Apply pending impulses to velocities
    for (const [i, imp] of this.pendingForces.entries()) {
      const p = this.particles[i];
      if (p.invMass > 0) {
        p.velocity.x += imp.x * p.invMass;
        p.velocity.y += imp.y * p.invMass;
      }
    }
    this.pendingForces.clear();

    // 2) Update recent impact tracking
    for (const [particleIndex, framesRemaining] of this.recentImpacts.entries()) {
      if (framesRemaining <= 1) {
        this.recentImpacts.delete(particleIndex);
      } else {
        this.recentImpacts.set(particleIndex, framesRemaining - 1);
      }
    }

    // Only run physics simulation on the host
    if (this._netBus.isHost) {
      this.runPhysicsSimulation(deltaTime);
    }
    
    this.render();
    
    // Broadcast state if we're the host
    this.broadcastStateIfHost();
  }

  private runPhysicsSimulation(deltaTime: number) {
    // 3) XPBD substeps
    const h = deltaTime / this.membraneParameters.substeps;
    for (let s = 0; s < this.membraneParameters.substeps; s++) {
      // Predict positions
      for (const p of this.particles) {
        p.prevPosition.set(p.position.x, p.position.y);
        p.position.x += p.velocity.x * h;
        p.position.y += p.velocity.y * h;
      }

      // Solve constraints
      for (let k = 0; k < this.membraneParameters.solverIterations; k++) {
        // Distance constraints (edges) with adaptive compliance
        for (let i = 0; i < this.particles.length; i++) {
          const j = (i + 1) % this.particles.length;
          
          let adaptiveAlpha = this.membraneParameters.alphaEdge;
          if (this.recentImpacts.has(i) || this.recentImpacts.has(j)) {
            adaptiveAlpha *= this.membraneParameters.impactSofteningFactor;
          }
          
          // PROOF OF CONCEPT: Regional compliance based on position
          // Apply localized softening for endocytosis testing
          const particleA = this.particles[i];
          const particleB = this.particles[j];
          const edgeMidpoint = particleA.position.clone().add(particleB.position).scale(0.5);
          
          // Get membrane center for regional calculations
          const membraneCenter = this.getCenter();
          const relativeY = edgeMidpoint.y - membraneCenter.y;
          
          // Bottom half of membrane gets much softer (higher alpha = more compliant)
          if (relativeY > 0) {
            adaptiveAlpha *= 200; // Make bottom half 200x more compliant (very soft)
          }
          // Top half stays stiff (original alpha value)
          
          this.solveDistanceXPBD(this.particles[i], this.particles[j], this.restEdge[i], adaptiveAlpha, h);
        }

        // Bending smoothing
        const N = this.particles.length;
        for (let i = 0; i < N; i++) {
          const a = (i - 1 + N) % N, b = i, c = (i + 1) % N;
          this.solveBendSmoothing(this.particles[a], this.particles[b], this.particles[c], this.membraneParameters.alphaBend, h);
        }

        // Area constraint (volume preservation)
        this.solveAreaXPBD(this.particles, this.restArea, this.membraneParameters.alphaArea, h);
      }

      // Check for membrane-to-membrane collisions only occasionally to avoid excessive force application
      if (s === this.membraneParameters.substeps - 1) { // Only on the last substep
        this.checkMembraneToMembraneCollisions();
      }

      // Update center and solve center anchor if set
      this.updateCenter();
      if (this.centerAnchor) {
        this.solveCenterAnchor();
      }

      // Update velocities from corrected positions + damping
      for (const p of this.particles) {
        p.velocity.x = (p.position.x - p.prevPosition.x) / h;
        p.velocity.y = (p.position.y - p.prevPosition.y) / h;
        p.velocity.x *= this.membraneParameters.damping;
        p.velocity.y *= this.membraneParameters.damping;
        
        // Velocity clamping
        const speed = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
        if (speed > this.membraneParameters.maxVelocity) {
          const scale = this.membraneParameters.maxVelocity / speed;
          p.velocity.x *= scale;
          p.velocity.y *= scale;
        }
      }
    }
  }

  /**
   * SERVER ONLY: Update membrane state for network replication
   */
  @RunOnServer()
  private broadcastStateIfHost() {
    // Create current state snapshot
    const currentState: MembraneState = {
      particles: this.particles.map(p => ({
        position: { x: p.position.x, y: p.position.y },
        velocity: { x: p.velocity.x, y: p.velocity.y }
      })),
      center: this.getCenter()
    };
    
    // Update the state channel - let the networking layer handle change detection
    Object.assign(this.membraneState, currentState);
  }
  /**
   * Apply received network state to local particles (for non-host clients)
   * Uses gentle reconciliation to avoid overriding client predictions
   */
  private syncFromNetworkState() {
    // Only sync if we're not the host
    if (this._netBus.isHost) return;
    
    const state = this.membraneState;
    if (!state.particles || state.particles.length !== this.particles.length) return;
    
    // Gentle reconciliation: only sync when positions differ significantly
    const threshold = 5.0; // pixels - adjust as needed
    let needsSync = false;
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const networkParticle = state.particles[i];
      
      const dx = networkParticle.position.x - particle.position.x;
      const dy = networkParticle.position.y - particle.position.y;
      const distanceSquared = dx * dx + dy * dy;
      
      if (distanceSquared > threshold * threshold) {
        needsSync = true;
        break;
      }
    }
    
    // If positions are significantly different, interpolate toward network state
    if (needsSync) {
      const lerpFactor = 0.3; // Adjust for smoother/snappier reconciliation
      
      for (let i = 0; i < this.particles.length; i++) {
        const particle = this.particles[i];
        const networkParticle = state.particles[i];
        
        // Interpolate position
        particle.position.x = Phaser.Math.Linear(particle.position.x, networkParticle.position.x, lerpFactor);
        particle.position.y = Phaser.Math.Linear(particle.position.y, networkParticle.position.y, lerpFactor);
        
        // Interpolate velocity more gently
        particle.velocity.x = Phaser.Math.Linear(particle.velocity.x, networkParticle.velocity.x, lerpFactor * 0.5);
        particle.velocity.y = Phaser.Math.Linear(particle.velocity.y, networkParticle.velocity.y, lerpFactor * 0.5);
      }
    }
    
    // No need for center movement detection here - handled by @Multicast
  }

  // === XPBD CONSTRAINT SOLVERS ===

  private solveDistanceXPBD(pA: ConstraintParticle, pB: ConstraintParticle, restLength: number, alpha: number, h: number) {
    if (pA.invMass + pB.invMass === 0) return;

    const delta = pB.position.clone().subtract(pA.position);
    const len = delta.length();
    if (len < 1e-6) return;

    const C = len - restLength;
    const dir = delta.scale(1 / len);
    const alphaPrime = alpha / (h * h);
    const denom = pA.invMass + pB.invMass + alphaPrime;
    
    if (denom === 0) return;
    
    const dLambda = -C / denom;
    const correction = dir.scale(dLambda);
    
    if (pA.invMass > 0) pA.position.add(correction.clone().scale(-pA.invMass));
    if (pB.invMass > 0) pB.position.add(correction.clone().scale(pB.invMass));
  }

  private solveBendSmoothing(pA: ConstraintParticle, _pB: ConstraintParticle, pC: ConstraintParticle, alpha: number, h: number) {
    if (pA.invMass + pC.invMass === 0) return;

    const restDist = pC.position.clone().subtract(pA.position).length();
    const delta = pC.position.clone().subtract(pA.position);
    const len = delta.length();
    if (len < 1e-6) return;

    const C = len - restDist;
    const dir = delta.scale(1 / len);
    const alphaPrime = alpha / (h * h);
    const denom = pA.invMass + pC.invMass + alphaPrime;
    
    if (denom === 0) return;
    
    const dLambda = -C / denom;
    const correction = dir.scale(dLambda * 0.5); // Weaker than stretch
    
    if (pA.invMass > 0) pA.position.add(correction.clone().scale(-pA.invMass));
    if (pC.invMass > 0) pC.position.add(correction.clone().scale(pC.invMass));
  }

  private solveAreaXPBD(particles: ConstraintParticle[], restArea: number, alpha: number, h: number) {
    const currentArea = this.calculateCurrentArea();
    const C = currentArea - restArea;
    if (Math.abs(C) < 1.0) return;

    const grads: Phaser.Math.Vector2[] = [];
    let denom = 0;
    
    for (let i = 0; i < particles.length; i++) {
      const prev = (i - 1 + particles.length) % particles.length;
      const next = (i + 1) % particles.length;
      const pPrev = particles[prev].position;
      const pNext = particles[next].position;
      const g = new Phaser.Math.Vector2((pNext.y - pPrev.y) * 0.5, (pPrev.x - pNext.x) * 0.5);
      grads.push(g);
      denom += particles[i].invMass * g.lengthSq();
    }
    
    const alphaPrime = alpha / (h * h);
    denom += alphaPrime;
    if (denom === 0) return;

    const dLambda = -C / denom;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.invMass > 0) {
        const correction = grads[i].clone().scale(dLambda * p.invMass);
        p.position.add(correction);
      }
    }
  }

  // === COLLISION AND INTERACTION ===

  /**
   * Player collision with membrane - returns bounce velocity and applies deformation
   */
  public collideCircleAndBounce(opts: {
    center: Phaser.Math.Vector2;
    radius: number;
    inOutVelocity: Phaser.Math.Vector2;
    restitution?: number;
    friction?: number;
    impulseScale?: number;
  }): { collided: boolean; contactPoint?: Phaser.Math.Vector2; normal?: Phaser.Math.Vector2 } {
    
    const restitution = opts.restitution ?? 0.32;
    const friction = opts.friction ?? 0.05;
    
    const sample = this.getNearestSurfaceSample(opts.center);
    const distance = opts.center.distance(sample.pos);
    const signedDistance = distance - opts.radius;
    
    if (signedDistance >= 0) {
      return { collided: false };
    }
    
    const normal = sample.normal;
    const incomingVel = opts.inOutVelocity.clone();
    const velDotNormal = incomingVel.dot(normal);
    
    // Bounce if moving into surface
    if (velDotNormal < 0) {
      const reflectionAmount = -(1 + restitution) * velDotNormal;
      opts.inOutVelocity.add(normal.clone().scale(reflectionAmount));
    }
    
    // Tangential friction
    const tangent = new Phaser.Math.Vector2(-normal.y, normal.x);
    const velDotTangent = opts.inOutVelocity.dot(tangent);
    const frictionAmount = velDotTangent * friction;
    opts.inOutVelocity.subtract(tangent.clone().scale(frictionAmount));
    
    // Apply deformation impulse to membrane
    const velocityChange = opts.inOutVelocity.clone().subtract(incomingVel);
    const impulseScale = opts.impulseScale ?? velocityChange.length();
    const impulse = normal.clone().scale(-impulseScale * 10);
    
    // Distribute impulse to neighboring particles
    const neighborCount = 5;
    const centerIndex = sample.particleIndex;
    
    for (let offset = -neighborCount; offset <= neighborCount; offset++) {
      const particleIndex = (centerIndex + offset + this.particles.length) % this.particles.length;
      const falloff = Math.cos((Math.PI * offset) / (neighborCount + 1));
      if (falloff <= 0) continue;
      
      const weightedImpulse = impulse.clone().scale(falloff);
      if (weightedImpulse.length() > 300) {
        weightedImpulse.normalize().scale(300);
      }
      
      if (!this.pendingForces.has(particleIndex)) {
        this.pendingForces.set(particleIndex, new Phaser.Math.Vector2());
      }
      this.pendingForces.get(particleIndex)!.add(weightedImpulse);
    }
    
    return {
      collided: true,
      contactPoint: sample.pos,
      normal: normal
    };
  }

  /**
   * Apply impulse at a specific point on the membrane
   */
  @RunOnServer()
  public applyImpulseAt(cellLocalPoint: Phaser.Math.Vector2, impulse: Phaser.Math.Vector2): void {
    // Reconstruct Vector2 objects since they get serialized as plain objects over network
    const localPoint = new Phaser.Math.Vector2(cellLocalPoint.x, cellLocalPoint.y);
    const impulseVec = new Phaser.Math.Vector2(impulse.x, impulse.y);
    
    this.updateCenter();
    const rel = localPoint.clone().subtract(this.centerPosition);
    const dist = rel.length();
    
    if (dist < 0.001) return;
    
    const angle = Math.atan2(rel.y, rel.x);
    
    // Find nearest particles around this angle
    let closestIndex = 0;
    let smallestAngleDiff = Infinity;
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const relativePos = particle.position.clone().subtract(this.centerPosition);
      const particleAngle = Math.atan2(relativePos.y, relativePos.x);
      
      let angleDiff = Math.abs(angle - particleAngle);
      if (angleDiff > Math.PI) {
        angleDiff = 2 * Math.PI - angleDiff;
      }
      
      if (angleDiff < smallestAngleDiff) {
        smallestAngleDiff = angleDiff;
        closestIndex = i;
      }
    }
    
    // Apply impulse to closest particle and neighbors (for local deformation)
    const particleIndices = [
      (closestIndex - 1 + this.particles.length) % this.particles.length,
      closestIndex,
      (closestIndex + 1) % this.particles.length
    ];
    
    const totalWeight = particleIndices.length;
    for (let i = 0; i < particleIndices.length; i++) {
      const particleIndex = particleIndices[i];
      const particle = this.particles[particleIndex];
      
      if (particle.invMass === 0) continue;
      
      const weight = (i === 1 ? 1.0 : 0.5) / totalWeight;
      const weightedImpulse = impulseVec.clone().scale(weight);
      
      particle.velocity.add(weightedImpulse.scale(particle.invMass));
      
      // Track for adaptive compliance
      if (impulseVec.length() > 50) {
        this.recentImpacts.set(particleIndex, this.membraneParameters.impactSofteningFrames);
      }
      
      // Clamp velocity
      const speed = particle.velocity.length();
      if (speed > 300) {
        particle.velocity.normalize().scale(300);
      }
    }
  }

  /**
   * Get nearest surface sample for collision detection
   */
  public getNearestSurfaceSample(point: Phaser.Math.Vector2): { 
    pos: Phaser.Math.Vector2; 
    normal: Phaser.Math.Vector2; 
    tension: number; 
    particleIndex: number 
  } {
    let closestDistance = Infinity;
    let closestPos = new Phaser.Math.Vector2();
    let closestNormal = new Phaser.Math.Vector2();
    let closestTension = 1.0;
    let closestParticleIndex = 0;

    // Find closest edge segment
    for (let i = 0; i < this.particles.length; i++) {
      const j = (i + 1) % this.particles.length;
      const p1 = this.particles[i].position;
      const p2 = this.particles[j].position;

      const edge = p2.clone().subtract(p1);
      const edgeLength = edge.length();
      
      if (edgeLength < 0.001) continue;
      
      const toPoint = point.clone().subtract(p1);
      const edgeDir = edge.clone().normalize();
      const projLength = toPoint.dot(edgeDir);
      
      const t = Math.max(0, Math.min(1, projLength / edgeLength));
      const closestOnEdge = p1.clone().add(edgeDir.scale(t * edgeLength));
      
      const distance = point.distance(closestOnEdge);
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPos = closestOnEdge;
        
        // Calculate outward normal
        const edgeNormal = new Phaser.Math.Vector2(-edgeDir.y, edgeDir.x);
        this.updateCenter();
        const toCenter = this.centerPosition.clone().subtract(closestOnEdge);
        if (edgeNormal.dot(toCenter) > 0) {
          edgeNormal.scale(-1);
        }
        closestNormal = edgeNormal.normalize();
        
        // Calculate tension from edge stretch
        const currentLength = edgeLength;
        const restLength = this.restEdge[i];
        const stretch = restLength > 0 ? currentLength / restLength : 1.0;
        closestTension = Math.max(0.8, Math.min(1.2, stretch));
        
        const distToP1 = point.distance(p1);
        const distToP2 = point.distance(p2);
        closestParticleIndex = distToP1 <= distToP2 ? i : j;
      }
    }

    return {
      pos: closestPos,
      normal: closestNormal,
      tension: closestTension,
      particleIndex: closestParticleIndex
    };
  }

  // === VESICLE COLLISION DETECTION ===

  /**
   * Check collision between vesicle and membrane using SDF
   */
  public checkVesicleCollision(vesicleCenter: Phaser.Math.Vector2, vesicleRadius: number): {
    colliding: boolean;
    signedDistance: number;
    contactPoint: Phaser.Math.Vector2;
    normal: Phaser.Math.Vector2;
    particleIndex: number;
  } {
    const sample = this.getNearestSurfaceSample(vesicleCenter);
    const distance = vesicleCenter.distance(sample.pos);
    const signedDistance = distance - vesicleRadius;
    
    return {
      colliding: signedDistance <= 0,
      signedDistance,
      contactPoint: sample.pos,
      normal: sample.normal,
      particleIndex: sample.particleIndex
    };
  }

  /**
   * Resolve vesicle-membrane collision with proper XPBD response
   */
  public resolveVesicleCollision(
    vesicleCenter: Phaser.Math.Vector2,
    vesicleRadius: number,
    vesicleVelocity: Phaser.Math.Vector2,
    vesicleInvMass: number,
    restitution: number = 0.4,
    friction: number = 0.1
  ): {
    newVesiclePosition: Phaser.Math.Vector2;
    newVesicleVelocity: Phaser.Math.Vector2;
    membraneImpulse: Phaser.Math.Vector2;
    contactPoint: Phaser.Math.Vector2;
  } {
    const collision = this.checkVesicleCollision(vesicleCenter, vesicleRadius);
    
    if (!collision.colliding) {
      return {
        newVesiclePosition: vesicleCenter.clone(),
        newVesicleVelocity: vesicleVelocity.clone(),
        membraneImpulse: new Phaser.Math.Vector2(0, 0),
        contactPoint: collision.contactPoint
      };
    }
    
    const normal = collision.normal;
    const penetration = -collision.signedDistance;
    
    // Position correction - move vesicle out of membrane (with safety limits)
    const maxCorrectionDistance = vesicleRadius * 2; // Limit correction to reasonable amount
    const correctionDistance = Math.min(penetration + 2, maxCorrectionDistance); // Small margin, but clamped
    const positionCorrection = normal.clone().scale(correctionDistance);
    const newPosition = vesicleCenter.clone().add(positionCorrection);
    
    // Velocity correction - bounce with restitution
    const relativeVelocity = vesicleVelocity.clone();
    const velocityAlongNormal = relativeVelocity.dot(normal);
    
    let newVelocity = vesicleVelocity.clone();
    if (velocityAlongNormal < 0) { // Moving into membrane
      // Normal component with restitution (reduced for stability)
      const normalCorrection = normal.clone().scale(-(1 + restitution * 0.5) * velocityAlongNormal);
      newVelocity.add(normalCorrection);
      
      // Tangential friction
      const tangent = new Phaser.Math.Vector2(-normal.y, normal.x);
      const velocityAlongTangent = relativeVelocity.dot(tangent);
      const frictionCorrection = tangent.clone().scale(-friction * velocityAlongTangent);
      newVelocity.add(frictionCorrection);
    }
    
    // Clamp velocity to prevent excessive speeds
    const maxVelocity = 100; // Reasonable max velocity
    if (newVelocity.length() > maxVelocity) {
      newVelocity.normalize().scale(maxVelocity);
    }
    
    // Calculate impulse to apply to membrane
    const velocityChange = newVelocity.clone().subtract(vesicleVelocity);
    const impulseStrength = velocityChange.length() * (vesicleInvMass > 0 ? 1.0 / vesicleInvMass : 1.0);
    const membraneImpulse = normal.clone().scale(-impulseStrength * 0.5); // Reduced for stability
    
    return {
      newVesiclePosition: newPosition,
      newVesicleVelocity: newVelocity,
      membraneImpulse,
      contactPoint: collision.contactPoint
    };
  }

  /**
   * Apply impulse from vesicle collision to membrane
   */
  public applyVesicleImpulse(
    impulse: Phaser.Math.Vector2,
    particleIndex: number
  ): void {
    if (impulse.length() < 0.1) return; // Too small to matter
    
    // Distribute impulse to neighboring particles
    const neighborCount = 3;
    const maxImpulse = 100; // Clamp for stability
    
    for (let offset = -neighborCount; offset <= neighborCount; offset++) {
      const targetIndex = (particleIndex + offset + this.particles.length) % this.particles.length;
      const particle = this.particles[targetIndex];
      
      if (particle.invMass === 0) continue; // Skip static particles
      
      // Calculate falloff based on distance from center
      const falloff = Math.cos((Math.PI * offset) / (neighborCount + 1));
      if (falloff <= 0) continue;
      
      const weightedImpulse = impulse.clone().scale(falloff);
      
      // Clamp impulse magnitude
      if (weightedImpulse.length() > maxImpulse) {
        weightedImpulse.normalize().scale(maxImpulse);
      }
      
      // Add to pending forces for next physics step
      if (!this.pendingForces.has(targetIndex)) {
        this.pendingForces.set(targetIndex, new Phaser.Math.Vector2());
      }
      this.pendingForces.get(targetIndex)!.add(weightedImpulse);
      
      // Track impact for adaptive compliance
      if (impulse.length() > 20) {
        this.recentImpacts.set(targetIndex, this.membraneParameters.impactSofteningFrames);
      }
    }
  }

  /**
   * Get signed distance from point to membrane surface (negative = inside)
   */
  public getSignedDistanceToSurface(point: Phaser.Math.Vector2): number {
    const sample = this.getNearestSurfaceSample(point);
    const distance = point.distance(sample.pos);
    
    // Determine if point is inside or outside membrane
    this.updateCenter();
    const toCenter = this.centerPosition.clone().subtract(point);
    
    // If point is on same side as center relative to surface, it's inside
    const isInside = toCenter.dot(sample.normal) < 0;
    
    return isInside ? -distance : distance;
  }

  /**
   * Calculate adhesion force between vesicle and membrane
   */
  public calculateVesicleAdhesionForce(
    vesicleCenter: Phaser.Math.Vector2,
    vesicleRadius: number,
    adhesionStrength: number = 50,
    adhesionRange: number = 30
  ): {
    force: Phaser.Math.Vector2;
    adhesionDistance: number;
    isAdhering: boolean;
  } {
    const sample = this.getNearestSurfaceSample(vesicleCenter);
    const distance = vesicleCenter.distance(sample.pos);
    const adhesionDistance = distance - vesicleRadius;
    
    // No adhesion if too far away
    if (adhesionDistance > adhesionRange) {
      return {
        force: new Phaser.Math.Vector2(0, 0),
        adhesionDistance,
        isAdhering: false
      };
    }
    
    // Calculate adhesion force strength (stronger when closer)
    const normalizedDistance = Math.max(0, adhesionDistance / adhesionRange);
    const forceStrength = adhesionStrength * (1 - normalizedDistance) * (1 - normalizedDistance);
    
    // Force direction: toward membrane surface
    const forceDirection = sample.pos.clone().subtract(vesicleCenter).normalize();
    const adhesionForce = forceDirection.scale(forceStrength);
    
    return {
      force: adhesionForce,
      adhesionDistance,
      isAdhering: adhesionDistance <= adhesionRange * 0.8
    };
  }

  /**
   * Calculate curvature-based adhesion modifier
   */
  public calculateCurvatureAdhesion(
    vesicleCenter: Phaser.Math.Vector2,
    vesiclePreferredCurvature: number = 0.1
  ): number {
    const sample = this.getNearestSurfaceSample(vesicleCenter);
    const particleIndex = sample.particleIndex;
    
    // Get neighboring particles for curvature calculation
    const prevIndex = (particleIndex - 1 + this.particles.length) % this.particles.length;
    const nextIndex = (particleIndex + 1) % this.particles.length;
    
    const prevPos = this.particles[prevIndex].position;
    const currPos = this.particles[particleIndex].position;
    const nextPos = this.particles[nextIndex].position;
    
    // Calculate local curvature using three points
    const v1 = currPos.clone().subtract(prevPos);
    const v2 = nextPos.clone().subtract(currPos);
    
    if (v1.length() < 0.001 || v2.length() < 0.001) {
      return 1.0; // Default multiplier
    }
    
    v1.normalize();
    v2.normalize();
    
    // Curvature is related to the angle change
    const dotProduct = Math.max(-1, Math.min(1, v1.dot(v2)));
    const angleChange = Math.acos(dotProduct);
    const curvature = angleChange / (v1.length() + v2.length() + 1);
    
    // Calculate preference match (vesicles prefer certain curvature ranges)
    const curvatureDiff = Math.abs(curvature - vesiclePreferredCurvature);
    const maxDiff = 0.5; // Maximum meaningful curvature difference
    const preferenceMatch = Math.max(0, 1 - (curvatureDiff / maxDiff));
    
    // Return multiplier (1.0 = normal adhesion, higher = stronger attraction)
    return 1.0 + preferenceMatch * 2.0; // Up to 3x stronger adhesion for preferred curvature
  }

  /**
   * Apply vesicle adhesion forces to both vesicle and membrane
   */
  public applyVesicleAdhesion(
    vesicleCenter: Phaser.Math.Vector2,
    vesicleRadius: number,
    adhesionStrength: number,
    vesiclePreferredCurvature: number = 0.1
  ): {
    vesicleForce: Phaser.Math.Vector2;
    membraneForce: Phaser.Math.Vector2;
    particleIndex: number;
    adhesionDistance: number;
  } {
    // Calculate base adhesion
    const adhesionResult = this.calculateVesicleAdhesionForce(
      vesicleCenter, 
      vesicleRadius, 
      adhesionStrength
    );
    
    if (!adhesionResult.isAdhering) {
      return {
        vesicleForce: new Phaser.Math.Vector2(0, 0),
        membraneForce: new Phaser.Math.Vector2(0, 0),
        particleIndex: -1,
        adhesionDistance: adhesionResult.adhesionDistance
      };
    }
    
    // Apply curvature modifier
    const curvatureMultiplier = this.calculateCurvatureAdhesion(
      vesicleCenter,
      vesiclePreferredCurvature
    );
    
    const vesicleForce = adhesionResult.force.clone().scale(curvatureMultiplier);
    const membraneForce = vesicleForce.clone().scale(-0.5); // Weaker reaction force
    
    const sample = this.getNearestSurfaceSample(vesicleCenter);
    
    return {
      vesicleForce,
      membraneForce,
      particleIndex: sample.particleIndex,
      adhesionDistance: adhesionResult.adhesionDistance
    };
  }

  /**
   * Calculate membrane curvature at a specific particle
   */
  public calculateMembranceCurvature(particleIndex: number): number {
    if (particleIndex < 0 || particleIndex >= this.particles.length) {
      return 0;
    }
    
    // Get neighboring particles for curvature calculation
    const prevIndex = (particleIndex - 1 + this.particles.length) % this.particles.length;
    const nextIndex = (particleIndex + 1) % this.particles.length;
    
    const prevPos = this.particles[prevIndex].position;
    const currPos = this.particles[particleIndex].position;
    const nextPos = this.particles[nextIndex].position;
    
    // Calculate local curvature using three points
    const v1 = currPos.clone().subtract(prevPos);
    const v2 = nextPos.clone().subtract(currPos);
    
    if (v1.length() < 0.001 || v2.length() < 0.001) {
      return 0; // No curvature if segments too short
    }
    
    v1.normalize();
    v2.normalize();
    
    // Curvature is related to the angle change
    const dotProduct = Math.max(-1, Math.min(1, v1.dot(v2)));
    const angleChange = Math.acos(dotProduct);
    
    // Normalize by segment lengths
    const avgSegmentLength = (v1.length() + v2.length()) * 0.5 + 1;
    return angleChange / avgSegmentLength;
  }

  /**
   * Get all membrane curvatures for vesicle attraction calculations
   */
  public getAllMembraneCurvatures(): number[] {
    const curvatures: number[] = [];
    for (let i = 0; i < this.particles.length; i++) {
      curvatures.push(this.calculateMembranceCurvature(i));
    }
    return curvatures;
  }

  /**
   * Find high-curvature regions on membrane
   */
  public findHighCurvatureRegions(curvatureThreshold: number = 0.3): Array<{
    particleIndex: number;
    position: Phaser.Math.Vector2;
    curvature: number;
  }> {
    const highCurvatureRegions: Array<{
      particleIndex: number;
      position: Phaser.Math.Vector2;
      curvature: number;
    }> = [];
    
    for (let i = 0; i < this.particles.length; i++) {
      const curvature = this.calculateMembranceCurvature(i);
      if (curvature > curvatureThreshold) {
        highCurvatureRegions.push({
          particleIndex: i,
          position: this.particles[i].position.clone(),
          curvature
        });
      }
    }
    
    return highCurvatureRegions;
  }

  /**
   * Check if vesicle should trigger endocytosis process
   */
  public shouldTriggerEndocytosis(
    vesicleCenter: Phaser.Math.Vector2,
    vesicleRadius: number,
    adhesionStrength: number,
    endocytosisThreshold: number = 0.8
  ): boolean {
    const adhesionResult = this.calculateVesicleAdhesionForce(vesicleCenter, vesicleRadius, adhesionStrength);
    const curvatureMultiplier = this.calculateCurvatureAdhesion(vesicleCenter);
    
    // Endocytosis threshold based on adhesion strength and membrane curvature
    const effectiveAdhesion = (adhesionResult.force.length() / adhesionStrength) * curvatureMultiplier;
    
    return effectiveAdhesion > endocytosisThreshold && adhesionResult.isAdhering;
  }

  /**
   * Create membrane invagination for endocytosis
   */
  public createEndocytosisInvagination(
    vesicleCenter: Phaser.Math.Vector2,
    vesicleRadius: number,
    invaginationDepth: number = 0.3
  ): {
    success: boolean;
    affectedParticles: number[];
    invaginationCenter: Phaser.Math.Vector2;
  } {
    const sample = this.getNearestSurfaceSample(vesicleCenter);
    const centerParticleIndex = sample.particleIndex;
    
    // Determine how many particles to affect based on vesicle size
    const particleCount = Math.max(3, Math.min(7, Math.ceil(vesicleRadius / 15)));
    const halfCount = Math.floor(particleCount / 2);
    
    const affectedParticles: number[] = [];
    for (let offset = -halfCount; offset <= halfCount; offset++) {
      const index = (centerParticleIndex + offset + this.particles.length) % this.particles.length;
      affectedParticles.push(index);
    }
    
    // Calculate invagination direction (toward cell center)
    this.updateCenter();
    const toCenterDir = this.centerPosition.clone().subtract(sample.pos).normalize();
    
    // Apply invagination forces to create pocket
    for (let i = 0; i < affectedParticles.length; i++) {
      const particleIndex = affectedParticles[i];
      const particle = this.particles[particleIndex];
      
      if (particle.invMass === 0) continue; // Skip static particles
      
      // Calculate force based on distance from center of invagination
      const distanceFromCenter = Math.abs(i - halfCount);
      const maxDistance = halfCount;
      const falloff = maxDistance > 0 ? 1 - (distanceFromCenter / maxDistance) : 1;
      
      // Apply inward force to create pocket
      const invaginationForce = toCenterDir.clone().scale(invaginationDepth * falloff * 20);
      
      // Add to pending forces
      if (!this.pendingForces.has(particleIndex)) {
        this.pendingForces.set(particleIndex, new Phaser.Math.Vector2());
      }
      this.pendingForces.get(particleIndex)!.add(invaginationForce);
    }
    
    return {
      success: true,
      affectedParticles,
      invaginationCenter: sample.pos
    };
  }

  /**
   * Progress endocytosis process over time with multi-point pocket formation
   * Enhanced with adhesion bond density guidance
   */
  public progressEndocytosis(
    vesicleCenter: Phaser.Math.Vector2,
    vesicleRadius: number,
    endocytosisProgress: number,
    deltaTime: number,
    progressRate: number = 0.5,
    bondDensityMap?: Map<number, number>
  ): {
    newProgress: number;
    membraneForces: Map<number, Phaser.Math.Vector2>;
    isComplete: boolean;
  } {
    const sample = this.getNearestSurfaceSample(vesicleCenter);
    const centerParticleIndex = sample.particleIndex;
    
    // Calculate average bond density in the endocytosis region to modulate progress rate
    let averageBondDensity = 0;
    let bondCount = 0;
    const checkRadius = Math.max(vesicleRadius, 25);
    
    if (bondDensityMap && bondDensityMap.size > 0) {
      const particleCount = Math.max(5, Math.min(12, Math.ceil(checkRadius / 10)));
      const halfCount = Math.floor(particleCount / 2);
      
      for (let offset = -halfCount; offset <= halfCount; offset++) {
        const index = (centerParticleIndex + offset + this.particles.length) % this.particles.length;
        const density = bondDensityMap.get(index) || 0;
        averageBondDensity += density;
        bondCount++;
      }
      
      if (bondCount > 0) {
        averageBondDensity /= bondCount;
      }
    }
    
    // Modulate progress rate based on bond density - more bonds = faster endocytosis
    const bondProgressMultiplier = 1 + (averageBondDensity * 0.6); // Up to 60% faster with high bond density
    const effectiveProgressRate = progressRate * bondProgressMultiplier;
    
    // Update progress
    const newProgress = Math.min(1, endocytosisProgress + effectiveProgressRate * deltaTime);
    const isComplete = newProgress >= 1;
    
    // Log bond-guided endocytosis progress
    if (bondDensityMap && bondDensityMap.size > 0 && Math.random() < 0.01) { // Log 1% of frames
      console.log(`🔗 Bond-guided endocytosis: progress=${newProgress.toFixed(2)}, avgBondDensity=${averageBondDensity.toFixed(2)}, speedup=${bondProgressMultiplier.toFixed(2)}x`);
    }
    
    // Enhanced multi-point pocket formation
    const pocketRadius = Math.max(vesicleRadius * 1.2, 30); // Larger affected area
    const particleCount = Math.max(5, Math.min(12, Math.ceil(pocketRadius / 10))); // More particles
    const halfCount = Math.floor(particleCount / 2);
    
    const membraneForces = new Map<number, Phaser.Math.Vector2>();
    
    this.updateCenter();
    
    for (let offset = -halfCount; offset <= halfCount; offset++) {
      const index = (centerParticleIndex + offset + this.particles.length) % this.particles.length;
      const particle = this.particles[index];
      
      if (particle.invMass === 0) continue;
      
      // Get bond density for this particle (higher density = stronger endocytosis)
      const bondDensity = bondDensityMap?.get(index) || 0;
      const bondMultiplier = 1 + (bondDensity * 0.8); // Up to 80% stronger with high bond density
      
      // Enhanced multi-point pocket formation
      const distanceFromCenter = Math.abs(offset);
      const maxDistance = halfCount;
      const falloff = maxDistance > 0 ? 1 - (distanceFromCenter / maxDistance) : 1;
      
      // Create a more sophisticated pocket shape
      // Phase 1: Initial invagination (0-0.4)
      // Phase 2: Pocket deepening (0.4-0.7) 
      // Phase 3: Neck formation (0.7-1.0)
      
      let pocketForce = new Phaser.Math.Vector2(0, 0);
      
      if (newProgress <= 0.4) {
        // Phase 1: Pull inward toward cell center to start invagination
        const inwardDir = this.centerPosition.clone().subtract(particle.position).normalize();
        const invaginationStrength = newProgress * 2.5; // 0 to 1 over first 40%
        pocketForce = inwardDir.scale(invaginationStrength * falloff * bondMultiplier * 20);
        
      } else if (newProgress <= 0.7) {
        // Phase 2: Pull toward vesicle to deepen pocket - enhanced by bond density
        const toVesicle = vesicleCenter.clone().subtract(particle.position).normalize();
        const deepeningProgress = (newProgress - 0.4) / 0.3; // 0 to 1 over 30%
        pocketForce = toVesicle.scale(deepeningProgress * falloff * bondMultiplier * 25);
        
      } else {
        // Phase 3: Neck formation - bond density guides neck constriction
        const isCenter = offset === 0;
        if (!isCenter) {
          // Side particles pull toward center particle to form neck
          // Higher bond density on sides creates tighter neck formation
          const centerParticle = this.particles[centerParticleIndex];
          const toCenter = centerParticle.position.clone().subtract(particle.position).normalize();
          const neckProgress = (newProgress - 0.7) / 0.3; // 0 to 1 over final 30%
          
          // Bond density makes neck formation more aggressive
          const neckStrength = bondMultiplier > 1.5 ? 1.5 : bondMultiplier; // Cap neck enhancement
          pocketForce = toCenter.scale(neckProgress * falloff * neckStrength * 35);
        } else {
          // Center particle continues toward vesicle - bond density guides depth
          const toVesicle = vesicleCenter.clone().subtract(particle.position).normalize();
          pocketForce = toVesicle.scale(newProgress * bondMultiplier * 20);
        }
      }
      
      membraneForces.set(index, pocketForce);
    }
    
    return {
      newProgress,
      membraneForces,
      isComplete
    };
  }

  /**
   * Apply endocytosis forces to membrane particles
   */
  public applyEndocytosisForces(forces: Map<number, Phaser.Math.Vector2>): void {
    for (const [particleIndex, force] of forces) {
      if (!this.pendingForces.has(particleIndex)) {
        this.pendingForces.set(particleIndex, new Phaser.Math.Vector2());
      }
      this.pendingForces.get(particleIndex)!.add(force);
    }
  }

  /**
   * Complete endocytosis process - vesicle is fully internalized
   * Enhanced with membrane pinch-off simulation
   */
  public completeEndocytosis(
    vesicleCenter: Phaser.Math.Vector2,
    vesicleRadius: number
  ): {
    internalizedPosition: Phaser.Math.Vector2;
    restorationForces: Map<number, Phaser.Math.Vector2>;
    pinchOffForces: Map<number, Phaser.Math.Vector2>;
  } {
    // Calculate position inside cell where vesicle will end up
    this.updateCenter();
    const directionToCenter = this.centerPosition.clone().subtract(vesicleCenter).normalize();
    const internalDistance = vesicleRadius * 3; // Move vesicle further inside
    const internalizedPosition = vesicleCenter.clone().add(directionToCenter.scale(internalDistance));
    
    // Generate restoration forces to return membrane to normal shape
    const sample = this.getNearestSurfaceSample(vesicleCenter);
    const centerParticleIndex = sample.particleIndex;
    
    const particleCount = Math.max(5, Math.min(9, Math.ceil(vesicleRadius / 12))); // More particles for pinch-off
    const halfCount = Math.floor(particleCount / 2);
    
    const restorationForces = new Map<number, Phaser.Math.Vector2>();
    const pinchOffForces = new Map<number, Phaser.Math.Vector2>();
    
    for (let offset = -halfCount; offset <= halfCount; offset++) {
      const index = (centerParticleIndex + offset + this.particles.length) % this.particles.length;
      const particle = this.particles[index];
      
      if (particle.invMass === 0) continue;
      
      // Calculate restoration force to return to normal membrane shape
      const distanceFromCenter = Math.abs(offset);
      const maxDistance = halfCount;
      const falloff = maxDistance > 0 ? 1 - (distanceFromCenter / maxDistance) : 1;
      
      // Force pointing outward from cell center to restore normal curvature
      const outwardDir = particle.position.clone().subtract(this.centerPosition).normalize();
      const restorationForce = outwardDir.scale(falloff * 40);
      
      restorationForces.set(index, restorationForce);
      
      // Additional pinch-off forces - side particles come together to seal membrane
      if (distanceFromCenter > 0 && distanceFromCenter <= 2) { // Side particles near the center
        const centerParticle = this.particles[centerParticleIndex];
        const toCenter = centerParticle.position.clone().subtract(particle.position).normalize();
        const pinchForce = toCenter.scale((3 - distanceFromCenter) * 25); // Stronger for closer particles
        
        pinchOffForces.set(index, pinchForce);
      }
    }
    
    return {
      internalizedPosition,
      restorationForces,
      pinchOffForces
    };
  }

  // === CENTER TRACKING ===

  public getCenter(): Phaser.Math.Vector2 {
    return this.centerPosition.clone();
  }
  
  public setCenterAnchor(anchor: Phaser.Math.Vector2 | null, compliance = 1e-3) {
    this.centerAnchor = anchor ? anchor.clone() : null;
    this.membraneParameters.centerAnchorCompliance = compliance;
  }
  
  private updateCenter() {
    let totalMass = 0;
    this.centerPosition.set(0, 0);
    
    for (const particle of this.particles) {
      if (particle.invMass > 0) {
        const mass = 1 / particle.invMass;
        this.centerPosition.add(particle.position.clone().scale(mass));
        totalMass += mass;
      }
    }
    
    if (totalMass > 0) {
      this.centerPosition.scale(1 / totalMass);
    }
  }
  
  private solveCenterAnchor() {
    if (!this.centerAnchor) return;
    
    const dt2 = this._dt * this._dt;
    const EPS = 1e-6;
    
    const delta = this.centerAnchor.clone().subtract(this.centerPosition);
    const dist = delta.length();
    if (dist < EPS) return;
    
    const dir = delta.scale(1 / dist);
    
    let totalInvMass = 0;
    for (const particle of this.particles) {
      if (!particle.isFrozen && particle.invMass > 0) {
        totalInvMass += particle.invMass;
      }
    }
    
    if (totalInvMass <= EPS) return;
    
    const denom = totalInvMass + this.membraneParameters.centerAnchorCompliance / dt2;
    const dLambda = -dist / denom;
    
    const correction = dir.scale(dLambda);
    for (const particle of this.particles) {
      if (!particle.isFrozen && particle.invMass > 0) {
        particle.position.add(correction.clone().scale(particle.invMass));
      }
    }
  }

  // === UTILITY METHODS ===

  public getParticleCount(): number {
    return this.particles.length;
  }

  public getParticlePositions(): Phaser.Math.Vector2[] {
    return this.particles.map(p => p.position.clone());
  }

  /**
   * Get particles for endocytosis system (proper getter)
   */
  public getParticles() {
    return this.particles;
  }

  /**
   * Apply active Brownian motion to membrane particles
   */
  private applyMembraneBrownianMotion(deltaTime: number): void {
    if (this.membraneParameters.membraneNoise <= 0 && this.membraneParameters.membraneActiveForce <= 0) return;
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      if (particle.isFrozen || particle.invMass === 0) continue;
      
      // Thermal noise
      if (this.membraneParameters.membraneNoise > 0) {
        const thermalForce = new Phaser.Math.Vector2(
          (Math.random() - 0.5) * 2,  // -1 to 1
          (Math.random() - 0.5) * 2   // -1 to 1
        ).scale(this.membraneParameters.membraneNoise * Math.sqrt(deltaTime));
        
        // Apply force through pending forces system
        if (!this.pendingForces.has(i)) {
          this.pendingForces.set(i, new Phaser.Math.Vector2());
        }
        this.pendingForces.get(i)!.add(thermalForce);
      }
      
      // Active membrane forces (optional - for future actin-like protrusions)
      if (this.membraneParameters.membraneActiveForce > 0) {
        // Calculate outward normal from center
        const toCenter = this.centerPosition.clone().subtract(particle.position);
        const outwardNormal = toCenter.normalize().scale(-1); // Point outward
        
        const activeForce = outwardNormal.scale(this.membraneParameters.membraneActiveForce);
        
        if (!this.pendingForces.has(i)) {
          this.pendingForces.set(i, new Phaser.Math.Vector2());
        }
        this.pendingForces.get(i)!.add(activeForce);
      }
    }
  }

  /**
   * Apply force to a specific particle by index
   */
  public applyForceToParticle(particleIndex: number, force: Phaser.Math.Vector2) {
    if (!this.pendingForces.has(particleIndex)) {
      this.pendingForces.set(particleIndex, new Phaser.Math.Vector2());
    }
    this.pendingForces.get(particleIndex)!.add(force);
  }

  /**
   * Find nearest point on the membrane to a given position
   */
  public findNearestPoint(position: Phaser.Math.Vector2): Phaser.Math.Vector2 | null {
    const sample = this.getNearestSurfaceSample(position);
    return sample.pos;
  }

  /**
   * Find particles within a radius of a given position
   */
  public findParticlesInRadius(position: Phaser.Math.Vector2, radius: number): number[] {
    const result: number[] = [];
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const distance = particle.position.distance(position);
      if (distance <= radius) {
        result.push(i);
      }
    }
    
    console.log(`🧬 MembranePhysics: Found ${result.length} particles within ${radius}px of (${position.x.toFixed(1)}, ${position.y.toFixed(1)})`);
    return result;
  }

  /**
   * Get membrane radius at a specific angle (compatibility method)
   */
  public getMembraneRadiusAt(angle: number): number {
    this.updateCenter();
    
    // Find the particle closest to the specified angle
    let closestParticle = 0;
    let smallestAngleDiff = Infinity;
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const relativePos = particle.position.clone().subtract(this.centerPosition);
      const particleAngle = Math.atan2(relativePos.y, relativePos.x);
      
      let angleDiff = Math.abs(angle - particleAngle);
      if (angleDiff > Math.PI) {
        angleDiff = 2 * Math.PI - angleDiff;
      }
      
      if (angleDiff < smallestAngleDiff) {
        smallestAngleDiff = angleDiff;
        closestParticle = i;
      }
    }
    
    const particle = this.particles[closestParticle];
    return particle.position.distance(this.centerPosition);
  }

  /**
   * Get approximate membrane radius (average distance from center)
   */
  public getApproximateRadius(): number {
    this.updateCenter();
    let avgRadius = 0;
    for (const particle of this.particles) {
      avgRadius += particle.position.distance(this.centerPosition);
    }
    return avgRadius / this.particles.length;
  }


  /**
   * Apply impact force (compatibility method for endocytosis)
   */
  public applyImpact(contactPoint: Phaser.Math.Vector2, force: number, explicitDirection: Phaser.Math.Vector2 | null) {
    // Convert force to impulse and apply
    const dampedForce = force * 0.05;
    const impulseMag = Math.min(dampedForce * this.membraneParameters.impactImpulseScale, 600);
    
    const impulseDirection = explicitDirection ? 
      explicitDirection.clone().normalize() : 
      this.computeLocalNormalAtPoint(contactPoint);
    const impulse = impulseDirection.scale(impulseMag);
    
    this.applyImpulseAt(contactPoint, impulse);
  }

  /**
   * Set reset behavior (compatibility method)
   */
  public setAllowReset(allow: boolean) {
    // This was used to prevent membrane resets during testing
    // For now, just store the setting without implementing full reset logic
    console.log(`Membrane reset ${allow ? 'enabled' : 'disabled'}`);
  }

  /**
   * XPBD Endocytosis Support: Create localized membrane invagination
   * This creates a true inward pocket by pulling nodes toward cell center, not along surface
   */
  public createMembraneInvagination(centerPoint: Phaser.Math.Vector2, _direction: Phaser.Math.Vector2, 
                                   radius: number, depth: number): number[] {
    const affectedParticles: number[] = [];
    
    // Much smaller affected area for localized teardrop effect (now tunable!)
    const localRadius = Math.min(radius * 0.3, this.membraneParameters.endocytosisRadius); // Now uses tunable parameter!
    
    // Calculate cell center (assuming membrane is roughly circular)
    const cellCenter = new Phaser.Math.Vector2(0, 0); // Assume center at origin
    
    // Find only particles within the small local area
    const nodeDistances: Array<{index: number, distance: number}> = [];
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const distance = particle.position.distance(centerPoint);
      if (distance <= localRadius) { // Only consider particles within small radius
        nodeDistances.push({index: i, distance});
      }
    }
    
    // Sort by distance and take only closest 3 for very localized effect
    nodeDistances.sort((a, b) => a.distance - b.distance);
    const targetCount = Math.min(3, nodeDistances.length); // Only 3 nodes max
    
    for (let i = 0; i < targetCount; i++) {
      const nodeData = nodeDistances[i];
      const particle = this.particles[nodeData.index];
      affectedParticles.push(nodeData.index);
      
      // Calculate INWARD direction toward cell center (not along surface)
      const toCenter = cellCenter.clone().subtract(particle.position).normalize();
      
      // Create localized teardrop shape with quadratic falloff
      const distanceFactor = 1.0 - (nodeData.distance / localRadius);
      const complianceMultiplier = Math.pow(distanceFactor, 2); // Quadratic falloff for teardrop
      
      // Pull nodes INWARD to create true pocket (now using tunable parameters!)
      const inwardStrength = this.membraneParameters.endocytosisCompliance * complianceMultiplier; // Now tunable!
      const inwardDisplacement = toCenter.clone().scale(depth * inwardStrength);
      
      // Apply controlled inward displacement for true pocket formation (tunable scaling!)
      const currentDisplacement = inwardDisplacement.clone().scale(this.membraneParameters.endocytosisDepthScale); // Now tunable!
      particle.position.add(currentDisplacement);
      
      // Minimal velocity influence to prevent whole-cell movement
      const velocityInfluence = inwardDisplacement.clone().scale(0.02); // Minimal velocity change
      particle.velocity.add(velocityInfluence);
      
      // Only slightly reduce mass for the center node
      if (i === 0) { // Only the closest node gets slight mass reduction
        particle.invMass = Math.min(particle.invMass * 1.1, 1.2); // Very conservative
      }
    }
    
    return affectedParticles;
  }

  /**
   * XPBD Endocytosis Support: Apply neck compression forces for scission
   * This concentrates forces at the neck area to create the pinch-off effect
   */
  public compressMembraneNeck(neckCenter: Phaser.Math.Vector2, compressionRadius: number, 
                             compressionForce: number): void {
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const distance = particle.position.distance(neckCenter);
      
      if (distance <= compressionRadius) {
        // Apply inward compression force toward neck center
        const forceDirection = neckCenter.clone().subtract(particle.position).normalize();
        const falloff = 1 - (distance / compressionRadius);
        const force = forceDirection.scale(compressionForce * falloff);
        
        // Apply force through the pending forces system
        if (!this.pendingForces.has(i)) {
          this.pendingForces.set(i, new Phaser.Math.Vector2());
        }
        this.pendingForces.get(i)!.add(force);
      }
    }
  }

  /**
   * XPBD Endocytosis Support: Check if membrane neck is thin enough for scission
   * Returns the minimum neck diameter found in the specified region
   */
  public measureNeckDiameter(neckCenter: Phaser.Math.Vector2, searchRadius: number): number {
    const particlesInRegion: ConstraintParticle[] = [];
    
    // Find all particles in the neck region
    for (const particle of this.particles) {
      const distance = particle.position.distance(neckCenter);
      if (distance <= searchRadius) {
        particlesInRegion.push(particle);
      }
    }
    
    if (particlesInRegion.length < 2) return searchRadius * 2; // No neck formed yet
    
    // Find the minimum distance between particles (neck width)
    let minDistance = Infinity;
    for (let i = 0; i < particlesInRegion.length; i++) {
      for (let j = i + 1; j < particlesInRegion.length; j++) {
        const distance = particlesInRegion[i].position.distance(particlesInRegion[j].position);
        minDistance = Math.min(minDistance, distance);
      }
    }
    
    return minDistance;
  }

  /**
   * XPBD Endocytosis Support: Create vesicle after successful scission
   * This removes a section of membrane and creates an independent vesicle
   */
  public performMembraneScission(scissionCenter: Phaser.Math.Vector2, vesicleRadius: number): boolean {
    const particlesToRemove: number[] = [];
    
    // Find particles that will become part of the vesicle
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const distance = particle.position.distance(scissionCenter);
      
      if (distance <= vesicleRadius) {
        particlesToRemove.push(i);
      }
    }
    
    if (particlesToRemove.length < 3) {
      console.warn("🧬 Scission failed: insufficient particles for vesicle formation");
      return false;
    }
    
    // For now, just mark particles as frozen to simulate vesicle separation
    // In a full implementation, you'd create a separate vesicle object
    for (const index of particlesToRemove) {
      this.particles[index].isFrozen = true;
      this.particles[index].invMass = 0; // Make immovable
    }
    
    console.log(`🧬 Membrane scission performed: ${particlesToRemove.length} particles converted to vesicle`);
    return true;
  }

  private computeLocalNormalAtPoint(contactPoint: Phaser.Math.Vector2): Phaser.Math.Vector2 {
    // Find closest particles for normal interpolation
    let closest1 = 0, closest2 = 1;
    let dist1 = Infinity, dist2 = Infinity;
    
    for (let i = 0; i < this.particles.length; i++) {
      const dist = this.particles[i].position.distance(contactPoint);
      if (dist < dist1) {
        closest2 = closest1;
        dist2 = dist1;
        closest1 = i;
        dist1 = dist;
      } else if (dist < dist2) {
        closest2 = i;
        dist2 = dist;
      }
    }
    
    // Calculate outward normal based on edge direction
    const p1 = this.particles[closest1].position;
    const p2 = this.particles[closest2].position;
    const edge = p2.clone().subtract(p1);
    const edgeNormal = new Phaser.Math.Vector2(-edge.y, edge.x).normalize();
    
    // Ensure normal points outward from center
    this.updateCenter();
    const toCenter = this.centerPosition.clone().subtract(contactPoint);
    if (edgeNormal.dot(toCenter) > 0) {
      edgeNormal.scale(-1);
    }
    
    return edgeNormal;
  }

  // === RENDERING ===

  private render() {
    this.graphics.clear();
    
    // Draw membrane edges with compliance-based coloring
    for (let i = 0; i < this.particles.length; i++) {
      const j = (i + 1) % this.particles.length;
      const particleA = this.particles[i];
      const particleB = this.particles[j];
      
      // Calculate edge compliance (same logic as in physics loop)
      const edgeMidpoint = particleA.position.clone().add(particleB.position).scale(0.5);
      const membraneCenter = this.getCenter();
      const relativeY = edgeMidpoint.y - membraneCenter.y;
      
      let adaptiveAlpha = this.membraneParameters.alphaEdge;
      if (this.recentImpacts.has(i) || this.recentImpacts.has(j)) {
        adaptiveAlpha *= this.membraneParameters.impactSofteningFactor;
      }
      
      // Apply regional compliance (bottom half is softer)
      if (relativeY > 0) {
        adaptiveAlpha *= 200; // Same multiplier as physics
      }
      
      // Color based on compliance with extreme binary contrast for maximum visibility
      const baseCompliance = this.membraneParameters.alphaEdge;
      const isVeryCompliant = adaptiveAlpha > baseCompliance * 50; // 50x threshold for clear distinction
      
      // Pure binary colors for maximum contrast and responsiveness to tuning panel
      const edgeColor = isVeryCompliant ? 0xff0000 : 0x0000ff; // Pure red vs pure blue
      
      // Draw individual edge with compliance color
      this.graphics.lineStyle(3, edgeColor, 0.9); // Thicker lines for visibility
      this.graphics.beginPath();
      this.graphics.moveTo(particleA.position.x, particleA.position.y);
      this.graphics.lineTo(particleB.position.x, particleB.position.y);
      this.graphics.strokePath();
    }
    
    // Fill the membrane with a subtle transparent color
    this.graphics.lineStyle(0, 0x000000, 0); // No outline for fill
    this.graphics.fillStyle(0x00ff00, 0.05); // Very subtle green fill
    this.graphics.beginPath();
    const firstParticle = this.particles[0];
    this.graphics.moveTo(firstParticle.position.x, firstParticle.position.y);
    
    for (let i = 1; i < this.particles.length; i++) {
      const particle = this.particles[i];
      this.graphics.lineTo(particle.position.x, particle.position.y);
    }
    
    this.graphics.closePath();
    this.graphics.fillPath();
    
    // Draw center cross
    const center = this.centerPosition;
    this.graphics.lineStyle(2, 0xff0000, 0.9);
    const crossSize = 8;
    this.graphics.beginPath();
    this.graphics.moveTo(center.x - crossSize, center.y);
    this.graphics.lineTo(center.x + crossSize, center.y);
    this.graphics.moveTo(center.x, center.y - crossSize);
    this.graphics.lineTo(center.x, center.y + crossSize);
    this.graphics.strokePath();
    
    // Draw particles
    for (const particle of this.particles) {
      if (particle.isFrozen) {
        this.graphics.fillStyle(0xff0000, 0.8);
      } else {
        this.graphics.fillStyle(0x00ff00, 0.6);
      }
      this.graphics.fillCircle(particle.position.x, particle.position.y, particle.radius);
    }
  }

  // === MULTIPLE MEMBRANE MANAGEMENT ===
  
  /**
   * Register an additional membrane for collision detection
   */
  public registerAdditionalMembrane(membrane: MembranePhysicsSystem): void {
    if (!this.additionalMembranes.includes(membrane)) {
      this.additionalMembranes.push(membrane);
      console.log(`🧬 Registered additional membrane for collision detection`);
    }
  }
  
  /**
   * Unregister an additional membrane
   */
  public unregisterAdditionalMembrane(membrane: MembranePhysicsSystem): void {
    const index = this.additionalMembranes.indexOf(membrane);
    if (index !== -1) {
      this.additionalMembranes.splice(index, 1);
      console.log(`🧬 Unregistered additional membrane`);
    }
  }
  
  /**
   * Check collisions with all registered additional membranes
   * Returns the first collision found
   */
  public checkAdditionalMembraneCollisions(opts: {
    center: Phaser.Math.Vector2;
    radius: number;
    inOutVelocity: Phaser.Math.Vector2;
    restitution?: number;
    friction?: number;
    impulseScale?: number;
  }): { collided: boolean; contactPoint?: Phaser.Math.Vector2; normal?: Phaser.Math.Vector2; membrane?: MembranePhysicsSystem } {
    
    for (let i = 0; i < this.additionalMembranes.length; i++) {
      const membrane = this.additionalMembranes[i];
      
      const collision = membrane.collideCircleAndBounce(opts);
      if (collision.collided) {
        return {
          ...collision,
          membrane: membrane
        };
      }
    }
    
    return { collided: false };
  }
  
  /**
   * Check membrane-to-membrane collision (this is what we really need!)
   */
  @RunOnServer()
  public checkMembraneToMembraneCollisions(): { collided: boolean; contactPoint?: Phaser.Math.Vector2; normal?: Phaser.Math.Vector2; membrane?: MembranePhysicsSystem } {
    
    for (let i = 0; i < this.additionalMembranes.length; i++) {
      const otherMembrane = this.additionalMembranes[i];
      
      // Check if our membrane particles are colliding with the other membrane
      const thisCenter = this.getCenter();
      const otherCenter = otherMembrane.getCenter();
      const centerDistance = thisCenter.distance(otherCenter);
      
      // Quick distance check - if centers are too far apart, skip detailed check
      const thisRadius = this.getApproximateRadius();
      const otherRadius = otherMembrane.getApproximateRadius();
      const maxCollisionDistance = thisRadius + otherRadius + 50; // Small buffer
      
      if (centerDistance > maxCollisionDistance) {
        continue;
      }
      
      // Detailed check: see if any of our particles penetrate the other membrane
      for (let j = 0; j < this.particles.length; j++) {
        const particle = this.particles[j];
        const sample = otherMembrane.getNearestSurfaceSample(particle.position);
        const distanceToSurface = particle.position.distance(sample.pos);
        const penetration = particle.radius - distanceToSurface;
        
        // Only handle significant penetrations to avoid micro-collision oscillations
        if (penetration > 0.5) {  // Minimum threshold to avoid noise
          
          // Calculate separation direction: from contact point toward our particle (repelling)
          const separationDirection = particle.position.clone().subtract(sample.pos).normalize();
          
          // Much stronger separation force that scales with penetration depth
          const baseSeparationForce = 500; // Much stronger base force
          const penetrationScale = Math.min(penetration * 200, 1000); // Cap at 1000
          const separationMagnitude = baseSeparationForce + penetrationScale;
          const separationForce = separationDirection.scale(separationMagnitude);
          
          // Apply strong impulse to our particle to push it away decisively
          this.applyForceToParticle(j, separationForce);
          
          // Apply weaker counter-force to several particles on the other membrane
          const closestParticleIndex = otherMembrane.findClosestParticleIndex(sample.pos);
          if (closestParticleIndex !== -1) {
            const oppositeSeparationForce = separationForce.clone().scale(-0.3); // Weaker counter-force
            
            // Apply to closest particle and its neighbors for more stable separation
            for (let k = -2; k <= 2; k++) {
              const targetIndex = (closestParticleIndex + k + otherMembrane.particles.length) % otherMembrane.particles.length;
              const falloff = 1.0 - Math.abs(k) * 0.2; // Reduce force for farther neighbors
              const neighborForce = oppositeSeparationForce.clone().scale(falloff);
              otherMembrane.applyForceToParticle(targetIndex, neighborForce);
            }
          }
          
          return {
            collided: true,
            contactPoint: sample.pos.clone(),
            normal: separationDirection.clone(),
            membrane: otherMembrane
          };
        }
      }
    }
    
    return { collided: false };
  }
  
  /**
   * Find the closest particle to a given position
   */
  private findClosestParticleIndex(position: Phaser.Math.Vector2): number {
    let closestIndex = -1;
    let closestDistance = Infinity;
    
    for (let i = 0; i < this.particles.length; i++) {
      const distance = this.particles[i].position.distance(position);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }
    
    return closestIndex;
  }
  
  /**
   * Update all registered additional membranes
   */
  public updateAdditionalMembranes(deltaTime: number): void {
    for (const membrane of this.additionalMembranes) {
      membrane.update(deltaTime);
    }
  }

  public override destroy() {
    this.graphics.destroy();
  }
}
