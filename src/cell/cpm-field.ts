// CpmField — a reaction-diffusion molecular field on the lattice (Step 4).
//
// A concentration per lattice pixel, diffusing only THROUGH a masked region (the
// cytosol of a cell), so the field domain deforms with the cell automatically:
// molecules route through the cell's *current* shape, flow around organelles
// (which are outside the mask), and bottleneck where the cell is squeezed.
// Produced at sources, consumed at the membrane (a decaying boundary), and the
// field follows the cell when the world recenters (shift()).

const ROW = (field: number) => field; // stride; field is square

export class CpmField {
  readonly data: Float32Array;
  private readonly next: Float32Array;
  private readonly mask: Uint8Array;
  readonly field: number;

  constructor(field: number) {
    this.field = field;
    this.data = new Float32Array(field * field);
    this.next = new Float32Array(field * field);
    this.mask = new Uint8Array(field * field);
  }

  private idx(x: number, y: number): number {
    return y * ROW(this.field) + x;
  }

  /** Rebuild the diffusion mask from the pixels of one owner cell (its cytosol).
   *  Cells supply their pixel iterator. */
  setMask(pixels: Iterable<[number, number]>): void {
    this.mask.fill(0);
    for (const [x, y] of pixels) this.mask[this.idx(x, y)] = 1;
  }

  /** Deposit concentration at a lattice pixel (only if inside the mask). */
  addSource(x: number, y: number, amount: number): void {
    const xi = Math.round(x),
      yi = Math.round(y);
    if (xi < 0 || xi >= this.field || yi < 0 || yi >= this.field) return;
    const i = this.idx(xi, yi);
    if (this.mask[i]) this.data[i] += amount;
  }

  /** One reaction-diffusion step: diffuse among masked neighbours, decay, and
   *  zero everything outside the mask (the field lives only in the cell). */
  step(diffuse: number, decay: number): void {
    const f = this.field;
    const d = this.data;
    const m = this.mask;
    const out = this.next;
    for (let y = 0; y < f; y++) {
      for (let x = 0; x < f; x++) {
        const i = y * f + x;
        if (!m[i]) {
          out[i] = 0;
          continue;
        }
        let acc = 0,
          n = 0;
        if (x > 0 && m[i - 1]) {
          acc += d[i - 1];
          n++;
        }
        if (x < f - 1 && m[i + 1]) {
          acc += d[i + 1];
          n++;
        }
        if (y > 0 && m[i - f]) {
          acc += d[i - f];
          n++;
        }
        if (y < f - 1 && m[i + f]) {
          acc += d[i + f];
          n++;
        }
        const v = d[i] + diffuse * (acc - n * d[i]);
        out[i] = v * (1 - decay);
      }
    }
    this.data.set(out);
  }

  /** Shift the field content by (dx,dy) lattice px (track lattice recentering). */
  shift(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const f = this.field;
    const out = this.next;
    out.fill(0);
    for (let y = 0; y < f; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= f) continue;
      for (let x = 0; x < f; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= f) continue;
        out[y * f + x] = this.data[sy * f + sx];
      }
    }
    this.data.set(out);
  }

  valueAt(x: number, y: number): number {
    if (x < 0 || x >= this.field || y < 0 || y >= this.field) return 0;
    return this.data[this.idx(x, y)];
  }
}
