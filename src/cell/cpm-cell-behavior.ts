// CpmCellBehavior — the per-cell behaviour controller. EVERY autonomous cell runs
// this same code; what it does is decided by the cell's CAPABILITIES (derived from
// its composition), never a type label:
//   - phagocytic + motile  -> HUNT the nearest edible cell
//   - motile, not phagocytic -> FLEE the nearest predator, else wander
//   - not motile            -> stay put (sessile tissue)
// It drives the shared per-cell steering primitive (`sim.steerCell`). The
// controlled cell is skipped — the player's input drives it instead. (Eating
// itself is handled uniformly by the life layer; this layer is movement only.)
//
// Only TYPE imports, so the pure decision fn is node-testable.

import type { CpmSimulation } from "./cpm-simulation";
import type { Capabilities } from "./cell-composition";

/** A cell reduced to what behaviour needs: position, size, predatory power, and
 *  whether it can move (sessile wall cells are not prey). */
export interface Agent {
  id: number;
  x: number;
  y: number;
  vol: number;
  phagocytic: number;
  motility: number;
}

export interface SteerChoice {
  x: number;
  y: number;
  mode: "hunt" | "flee";
}

/** A cell is a predator if it can meaningfully engulf. */
const PREDATOR_PHAGO = 0.2;

/** Pure decision: given `self` and the other agents around it, choose a steer
 *  target (or null to wander). Predators chase the nearest smaller, less-predatory
 *  cell within `sense`; prey flee the nearest predator within `fleeDist`. */
export function chooseSteer(
  self: Agent,
  others: readonly Agent[],
  sense: number,
  fleeDist: number
): SteerChoice | null {
  const predator = self.phagocytic > PREDATOR_PHAGO;

  if (predator) {
    let best: Agent | null = null;
    let bestD = sense;
    for (const o of others) {
      if (o.id === self.id) continue;
      // Prey must be a MOTILE free cell (microbe/debris) — predators don't graze on
      // the sessile vessel wall / tissue.
      const edible =
        o.motility > 0.1 && o.phagocytic < self.phagocytic * 0.4 && o.vol < self.vol * 0.95;
      if (!edible) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best ? { x: best.x, y: best.y, mode: "hunt" } : null;
  }

  // Prey: flee the nearest predator.
  let threat: Agent | null = null;
  let threatD = fleeDist;
  for (const o of others) {
    if (o.id === self.id) continue;
    if (o.phagocytic <= PREDATOR_PHAGO) continue;
    const d = Math.hypot(o.x - self.x, o.y - self.y);
    if (d < threatD) {
      threatD = d;
      threat = o;
    }
  }
  if (!threat) return null;
  const dx = self.x - threat.x;
  const dy = self.y - threat.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: self.x + (dx / len) * fleeDist, y: self.y + (dy / len) * fleeDist, mode: "flee" };
}

const MOTILE_EPS = 0.05; // below this motility a cell is treated as sessile
const WANDER_RADIUS = 45;
const RETARGET_MIN = 1.2;
const RETARGET_MAX = 2.8;
const FLEE_RETARGET = 0.4;
const LEASH = 82; // keep active cells loitering near the bubble centre

interface AiState {
  retargetIn: number;
}

export interface CellBehaviorOptions {
  /** The cell currently under player control (its behaviour is suppressed). */
  controlledId: () => number;
  /** Capabilities for a cell id (from its composition), or undefined if unknown. */
  getCaps: (id: number) => Capabilities | undefined;
}

export class CpmCellBehavior {
  private readonly state = new Map<number, AiState>();
  private readonly sim: CpmSimulation;
  private readonly opts: CellBehaviorOptions;

  constructor(sim: CpmSimulation, opts: CellBehaviorOptions) {
    this.sim = sim;
    this.opts = opts;
  }

  /** `centroids` is the shared per-frame snapshot (sim.centroidsAll) so we don't
   *  pay an O(field^2) centroid scan per cell. */
  update(
    dt: number,
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    const controlled = this.opts.controlledId();

    // Snapshot every live cell as an Agent from the shared centroid map.
    const agents: Agent[] = [];
    for (const rec of this.sim.getCells()) {
      const c = centroids.get(rec.id);
      if (!c) continue;
      const caps = this.opts.getCaps(rec.id);
      agents.push({
        id: rec.id,
        x: c.x,
        y: c.y,
        vol: c.pixels,
        phagocytic: caps?.phagocytic ?? 0,
        motility: caps?.motility ?? 0,
      });
    }

    const live = new Set<number>();
    for (const self of agents) {
      if (self.id === controlled) continue; // player drives this one
      const caps = this.opts.getCaps(self.id);
      if (!caps || caps.motility <= MOTILE_EPS) continue; // sessile cell stays put
      live.add(self.id);

      let st = this.state.get(self.id);
      if (!st) {
        st = { retargetIn: 0 };
        this.state.set(self.id, st);
      }
      st.retargetIn -= dt;
      if (st.retargetIn > 0) continue;

      const sense = 60 + caps.chemotaxis * 34;
      const fleeDist = 40 + caps.motility * 14;
      const choice = chooseSteer(self, agents, sense, fleeDist);

      let tx: number;
      let ty: number;
      if (choice) {
        tx = choice.x;
        ty = choice.y;
        st.retargetIn = choice.mode === "flee" ? FLEE_RETARGET : 0.5;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const r = WANDER_RADIUS * (0.4 + Math.random() * 0.6);
        tx = self.x + Math.cos(ang) * r;
        ty = self.y + Math.sin(ang) * r;
        st.retargetIn = RETARGET_MIN + Math.random() * (RETARGET_MAX - RETARGET_MIN);
      }

      // Leash toward bubble centre so active cells loiter in view (until proper
      // procedural refill in a later milestone).
      const c = this.sim.field / 2;
      const lx = tx - c;
      const ly = ty - c;
      const d = Math.hypot(lx, ly);
      if (d > LEASH) {
        tx = c + (lx / d) * LEASH;
        ty = c + (ly / d) * LEASH;
      }
      this.sim.steerCell(self.id, tx, ty);
    }

    for (const id of [...this.state.keys()]) {
      if (!live.has(id)) this.state.delete(id);
    }
  }
}
