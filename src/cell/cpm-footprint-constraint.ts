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
  /** Bits the grid uses to pack (x,y) -> index: p2i = (x << yBits) + y. The mask
   *  MUST be keyed by this same packed index, because deltaH receives `tgt_i` as
   *  that packed IndexCoordinate (not y*field+x). */
  private readonly yBits: number;

  constructor(field: number) {
    super({});
    this.yBits = 1 + Math.floor(Math.log2(field - 1));
    this.mark = new Uint8Array(field << this.yBits);
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
      if (x >= 0 && x < field && y >= 0 && y < field) {
        this.mark[(x << this.yBits) + y] = 1;
      }
    }
    this.hostId = hostId;
    this.lambda = lambda;
  }

  // --- reads for the GPU bridge (mirror this constraint into the GPU step) ---
  get host(): CellId { return this.hostId; }
  get strength(): number { return this.lambda; }
  /** Write a tight (y*field+x) 0/1 footprint mask into `out` (length field*field). Clears first;
   *  a no-op leaving it all-zero when the coupling is disabled. */
  writeTightMask(out: Uint32Array, field: number): void {
    out.fill(0);
    if (this.lambda === 0) return;
    const yb = this.yBits;
    for (let x = 0; x < field; x++) {
      for (let y = 0; y < field; y++) {
        if (this.mark[(x << yb) + y] === 1) out[y * field + x] = 1;
      }
    }
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
