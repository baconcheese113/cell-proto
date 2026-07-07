// cpm-gpu.ts — GPU-resident reduced CPM (adhesion matrix + volume) on a checkerboard.
// Owns all state in GPU buffers; the host only enqueues steps and reads back volumes / framebuffer.
// Worker-safe (no Phaser). Physics is intentionally reduced (no Act/perimeter/barrier yet — M1b).

import { acquireGpu, BUF, MAP_READ_FLAG } from "./cpm-gpu-device";
import {
  STEP_WGSL, VOL_WGSL, PERIM_WGSL, COLORMAP_WGSL, ACT_DECAY_WGSL, BORDER_BUILD_WGSL, CELL_STEP_WGSL,
} from "./cpm-gpu-wgsl";
import { blockDispatch, encodeParams } from "./cpm-gpu-encoding";

const WG = 64;
const CAP = 512; // max tracked border pixels per cell (cell-parallel step)

export class GpuCpm {
  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly d: any,
    private readonly field: number,
    private readonly B: number,
    private readonly lambdaV: number,
    private readonly T: number,
    private readonly volN: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly buf: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly pipe: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly bind: any
  ) {}

  static async create(opts: {
    field: number; B?: number; lambdaV: number; T: number;
    J: Float32Array; nKinds: number; lut: Uint32Array;
    lattice: Int32Array; kind: Int32Array; targetVol: Float32Array; maxId: number;
    maxAct: number[]; lambdaAct: number[]; // per-kind (index 0 = background), Act model params
    lambdaP: number[]; targetP: number[]; // per-kind Perimeter constraint params
    permeableKind?: number; // kind that may cross barriers (the player); default 1
    barrierKinds?: number[]; // kinds that act as hard barriers (debris/walls); default none
  }): Promise<GpuCpm | { error: string }> {
    const g = await acquireGpu();
    if ("error" in g) return g;
    const d = g.device;
    const { field } = opts;
    const B = opts.B ?? 4;
    const N = field * field;
    const volN = opts.maxId + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (bytes: number): any =>
      d.createBuffer({ size: bytes, usage: BUF.STORAGE() | BUF.COPY_DST() | BUF.COPY_SRC() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniform = (bytes: number): any =>
      d.createBuffer({ size: bytes, usage: BUF.UNIFORM() | BUF.COPY_DST() });

    // per-kind params packed as vec4 (x=maxAct, y=lambdaAct, z=lambdaP, w=targetP).
    const kindParams = new Float32Array(opts.nKinds * 4);
    for (let k = 0; k < opts.nKinds; k++) {
      kindParams[k * 4] = opts.maxAct[k] ?? 0;
      kindParams[k * 4 + 1] = opts.lambdaAct[k] ?? 0;
      kindParams[k * 4 + 2] = opts.lambdaP[k] ?? 0;
      kindParams[k * 4 + 3] = opts.targetP[k] ?? 0;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf: any = {
      lattice: store(N * 4),
      vol: store(volN * 4),
      kind: store(volN * 4),
      targetVol: store(volN * 4),
      J: store(opts.J.byteLength),
      lut: store(opts.lut.byteLength),
      act: store(N * 4), // zero-initialised by WebGPU
      kindParams: store(kindParams.byteLength),
      perim: store(volN * 4),
      steer: store(volN * 16), // per-cell vec4 (targetX, targetY, lambda, frozen); zero = idle
      borderCount: store(volN * 4),
      borderList: store(volN * CAP * 4),
      framebuffer: store(N * 4),
      params: uniform(48),
      nk: uniform(16),
      volDim: uniform(16),
      cmDim: uniform(16),
      cellDim: uniform(16),
      volStaging: d.createBuffer({ size: volN * 4, usage: BUF.COPY_DST() | BUF.MAP_READ() }),
      fbStaging: d.createBuffer({ size: N * 4, usage: BUF.COPY_DST() | BUF.MAP_READ() }),
      latStaging: d.createBuffer({ size: N * 4, usage: BUF.COPY_DST() | BUF.MAP_READ() }),
    };
    d.queue.writeBuffer(buf.lattice, 0, opts.lattice);
    d.queue.writeBuffer(buf.kind, 0, opts.kind);
    d.queue.writeBuffer(buf.targetVol, 0, opts.targetVol);
    d.queue.writeBuffer(buf.J, 0, opts.J);
    d.queue.writeBuffer(buf.lut, 0, opts.lut);
    d.queue.writeBuffer(buf.kindParams, 0, kindParams);
    let barrierBitmask = 0;
    for (const k of opts.barrierKinds ?? []) barrierBitmask |= 1 << k;
    d.queue.writeBuffer(buf.nk, 0, new Uint32Array([opts.nKinds, opts.permeableKind ?? 1, barrierBitmask, 0]));
    d.queue.writeBuffer(buf.volDim, 0, new Uint32Array([N, volN, field, field]));
    d.queue.writeBuffer(buf.cmDim, 0, new Uint32Array([N, 0, 0, 0]));
    d.queue.writeBuffer(buf.cellDim, 0, new Uint32Array([N, volN, field, CAP]));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (code: string): any => d.createShaderModule({ code });
    const pipe = {
      step: d.createComputePipeline({ layout: "auto", compute: { module: mod(STEP_WGSL), entryPoint: "main" } }),
      volClear: d.createComputePipeline({ layout: "auto", compute: { module: mod(VOL_WGSL), entryPoint: "clear" } }),
      volScatter: d.createComputePipeline({ layout: "auto", compute: { module: mod(VOL_WGSL), entryPoint: "scatter" } }),
      perimClear: d.createComputePipeline({ layout: "auto", compute: { module: mod(PERIM_WGSL), entryPoint: "clear" } }),
      perimScatter: d.createComputePipeline({ layout: "auto", compute: { module: mod(PERIM_WGSL), entryPoint: "scatter" } }),
      colormap: d.createComputePipeline({ layout: "auto", compute: { module: mod(COLORMAP_WGSL), entryPoint: "main" } }),
      actDecay: d.createComputePipeline({ layout: "auto", compute: { module: mod(ACT_DECAY_WGSL), entryPoint: "decay" } }),
      borderClear: d.createComputePipeline({ layout: "auto", compute: { module: mod(BORDER_BUILD_WGSL), entryPoint: "clear" } }),
      borderScatter: d.createComputePipeline({ layout: "auto", compute: { module: mod(BORDER_BUILD_WGSL), entryPoint: "scatter" } }),
      cellStep: d.createComputePipeline({ layout: "auto", compute: { module: mod(CELL_STEP_WGSL), entryPoint: "main" } }),
    };
    const bind = {
      step: d.createBindGroup({
        layout: pipe.step.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.vol } },
          { binding: 2, resource: { buffer: buf.kind } },
          { binding: 3, resource: { buffer: buf.targetVol } },
          { binding: 4, resource: { buffer: buf.J } },
          { binding: 5, resource: { buffer: buf.params } },
          { binding: 6, resource: { buffer: buf.nk } },
          { binding: 7, resource: { buffer: buf.act } },
          { binding: 8, resource: { buffer: buf.kindParams } },
          { binding: 9, resource: { buffer: buf.perim } },
          { binding: 10, resource: { buffer: buf.steer } },
        ],
      }),
      actDecay: d.createBindGroup({
        layout: pipe.actDecay.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.act } },
          { binding: 1, resource: { buffer: buf.cmDim } },
        ],
      }),
      // `clear` does not read the lattice, so with layout:"auto" its bind-group layout omits
      // binding 0 — the bind group must match exactly (only vol + DIM), or the whole command
      // buffer is invalidated.
      volClear: d.createBindGroup({
        layout: pipe.volClear.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: buf.vol } },
          { binding: 2, resource: { buffer: buf.volDim } },
        ],
      }),
      volScatter: d.createBindGroup({
        layout: pipe.volScatter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.vol } },
          { binding: 2, resource: { buffer: buf.volDim } },
        ],
      }),
      perimClear: d.createBindGroup({
        layout: pipe.perimClear.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: buf.perim } },
          { binding: 2, resource: { buffer: buf.volDim } },
        ],
      }),
      perimScatter: d.createBindGroup({
        layout: pipe.perimScatter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.perim } },
          { binding: 2, resource: { buffer: buf.volDim } },
        ],
      }),
      colormap: d.createBindGroup({
        layout: pipe.colormap.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.kind } },
          { binding: 2, resource: { buffer: buf.lut } },
          { binding: 3, resource: { buffer: buf.framebuffer } },
          { binding: 4, resource: { buffer: buf.cmDim } },
        ],
      }),
      // BORDER_BUILD `clear` uses only borderCount + DIM (not lattice/borderList) — layout omits them.
      borderClear: d.createBindGroup({
        layout: pipe.borderClear.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: buf.borderCount } },
          { binding: 3, resource: { buffer: buf.cellDim } },
        ],
      }),
      borderScatter: d.createBindGroup({
        layout: pipe.borderScatter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.borderCount } },
          { binding: 2, resource: { buffer: buf.borderList } },
          { binding: 3, resource: { buffer: buf.cellDim } },
        ],
      }),
      cellStep: d.createBindGroup({
        layout: pipe.cellStep.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buf.lattice } },
          { binding: 1, resource: { buffer: buf.vol } },
          { binding: 2, resource: { buffer: buf.perim } },
          { binding: 3, resource: { buffer: buf.act } },
          { binding: 4, resource: { buffer: buf.kind } },
          { binding: 5, resource: { buffer: buf.targetVol } },
          { binding: 6, resource: { buffer: buf.J } },
          { binding: 7, resource: { buffer: buf.kindParams } },
          { binding: 8, resource: { buffer: buf.steer } },
          { binding: 9, resource: { buffer: buf.borderCount } },
          { binding: 10, resource: { buffer: buf.borderList } },
          { binding: 11, resource: { buffer: buf.params } },
          { binding: 12, resource: { buffer: buf.nk } },
          { binding: 13, resource: { buffer: buf.cellDim } },
        ],
      }),
    };
    // Initialise vol + perim from the uploaded lattice so the first MCS reads correct baselines
    // (otherwise deltaH on MCS 1 sees zeroed state and over-accepts).
    {
      const enc = d.createCommandEncoder();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const disp = (pl: any, bg: any, threads: number): void => {
        const p = enc.beginComputePass();
        p.setPipeline(pl); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(threads / WG)); p.end();
      };
      disp(pipe.volClear, bind.volClear, volN);
      disp(pipe.volScatter, bind.volScatter, N);
      disp(pipe.perimClear, bind.perimClear, volN);
      disp(pipe.perimScatter, bind.perimScatter, N);
      d.queue.submit([enc.finish()]);
    }
    return new GpuCpm(d, field, B, opts.lambdaV, opts.T, volN, buf, pipe, bind);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dispatch(enc: any, pipeline: any, bindGroup: any, threads: number): void {
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(threads / WG));
    pass.end();
  }

  stepN(n: number): void {
    const { workgroups } = blockDispatch(this.field, this.B, WG);
    const N = this.field * this.field;
    for (let m = 0; m < n; m++) {
      const ox = (Math.random() * this.B) | 0;
      const oy = (Math.random() * this.B) | 0;
      const enc = this.d.createCommandEncoder();
      for (let phase = 0; phase < 4; phase++) {
        this.d.queue.writeBuffer(
          this.buf.params, 0,
          encodeParams({ W: this.field, H: this.field, B: this.B, phase, ox, oy,
            seed: (Math.random() * 1e9) | 0, lambdaV: this.lambdaV, T: this.T })
        );
        const pass = enc.beginComputePass();
        pass.setPipeline(this.pipe.step);
        pass.setBindGroup(0, this.bind.step);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
      }
      // drift-safe volume + perimeter recompute (once per MCS): clear then scatter from the lattice.
      this.dispatch(enc, this.pipe.volClear, this.bind.volClear, this.volN);
      this.dispatch(enc, this.pipe.volScatter, this.bind.volScatter, N);
      this.dispatch(enc, this.pipe.perimClear, this.bind.perimClear, this.volN);
      this.dispatch(enc, this.pipe.perimScatter, this.bind.perimScatter, N);
      // Act model decays by 1 each MCS (postMCSListener in Artistoo).
      this.dispatch(enc, this.pipe.actDecay, this.bind.actDecay, N);
      this.d.queue.submit([enc.finish()]);
    }
  }

  /** Command cell `id` toward (x,y) with steering strength `lambda` (0 = idle). `frozen` makes
   *  the cell a hard barrier (wall-sleep). Writes just this cell's slot in the steer buffer. */
  setSteer(id: number, x: number, y: number, lambda: number, frozen = 0): void {
    this.d.queue.writeBuffer(this.buf.steer, id * 16, new Float32Array([x, y, lambda, frozen]));
  }

  /** Cell-parallel step: one thread per cell runs its border loop sequentially (preserves the Act
   *  crawl), cells concurrently, boundary pixels claimed atomically (collision-safe). Rebuilds the
   *  per-cell border lists each MCS, then recomputes vol/perim + decays act, like the checkerboard. */
  stepCellParallelN(n: number): void {
    const N = this.field * this.field;
    for (let m = 0; m < n; m++) {
      this.d.queue.writeBuffer(
        this.buf.params, 0,
        encodeParams({ W: this.field, H: this.field, B: 4, phase: 0, ox: 0, oy: 0,
          seed: (Math.random() * 1e9) | 0, lambdaV: this.lambdaV, T: this.T })
      );
      const enc = this.d.createCommandEncoder();
      // build per-cell border lists from the current lattice
      this.dispatch(enc, this.pipe.borderClear, this.bind.borderClear, this.volN);
      this.dispatch(enc, this.pipe.borderScatter, this.bind.borderScatter, N);
      // one thread per cell id
      this.dispatch(enc, this.pipe.cellStep, this.bind.cellStep, this.volN);
      // drift-safe recompute + act decay (same as the checkerboard path)
      this.dispatch(enc, this.pipe.volClear, this.bind.volClear, this.volN);
      this.dispatch(enc, this.pipe.volScatter, this.bind.volScatter, N);
      this.dispatch(enc, this.pipe.perimClear, this.bind.perimClear, this.volN);
      this.dispatch(enc, this.pipe.perimScatter, this.bind.perimScatter, N);
      this.dispatch(enc, this.pipe.actDecay, this.bind.actDecay, N);
      this.d.queue.submit([enc.finish()]);
    }
  }

  async flush(): Promise<void> {
    await this.d.queue.onSubmittedWorkDone();
  }

  async readVolumes(): Promise<Int32Array> {
    const enc = this.d.createCommandEncoder();
    enc.copyBufferToBuffer(this.buf.vol, 0, this.buf.volStaging, 0, this.volN * 4);
    this.d.queue.submit([enc.finish()]);
    await this.buf.volStaging.mapAsync(MAP_READ_FLAG());
    const out = new Int32Array(this.buf.volStaging.getMappedRange().slice(0));
    this.buf.volStaging.unmap();
    return out;
  }

  async readLattice(): Promise<Int32Array> {
    const N = this.field * this.field;
    const enc = this.d.createCommandEncoder();
    enc.copyBufferToBuffer(this.buf.lattice, 0, this.buf.latStaging, 0, N * 4);
    this.d.queue.submit([enc.finish()]);
    await this.buf.latStaging.mapAsync(MAP_READ_FLAG());
    const out = new Int32Array(this.buf.latStaging.getMappedRange().slice(0));
    this.buf.latStaging.unmap();
    return out;
  }

  async readAct(): Promise<Int32Array> {
    const N = this.field * this.field;
    const enc = this.d.createCommandEncoder();
    enc.copyBufferToBuffer(this.buf.act, 0, this.buf.latStaging, 0, N * 4);
    this.d.queue.submit([enc.finish()]);
    await this.buf.latStaging.mapAsync(MAP_READ_FLAG());
    const out = new Int32Array(this.buf.latStaging.getMappedRange().slice(0));
    this.buf.latStaging.unmap();
    return out;
  }

  async readFramebuffer(): Promise<Uint32Array> {
    const N = this.field * this.field;
    const enc = this.d.createCommandEncoder();
    this.dispatch(enc, this.pipe.colormap, this.bind.colormap, N);
    enc.copyBufferToBuffer(this.buf.framebuffer, 0, this.buf.fbStaging, 0, N * 4);
    this.d.queue.submit([enc.finish()]);
    await this.buf.fbStaging.mapAsync(MAP_READ_FLAG());
    const out = new Uint32Array(this.buf.fbStaging.getMappedRange().slice(0));
    this.buf.fbStaging.unmap();
    return out;
  }

  destroy(): void {
    for (const k of Object.keys(this.buf)) this.buf[k].destroy?.();
    this.d.destroy?.();
  }
}
