// CpmProfiler — always-on, lightweight per-subsystem + per-cell timing so the cost
// of scaling the living world up is visible immediately (not profiled after the
// fact). Wrap each subsystem with `measure(name, fn)` each frame, call `frame()`
// once at the end, and read `report()` for a smoothed ms/frame breakdown, FPS, the
// scale drivers (active/dormant cell counts, CPM border-pixel total), and a derived
// ms-per-active-cell. The scene renders this as an overlay and exposes it on __cpm.
//
// The clock is injectable so the aggregation/EMA math is deterministic in tests.

export interface ProfilerMetrics {
  activeCells: number;
  dormantCells: number;
  /** Total CPM border pixels — the real driver of CPM step cost. */
  borderPixels: number;
}

export interface ProfilerReport {
  fps: number;
  /** Smoothed ms/frame per section, descending. */
  sections: Array<[string, number]>;
  /** Smoothed total measured ms/frame. */
  totalMs: number;
  metrics: ProfilerMetrics;
  /** Smoothed total ms divided by active cell count (0 if none). */
  msPerActiveCell: number;
}

/** EMA smoothing factor for the per-section ms (0..1; higher = snappier). */
const SMOOTH = 0.15;

export class CpmProfiler {
  private readonly now: () => number;
  private readonly acc = new Map<string, number>(); // ms accumulated THIS frame
  private readonly smoothed = new Map<string, number>(); // EMA ms/frame
  private readonly startStack: Array<{ name: string; t: number }> = [];
  private fpsEma = 60;
  private lastFrameTs = 0;
  metrics: ProfilerMetrics = { activeCells: 0, dormantCells: 0, borderPixels: 0 };

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** Time `fn` under `name`, accumulating into this frame's total for that name. */
  measure<T>(name: string, fn: () => T): T {
    const t0 = this.now();
    try {
      return fn();
    } finally {
      this.acc.set(name, (this.acc.get(name) ?? 0) + (this.now() - t0));
    }
  }

  /** Manual begin/end for sections that can't be wrapped in a single callback. */
  begin(name: string): void {
    this.startStack.push({ name, t: this.now() });
  }

  end(name: string): void {
    for (let i = this.startStack.length - 1; i >= 0; i--) {
      if (this.startStack[i].name === name) {
        const dt = this.now() - this.startStack[i].t;
        this.startStack.splice(i, 1);
        this.acc.set(name, (this.acc.get(name) ?? 0) + dt);
        return;
      }
    }
  }

  /** Call once per frame (after all measures). Folds this frame's accumulators into
   *  the smoothed values and updates FPS. */
  frame(): void {
    const now = this.now();
    if (this.lastFrameTs > 0) {
      const dt = now - this.lastFrameTs;
      if (dt > 0) this.fpsEma += (1000 / dt - this.fpsEma) * SMOOTH;
    }
    this.lastFrameTs = now;

    // EMA every known section toward this frame's value (0 if not measured).
    const names = new Set<string>([...this.smoothed.keys(), ...this.acc.keys()]);
    for (const name of names) {
      const v = this.acc.get(name) ?? 0;
      const prev = this.smoothed.get(name) ?? v;
      this.smoothed.set(name, prev + (v - prev) * SMOOTH);
    }
    this.acc.clear();
  }

  report(): ProfilerReport {
    const sections = [...this.smoothed.entries()].sort((a, b) => b[1] - a[1]);
    let totalMs = 0;
    for (const [, v] of sections) totalMs += v;
    const active = this.metrics.activeCells;
    return {
      fps: this.fpsEma,
      sections,
      totalMs,
      metrics: { ...this.metrics },
      msPerActiveCell: active > 0 ? totalMs / active : 0,
    };
  }

  /** Compact one-line-per-section text for the HUD overlay. */
  overlayText(): string {
    const r = this.report();
    const lines = [
      `FPS ${r.fps.toFixed(0)}  sim ${r.totalMs.toFixed(1)}ms  ` +
        `cells ${r.metrics.activeCells}(+${r.metrics.dormantCells} dormant)  ` +
        `border ${r.metrics.borderPixels}  ${r.msPerActiveCell.toFixed(2)}ms/cell`,
    ];
    for (const [name, ms] of r.sections) {
      if (ms < 0.05) continue;
      lines.push(`  ${name.padEnd(10)} ${ms.toFixed(2)}ms`);
    }
    return lines.join("\n");
  }
}
