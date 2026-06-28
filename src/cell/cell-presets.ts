// cell-presets.ts — presets are ONLY a convenience for spawning. A preset is a
// named bundle of component specs (with randomization ranges) plus which CPM body
// profile to use. Rolling a preset produces a randomized `Component[]` — after
// that the cell is defined entirely by its (mutable) composition, not the preset.
// Two cells from the same preset differ because their component strengths (and
// counts, later) are randomized.
//
// Kept node-testable: only TYPE imports from cell-composition (erased at runtime),
// and bodies are referenced by a string key the scene resolves to a CpmCellProfile
// — so this module has no runtime relative imports.

import type { Component, ComponentKind, Rng } from "./cell-composition";

/** Which base CPM physics profile a preset's body uses (resolved in the scene). */
export type BodyKey =
  | "macrophage"
  | "epithelial"
  | "microbe"
  | "endothelial"
  | "fibroblast";

interface ComponentSpec {
  kind: ComponentKind;
  /** Strength rolled uniformly in [min, max] per instance. */
  min: number;
  max: number;
  /** How many to add (default 1). */
  count?: number;
}

export interface CellPreset {
  name: string;
  body: BodyKey;
  components: ComponentSpec[];
}

export const PRESETS: Record<string, CellPreset> = {
  // A motile hunter: senses prey (chemoreceptor), chases (cytoskeleton), engulfs
  // (phagocytic-receptor), well-powered (2 mitochondria).
  macrophage: {
    name: "macrophage",
    body: "macrophage",
    components: [
      { kind: "nucleus", min: 0.9, max: 1.1 },
      { kind: "mitochondrion", min: 0.8, max: 1.3, count: 2 },
      { kind: "cytoskeleton", min: 0.9, max: 1.4 },
      { kind: "phagocytic-receptor", min: 0.9, max: 1.5 },
      { kind: "chemoreceptor", min: 0.8, max: 1.2 },
    ],
  },
  // Sessile, cohesive tissue: no motility, no phagocytosis. Holds and divides.
  epithelial: {
    name: "epithelial",
    body: "epithelial",
    components: [
      { kind: "nucleus", min: 0.9, max: 1.1 },
      { kind: "mitochondrion", min: 0.7, max: 1.1 },
      { kind: "ribosome", min: 0.8, max: 1.2, count: 2 },
    ],
  },
  // Fast, simple, multiplies and flees: a flagellum but no phagocytosis.
  microbe: {
    name: "microbe",
    body: "microbe",
    components: [
      { kind: "nucleus", min: 0.7, max: 1.0 },
      { kind: "mitochondrion", min: 0.9, max: 1.4 },
      { kind: "flagellum", min: 1.0, max: 1.6 },
    ],
  },
  // The vessel lining: sessile, cohesive, slow metabolism (net ~neutral so the
  // wall turns over slowly rather than over-dividing). No motility/phagocytosis.
  endothelial: {
    name: "endothelial",
    body: "endothelial",
    components: [
      { kind: "nucleus", min: 0.9, max: 1.1 },
      { kind: "mitochondrion", min: 0.7, max: 1.0 },
      { kind: "ribosome", min: 0.9, max: 1.2, count: 2 },
    ],
  },
  // Tissue beyond the lining. Same sessile/cohesive shape, slightly leaner.
  fibroblast: {
    name: "fibroblast",
    body: "fibroblast",
    components: [
      { kind: "nucleus", min: 0.8, max: 1.0 },
      { kind: "mitochondrion", min: 0.7, max: 1.0 },
      { kind: "ribosome", min: 0.8, max: 1.1, count: 2 },
    ],
  },
};

/** Roll a preset into a concrete, randomized component list. */
export function rollComponents(preset: CellPreset, rng: Rng): Component[] {
  const out: Component[] = [];
  for (const s of preset.components) {
    const n = s.count ?? 1;
    for (let i = 0; i < n; i++) {
      out.push({ kind: s.kind, strength: s.min + rng() * (s.max - s.min) });
    }
  }
  return out;
}
