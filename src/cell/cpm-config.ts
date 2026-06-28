// CPM world + cell-type configuration.
//
// Cell types are parameter vectors (the plan's rock/paper/scissors balance lever).
// World config defines the lattice resolution ("quality") and the world<->lattice
// scale for the player-anchored simulation bubble.

/** A CPM cell-type parameter vector. Index [0] of every per-kind array is the
 *  background; index [1] is this kind. */
export interface CpmCellProfile {
  readonly name: string;
  /** Display tint (0xRRGGBB) for this cell type. */
  readonly color: number;
  /** Target area in lattice pixels (turgor) + constraint strength. */
  readonly volume: number;
  readonly lambdaV: number;
  /** Target perimeter (membrane tension / "thickness") + strength. Higher =
   *  rounder, stiffer, harder to squeeze/tear. */
  readonly perimeter: number;
  readonly lambdaP: number;
  /** Act-model protrusion: memory (MAX_ACT) + strength WHILE STEERING. At rest
   *  the effective strength drops to `lambdaActRest` so the cell holds still. */
  readonly maxAct: number;
  readonly lambdaAct: number;
  readonly lambdaActRest: number;
  /** Cohesion: penalty for locally disconnecting the cell (tear-resistance).
   *  Condition-gated tearing overcomes this; it is NOT an absolute lock. */
  readonly lambdaConnectivity: number;
  /** Steering strength (attraction-point) while a destination is commanded. */
  readonly steerLambda: number;
  /** Adhesion of this kind's boundary with the background medium. */
  readonly jWithMedium: number;
  /** Adhesion of this kind's boundary with OTHER cells (lower = stickier). */
  readonly jWithOther: number;
}

// NB: tuned via node parameter sweep — responsive crawl WHILE steered, near-zero
// centroid drift at rest, intact (1 connected component) throughout. Hotter Act +
// slightly looser perimeter drives the crawl; the soft connectivity penalty is
// cheap and resists spontaneous fragmentation without blocking motion.

/** The player's amoeboid cell: soft, motile, steerable, rests when idle. */
export const PLAYER_PROFILE: CpmCellProfile = {
  name: "player",
  color: 0x49d0ff,
  // Large enough that 15+ small organelles stay a minority of the cell's area,
  // leaving thick cytoplasm so vigorous crawling never pinches the cell apart.
  // (A small cell crowded with compartments fragments when it moves.)
  volume: 1300,
  lambdaV: 50,
  perimeter: 400,
  lambdaP: 2,
  maxAct: 80,
  lambdaAct: 220, // active protrusion while steering (above this it self-fragments)
  lambdaActRest: 0, // idle = no protrusion drive -> rests (centroid stays put)
  lambdaConnectivity: 40, // strong cohesion: no spontaneous tearing under steering
  steerLambda: 220,
  jWithMedium: 20,
  jWithOther: 22,
};

/** A generic enemy/prey cell: a bit stiffer and slower than the player. */
export const ENEMY_PROFILE: CpmCellProfile = {
  name: "enemy",
  color: 0xff5d73,
  volume: 460,
  lambdaV: 50,
  perimeter: 230,
  lambdaP: 2,
  maxAct: 50,
  lambdaAct: 180,
  lambdaActRest: 8, // wanders gently on its own
  lambdaConnectivity: 40,
  steerLambda: 180,
  jWithMedium: 20,
  jWithOther: 22,
};

/** A prey that has been committed to digestion: volume target 0 so it shrinks
 *  away (no regrowth), inert, recoloured to read as "being digested". */
export const DIGESTING_PROFILE: CpmCellProfile = {
  name: "digesting",
  color: 0xffae42,
  volume: 0,
  lambdaV: 60,
  perimeter: 0,
  lambdaP: 0,
  maxAct: 0,
  lambdaAct: 0,
  lambdaActRest: 0,
  lambdaConnectivity: 0,
  steerLambda: 0,
  jWithMedium: 20,
  jWithOther: 20,
};

/** An organelle compartment (e.g. the nucleus): a sub-cell held INSIDE the
 *  cytosol by differential adhesion (loves cytosol, repelled by the medium), so
 *  it deforms and flows with the cell. Passive (no protrusion). Building a
 *  structure = growing one of these. */
export const NUCLEUS_PROFILE: CpmCellProfile = {
  name: "nucleus",
  color: 0x9b6cff,
  // Compartments must be SMALL relative to the cell: their combined volume has to
  // fit inside the cytosol with cytoplasm to spare, or they bulge through the
  // membrane. At ~26 px, 15+ structures still leave the ~540 px cell mostly
  // cytoplasm. (Distinct organelle kinds with their own sizes — a larger nucleus,
  // tiny ribosomes — come later; for now one shared profile.)
  volume: 26,
  // Deformable but stable: a firm volume target keeps the compartment from
  // collapsing/merging in the churning interior, while modest perimeter stiffness
  // still lets it squish and flow with the cytoplasm (organic) rather than riding
  // as a rigid pinned blob. (lambdaP is the deform-vs-survive dial.)
  lambdaV: 40,
  perimeter: 18,
  lambdaP: 2,
  maxAct: 0,
  lambdaAct: 0,
  lambdaActRest: 0,
  lambdaConnectivity: 20,
  steerLambda: 0,
  jWithMedium: 40, // strongly repelled by background -> stays internal
  jWithOther: 12,
};

/** A TISSUE cell: the body is packed with these. They form a cohesive sheet the
 *  player must SQUEEZE BETWEEN to migrate (amoeboid migration through tissue).
 *  Roughly the player's size so wedging between two neighbours is the skill;
 *  passive (no protrusion), deformable, and sticky to each other (cohesive) but
 *  pushable by a protruding player. */
export const TISSUE_PROFILE: CpmCellProfile = {
  name: "tissue",
  color: 0x6b8f9c,
  volume: 700,
  lambdaV: 45,
  // Deformable (low lambdaP) so the player can wedge them apart and they reflow.
  perimeter: 300,
  lambdaP: 2,
  maxAct: 0,
  lambdaAct: 0,
  lambdaActRest: 0,
  // Cohesive enough to hold the sheet together while being shoved, not so stiff
  // that the player can't open a gap.
  lambdaConnectivity: 20,
  steerLambda: 0,
  jWithMedium: 20,
  // Sticky to each other (low) -> a continuous tissue; the player overcomes this
  // locally to squeeze through a junction.
  jWithOther: 14,
};

/** A MICROBE body: small, fast, motile prey that multiplies and flees. The
 *  flagellum component (composition) is what grants its speed; this profile is
 *  just the physical body it animates. */
export const MICROBE_PROFILE: CpmCellProfile = {
  name: "microbe",
  color: 0xe7d14b,
  volume: 280,
  lambdaV: 50,
  perimeter: 150,
  lambdaP: 2,
  maxAct: 60,
  lambdaAct: 200,
  lambdaActRest: 10, // drifts on its own
  lambdaConnectivity: 30,
  steerLambda: 200,
  jWithMedium: 20,
  jWithOther: 22,
};

export interface CpmWorldConfig {
  /** Square lattice edge in pixels — the "quality" dial. Higher = sharper +
   *  slower. The lattice is the player-anchored bubble, recentered for an
   *  effectively infinite world. */
  readonly fieldSize: number;
  /** World pixels per lattice pixel (the world<->lattice magnification). */
  readonly worldPerPixel: number;
  /** Monte-Carlo temperature (global fluctuation). Lower = calmer membranes. */
  readonly temperature: number;
  /** Monte-Carlo sweeps to advance per rendered frame. */
  readonly stepsPerFrame: number;
  /** When the player centroid drifts this fraction of the field from center,
   *  recenter the bubble (infinite-world streaming). */
  readonly recenterMargin: number;
  /** RNG seed. */
  readonly seed: number;
}

export const DEFAULT_WORLD_CONFIG: CpmWorldConfig = {
  fieldSize: 220,
  worldPerPixel: 4,
  temperature: 16,
  stepsPerFrame: 2,
  recenterMargin: 0.22,
  seed: 1,
};
