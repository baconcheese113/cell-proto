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

export class MembranePhysicsSystem {
  private particles: ConstraintParticle[] = [];
  private graphics: Phaser.GameObjects.Graphics;
  
  // === XPBD PHYSICS PARAMETERS ===
  // Main membrane control knobs - adjust these to tune behavior
  private readonly alphaEdge = 3e-4;     // Lower = stretchier membrane (your main control!)
  private readonly alphaArea = 1e-4;     // Lower = more volume flexibility
  private readonly alphaBend = 2e-4;     // Lower = softer bending
  
  // Simulation parameters
  private readonly substeps = 2;         // Number of physics substeps per frame
  private readonly solverIterations = 8; // Constraint solver iterations per substep
  private readonly damping = 0.985;      // Velocity damping (0.97-0.99)
  private readonly maxVelocity = 250;    // Velocity clamp to prevent instability
  
  // Collision response parameters
  private readonly impactImpulseScale = 120; // Impulse strength for collisions
  
  // Adaptive compliance for membrane extrusion
  private readonly impactSofteningFrames = 10; // How long to soften after impact
  private readonly impactSofteningFactor = 3.0; // How much to soften (multiplier)
  
  // Internal simulation state
  private _dt: number = 1/60;
  private restEdge: number[] = [];
  private restArea: number = 0;
  
  // Center-of-mass tracking
  private centerPosition: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
  private centerAnchor: Phaser.Math.Vector2 | null = null;
  private centerAnchorCompliance: number = 2e-3;
  
  // Force accumulation and impact tracking
  private pendingForces: Map<number, Phaser.Math.Vector2> = new Map();
  private recentImpacts: Map<number, number> = new Map(); // particle index -> frames remaining

  constructor(scene: Phaser.Scene, config: {
    particles: Phaser.Math.Vector2[];
    restArea?: number;
    timeStep?: number;
    parent?: Phaser.GameObjects.Container;
  }) {
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
  public update(deltaTime: number) {
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

    // 3) XPBD substeps
    const h = deltaTime / this.substeps;
    for (let s = 0; s < this.substeps; s++) {
      // Predict positions
      for (const p of this.particles) {
        p.prevPosition.set(p.position.x, p.position.y);
        p.position.x += p.velocity.x * h;
        p.position.y += p.velocity.y * h;
      }

      // Solve constraints
      for (let k = 0; k < this.solverIterations; k++) {
        // Distance constraints (edges) with adaptive compliance
        for (let i = 0; i < this.particles.length; i++) {
          const j = (i + 1) % this.particles.length;
          
          let adaptiveAlpha = this.alphaEdge;
          if (this.recentImpacts.has(i) || this.recentImpacts.has(j)) {
            adaptiveAlpha *= this.impactSofteningFactor;
          }
          
          this.solveDistanceXPBD(this.particles[i], this.particles[j], this.restEdge[i], adaptiveAlpha, h);
        }

        // Bending smoothing
        const N = this.particles.length;
        for (let i = 0; i < N; i++) {
          const a = (i - 1 + N) % N, b = i, c = (i + 1) % N;
          this.solveBendSmoothing(this.particles[a], this.particles[b], this.particles[c], this.alphaBend, h);
        }

        // Area constraint (volume preservation)
        this.solveAreaXPBD(this.particles, this.restArea, this.alphaArea, h);
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
        p.velocity.x *= this.damping;
        p.velocity.y *= this.damping;
        
        // Velocity clamping
        const speed = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
        if (speed > this.maxVelocity) {
          const scale = this.maxVelocity / speed;
          p.velocity.x *= scale;
          p.velocity.y *= scale;
        }
      }
    }

    this.render();
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
  public applyImpulseAt(cellLocalPoint: Phaser.Math.Vector2, impulse: Phaser.Math.Vector2): void {
    this.updateCenter();
    const rel = cellLocalPoint.clone().subtract(this.centerPosition);
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
    
    // Apply impulse to closest particle and neighbors
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
      const weightedImpulse = impulse.clone().scale(weight);
      
      particle.velocity.add(weightedImpulse.scale(particle.invMass));
      
      // Track for adaptive compliance
      if (impulse.length() > 50) {
        this.recentImpacts.set(particleIndex, this.impactSofteningFrames);
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

  // === CENTER TRACKING ===

  public getCenter(): Phaser.Math.Vector2 {
    return this.centerPosition.clone();
  }
  
  public setCenterAnchor(anchor: Phaser.Math.Vector2 | null, compliance = 1e-3) {
    this.centerAnchor = anchor ? anchor.clone() : null;
    this.centerAnchorCompliance = compliance;
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
    
    const denom = totalInvMass + this.centerAnchorCompliance / dt2;
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
   * Apply impact force (compatibility method for endocytosis)
   */
  public applyImpact(contactPoint: Phaser.Math.Vector2, force: number, explicitDirection: Phaser.Math.Vector2 | null) {
    // Convert force to impulse and apply
    const dampedForce = force * 0.05;
    const impulseMag = Math.min(dampedForce * this.impactImpulseScale, 600);
    
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
    this.graphics.lineStyle(2, 0x00ff00, 0.8);
    this.graphics.fillStyle(0x00ff00, 0.1);
    
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

  public destroy() {
    this.graphics.destroy();
  }
}
