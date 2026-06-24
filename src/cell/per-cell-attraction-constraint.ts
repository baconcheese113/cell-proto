// PerCellAttractionConstraint — a fork extension of Artistoo.
//
// Artistoo's AttractionPointConstraint biases motion toward a point PER CELL
// KIND. We need it PER CELL ID so every cell (the player, each enemy, and later
// each cargo vesicle) can be commanded toward its own target at its own
// strength. This is the unified "command a direction, drift that way, strength =
// speed" primitive the plan builds both motility and intracellular transport on.
//
// The deltaH math mirrors Artistoo's AttractionPointConstraint: reward copy
// attempts whose direction aligns with the source pixel -> target direction.

import { SoftConstraint, type CPM, type IndexCoordinate, type CellId } from "../vendor/artistoo";

export class PerCellAttractionConstraint extends SoftConstraint {
  /** cellId -> attraction target in lattice coords. */
  readonly targets = new Map<CellId, [number, number]>();
  /** cellId -> strength (0 = no bias). */
  readonly lambdas = new Map<CellId, number>();

  // Set by CPM.add() via the base `set CPM`. Declared for typing.
  declare C: CPM;

  constructor() {
    super({});
  }

  setTarget(id: CellId, x: number, y: number, lambda: number): void {
    this.targets.set(id, [x, y]);
    this.lambdas.set(id, lambda);
  }

  clear(id: CellId): void {
    this.lambdas.set(id, 0);
  }

  forget(id: CellId): void {
    this.targets.delete(id);
    this.lambdas.delete(id);
  }

  deltaH(
    src_i: IndexCoordinate,
    tgt_i: IndexCoordinate,
    src_type: CellId
  ): number {
    const l = this.lambdas.get(src_type);
    if (!l) return 0;
    const tgt = this.targets.get(src_type);
    if (!tgt) return 0;

    const torus = (this.C.conf as { torus: boolean[] }).torus;
    const p1 = this.C.grid.i2p(src_i);
    const p2 = this.C.grid.i2p(tgt_i);
    let r = 0,
      ldir = 0;
    for (let i = 0; i < p1.length; i++) {
      const dir_i = tgt[i] - p1[i];
      ldir += dir_i * dir_i;
      let dx = p2[i] - p1[i];
      const si = this.C.extents[i];
      if (torus[i]) {
        if (dx > si / 2) dx -= si;
        else if (dx < -si / 2) dx += si;
      }
      r += dx * dir_i;
    }
    if (ldir === 0) return 0;
    return (-r * l) / Math.sqrt(ldir);
  }
}
