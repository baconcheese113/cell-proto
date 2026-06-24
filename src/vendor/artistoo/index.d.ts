// Hand-written types for the vendored Artistoo ESM core (see ./index.js).
// Artistoo ships no type declarations; this covers the subset the game uses.
// Internals we don't touch are intentionally `any`.

export type ArrayCoordinate = number[]; // [x, y] (or [x, y, z])
export type IndexCoordinate = number; // bit-packed grid index
export type CellId = number;
export type CellKind = number;

/** A non-background pixel: [ [x,y], cellId ]. */
export type Pixel = [ArrayCoordinate, CellId];

export class Grid {
  extents: number[];
  torus: boolean[];
  p2i(p: ArrayCoordinate): IndexCoordinate;
  i2p(i: IndexCoordinate): ArrayCoordinate;
  pixt(p: ArrayCoordinate): number;
  pixti(i: IndexCoordinate): number;
  setpix(p: ArrayCoordinate, t: number): void;
  setpixi(i: IndexCoordinate, t: number): void;
  pixels(): IterableIterator<Pixel>;
  pixelsi(): IterableIterator<IndexCoordinate>;
  neighi(i: IndexCoordinate, torus?: boolean[]): IndexCoordinate[];
}

export class Grid2D extends Grid {
  constructor(extents: number[], torus?: boolean[], datatype?: "Uint16" | "Float32");
}

export class CoarseGrid extends Grid2D {
  constructor(grid: Grid2D, upscale?: number);
}

export class GridBasedModel {
  grid: Grid;
  extents: number[];
  midpoint: ArrayCoordinate;
  time: number;
  conf: Record<string, unknown>;
  pixt(p: ArrayCoordinate): number;
  setpix(p: ArrayCoordinate, t: number): void;
  cellKind(id: CellId): CellKind;
  getStat(stat: unknown): unknown;
  timeStep(): void;
}

export class CPM extends GridBasedModel {
  constructor(field_size: number[], conf: Record<string, unknown>);
  isCPM: boolean;
  nr_cells: number;
  add(constraint: unknown): void;
  getConstraint(name: string, num?: number): any;
  makeNewCellID(kind: CellKind): CellId;
  cellPixels(): IterableIterator<Pixel>;
}

export class CPMEvol extends CPM {}
export class CA extends GridBasedModel {}

export class GridManipulator {
  constructor(C: CPM | GridBasedModel | Grid);
  seedCell(kind: CellKind, max_attempts?: number): CellId;
  seedCellAt(kind: CellKind, p: ArrayCoordinate): CellId;
  killCell(cellID: CellId): void;
}

// --- Constraints (all take a conf object). Typed loosely on purpose. ---
declare class Constraint {
  constructor(conf: Record<string, unknown>);
  conf: Record<string, unknown>;
  CPM: CPM;
}
export class SoftConstraint extends Constraint {}
export class HardConstraint extends Constraint {}
export class Adhesion extends SoftConstraint {}
export class VolumeConstraint extends SoftConstraint {}
export class PerimeterConstraint extends SoftConstraint {}
export class ActivityConstraint extends SoftConstraint {
  /** Activity (0..MAX_ACT) at a pixel index — used for protrusion rendering. */
  pxact(i: IndexCoordinate): number;
  cellpixelsact: Record<number, number>;
}
export class ActivityMultiBackground extends ActivityConstraint {}
export class PersistenceConstraint extends SoftConstraint {}
export class PreferredDirectionConstraint extends SoftConstraint {}
export class ChemotaxisConstraint extends SoftConstraint {}
export class AttractionPointConstraint extends SoftConstraint {}
export class ConnectivityConstraint extends HardConstraint {}
export class SoftConnectivityConstraint extends SoftConstraint {}
export class LocalConnectivityConstraint extends HardConstraint {}
export class SoftLocalConnectivityConstraint extends SoftConstraint {}
export class HardVolumeRangeConstraint extends HardConstraint {}
export class BarrierConstraint extends HardConstraint {}
export class BorderConstraint extends HardConstraint {}

export class ParameterChecker {
  constructor(conf: Record<string, unknown>, C: CPM);
}

// --- Stats (constructed and passed to model.getStat). ---
export class Stat {}
export class PixelsByCell extends Stat {}
export class BorderPixelsByCell extends Stat {}
export class Centroids extends Stat {}
export class CentroidsWithTorusCorrection extends Stat {}
export class CellNeighborList extends Stat {}
export class ConnectedComponentsByCell extends Stat {}
export class Connectedness extends Stat {}

export class Cell {}
export class Divider {}
