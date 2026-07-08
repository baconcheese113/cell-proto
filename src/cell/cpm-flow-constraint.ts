// CpmFlowConstraint — a fork extension of Artistoo. The vessel CURRENT (heart
// pump) as a CPM soft constraint: it biases copy attempts so that cells of a
// "flowing" kind drift along a global flow direction. The scene sets the direction
// (the path tangent at the player) and a pulsed magnitude (the heartbeat) each
// frame. Sessile wall kinds (endothelial/tissue) are NOT in the flowing set, so the
// pump moves the lumen contents (and the player) without washing the walls away.
//
// The cost math is the node-tested `flowDeltaH`.

import {
  SoftConstraint,
  type CPM,
  type IndexCoordinate,
  type CellId,
} from "../vendor/artistoo";
import { flowDeltaH } from "./flow-cost";

export class CpmFlowConstraint extends SoftConstraint {
  private fx = 1;
  private fy = 0;
  private lambda = 0;
  private flowing = new Set<number>();
  declare C: CPM;

  constructor() {
    super({});
  }

  /** Set the current's direction (unit-ish) and pulse-scaled strength. 0 = off. */
  setFlow(fx: number, fy: number, lambda: number): void {
    const m = Math.hypot(fx, fy) || 1;
    this.fx = fx / m;
    this.fy = fy / m;
    this.lambda = lambda;
  }

  /** Which cell KINDS get carried by the current (the lumen dwellers). */
  setFlowingKinds(kinds: number[]): void {
    this.flowing = new Set(kinds);
  }

  // --- reads for the GPU bridge (mirror this constraint into the GPU step) ---
  get dirX(): number { return this.fx; }
  get dirY(): number { return this.fy; }
  get strength(): number { return this.lambda; }
  /** Bitmask of flowing kinds (bit k set => kind k is carried). */
  flowKindsBitmask(): number {
    let m = 0;
    for (const k of this.flowing) m |= 1 << k;
    return m;
  }

  deltaH(
    src_i: IndexCoordinate,
    tgt_i: IndexCoordinate,
    src_type: CellId,
    _tgt_type: CellId
  ): number {
    if (this.lambda === 0 || src_type === 0) return 0;
    if (!this.flowing.has(this.C.cellKind(src_type))) return 0;
    const p1 = this.C.grid.i2p(src_i);
    const p2 = this.C.grid.i2p(tgt_i);
    return flowDeltaH(p2[0] - p1[0], p2[1] - p1[1], this.fx, this.fy, this.lambda);
  }
}
