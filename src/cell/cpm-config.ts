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
  volume: 540,
  lambdaV: 50,
  perimeter: 260,
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
