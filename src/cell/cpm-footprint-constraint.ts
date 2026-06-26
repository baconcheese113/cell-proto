// CpmFootprintConstraint — a fork extension of Artistoo. The single soft link
// between the CPM membrane and the big-organelle soft bodies: it holds a mask of
// the organelles' current footprint pixels (rasterized each frame by the soft
// bodies) and penalizes the host for retracting cytoplasm off them / rewards
// covering them. From this one coupling: squeeze narrow -> the cell must keep
// cytoplasm over the (incompressible) nucleus -> BOTTLENECK; force it narrower
// than the nucleus can deform -> footprint exposed -> the manager raises stress
// to RUPTURE. The cost math is the node-tested `footprintDeltaH`.

import {
  SoftConstraint,
  type IndexCoordinate,
  type CellId,
} from "../vendor/artistoo";
import { footprintDeltaH } from "./footprint-cost";

export class CpmFootprintConstraint extends SoftConstraint {
  private mark: Uint8Array;
  private hostId = 0;
  private lambda = 0;

  constructor(field: number) {
    super({});
    this.mark = new Uint8Array(field * field);
  }

  /** Replace the footprint mask for this frame (all big organelles share one
   *  host = the player, so they accumulate into one mask). lambda=0 disables. */
  setFootprint(
    hostId: CellId,
    cells: Iterable<[number, number]>,
    field: number,
    lambda: number
  ): void {
    this.mark.fill(0);
    for (const [x, y] of cells) {
      if (x >= 0 && x < field && y >= 0 && y < field) this.mark[y * field + x] = 1;
    }
    this.hostId = hostId;
    this.lambda = lambda;
  }

  deltaH(
    _src_i: IndexCoordinate,
    tgt_i: IndexCoordinate,
    src_type: CellId,
    tgt_type: CellId
  ): number {
    if (this.lambda === 0) return 0;
    return footprintDeltaH(
      this.mark,
      this.hostId,
      tgt_i as unknown as number,
      src_type,
      tgt_type,
      this.lambda
    );
  }
}
