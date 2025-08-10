/**
 * Species Registry - Milestone 2 Task 1
 * 
 * Centralized registry for all species in the cellular environment.
 * Each species has diffusion properties and constraints.
 */

export interface SpeciesData {
  id: string;
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
  private species: Map<string, SpeciesData> = new Map();

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
  }

  private registerSpecies(species: SpeciesData): void {
    this.species.set(species.id, species);
  }

  /**
   * Get all registered species IDs
   */
  public getAllSpeciesIds(): string[] {
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
  public getSpecies(id: string): SpeciesData | undefined {
    return this.species.get(id);
  }

  /**
   * Check if a species exists
   */
  public hasSpecies(id: string): boolean {
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
  public createEmptyConcentrations(): Record<string, number> {
    const concentrations: Record<string, number> = {};
    for (const id of this.getAllSpeciesIds()) {
      concentrations[id] = 0;
    }
    return concentrations;
  }
}

// Export singleton instance
export const speciesRegistry = new SpeciesRegistry();

// Helper functions for easy access
export function getAllSpeciesIds(): string[] {
  return speciesRegistry.getAllSpeciesIds();
}

export function getAllSpecies(): SpeciesData[] {
  return speciesRegistry.getAllSpecies();
}

export function getSpecies(id: string): SpeciesData | undefined {
  return speciesRegistry.getSpecies(id);
}

export function hasSpecies(id: string): boolean {
  return speciesRegistry.hasSpecies(id);
}

export function createEmptyConcentrations(): Record<string, number> {
  return speciesRegistry.createEmptyConcentrations();
}
