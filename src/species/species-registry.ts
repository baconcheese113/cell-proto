/**
 * Species Registry - Milestone 2 Task 1
 * 
 * Centralized registry for all species in the cellular environment.
 * Each species has diffusion properties and constraints.
 */

// Union type of all valid species IDs
export type SpeciesId = 
  | 'ATP'
  | 'AA' 
  | 'NT'
  | 'ROS'
  | 'GLUCOSE'
  | 'PRE_MRNA'
  | 'PROTEIN'
  | 'CARGO'
  | 'LIPID'
  | 'H2O'
  | 'CO2';

export interface SpeciesData {
  id: SpeciesId;
  label: string;
  diffusionCoefficient: number; // 0-1, fraction to exchange per tick
  minConcentration?: number;    // Optional lower clamp
  maxConcentration?: number;    // Optional upper clamp
  color?: number;               // Hex color for visualization
}

/**
 * Central species registry containing all species definitions
 */
class SpeciesRegistry {
  private species: Map<SpeciesId, SpeciesData> = new Map();

  constructor() {
    this.initializeSpecies();
  }

  private initializeSpecies(): void {
    // Core cellular energy and building blocks
    this.registerSpecies({
      id: 'ATP',
      label: 'ATP',
      diffusionCoefficient: 0.03, // Reduced for better observation
      minConcentration: 0,
      maxConcentration: 100,
      color: 0xffc300
    });

    this.registerSpecies({
      id: 'AA',
      label: 'Amino Acids',
      diffusionCoefficient: 0.025,
      minConcentration: 0,
      maxConcentration: 80,
      color: 0x8ef58a
    });

    this.registerSpecies({
      id: 'NT',
      label: 'Nucleotides', 
      diffusionCoefficient: 0.02,
      minConcentration: 0,
      maxConcentration: 60,
      color: 0x52a7ff
    });

    this.registerSpecies({
      id: 'ROS',
      label: 'Reactive Oxygen',
      diffusionCoefficient: 0.04, // Faster diffusion for ROS
      minConcentration: 0,
      maxConcentration: 40,
      color: 0xff6b6b
    });

    this.registerSpecies({
      id: 'GLUCOSE',
      label: 'Glucose',
      diffusionCoefficient: 0.015,
      minConcentration: 0,
      maxConcentration: 50,
      color: 0xffd93d
    });

    // New species for organelle processing - Milestone 3
    this.registerSpecies({
      id: 'PRE_MRNA',
      label: 'pre-mRNA',
      diffusionCoefficient: 0.01, // Slower, larger molecules
      minConcentration: 0,
      maxConcentration: 30,
      color: 0x9966ff
    });

    this.registerSpecies({
      id: 'PROTEIN',
      label: 'Protein Units',
      diffusionCoefficient: 0.008, // Even slower
      minConcentration: 0,
      maxConcentration: 25,
      color: 0xff9966
    });

    this.registerSpecies({
      id: 'CARGO',
      label: 'Cargo Vesicles',
      diffusionCoefficient: 0.005, // Slowest diffusion
      minConcentration: 0,
      maxConcentration: 20,
      color: 0x66ff99
    });
  }

  private registerSpecies(species: SpeciesData): void {
    this.species.set(species.id, species);
  }

  /**
   * Get all registered species IDs
   */
  public getAllSpeciesIds(): SpeciesId[] {
    return Array.from(this.species.keys());
  }

  /**
   * Get all species data
   */
  public getAllSpecies(): SpeciesData[] {
    return Array.from(this.species.values());
  }

  /**
   * Look up species metadata by ID
   */
  public getSpecies(id: SpeciesId): SpeciesData | undefined {
    return this.species.get(id);
  }

  /**
   * Check if a species exists
   */
  public hasSpecies(id: SpeciesId): boolean {
    return this.species.has(id);
  }

  /**
   * Get species count
   */
  public getSpeciesCount(): number {
    return this.species.size;
  }

  /**
   * Helper to create empty concentration object for all species
   */
  public createEmptyConcentrations(): Record<SpeciesId, number> {
    const concentrations: Record<string, number> = {};
    for (const id of this.getAllSpeciesIds()) {
      concentrations[id] = 0;
    }
    return concentrations as Record<SpeciesId, number>;
  }
}

// Export singleton instance
export const speciesRegistry = new SpeciesRegistry();

// Helper functions for easy access
export function getAllSpeciesIds(): SpeciesId[] {
  return speciesRegistry.getAllSpeciesIds();
}

export function getAllSpecies(): SpeciesData[] {
  return speciesRegistry.getAllSpecies();
}

export function getSpecies(id: SpeciesId): SpeciesData | undefined {
  return speciesRegistry.getSpecies(id);
}

export function hasSpecies(id: SpeciesId): boolean {
  return speciesRegistry.hasSpecies(id);
}

export function createEmptyConcentrations(): Record<SpeciesId, number> {
  return speciesRegistry.createEmptyConcentrations();
}
