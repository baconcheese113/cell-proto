// sim-clock.ts — fixed-timestep accumulator math so the simulation advances at a
// constant rate in REAL TIME, decoupled from the render frame rate. Without this,
// movement speed = stepsPerFrame x FPS, so a cell crawls slower whenever the frame
// rate dips (a render hitch shouldn't change how fast you move).
//
// Pure + node-tested. The scene keeps an accumulator of elapsed ms, calls this each
// frame to learn how many Monte-Carlo steps to run, and carries the remainder.

export interface SimStepPlan {
  /** Monte-Carlo steps to run this frame. */
  steps: number;
  /** Leftover accumulated ms to carry into the next frame. */
  remainderMs: number;
}

/** Given accumulated real ms and the per-MCS time budget, how many MCS to run now.
 *  Capped at `maxSteps`; when capped we DROP the backlog (remainder 0) so a slow
 *  frame can't snowball an ever-growing debt (the "spiral of death") — the sim
 *  briefly runs in bounded slow-motion instead of locking up. */
export function simStepsFor(
  accumMs: number,
  msPerMcs: number,
  maxSteps: number
): SimStepPlan {
  if (msPerMcs <= 0) return { steps: 0, remainderMs: 0 };
  const want = Math.floor(accumMs / msPerMcs);
  if (want <= maxSteps) return { steps: want, remainderMs: accumMs - want * msPerMcs };
  return { steps: maxSteps, remainderMs: 0 };
}
