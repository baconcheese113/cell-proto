// cell-composition.ts — a cell IS its composition. The set of components a cell
// has built (organelles, membrane proteins, …) is the single source of truth;
// its CAPABILITIES (can it move? engulf? sense gradients?) and its METABOLIC
// BALANCE (energy gain vs upkeep) are *derived* from the components present.
// There is no authoritative "type" — change the components, change the cell
// (that's differentiation). A "preset" (cell-presets.ts) is only a convenient,
// randomized way to seed an initial composition.
//
// Pure + node-testable: no CPM/Phaser imports.

export type ComponentKind =
  | "nucleus"
  | "mitochondrion"
  | "ribosome"
  | "cytoskeleton" // grants motility
  | "flagellum" // grants fast motility
  | "phagocytic-receptor" // grants engulfing
  | "tearing-receptor" // grants trogocytosis (membrane ripping)
  | "chemoreceptor"; // grants gradient/prey sensing

export interface Component {
  kind: ComponentKind;
  /** Per-instance quality, usually randomized at spawn (~0.6..1.4). Scales the
   *  component's contribution to capabilities + metabolism. */
  strength: number;
}

/** What the cell can DO, derived from its components (0 = absent). Behavior reads
 *  these — never a type label. */
export interface Capabilities {
  /** Steering speed/strength; 0 = sessile. */
  motility: number;
  /** Engulfing power; 0 = cannot phagocytose. */
  phagocytic: number;
  /** Membrane-ripping power (trogocytosis); 0 = cannot tear. */
  tearing: number;
  /** Gradient/prey sensing; 0 = blind to gradients. */
  chemotaxis: number;
}

/** Passive per-tick energy economy derived from components. Active costs (e.g.
 *  moving) are added by the life-cycle layer. */
export interface MetabolicBalance {
  gain: number;
  drain: number;
}

interface CatalogEntry {
  /** Capability contributions per unit strength. */
  motility?: number;
  phagocytic?: number;
  tearing?: number;
  chemotaxis?: number;
  /** Passive energy produced per unit strength (mitochondria). */
  gain?: number;
  /** Passive upkeep cost per unit strength (everything costs something). */
  upkeep: number;
}

/** The honest-ish contribution table. Tunable; behavior/feel decide final values. */
export const COMPONENT_CATALOG: Record<ComponentKind, CatalogEntry> = {
  nucleus: { upkeep: 0.012 },
  mitochondrion: { gain: 0.09, upkeep: 0.01 },
  ribosome: { upkeep: 0.006 },
  cytoskeleton: { motility: 1.0, upkeep: 0.01 },
  flagellum: { motility: 1.7, upkeep: 0.016 },
  "phagocytic-receptor": { phagocytic: 1.0, upkeep: 0.008 },
  "tearing-receptor": { tearing: 1.0, upkeep: 0.009 },
  chemoreceptor: { chemotaxis: 1.0, upkeep: 0.007 },
};

/** Baseline cost of merely being alive (per tick), independent of components. */
export const BASE_DRAIN = 0.02;

export function deriveCapabilities(components: readonly Component[]): Capabilities {
  let motility = 0;
  let phagocytic = 0;
  let tearing = 0;
  let chemotaxis = 0;
  for (const c of components) {
    const e = COMPONENT_CATALOG[c.kind];
    motility += (e.motility ?? 0) * c.strength;
    phagocytic += (e.phagocytic ?? 0) * c.strength;
    tearing += (e.tearing ?? 0) * c.strength;
    chemotaxis += (e.chemotaxis ?? 0) * c.strength;
  }
  return { motility, phagocytic, tearing, chemotaxis };
}

export function deriveMetabolism(components: readonly Component[]): MetabolicBalance {
  let gain = 0;
  let drain = BASE_DRAIN;
  for (const c of components) {
    const e = COMPONENT_CATALOG[c.kind];
    gain += (e.gain ?? 0) * c.strength;
    drain += e.upkeep * c.strength;
  }
  return { gain, drain };
}

/** A minimal RNG interface so spawning/mutation is deterministic in tests. */
export type Rng = () => number; // returns [0,1)

/** Deep-copy a component list, jittering each strength by ±`amount` (fraction) and
 *  clamping to a sane range. Used on division so children differ from parents —
 *  the seed of emergent differentiation. */
export function mutateComponents(
  components: readonly Component[],
  rng: Rng,
  amount = 0.12
): Component[] {
  return components.map((c) => {
    const jitter = 1 + (rng() * 2 - 1) * amount;
    const s = Math.max(0.3, Math.min(2, c.strength * jitter));
    return { kind: c.kind, strength: s };
  });
}

/** A cell's mutable composition + its derived (cached) capabilities/metabolism.
 *  Mutating the components recomputes the derived values — differentiation is just
 *  changing what's in here. */
export class CellComposition {
  readonly components: Component[];
  private _caps: Capabilities;
  private _metab: MetabolicBalance;

  constructor(components: Component[]) {
    this.components = components;
    this._caps = deriveCapabilities(components);
    this._metab = deriveMetabolism(components);
  }

  get capabilities(): Capabilities {
    return this._caps;
  }
  get metabolism(): MetabolicBalance {
    return this._metab;
  }

  /** Recompute derived values (call after mutating `components`). */
  refresh(): void {
    this._caps = deriveCapabilities(this.components);
    this._metab = deriveMetabolism(this.components);
  }

  add(kind: ComponentKind, strength: number): void {
    this.components.push({ kind, strength });
    this.refresh();
  }

  /** Remove the first component of a kind (returns true if one was removed). */
  remove(kind: ComponentKind): boolean {
    const i = this.components.findIndex((c) => c.kind === kind);
    if (i < 0) return false;
    this.components.splice(i, 1);
    this.refresh();
    return true;
  }

  has(kind: ComponentKind): boolean {
    return this.components.some((c) => c.kind === kind);
  }

  /** A child composition for division: mutated copy of this one. */
  childComposition(rng: Rng, amount = 0.12): CellComposition {
    return new CellComposition(mutateComponents(this.components, rng, amount));
  }
}
