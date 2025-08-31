/**
 * TODOs for Membrane XPBD refactor (squishy + reusable):
 * 1) Make particles the only source of truth. Derive nodes via getNodes() for legacy code.
 * 2) Keep particle-based getMembraneRadiusAt(angle) and remove node-based one.
 * 3) Implement XPBD loop:
 *    - predict xPred
 *    - apply external pendingForces into xPred (invM * F * dt^2)
 *    - solve stretch, bending, area with nonzero compliance (see constants below)
 *    - v = (xPred - x)/dt; x = xPred
 * 4) Add solvePins(h) and a pinParticles(indices, duration, softness) helper for "hold snap-back".
 * 5) In applyImpact: enlarge influenceRadius = max(40, 0.2 * currentRadius),
 *    gather neighbors with cosine falloff, compute local outward normal from neighbors when direction omitted.
 * 6) Guard against NaN / huge positions post-step; only run resetIfOverDeformed() when !isInPullHold.
 * 7) Expose setCompliance({stretch, bending, area}) so endocytosis can make local regions more/less squishy.
 *    Start with: stretch=0.003, bending=0.01, area=0.02; 6-10 iterations per substep, 4 substeps/frame.
 */

import Phaser from 'phaser';

/**
 * Membrane Physics System - Constraint-based membrane simulation
 * 
 * Implements a constraint-based membrane model with:
 * - Particle-based soft body dynamics
 * - Stretch constraints (edge preservation)
 * - Bending constraints (smoothness)
 * - Area constraints (incompressibility)
 * - Natural topology changes for endocytosis
 * - No radial bias - responds naturally to forces from any direction
 */

interface ConstraintParticle {
  // Current state
  position: Phaser.Math.Vector2;
  prevPosition: Phaser.Math.Vector2;
  velocity: Phaser.Math.Vector2;
  
  // XPBD predicted position for substep integration
  xPred: Phaser.Math.Vector2;
  
  // Properties
  invMass: number; // 1/mass, 0 = immovable (frozen)
  radius: number;  // For collision detection
  
  // Constraint solving
  deltaPosition: Phaser.Math.Vector2; // Accumulated position corrections
  
  // Metadata
  id: number;
  isFrozen: boolean;
}

interface StretchConstraint {
  particleA: number; // Particle indices
  particleB: number;
  restLength: number;
  compliance: number; // α - higher = softer (0 = rigid)
  lambda: number; // Lagrange multiplier for Constraint-based
}

interface BendingConstraint {
  particleA: number; // Three consecutive particles
  particleB: number; // Center particle
  particleC: number;
  restAngle: number;
  restDistance: number; // For simplified second-neighbor approach
  compliance: number;
  lambda: number;
}

interface AreaConstraint {
  restArea: number;
  compliance: number;
  lambda: number;
}

interface SoftPin { 
  index: number; 
  target: Phaser.Math.Vector2; 
  compliance: number; 
  lambda: number;
  // Timing system for gradual application
  remainingFrames?: number; // Optional: if set, pin will be removed after this many frames
  strengthRamp?: number; // Optional: 0-1 ramp-up factor for gradual application
}

// TODO: Implement collision constraints
// interface CollisionConstraint {
//   particleIndex: number;
//   contactPoint: Phaser.Math.Vector2;
//   contactNormal: Phaser.Math.Vector2;
//   penetration: number;
//   compliance: number;
// }

export class MembranePhysicsSystem {
  private particles: ConstraintParticle[] = [];
  private stretchConstraints: StretchConstraint[] = [];
  private bendingConstraints: BendingConstraint[] = [];
  private areaConstraint: AreaConstraint;
  private softPins: SoftPin[] = [];
  // private collisionConstraints: CollisionConstraint[] = []; // TODO: Implement collision constraints
  
  // Solver parameters for proper XPBD with squishiness
  private readonly constraintIterations = 8; // was 3 - more iterations for better convergence
  private _dt: number = 1/60; // current substep dt
  private readonly damping = 0.92; // was 0.95 - slightly less damping for more lively soft-body feel
  private readonly substeps = 4; // was 3 - 4 substeps/frame as recommended
  private readonly maxCorrectionPerIteration = 1.0; // Clamp position corrections to prevent teleporting
  
  // NEW: tuneable impulse scales (feel knobs) - increased for more responsiveness
  private readonly impactImpulseScale = 120; // was 80 - more squish on collision  
  private readonly pullImpulseScale = 100; // was 90 - stronger endocytosis pulling
  
  // Rendering
  private graphics: Phaser.GameObjects.Graphics;
  
  // XPBD Compliance values for squishy but stable membrane (user-recommended)
  private readonly stretchCompliance = 0.003; // stretch constraint compliance
  private readonly bendingCompliance = 0.01;  // bending constraint compliance  
  private readonly areaCompliance = 0.02;     // area constraint compliance (allows pinching)
  private initialRadius: number; // Store initial membrane radius
  
  // Rest values for clean XPBD solver
  private restEdge: number[] = []; // Rest edge lengths
  private restArea: number = 0; // Rest area
  
  // External impulse accumulation for better integration with constraint solving
  private pendingForces: Map<number, Phaser.Math.Vector2> = new Map(); // Actually impulses (px/s) now
  private allowReset: boolean = false; // default OFF during tuning
  private _spatialDirty: boolean = true; // Flag to rebuild spatial index after teleports
  
  // Center-of-mass tracking
  private centerPosition: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
  private centerAnchor: Phaser.Math.Vector2 | null = null;
  private centerAnchorCompliance: number = 2e-3; // was 1e-3 - softer center anchoring
  
  // Rest position snapshots for proper pull depth calculations
  private restPositions: Phaser.Math.Vector2[] = [];
  
  // Pin system for testing (hold particles for N seconds)
  private pins = new Map<number, {target: Phaser.Math.Vector2, compliance: number, t: number}>();
  
  /**
   * Rebuild spatial index if needed after position changes
   */
  private rebuildSpatialIndexIfNeeded(): void {
    if (this._spatialDirty) {
      // Currently no spatial index implemented - just reset the flag
      // TODO: Implement actual spatial index for collision optimization
      this._spatialDirty = false;
    }
  }
  
  constructor(scene: Phaser.Scene, config: {
    particles: Phaser.Math.Vector2[]; // Initial positions
    restArea?: number; // Auto-calculated if not provided
    timeStep?: number;
    parent?: Phaser.GameObjects.Container; // Parent container for graphics
  }) {
    // this.timeStep = config.timeStep || (1 / 60); // unused - now using _dt
    
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(1);
    
    // Add graphics to parent container if provided
    if (config.parent) {
      config.parent.add(this.graphics);
    }
    
    this.initializeParticles(config.particles);
    
    // Calculate initial radius from particle positions
    this.initialRadius = this.calculateAverageRadius();
    
    // Store rest edge lengths for clean XPBD
    this.restEdge = [];
    for (let i = 0; i < this.particles.length; i++) {
      const j = (i + 1) % this.particles.length;
      const edge = this.particles[j].position.clone().subtract(this.particles[i].position);
      this.restEdge.push(edge.length());
    }
    
    // Store rest area for clean XPBD
    this.restArea = config.restArea || this.calculateCurrentArea();
    
    this.createConstraints();
    
    // Set rest area (legacy constraint system)
    this.areaConstraint = {
      restArea: this.restArea,
      compliance: this.areaCompliance,
      lambda: 0
    };
    
    console.log(`🧬 Constraint-based Membrane initialized: ${this.particles.length} particles, rest area: ${this.areaConstraint.restArea.toFixed(1)}`);
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
    
    // Initialize rest positions - this is the "undeformed" configuration
    this.restPositions = positions.map(pos => pos.clone());
  }
  
  private createConstraints() {
    const numParticles = this.particles.length;
    
    // Create stretch constraints (edges of polygon)
    for (let i = 0; i < numParticles; i++) {
      const next = (i + 1) % numParticles;
      const restLength = this.particles[i].position.distance(this.particles[next].position);
      
      this.stretchConstraints.push({
        particleA: i,
        particleB: next,
        restLength,
        compliance: this.stretchCompliance,
        lambda: 0
      });
    }
    
    // Create bending constraints (resist angle changes)
    for (let i = 0; i < numParticles; i++) {
      const prev = (i - 1 + numParticles) % numParticles;
      const next = (i + 1) % numParticles;
      
      // Calculate rest angle and rest distance for second-neighbor approach
      const restAngle = this.calculateAngle(prev, i, next);
      const restDistance = this.particles[prev].position.distance(this.particles[next].position);
      
      this.bendingConstraints.push({
        particleA: prev,
        particleB: i,
        particleC: next,
        restAngle,
        restDistance,
        compliance: this.bendingCompliance,
        lambda: 0
      });
    }
    
    console.log(`🔗 Created ${this.stretchConstraints.length} stretch constraints, ${this.bendingConstraints.length} bending constraints`);
  }
  
  private calculateAngle(prevIndex: number, centerIndex: number, nextIndex: number): number {
    const prev = this.particles[prevIndex].position;
    const center = this.particles[centerIndex].position;
    const next = this.particles[nextIndex].position;
    
    const edge1 = prev.clone().subtract(center).normalize();
    const edge2 = next.clone().subtract(center).normalize();
    
    return Math.atan2(edge1.cross(edge2), edge1.dot(edge2));
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
   * Main simulation step with XPBD substeps
   */
  public update(deltaTime: number) {
    // --- parameters (tune in this order)
    const SUBSTEPS = 2;                 // 2–3
    const SOLVER_ITERS = 8;             // 6–10
    const DAMPING = 0.985;              // 0.97–0.99
    const alphaEdge = 5e-5;             // compliance (softer if larger)
    const alphaArea = 1e-4;             // soft area preservation
    const alphaBend = 2e-4;             // optional smoothing

    // 1) apply pending impulses to velocities (cell-local)
    for (const [i, imp] of this.pendingForces.entries()) {
      const p = this.particles[i];
      if (p.invMass > 0) {
        p.velocity.x += imp.x * p.invMass;
        p.velocity.y += imp.y * p.invMass;
      }
    }
    this.pendingForces.clear();

    const h = deltaTime / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      // 2) predict
      for (const p of this.particles) {
        p.prevPosition.set(p.position.x, p.position.y);
        p.position.x += p.velocity.x * h;
        p.position.y += p.velocity.y * h;
      }

      // 3) solve constraints (XPBD)
      for (let k = 0; k < SOLVER_ITERS; k++) {
        // stretch constraints (edges)
        for (let i = 0; i < this.particles.length; i++) {
          const j = (i + 1) % this.particles.length;
          this.solveDistanceXPBD(this.particles[i], this.particles[j], this.restEdge[i], alphaEdge, h);
        }

        // optional: bending smoothing across triples (i-1, i, i+1)
        const N = this.particles.length;
        for (let i = 0; i < N; i++) {
          const a = (i - 1 + N) % N, b = i, c = (i + 1) % N;
          this.solveBendSmoothing(this.particles[a], this.particles[b], this.particles[c], alphaBend, h);
        }

        // global soft area (pressure-like)
        this.solveAreaXPBD(this.particles, this.restArea, alphaArea, h);
      }

      // 4) update velocities from corrected positions + damping
      for (const p of this.particles) {
        p.velocity.x = (p.position.x - p.prevPosition.x) / h;
        p.velocity.y = (p.position.y - p.prevPosition.y) / h;
        p.velocity.x *= DAMPING;
        p.velocity.y *= DAMPING;
        
        // Clamp velocity (not position) at 200-300 as recommended by GPT-5
        const speed = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
        if (speed > 250) {
          const scale = 250 / speed;
          p.velocity.x *= scale;
          p.velocity.y *= scale;
        }
      }
    }

    // Render after all substeps
    this.render();
  }

  // Helper functions for clean XPBD solver

  /**
   * Solve distance constraint between two particles using XPBD
   */
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

  /**
   * Solve bending smoothing constraint across three particles
   */
  private solveBendSmoothing(pA: ConstraintParticle, pB: ConstraintParticle, pC: ConstraintParticle, alpha: number, h: number) {
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

  /**
   * Solve area constraint for the entire membrane
   */
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
  
  /**
   * Guard against NaN/infinite positions that can crash the simulation
   */
  private guardAgainstNaN() {
    for (const p of this.particles) {
      if (!isFinite(p.position.x) || !isFinite(p.position.y)) {
        console.warn(`🚨 NaN/Infinite position detected, resetting particle`);
        p.position.set(0, 0); 
        p.velocity.set(0, 0);
        p.xPred.set(0, 0);
      }
    }
  }
  
  private solveStretchConstraints() {
    const dt2 = this._dt * this._dt;
    const EPS = 1e-6;
    for (const c of this.stretchConstraints) {
      const pA = this.particles[c.particleA];
      const pB = this.particles[c.particleB];
      if ((pA.isFrozen && pB.isFrozen) || (pA.invMass + pB.invMass) === 0) continue;

      const delta = pB.position.clone().subtract(pA.position);
      const len = delta.length();
      if (len < EPS) continue; // guard

      const C = len - c.restLength;
      if (Math.abs(C) < 1e-4) continue;

      const dir = delta.scale(1 / len);
      const denom = pA.invMass + pB.invMass + c.compliance / dt2;
      if (denom <= EPS) continue;

      const dLambda = -(C + c.compliance * c.lambda / dt2) / denom;
      c.lambda += dLambda;

      const relax = 0.85; // was 0.8 - slightly stronger for stable convergence with softer compliance
      const corr = dir.scale(dLambda);
      if (!pA.isFrozen && pA.invMass > 0) pA.position.add(corr.clone().scale(-pA.invMass * relax).limit(this.maxCorrectionPerIteration));
      if (!pB.isFrozen && pB.invMass > 0) pB.position.add(corr.clone().scale( pB.invMass * relax).limit(this.maxCorrectionPerIteration));
    }
  }
  
  private solveBendingConstraints() {
    const dt2 = this._dt * this._dt;
    const EPS = 1e-6;
    for (const c of this.bendingConstraints) {
      const pA = this.particles[c.particleA];
      const pC = this.particles[c.particleC];
      if ((pA.invMass + pC.invMass) === 0) continue;

      const rest = c.restDistance;
      const delta = pC.position.clone().subtract(pA.position);
      const dist = delta.length();
      if (dist < EPS) continue; // guard

      const C = dist - rest;
      if (Math.abs(C) < 1e-3) continue;

      const dir = delta.scale(1 / dist);
      const wA = pA.invMass, wC = pC.invMass;
      const denom = wA + wC + c.compliance / dt2;
      if (denom <= EPS) continue;

      const dLambda = -(C + c.compliance * c.lambda / dt2) / denom;
      c.lambda += dLambda;

      const relaxB = 0.7; // was 0.6 - slightly stronger bending relaxation for smoother curves
      const corr = dir.scale(0.5 * dLambda); // keep weaker than stretch
      if (wA > 0) pA.position.add(corr.clone().scale(-wA * relaxB).limit(this.maxCorrectionPerIteration));
      if (wC > 0) pC.position.add(corr.clone().scale( wC * relaxB).limit(this.maxCorrectionPerIteration));
    }
  }
  
  private solveAreaConstraint() {
    const dt2 = this._dt * this._dt;
    const currentArea = this.calculateCurrentArea();
    const C = currentArea - this.areaConstraint.restArea;
    if (Math.abs(C) < 1.0) return;

    const grads: Phaser.Math.Vector2[] = [];
    let denom = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const prev = (i - 1 + this.particles.length) % this.particles.length;
      const next = (i + 1) % this.particles.length;
      const pPrev = this.particles[prev].position;
      const pNext = this.particles[next].position;
      const g = new Phaser.Math.Vector2( (pNext.y - pPrev.y) * 0.5, (pPrev.x - pNext.x) * 0.5 );
      grads.push(g);
      denom += this.particles[i].invMass * g.lengthSq();
    }
    denom += this.areaConstraint.compliance / dt2;
    if (denom === 0) return;

    const relax = 0.75; // was 0.7 - slightly stronger area relaxation for stable volume
    const dLambda = -(C + this.areaConstraint.compliance * this.areaConstraint.lambda / dt2) / denom;
    this.areaConstraint.lambda += dLambda * relax;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass > 0 && !p.isFrozen) {
        const correction = grads[i].clone().scale((dLambda * relax) * p.invMass).limit(this.maxCorrectionPerIteration);
        p.position.subtract(correction);
      }
    }
  }
  
  private solveSoftPins() {
    const dt2 = this._dt * this._dt;
    
    // Process pins with timing (backwards iteration for safe removal)
    for (let i = this.softPins.length - 1; i >= 0; i--) {
      const pin = this.softPins[i];
      const p = this.particles[pin.index];
      if (p.invMass === 0) continue; // truly static not needed
      
      // Handle timing: decrement remaining frames
      if (pin.remainingFrames !== undefined) {
        pin.remainingFrames--;
        if (pin.remainingFrames <= 0) {
          this.softPins.splice(i, 1); // Remove expired pin
          continue;
        }
      }
      
      // Calculate strength ramp (gradual application)
      let strength = 1.0;
      if (pin.strengthRamp !== undefined) {
        strength = pin.strengthRamp;
        // Optionally auto-ramp based on remaining frames
        if (pin.remainingFrames !== undefined && pin.remainingFrames > 0) {
          strength = Math.min(1.0, (10 - pin.remainingFrames) / 10);
        }
      }
      
      const w = p.invMass;
      const Cx = p.position.x - pin.target.x;
      const Cy = p.position.y - pin.target.y;

      const denom = w + pin.compliance / dt2;
      if (denom === 0) continue;

      // we solve x and y independently (diagonal Jacobian)
      let dLambdaX = -(Cx + pin.compliance * pin.lambda / dt2) / denom;
      let dLambdaY = -(Cy + pin.compliance * pin.lambda / dt2) / denom;

      // Apply strength scaling and under-relaxation - tuned for stability
      dLambdaX *= 0.7 * strength; // was 0.6 - slightly stronger for better pin control
      dLambdaY *= 0.7 * strength;

      pin.lambda += (Math.abs(dLambdaX) + Math.abs(dLambdaY)) * 0.5;

      p.position.x += -dLambdaX * w;
      p.position.y += -dLambdaY * w;
    }
  }
  
  // TODO: Implement collision constraints
  // private solveCollisionConstraints() {
  //   // Will be implemented to handle player collision
  //   // For now, placeholder
  // }
  
  /* REMOVED: Old methods replaced by new XPBD loop
  private updateVelocities(deltaTime: number) {
    for (const particle of this.particles) {
      if (particle.isFrozen || particle.invMass === 0) {
        particle.velocity.set(0, 0);
        continue;
      }
      
      // Update velocity based on position change
      const positionDelta = particle.position.clone().subtract(particle.prevPosition);
      particle.velocity.copy(positionDelta.scale(1 / deltaTime));
    }
  }
  
  private applyDamping() { // REMOVED: replaced by new XPBD loop
    const maxVelocity = 200; // Much smaller max velocity to keep membrane stable
    
    for (const particle of this.particles) {
      if (!particle.isFrozen && particle.invMass > 0) {
        // Apply standard damping
        particle.velocity.scale(this.damping);
        
        // Clamp extreme velocities (reduce logging)
        const speed = particle.velocity.length();
        if (speed > maxVelocity) {
          particle.velocity.normalize().scale(maxVelocity);
          // Only log very occasionally to reduce spam (0.2% chance)
          if (Math.random() < 0.002) {
            console.log(`🔧 VELOCITY CLAMPED: speed ${speed.toFixed(1)} → ${maxVelocity}`);
          }
        }
        
        // Additional stability check: if velocity is NaN or infinite, reset it
        if (!isFinite(particle.velocity.x) || !isFinite(particle.velocity.y)) {
          console.log(`🚨 VELOCITY NaN/INFINITE DETECTED: resetting particle velocity`);
          particle.velocity.set(0, 0);
        }
      }
    }
  }
  
  /**
   * Stabilizing edge-length projection to prevent catastrophic stretch
   * DISABLED FOR NOW - was causing snap-back behavior
   */
  /* 
  private applyEdgeLengthProjection() {
    // Only intervene if an edge is badly stretched (>25% from rest)
    let needsHelp = false;
    for (let i = 0; i < this.particles.length; i++) {
      const j = (i + 1) % this.particles.length;
      const dist = this.particles[i].position.distance(this.particles[j].position);
      const rest = this.stretchConstraints[i].restLength;
      if (Math.abs(dist - rest) / rest > 0.25) { needsHelp = true; break; }
    }
    if (!needsHelp) return;

    const maxCorr = 2.0;   // was 50 — way too strong
    const iters = 2;       // was 6 — enough to kill your squish

    for (let iter = 0; iter < iters; iter++) {
      for (let i = 0; i < this.particles.length; i++) {
        const j = (i + 1) % this.particles.length;
        const a = this.particles[i], b = this.particles[j];
        if (a.isFrozen && b.isFrozen) continue;

        const delta = b.position.clone().subtract(a.position);
        const dist = delta.length();
        if (dist === 0) continue;

        const rest = this.stretchConstraints[i].restLength;
        const diff = (dist - rest) / dist;
        const corr = delta.scale(0.5 * diff);
        corr.limit(maxCorr);

        if (!a.isFrozen) a.position.add(corr);
        if (!b.isFrozen) b.position.subtract(corr);
      }
    }
    this._spatialDirty = true;
  }
  */
  
  private render() {
    this.graphics.clear();
    this.graphics.lineStyle(2, 0x00ff00, 0.8);
    this.graphics.fillStyle(0x00ff00, 0.1);
    
    // Check for extreme particle positions that could cause screen-filling issues
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const particle of this.particles) {
      minX = Math.min(minX, particle.position.x);
      maxX = Math.max(maxX, particle.position.x);
      minY = Math.min(minY, particle.position.y);
      maxY = Math.max(maxY, particle.position.y);
    }
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Log warning if membrane bounds are extreme (reduce logging frequency)
    if ((width > 2000 || height > 2000 || Math.abs(minX) > 1000 || Math.abs(maxX) > 1000 || Math.abs(minY) > 1000 || Math.abs(maxY) > 1000) && Math.random() < 0.05) {
      console.warn(`🟢 MEMBRANE BOUNDS EXTREME: width=${width.toFixed(1)}, height=${height.toFixed(1)}, bounds: (${minX.toFixed(1)}, ${minY.toFixed(1)}) to (${maxX.toFixed(1)}, ${maxY.toFixed(1)})`);
      
      // Log first few particle positions for debugging (reduced frequency)
      for (let i = 0; i < Math.min(3, this.particles.length); i++) {
        const p = this.particles[i];
        console.warn(`  Particle ${i}: (${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}) vel=(${p.velocity.x.toFixed(2)}, ${p.velocity.y.toFixed(2)})`);
      }
    }
    
    // Draw membrane polygon
    this.graphics.beginPath();
    const firstParticle = this.particles[0];
    this.graphics.moveTo(firstParticle.position.x, firstParticle.position.y);
    
    for (let i = 1; i < this.particles.length; i++) {
      const particle = this.particles[i];
      this.graphics.lineTo(particle.position.x, particle.position.y);
    }
    
    this.graphics.closePath();
    this.graphics.fillPath();
    this.graphics.strokePath();
    
    // Draw particles (optional, for debugging)
    for (const particle of this.particles) {
      if (particle.isFrozen) {
        this.graphics.fillStyle(0xff0000, 0.8); // Red for frozen
      } else {
        this.graphics.fillStyle(0x00ff00, 0.6); // Green for active
      }
      this.graphics.fillCircle(particle.position.x, particle.position.y, particle.radius);
    }
  }
  
  /**
   * Apply impact force at a specific point with local normal computation
   */
  /**
   * Find particles in an index window around the nearest boundary edge by angle.
   * This prevents "0 affected particles" and provides smooth weight distribution.
   */
  private findParticlesByIndexWindow(contactPoint: Phaser.Math.Vector2, windowSize: number = 5): { index: number; weight: number }[] {
    // Find the angle of the contact point relative to membrane center
    const center = this.getCenter();
    const relativePos = contactPoint.clone().subtract(center);
    const contactAngle = Math.atan2(relativePos.y, relativePos.x);
    
    // Normalize angle to [0, 2π]
    const normalizedAngle = contactAngle < 0 ? contactAngle + Math.PI * 2 : contactAngle;
    
    // Find the nearest particle index by angle
    const particleCount = this.particles.length;
    const anglePerParticle = (Math.PI * 2) / particleCount;
    let nearestIndex = Math.round(normalizedAngle / anglePerParticle) % particleCount;
    
    // Create index window around the nearest particle
    const affectedParticles: { index: number; weight: number }[] = [];
    
    for (let offset = -windowSize; offset <= windowSize; offset++) {
      const index = (nearestIndex + offset + particleCount) % particleCount;
      
      // Cosine falloff weight based on distance from center of window
      const normalizedOffset = Math.abs(offset) / windowSize;
      const weight = Math.cos(normalizedOffset * Math.PI * 0.5);
      
      affectedParticles.push({ index, weight });
    }
    
    return affectedParticles;
  }

  /**
   * Test circle collision against membrane polygon edges.
   * Returns collision info if collision detected, null otherwise.
   */
  public testCircleCollision(
    circleCenter: Phaser.Math.Vector2, 
    circleRadius: number, 
    membraneThickness: number = 5
  ): { penetration: number; normal: Phaser.Math.Vector2; edgeIndex: number; barycentric: number } | null {
    const center = this.getCenter();
    const localCircleCenter = circleCenter.clone().subtract(center);
    
    let minPenetration = Infinity;
    let bestNormal: Phaser.Math.Vector2 | null = null;
    let bestEdgeIndex = -1;
    let bestBarycentric = 0;
    
    // Test against each membrane edge
    for (let i = 0; i < this.particles.length; i++) {
      const j = (i + 1) % this.particles.length;
      const p1 = this.particles[i].position;
      const p2 = this.particles[j].position;
      
      // Find closest point on edge to circle center
      const edge = p2.clone().subtract(p1);
      const toCenter = localCircleCenter.clone().subtract(p1);
      
      const edgeLength = edge.length();
      if (edgeLength < 0.001) continue; // Skip degenerate edges
      
      const edgeNorm = edge.clone().normalize();
      const projLength = toCenter.dot(edgeNorm);
      
      // Clamp projection to edge bounds
      const t = Math.max(0, Math.min(1, projLength / edgeLength));
      const closestPoint = p1.clone().add(edgeNorm.scale(t * edgeLength));
      
      // Calculate distance and penetration
      const toClosest = localCircleCenter.clone().subtract(closestPoint);
      const distance = toClosest.length();
      const totalRadius = circleRadius + membraneThickness;
      
      if (distance < totalRadius) {
        const penetration = totalRadius - distance;
        
        if (penetration < minPenetration) {
          minPenetration = penetration;
          bestNormal = distance > 0.001 ? toClosest.normalize() : new Phaser.Math.Vector2(-edgeNorm.y, edgeNorm.x);
          bestEdgeIndex = i;
          bestBarycentric = t;
        }
      }
    }
    
    if (bestNormal) {
      return {
        penetration: minPenetration,
        normal: bestNormal,
        edgeIndex: bestEdgeIndex,
        barycentric: bestBarycentric
      };
    }
    
    return null;
  }

  /**
   * Apply impact force at a specific edge with barycentric weighting.
   * Used for edge-based collision response.
   */
  public applyImpactAtEdge(
    edgeIndex: number, 
    barycentric: number, 
    impulse: Phaser.Math.Vector2
  ) {
    const i = edgeIndex;
    const j = (edgeIndex + 1) % this.particles.length;
    
    // Distribute impulse between the two edge particles based on barycentric coordinate
    const weight1 = 1 - barycentric;
    const weight2 = barycentric;
    
    // Apply weighted impulses to both particles
    const impulse1 = impulse.clone().scale(weight1);
    const impulse2 = impulse.clone().scale(weight2);
    
    // Accumulate in pending forces
    if (!this.pendingForces.has(i)) {
      this.pendingForces.set(i, new Phaser.Math.Vector2());
    }
    if (!this.pendingForces.has(j)) {
      this.pendingForces.set(j, new Phaser.Math.Vector2());
    }
    
    this.pendingForces.get(i)!.add(impulse1);
    this.pendingForces.get(j)!.add(impulse2);
    
    // Log edge impact occasionally (5% chance)
    if (Math.random() < 0.05) {
      console.log(`💥 EDGE IMPACT: edge ${i}-${j}, barycentric=${barycentric.toFixed(2)}, impulse=(${impulse.x.toFixed(1)}, ${impulse.y.toFixed(1)})`);
    }
  }
  
  public applyImpact(contactPoint: Phaser.Math.Vector2, force: number, explicitDirection: Phaser.Math.Vector2 | null) {
    // Rebuild spatial index if needed before particle lookup
    this.rebuildSpatialIndexIfNeeded();
    
    // Log impact occasionally (5% chance)
    if (Math.random() < 0.05) {
      console.log(`💥 MEMBRANE IMPACT: contactPoint=(${contactPoint.x.toFixed(1)}, ${contactPoint.y.toFixed(1)}), force=${force.toFixed(1)}`);
    }
    
    // More conservative force to avoid constant resets
    const dampedForce = force * 0.05; // Reduced from 0.1 to prevent immediate over-deformation
    
    // Log damped force occasionally (2% chance)
    if (Math.random() < 0.02) {
      console.log(`💥 DAMPED FORCE: ${dampedForce.toFixed(1)}`);
    }
    
    // Use index-window approach instead of distance-based selection
    // This prevents "0 affected particles" and provides smoother deformation
    const windowSize = 5; // ±5 particles around nearest edge
    const affectedParticles = this.findParticlesByIndexWindow(contactPoint, windowSize);

    // Log affected particles occasionally (1% chance)
    if (Math.random() < 0.01) {
      console.log(`💥 AFFECTED PARTICLES: ${affectedParticles.length} particles (index-window)`);
    }
    
    // Accumulate impulses instead of forces for direct velocity application
    const impulseMag = Math.min(dampedForce * this.impactImpulseScale, 600); // hard cap
    
    // Use explicit direction if provided, otherwise compute local normal
    const impulseDirection = explicitDirection ? 
      explicitDirection.clone().normalize() : 
      this.computeLocalNormalAtPoint(contactPoint);
    const impulse = impulseDirection.scale(impulseMag);
    
    for (const { index, weight } of affectedParticles) {
      const particle = this.particles[index];
      
      if (!particle.isFrozen && particle.invMass > 0) {
        const weightedImpulse = impulse.clone().scale(weight);
        
        // Accumulate in pending forces (now impulses) for next physics step
        if (!this.pendingForces.has(index)) {
          this.pendingForces.set(index, new Phaser.Math.Vector2());
        }
        this.pendingForces.get(index)!.add(weightedImpulse);
        
        // Log impulse accumulation occasionally (1% chance)
        if (Math.random() < 0.01) {
          console.log(`� IMPULSE ACCUMULATED: particle ${index}, impulse=(${weightedImpulse.x.toFixed(2)}, ${weightedImpulse.y.toFixed(2)})`);
        }
      }
    }
  }

  // Distance-based impact methods disabled for clean baseline testing

  /**
   * Apply a continuous pulling force for endocytosis pocket formation
   * @param contactPoint The point where pulling is applied
   * @param pullDirection The direction to pull toward (typically inward)
   * @param pullForce The strength of the pulling force
   */
  public applyPullingForce(contactPoint: Phaser.Math.Vector2, pullDirection: Phaser.Math.Vector2, pullForce: number) {
    // Log pulling force occasionally (1% chance)
    if (Math.random() < 0.01) {
      console.log(`🫴 MEMBRANE PULL: point=(${contactPoint.x.toFixed(1)}, ${contactPoint.y.toFixed(1)}), force=${pullForce.toFixed(1)}`);
    }
    
    // More conservative pulling force to avoid over-deformation
    const dampedForce = pullForce * 0.05; // Reduced from 0.1 to prevent constant resets
    
    // Wider influence radius for smoother pulling
    const influenceRadius = 80; // Larger radius for smoother deformation
    const affectedParticles: { index: number; weight: number }[] = [];
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const distance = particle.position.distance(contactPoint);
      
      if (distance <= influenceRadius) {
        // Smoother weight distribution for pulling
        const weight = Math.cos((distance / influenceRadius) * Math.PI * 0.5); // Cosine falloff
        affectedParticles.push({ index: i, weight });
      }
    }
    
    if (affectedParticles.length === 0) return; // No particles to affect
    
    // Accumulate pulling impulses for next physics step
    const impulseMag = Math.min(dampedForce * this.pullImpulseScale, 600); // hard cap
    const impulse = pullDirection.clone().normalize().scale(impulseMag);
    
    for (const { index, weight } of affectedParticles) {
      const particle = this.particles[index];
      
      if (!particle.isFrozen && particle.invMass > 0) {
        const weightedImpulse = impulse.clone().scale(weight);
        
        // Accumulate in pending forces (now impulses)
        if (!this.pendingForces.has(index)) {
          this.pendingForces.set(index, new Phaser.Math.Vector2());
        }
        this.pendingForces.get(index)!.add(weightedImpulse);
      }
    }
  }
  
  // Local membrane normal computation for realistic collision response
  private computeLocalNormal(particleIndex: number): Phaser.Math.Vector2 {
    const numParticles = this.particles.length;
    if (numParticles < 3) {
      // Fallback for degenerate cases
      return new Phaser.Math.Vector2(0, -1);
    }
    
    const current = this.particles[particleIndex];
    const prev = this.particles[(particleIndex - 1 + numParticles) % numParticles];
    const next = this.particles[(particleIndex + 1) % numParticles];
    
    // Calculate edge vectors
    const edgeToPrev = prev.position.clone().subtract(current.position);
    const edgeToNext = next.position.clone().subtract(current.position);
    
    // Calculate average edge direction (tangent)
    const tangent = edgeToPrev.clone().add(edgeToNext).normalize();
    
    // Normal is perpendicular to tangent (rotated 90°)
    const normal = new Phaser.Math.Vector2(-tangent.y, tangent.x);
    
    // Ensure normal points outward from center
    this.updateCenter();
    const toCenter = this.centerPosition.clone().subtract(current.position);
    if (normal.dot(toCenter) > 0) {
      normal.scale(-1); // Flip to point outward
    }
    
    return normal.normalize();
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
    
    // Interpolate normals from closest particles
    const normal1 = this.computeLocalNormal(closest1);
    const normal2 = this.computeLocalNormal(closest2);
    
    // Weight by inverse distance
    const weight1 = dist2 / (dist1 + dist2);
    const weight2 = dist1 / (dist1 + dist2);
    
    const blendedNormal = normal1.clone().scale(weight1).add(normal2.clone().scale(weight2));
    return blendedNormal.normalize();
  }
  
  /**
   * Safely zero all kinetic state for a particle (prevents runaway after teleports)
   */
  private zeroKinetics(particle: ConstraintParticle) {
    particle.velocity.set(0, 0);
    particle.prevPosition.copy(particle.position);
  }
  
  /**
   * Safely set position and zero kinetics to prevent implied velocity
   */
  private setPositionSafely(particle: ConstraintParticle, x: number, y: number) {
    particle.position.set(x, y);
    this.zeroKinetics(particle);
    this._spatialDirty = true; // Mark spatial index dirty
  }
  
  /**
   * Reset membrane if it becomes too deformed
   */
  public resetIfOverDeformed() {
    if (!this.allowReset) return; // Skip reset if disabled
    
    // First, check for and fix any particles with NaN or infinite positions
    const fixedCount = this.detectAndFixInvalidParticles();
    if (fixedCount > 0) {
      console.log(`🔧 Fixed ${fixedCount} particles with invalid positions`);
      this._spatialDirty = true;
    }
    
    const currentSize = this.getMaxParticleDistance();
    const maxAllowedSize = this.initialRadius * 12; // Increased from 8x to 12x - even more deformation tolerance
    
    if (currentSize > maxAllowedSize) {
      console.log(`🔄 RESETTING OVER-DEFORMED MEMBRANE: size=${currentSize.toFixed(1)} > ${maxAllowedSize.toFixed(1)}`);
      
      // Reset particles to original circular positions with proper kinetic zeroing
      const particleCount = this.particles.length;
      for (let i = 0; i < particleCount; i++) {
        // Skip pinned particles during reset
        if (this.isParticlePinned(i)) continue;
        
        const angle = (i / particleCount) * Math.PI * 2;
        const x = Math.cos(angle) * this.initialRadius;
        const y = Math.sin(angle) * this.initialRadius;
        
        this.setPositionSafely(this.particles[i], x, y);
      }
      
      // Clear any pending forces
      this.pendingForces.clear();
      this._spatialDirty = true;
    }
  }
  
  /**
   * Check if a specific particle is currently pinned
   */
  private isParticlePinned(index: number): boolean {
    return this.pins.has(index);
  }
  
  /**
   * Detect and fix particles with NaN or infinite positions
   * Returns the number of particles that were fixed
   */
  private detectAndFixInvalidParticles(): number {
    let fixedCount = 0;
    const particleCount = this.particles.length;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = this.particles[i];
      
      // Check for NaN or infinite positions
      const hasInvalidPosition = !isFinite(particle.position.x) || !isFinite(particle.position.y) ||
                                isNaN(particle.position.x) || isNaN(particle.position.y);
      
      // Check for NaN or infinite velocities  
      const hasInvalidVelocity = !isFinite(particle.velocity.x) || !isFinite(particle.velocity.y) ||
                                isNaN(particle.velocity.x) || isNaN(particle.velocity.y);
      
      // Check for extremely large positions (> 10000 units from origin)
      const hasExtremePosition = Math.abs(particle.position.x) > 10000 || Math.abs(particle.position.y) > 10000;
      
      if (hasInvalidPosition || hasInvalidVelocity || hasExtremePosition) {
        // Don't reset pinned particles - they're held intentionally
        if (this.isParticlePinned(i)) continue;
        
        // Reset this particle to its original circular position
        const angle = (i / particleCount) * Math.PI * 2;
        const x = Math.cos(angle) * this.initialRadius;
        const y = Math.sin(angle) * this.initialRadius;
        
        this.setPositionSafely(particle, x, y);
        fixedCount++;
        
        if (fixedCount === 1) {
          console.log(`🚨 Detected invalid particle ${i}: pos=(${particle.position.x}, ${particle.position.y}), vel=(${particle.velocity.x}, ${particle.velocity.y})`);
        }
      }
    }
    
    return fixedCount;
  }
  
  /**
   * Enable or disable membrane reset (for testing deformation)
   */
  public setAllowReset(allow: boolean) {
    this.allowReset = allow;
  }
  
  /**
   * Get the number of particles in the membrane
   */
  public getParticleCount(): number {
    return this.particles.length;
  }
  
  /**
   * Get membrane radius at a specific angle (for compatibility with old system)
   */
  public getMembraneRadiusAt(angle: number): number {
    // Update center before radius calculation
    this.updateCenter();
    
    // Find the particle closest to the specified angle (relative to center)
    let closestParticle = 0;
    let smallestAngleDiff = Infinity;
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      // Use center-relative coordinates
      const relativePos = particle.position.clone().subtract(this.centerPosition);
      const particleAngle = Math.atan2(relativePos.y, relativePos.x);
      
      // Handle angle wrapping for proper distance calculation
      let angleDiff = Math.abs(angle - particleAngle);
      if (angleDiff > Math.PI) {
        angleDiff = 2 * Math.PI - angleDiff;
      }
      
      if (angleDiff < smallestAngleDiff) {
        smallestAngleDiff = angleDiff;
        closestParticle = i;
      }
    }
    
    // Return distance from center-of-mass to that particle
    const particle = this.particles[closestParticle];
    return particle.position.distance(this.centerPosition);
  }
  
  /**
   * Get membrane elasticity at a specific angle (for compatibility with old system)
   */
  public getMembraneElasticityAt(_angle: number): number {
    // Constraint-based doesn't have per-angle elasticity in the same way
    // Return a base elasticity value that can be adjusted based on compliance
    return 0.3; // Default elasticity
  }
  
  /**
   * Get particles as "nodes" for compatibility with endocytosis system
   */
  public getNodes() {
    return this.particles.map((particle, index) => ({
      position: particle.position,
      restPosition: this.restPositions[index]?.clone() || particle.position.clone(), // Use proper rest position
      force: new Phaser.Math.Vector2(0, 0), // Force is applied directly to velocity
      velocity: particle.velocity,
      restRadius: this.restPositions[index]?.length() || particle.position.length(),
      angle: Math.atan2(particle.position.y, particle.position.x),
      currentRadius: particle.position.length(),
      index: index
    }));
  }
  
  /**
   * Set local compliance for specific particles (for endocytosis)
   */
  public setNodeOverrides(particleIndex: number, overrides: {
    locked?: boolean;
    restPosition?: Phaser.Math.Vector2;
    restRadius?: number;
    radialStiffnessScale?: number;
    tangentialStiffnessScale?: number;
    dampingScale?: number;
  }) {
    if (particleIndex < 0 || particleIndex >= this.particles.length) return;
    
    const particle = this.particles[particleIndex];
    
    if (overrides.locked !== undefined) {
      particle.isFrozen = overrides.locked;
      particle.invMass = overrides.locked ? 0 : 1; // 0 = immovable, 1 = normal mass
    }
    
    // Note: Constraint-based doesn't have separate rest positions like the old system
    // The constraint-based approach handles membrane shape differently
  }
  
  /**
   * Clear overrides for a particle (restore normal behavior)
   */
  public clearNodeOverrides(particleIndex: number) {
    if (particleIndex < 0 || particleIndex >= this.particles.length) return;
    
    const particle = this.particles[particleIndex];
    particle.isFrozen = false;
    particle.invMass = 1; // Restore normal mass
  }
  
  /**
   * Create a smaller vesicle membrane system (for endocytosis)
   */
  public static createVesicleMembrane(
    scene: Phaser.Scene,
    _worldRefs: any,
    radius: number,
    position: Phaser.Math.Vector2,
    parent?: Phaser.GameObjects.Container
  ): MembranePhysicsSystem {
    // Create vesicle particles in a circle
    const particleCount = 16; // Smaller vesicle needs fewer particles
    const vesicleParticles: Phaser.Math.Vector2[] = [];
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const x = position.x + Math.cos(angle) * radius;
      const y = position.y + Math.sin(angle) * radius;
      vesicleParticles.push(new Phaser.Math.Vector2(x, y));
    }
    
    return new MembranePhysicsSystem(scene, {
      particles: vesicleParticles,
      timeStep: 1/60,
      parent: parent
    });
  }
  
  /**
   * Set local compliance for a region (for endocytosis neck softening)
   */
  public setLocalCompliance(particleIndices: number[], compliance: number) {
    for (const constraint of this.stretchConstraints) {
      if (particleIndices.includes(constraint.particleA) || particleIndices.includes(constraint.particleB)) {
        constraint.compliance = compliance;
      }
    }
    
    for (const constraint of this.bendingConstraints) {
      if (particleIndices.includes(constraint.particleB)) { // Center particle
        constraint.compliance = compliance;
      }
    }
    
    console.log(`🔧 Set local compliance ${compliance} for ${particleIndices.length} particles`);
  }

  /**
   * Set up compliance mapping for scission: soften neck, stiffen walls
   */
  public setupScissionCompliance(neckIndices: number[], wallIndices: number[]) {
    // Reset all constraints to default compliance first
    this.resetConstraintCompliance();
    
    // Soften neck area for easier pinching
    const neckCompliance = 0.08; // Much higher than default (0.003) - very soft
    this.setLocalCompliance(neckIndices, neckCompliance);
    
    // Stiffen wall area to resist deformation
    const wallCompliance = 0.001; // Lower than default (0.003) - more rigid
    this.setLocalCompliance(wallIndices, wallCompliance);
    
    console.log(`✂️ SCISSION COMPLIANCE: neck=${neckCompliance} (${neckIndices.length} particles), wall=${wallCompliance} (${wallIndices.length} particles)`);
  }

  /**
   * Reset all constraint compliance to default values
   */
  public resetConstraintCompliance() {
    // Reset stretch constraints
    for (const constraint of this.stretchConstraints) {
      constraint.compliance = this.stretchCompliance;
    }
    
    // Reset bending constraints
    for (const constraint of this.bendingConstraints) {
      constraint.compliance = this.bendingCompliance;
    }
    
    console.log(`🔄 Reset all constraints to default compliance`);
  }

  /**
   * Freeze specific particles (for endocytosis wall freezing)
   */
  public freezeParticles(particleIndices: number[]) {
    for (const index of particleIndices) {
      if (index < this.particles.length) {
        this.particles[index].isFrozen = true;
        this.particles[index].invMass = 0;
        this.particles[index].velocity.set(0, 0);
      }
    }
    
    console.log(`❄️ Froze ${particleIndices.length} particles`);
  }
  
  /**
   * Get particle positions for external systems
   */
  public getParticlePositions(): Phaser.Math.Vector2[] {
    return this.particles.map(p => p.position.clone());
  }
  
  /**
   * Calculate the average distance of particles from origin (initial radius)
   */
  private calculateAverageRadius(): number {
    if (this.particles.length === 0) return 200; // Default fallback
    
    const totalDistance = this.particles.reduce((sum, particle) => {
      return sum + particle.position.length();
    }, 0);
    
    return totalDistance / this.particles.length;
  }
  
  /**
   * Get the maximum distance between any two particles
   */
  private getMaxParticleDistance(): number {
    if (this.particles.length < 2) return 0;
    
    let maxDistance = 0;
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const distance = this.particles[i].position.distance(this.particles[j].position);
        maxDistance = Math.max(maxDistance, distance);
      }
    }
    
    return maxDistance;
  }

  /**
   * Begin holding particles at their current positions for testing.
   * This enables "pull and freeze" behavior for scission testing.
   */
  public beginHold(indices: number[], targets?: Phaser.Math.Vector2[], frames: number = 90, softness: number = 0.003) {
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      
      // Use provided target or current position
      const target = targets && targets[i] ? 
        targets[i].clone() : 
        this.particles[index].position.clone();
      
      // Use the pin system (Map-based) for hold mode
      this.pins.set(index, {
        target: target,
        compliance: softness,
        t: frames / 60 // Convert frames to seconds assuming 60fps
      });
    }
    
    console.log(`🫱 BEGIN HOLD: ${indices.length} particles held for ${frames} frames`);
  }

  /**
   * End hold mode and release all pins.
   * This allows natural snap-back behavior.
   */
  public endHold() {
    this.clearPins();
    console.log(`🫲 END HOLD: Released all pins, membrane free`);
  }

  /**
   * Check if currently in hold mode
   */
  public isHolding(): boolean {
    return this.isPinned;
  }

  public addSoftPin(index: number, target: Phaser.Math.Vector2, compliance = 1e-2) {
    this.softPins.push({ index, target: target.clone(), compliance, lambda: 0 });
  }
  
  public addTimedSoftPin(index: number, target: Phaser.Math.Vector2, frames: number, compliance = 1e-2, strengthRamp = 1.0) {
    this.softPins.push({ 
      index, 
      target: target.clone(), 
      compliance, 
      lambda: 0,
      remainingFrames: frames,
      strengthRamp: strengthRamp 
    });
  }
  
  public clearSoftPins() { 
    this.softPins.length = 0; 
  }
  
  // Center-of-mass tracking methods
  public getCenter(): Phaser.Math.Vector2 {
    return this.centerPosition.clone();
  }
  
  public setCenterAnchor(anchor: Phaser.Math.Vector2 | null, compliance = 1e-3) {
    this.centerAnchor = anchor ? anchor.clone() : null;
    this.centerAnchorCompliance = compliance;
  }
  
  private updateCenter() {
    // Calculate center of mass
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
    
    // Calculate center deviation
    const delta = this.centerAnchor.clone().subtract(this.centerPosition);
    const dist = delta.length();
    if (dist < EPS) return;
    
    const dir = delta.scale(1 / dist);
    
    // Apply soft constraint to all particles
    let totalInvMass = 0;
    for (const particle of this.particles) {
      if (!particle.isFrozen && particle.invMass > 0) {
        totalInvMass += particle.invMass;
      }
    }
    
    if (totalInvMass <= EPS) return;
    
    const denom = totalInvMass + this.centerAnchorCompliance / dt2;
    const dLambda = -dist / denom;
    
    const correction = dir.scale(dLambda);
    for (const particle of this.particles) {
      if (!particle.isFrozen && particle.invMass > 0) {
        particle.position.add(correction.clone().scale(particle.invMass));
      }
    }
  }
  
  // Rest position snapshot system for endocytosis
  public takeRestSnapshot() {
    // Capture current positions as new rest state
    for (let i = 0; i < this.particles.length; i++) {
      this.restPositions[i] = this.particles[i].position.clone();
    }
  }
  
  public restoreRestSnapshot() {
    // Restore rest positions to initial configuration
    // Note: This doesn't move current positions, only resets rest state
    for (let i = 0; i < this.particles.length; i++) {
      // Keep the original rest positions from initialization
      // (Don't overwrite with current deformed state)
    }
  }
  
  public getRestPosition(index: number): Phaser.Math.Vector2 | null {
    if (index < 0 || index >= this.restPositions.length) return null;
    return this.restPositions[index].clone();
  }
  
  // Pin system for testing membrane behavior with "hold snap-back"
  public pinParticles(indices: number[], durationSec: number, softness = 1e-4) {
    for (const i of indices) {
      if (i >= 0 && i < this.particles.length) {
        this.pins.set(i, {
          target: this.particles[i].position.clone(),
          compliance: softness,
          t: durationSec
        });
      }
    }
  }
  
  public clearPins() {
    this.pins.clear();
  }
  
  private solvePins() {
    const h = this._dt;
    for (const [i, pin] of this.pins) {
      const p = this.particles[i];
      if (p.invMass === 0) continue;
      
      // XPBD one-point constraint: C(x) = x_i - target = 0
      const C = p.xPred.clone().subtract(pin.target);
      const w = p.invMass;
      if (w === 0) continue;
      
      const alpha = pin.compliance / (h * h);
      const denom = w + alpha;
      const lambda = -C.length() / Math.max(denom, 1e-6);
      const n = C.length() > 1e-6 ? C.clone().scale(1 / C.length()) : new Phaser.Math.Vector2();
      p.xPred.add(n.scale(lambda * w));
      
      // Lifetime management
      pin.t -= h;
      if (pin.t <= 0) {
        this.pins.delete(i);
      }
    }
  }
  
  public get isPinned(): boolean {
    return this.pins.size > 0;
  }
  
  /**
   * Cleanup
   */
  public destroy() {
    this.graphics.destroy();
  }
}
