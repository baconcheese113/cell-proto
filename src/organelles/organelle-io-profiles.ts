/**
 * Organelle I/O Profiles - Milestone 3 Production/Consumption System
 * 
 * Defines what each organelle type consumes and produces per processing unit.
 */

import type { SpeciesId } from "../species/species-registry";

export interface OrganelleIOSpec {
  id: SpeciesId; // Species ID
  rate: number; // units per processing unit
}

export interface OrganelleIOProfile {
  capPerTick: number;  // Maximum processing units per tick
  priority: number;    // Lower number = higher priority (processed first)
  inputs: OrganelleIOSpec[];   // Species consumed
  outputs: OrganelleIOSpec[];  // Species produced
}

/**
 * Central configuration for all organelle I/O profiles
 * Numbers are tuned for balanced gameplay
 */
export const ORGANELLE_IO_PROFILES: Record<string, OrganelleIOProfile> = {
  // Nucleus - transcription: nucleotides -> pre-mRNA
  nucleus: {
    capPerTick: 3,
    priority: 1,
    inputs: [
      { id: "NT", rate: 0.8 }  // Nucleotide consumption
    ],
    outputs: [
      { id: "PRE_MRNA", rate: 0.3 }  // Pre-mRNA production
    ]
  },

  // Ribosome Hub - translation: amino acids + pre-mRNA -> proteins
  "ribosome-hub": {
    capPerTick: 3,
    priority: 2,
    inputs: [
      { id: "AA", rate: 0.6 },       // Amino acid consumption
      { id: "PRE_MRNA", rate: 0.2 }  // Pre-mRNA consumption
    ],
    outputs: [
      { id: "PROTEIN", rate: 0.4 }   // Protein production
    ]
  },

  // Proto-ER - processing: proteins -> cargo
  "proto-er": {
    capPerTick: 2,
    priority: 3,
    inputs: [
      { id: "PROTEIN", rate: 0.5 }   // Protein consumption
    ],
    outputs: [
      { id: "CARGO", rate: 0.3 }     // Cargo production
    ]
  }
};

/**
 * Get I/O profile for an organelle type
 */
export function getOrganelleIOProfile(organelleType: string): OrganelleIOProfile | undefined {
  return ORGANELLE_IO_PROFILES[organelleType];
}

/**
 * Check if an organelle type has an I/O profile
 */
export function hasIOProfile(organelleType: string): boolean {
  return organelleType in ORGANELLE_IO_PROFILES;
}

/**
 * Get all organelle types that have I/O profiles
 */
export function getActiveOrganelleTypes(): string[] {
  return Object.keys(ORGANELLE_IO_PROFILES);
}
