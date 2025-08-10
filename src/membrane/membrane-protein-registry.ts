/**
 * Membrane Protein Registry - Milestone 6 Task 3
 * 
 * Registry for membrane proteins with behavior metadata.
 * Defines transporters and receptors that can be installed on membrane tiles.
 */

import type { SpeciesId } from "../species/species-registry";

export type MembraneProteinKind = 'transporter' | 'receptor';
export type TransportDirection = 'in' | 'out';

export interface TransporterProtein {
  kind: 'transporter';
  id: string;
  label: string;
  speciesId: SpeciesId;
  direction: TransportDirection;
  ratePerTick: number; // positive value, direction determines sign
  color?: number;
}

export interface ReceptorProtein {
  kind: 'receptor';
  id: string;
  label: string;
  ligandId: SpeciesId; // external ligand detected
  messengerId: SpeciesId; // internal signal produced
  messengerRate: number; // signal production rate per tick
  color?: number;
}

export type MembraneProtein = TransporterProtein | ReceptorProtein;

/**
 * Membrane protein registry
 */
class MembraneProteinRegistry {
  private proteins: Map<string, MembraneProtein> = new Map();

  constructor() {
    this.initializeProteins();
  }

  private initializeProteins(): void {
    // Transporters (constant flux)
    this.registerProtein({
      kind: 'transporter',
      id: 'GLUT',
      label: 'GLUT Transporter',
      speciesId: 'GLUCOSE',
      direction: 'in',
      ratePerTick: 0.05,
      color: 0xffd93d
    });

    this.registerProtein({
      kind: 'transporter',
      id: 'AA_TRANSPORTER',
      label: 'AA Transporter',
      speciesId: 'AA',
      direction: 'in',
      ratePerTick: 0.04,
      color: 0x8ef58a
    });

    this.registerProtein({
      kind: 'transporter',
      id: 'NT_TRANSPORTER',
      label: 'NT Transporter',
      speciesId: 'NT',
      direction: 'in',
      ratePerTick: 0.03,
      color: 0x52a7ff
    });

    this.registerProtein({
      kind: 'transporter',
      id: 'ROS_EXPORTER',
      label: 'ROS Exporter',
      speciesId: 'ROS',
      direction: 'out',
      ratePerTick: 0.06,
      color: 0xff6b6b
    });

    this.registerProtein({
      kind: 'transporter',
      id: 'SECRETION_PUMP',
      label: 'Secretion Pump',
      speciesId: 'CARGO',
      direction: 'out',
      ratePerTick: 0.08,
      color: 0x66ff99
    });

    // Receptors (ligand → messenger)
    this.registerProtein({
      kind: 'receptor',
      id: 'GROWTH_FACTOR_RECEPTOR',
      label: 'Growth Factor Receptor',
      ligandId: 'LIGAND_GROWTH',
      messengerId: 'SIGNAL',
      messengerRate: 0.04,
      color: 0xff33ff
    });
  }

  private registerProtein(protein: MembraneProtein): void {
    this.proteins.set(protein.id, protein);
  }

  public getProtein(id: string): MembraneProtein | undefined {
    return this.proteins.get(id);
  }

  public getAllProteins(): MembraneProtein[] {
    return Array.from(this.proteins.values());
  }

  public getTransporters(): TransporterProtein[] {
    return this.getAllProteins().filter(p => p.kind === 'transporter') as TransporterProtein[];
  }

  public getReceptors(): ReceptorProtein[] {
    return this.getAllProteins().filter(p => p.kind === 'receptor') as ReceptorProtein[];
  }

  public getProteinIds(): string[] {
    return Array.from(this.proteins.keys());
  }
}

// Export singleton instance
export const MEMBRANE_PROTEIN_REGISTRY = new MembraneProteinRegistry();

// Helper functions
export function getMembraneProtein(id: string): MembraneProtein | undefined {
  return MEMBRANE_PROTEIN_REGISTRY.getProtein(id);
}

export function getAllMembraneProteins(): MembraneProtein[] {
  return MEMBRANE_PROTEIN_REGISTRY.getAllProteins();
}

export function getTransporterProteins(): TransporterProtein[] {
  return MEMBRANE_PROTEIN_REGISTRY.getTransporters();
}

export function getReceptorProteins(): ReceptorProtein[] {
  return MEMBRANE_PROTEIN_REGISTRY.getReceptors();
}
