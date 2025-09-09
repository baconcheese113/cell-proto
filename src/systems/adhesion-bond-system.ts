/**
 * Adhesion bond between a vesicle and membrane particle
 */
export interface AdhesionBond {
  id: string;
  vesicleId: string;
  membraneParticleIndex: number;
  restLength: number;
  currentLength: number;
  force: number; // Current bond force magnitude
  creationTime: number;
  alpha: number; // Bond strength/compliance
}

/**
 * Bell model parameters for adhesion bond kinetics
 */
export interface BondKinetics {
  kon: number; // Bond formation rate constant (per second)
  koff0: number; // Base bond breaking rate constant (per second)
  fo: number; // Characteristic force for force-dependent unbinding (pN)
  captureRadius: number; // Distance within which bonds can form (pixels)
  alphaAdhesion: number; // Bond compliance/strength
}

/**
 * Stochastic adhesion bond system implementing Bell model kinetics
 */
export class AdhesionBondSystem {
  private bonds: Map<string, AdhesionBond> = new Map();
  private bondCounter = 0;
  
  // Default Bell model parameters for vesicle-membrane adhesion
  private kinetics: BondKinetics = {
    kon: 2.0,      // Moderate bond formation rate
    koff0: 0.5,    // Base unbinding rate 
    fo: 50,        // Force scale for unbinding
    captureRadius: 20, // Bond formation radius
    alphaAdhesion: 5e-4 // Bond compliance
  };

  constructor(kinetics?: Partial<BondKinetics>) {
    if (kinetics) {
      this.kinetics = { ...this.kinetics, ...kinetics };
    }
  }

  /**
   * Update all bonds and handle formation/breaking based on Bell model
   */
  public update(deltaTime: number, vesicles: any[], membraneParticles: any[]): void {
    // Process existing bonds - check for breaking
    this.processExistingBonds(deltaTime, vesicles, membraneParticles);
    
    // Check for new bond formation
    this.checkBondFormation(deltaTime, vesicles, membraneParticles);
  }

  private processExistingBonds(deltaTime: number, vesicles: any[], membraneParticles: any[]): void {
    const bondsToRemove: string[] = [];
    
    for (const [bondId, bond] of this.bonds) {
      // Find vesicle and membrane particle
      const vesicle = vesicles.find(v => v.id === bond.vesicleId);
      const membraneParticle = membraneParticles[bond.membraneParticleIndex];
      
      if (!vesicle || !membraneParticle) {
        bondsToRemove.push(bondId);
        continue;
      }
      
      // Update bond geometry
      const vesiclePos = vesicle.position;
      const membranePos = membraneParticle.position;
      const currentLength = vesiclePos.distance(membranePos);
      bond.currentLength = currentLength;
      
      // Calculate bond force using spring law
      const stretch = currentLength - bond.restLength;
      bond.force = Math.abs(stretch) / bond.alpha; // Force = stretch / compliance
      
      // Bell model unbinding probability
      const koffEffective = this.kinetics.koff0 * Math.exp(bond.force / this.kinetics.fo);
      const unbindingProbability = koffEffective * deltaTime;
      
      if (Math.random() < unbindingProbability) {
        bondsToRemove.push(bondId);
        console.log(`🔗 Bond ${bondId} broke (force: ${bond.force.toFixed(1)}pN, prob: ${unbindingProbability.toFixed(3)})`);
      }
    }
    
    // Remove broken bonds
    for (const bondId of bondsToRemove) {
      this.bonds.delete(bondId);
    }
  }

  private checkBondFormation(deltaTime: number, vesicles: any[], membraneParticles: any[]): void {
    for (const vesicle of vesicles) {
      // Check if vesicle already has bonds (limit concurrent bonds)
      const existingBonds = Array.from(this.bonds.values()).filter(b => b.vesicleId === vesicle.id);
      if (existingBonds.length >= 3) continue; // Max 3 bonds per vesicle
      
      for (let i = 0; i < membraneParticles.length; i++) {
        const membraneParticle = membraneParticles[i];
        const distance = vesicle.position.distance(membraneParticle.position);
        
        // Check if within capture radius and no existing bond
        if (distance <= this.kinetics.captureRadius) {
          const existingBond = Array.from(this.bonds.values()).find(b => 
            b.vesicleId === vesicle.id && b.membraneParticleIndex === i
          );
          
          if (!existingBond) {
            // Bell model binding probability
            const bindingProbability = this.kinetics.kon * deltaTime;
            
            if (Math.random() < bindingProbability) {
              const bondId = `bond_${this.bondCounter++}`;
              const bond: AdhesionBond = {
                id: bondId,
                vesicleId: vesicle.id,
                membraneParticleIndex: i,
                restLength: distance * 0.9, // Slightly compressed rest length
                currentLength: distance,
                force: 0,
                creationTime: Date.now(),
                alpha: this.kinetics.alphaAdhesion
              };
              
              this.bonds.set(bondId, bond);
              console.log(`🔗 Bond ${bondId} formed between vesicle ${vesicle.id} and membrane particle ${i} (dist: ${distance.toFixed(1)}px)`);
            }
          }
        }
      }
    }
  }

  /**
   * Apply bond forces to vesicles and membrane particles
   */
  public applyBondForces(vesicles: any[], membraneParticles: any[]): void {
    for (const bond of this.bonds.values()) {
      const vesicle = vesicles.find(v => v.id === bond.vesicleId);
      const membraneParticle = membraneParticles[bond.membraneParticleIndex];
      
      if (!vesicle || !membraneParticle) continue;
      
      // Calculate spring force
      const vesiclePos = vesicle.position;
      const membranePos = membraneParticle.position;
      const delta = membranePos.clone().subtract(vesiclePos);
      const currentLength = delta.length();
      
      if (currentLength > 0) {
        const stretch = currentLength - bond.restLength;
        const forceDirection = delta.normalize();
        const forceMagnitude = stretch / bond.alpha; // Spring force
        
        // Apply equal and opposite forces
        const force = forceDirection.scale(forceMagnitude);
        
        // Apply to vesicle (if it has addForce method)
        if (vesicle.addForce) {
          vesicle.addForce(force.clone().scale(0.1)); // Gentle force to vesicle
        }
        
        // Apply to membrane particle (via pending forces system)
        // Note: This would need integration with membrane physics system
        // For now, we'll just track the force for visualization
        bond.force = forceMagnitude;
      }
    }
  }

  /**
   * Get all active bonds for visualization/debugging
   */
  public getBonds(): AdhesionBond[] {
    return Array.from(this.bonds.values());
  }

  /**
   * Get bonds for a specific vesicle
   */
  public getVesicleBonds(vesicleId: string): AdhesionBond[] {
    return Array.from(this.bonds.values()).filter(b => b.vesicleId === vesicleId);
  }

  /**
   * Calculate bond density around membrane particles for endocytosis guidance
   */
  public getBondDensityMap(vesicleId: string, membraneParticles: any[], searchRadius: number = 30): Map<number, number> {
    const bondDensity = new Map<number, number>();
    const vesicleBonds = this.getVesicleBonds(vesicleId);
    
    if (vesicleBonds.length === 0) {
      return bondDensity;
    }
    
    // For each membrane particle, count nearby bonds and their accumulated forces
    for (let i = 0; i < membraneParticles.length; i++) {
      const particle = membraneParticles[i];
      let density = 0;
      
      for (const bond of vesicleBonds) {
        const bondParticle = membraneParticles[bond.membraneParticleIndex];
        if (!bondParticle) continue;
        
        // Calculate distance between this particle and the bonded particle
        const distance = particle.position.distance(bondParticle.position);
        
        if (distance <= searchRadius) {
          // Weight density by bond force and proximity
          const proximityWeight = 1 - (distance / searchRadius);
          const forceWeight = bond.force / 100; // Normalize force contribution
          density += proximityWeight * (1 + forceWeight);
        }
      }
      
      if (density > 0) {
        bondDensity.set(i, density);
      }
    }
    
    return bondDensity;
  }

  /**
   * Get statistics about current bond state
   */
  public getBondStats(): {
    totalBonds: number;
    avgForce: number;
    maxForce: number;
    avgAge: number;
  } {
    const bonds = Array.from(this.bonds.values());
    if (bonds.length === 0) {
      return { totalBonds: 0, avgForce: 0, maxForce: 0, avgAge: 0 };
    }
    
    const currentTime = Date.now();
    const totalForce = bonds.reduce((sum, b) => sum + b.force, 0);
    const maxForce = Math.max(...bonds.map(b => b.force));
    const totalAge = bonds.reduce((sum, b) => sum + (currentTime - b.creationTime), 0);
    
    return {
      totalBonds: bonds.length,
      avgForce: totalForce / bonds.length,
      maxForce,
      avgAge: totalAge / bonds.length / 1000 // Convert to seconds
    };
  }

  /**
   * Update kinetics parameters
   */
  public updateKinetics(newKinetics: Partial<BondKinetics>): void {
    this.kinetics = { ...this.kinetics, ...newKinetics };
  }

  /**
   * Clear all bonds
   */
  public clearAllBonds(): void {
    this.bonds.clear();
  }
}
