// WorldSim — the Phaser-FREE simulation core. Owns the CPM bubble + the agent tier +
// every per-cell system (behavior, life, combat, rules, big-organelles, deform-grid,
// signal field, vessel), and runs ONE fixed-timestep tick. The scene (or, later, a Web
// Worker) drives it: feed input via setInput(), call tick(dt), then read the sim state
// to render. All Phaser-specific work (rendering, camera, input capture, FX tweens)
// lives in CpmWorldScene; WorldSim emits FX/control-change as plain callbacks so it has
// no DOM/Phaser dependency and can run on a worker thread.

import { CpmSimulation } from "./cpm-simulation";
import { CpmRules, type DeathReason } from "./cpm-rules";
import { CpmCellBehavior } from "./cpm-cell-behavior";
import { CpmCombat } from "./cpm-combat";
import { CpmField } from "./cpm-field";
import { CpmDeformGrid } from "./cpm-deform-grid";
import { CpmBigOrganelles } from "./cpm-big-organelles";
import { CpmProfiler } from "./cpm-profiler";
import { CpmLife } from "./cpm-life";
import { CellComposition } from "./cell-composition";
import { PRESETS, rollComponents, type BodyKey } from "./cell-presets";
import { CpmVessel, DEFAULT_VESSEL } from "./cpm-vessel";
import { simStepsFor } from "./sim-clock";
import { AgentWorld } from "./agent-world";
import {
  DEFAULT_WORLD_CONFIG,
  type CpmWorldConfig,
  PLAYER_PROFILE,
  TISSUE_PROFILE,
  MICROBE_PROFILE,
  ENDOTHELIAL_PROFILE,
  FIBROBLAST_PROFILE,
  DIGESTING_PROFILE,
} from "./cpm-config";

// Kinds = physics bodies only (NOT identities — a cell's identity is its composition).
export const CONTROLLED_KIND = 1; // macrophage body, player-driven
export const MACROPHAGE_KIND = 2; // macrophage body, autonomous
export const EPITHELIAL_KIND = 3;
export const MICROBE_KIND = 4;
export const ENDOTHELIAL_KIND = 5; // vessel lining
export const FIBROBLAST_KIND = 6; // tissue beyond
export const DIGEST_KIND = 7;

// DEV: freeze the player-anchored streaming bubble (study aid). For play it's false so
// the camera follows the player; the worldsim streaming branch keys off it too.
export const DEV_FREEZE_STREAMING = false;

// Fixed-timestep clock: advance the CPM sim at a CONSTANT real-time rate so movement
// speed is independent of render FPS.
// Default Monte-Carlo rate. PERCEIVED crawl speed is purely MCS/sec (per-step
// displacement is saturated); FPS/sim-Hz falls as MCS/sec x border rises. There is no
// value that's both fast AND smooth on a big (high-border) view, so it's live-tunable
// via setMcsRate (the scene's [ and ] keys) — the player picks their speed/smoothness.
const TARGET_MCS_PER_SEC = 130;
const MIN_MCS = 40;
const MAX_MCS = 260;
// Cap per tick -> bounded work, no spiral of death (simStepsFor drops any backlog past
// this). Raised 6 -> 10: at a heavy ~24-30Hz tick rate the old cap of 6 ran only 180
// MCS/s vs the 240 target, i.e. visible SLOW-MOTION on top of the low frame rate. 10
// lets the sim hold true speed down to ~24Hz; only below that does it gracefully slow.
const MAX_CATCHUP_STEPS = 10;

const NUCLEUS = { type: "nucleus", color: 0x9b6cff, radius: 6 };
const BUILDABLES = [
  { type: "mitochondrion", color: 0xff9d4d, radius: 3.5 },
  { type: "ribosome", color: 0x7cf6c7, radius: 2 },
  { type: "golgi", color: 0xffe066, radius: 3 },
];

const MICROBE_CAP = 110;
const IMMUNE_CAP = 14;

/** Concentration that renders as full-intensity molecular glow (was in CpmRenderer). */
const FIELD_FULL = 8;

/** Agent-tier render colour by body (mirrors the CPM profiles; was in the scene). */
const AGENT_COLOR: Record<BodyKey, number> = {
  macrophage: 0x49d0ff,
  epithelial: 0x6b8f9c,
  microbe: 0xe7d14b,
  endothelial: 0x8a6f9e,
  fibroblast: 0x5d7d6a,
};

/** Heartbeat: a sharp systolic surge each ~beat seconds (a pulsed 0..1). */
function heartbeat(timeSec: number, bpm = 70): number {
  const phase = (timeSec * (bpm / 60)) % 1;
  const s = Math.sin(phase * Math.PI);
  return s > 0 ? s * s * s : 0;
}

/** Per-frame input from the player (set by the scene; the worker gets it via message). */
export interface WorldInput {
  steering: boolean;
  pointerWX: number;
  pointerWY: number;
  engulf: boolean; // RMB held
  viewHalfDiag: number; // world px from screen centre to a corner (bubble promote radius)
}

/** A one-shot visual effect to play on the render thread (a death/digest pop). */
export interface SnapshotFx {
  kind: "death" | "digest";
  wx: number;
  wy: number;
  radius: number;
  color: number;
}

/** An agent-tier cell as a render disc (world coords + radius + colour). */
export interface SnapshotAgent {
  x: number;
  y: number;
  r: number;
  color: number;
}

/** A small deform-grid organelle, pre-projected to world coords. */
export interface SnapshotOccupant {
  type: string;
  color: number;
  radius: number;
  x: number; // lattice x (for the mitochondrion angle hash)
  y: number;
  compressed: number;
  wx: number;
  wy: number;
}

/** A big soft-body organelle (nucleus), pre-projected to world coords. */
export interface SnapshotOrganelle {
  type: string;
  color: number;
  stress: number;
  nodes: Array<{ x: number; y: number }>; // world coords, polygon outline
  cx: number; // world centre
  cy: number;
  restRadiusW: number; // restRadius * scale * 0.35 (nucleolus dot)
}

/** Everything the render thread needs for one frame — a pure data object so the
 *  whole sim can run on a worker and post this across the boundary. */
export interface WorldSnapshot {
  framebuffer: Uint32Array; // RGBA lattice, field*field
  field: number;
  originWX: number;
  originWY: number;
  scale: number;
  agents: SnapshotAgent[];
  occupants: SnapshotOccupant[];
  organelles: SnapshotOrganelle[];
  playerWorld: { x: number; y: number } | null;
  stats: WorldHudStats;
  profOverlay: string;
  fx: SnapshotFx[];
  controlChanged: boolean;
  /** Monotonic sim clock + tick count — lets the render thread verify the sim keeps
   *  advancing independently of render FPS (worker decoupling check). */
  simTimeSec: number;
  tickSeq: number;
  /** Current Monte-Carlo rate (live speed dial), for the HUD. */
  mcsPerSec: number;
}

export interface WorldHudStats {
  macrophages: number;
  lining: number;
  microbes: number;
  nutrients: number;
  energy: number;
  hp: number;
  combatStatus: string;
}

export class WorldSim {
  readonly sim: CpmSimulation;
  readonly rules: CpmRules;
  readonly behavior: CpmCellBehavior;
  readonly life: CpmLife;
  readonly combat: CpmCombat;
  readonly signal: CpmField;
  readonly grid: CpmDeformGrid;
  readonly bigOrganelles: CpmBigOrganelles;
  readonly vessel: CpmVessel;
  readonly agentWorld: AgentWorld;
  readonly prof = new CpmProfiler();

  /** A cell IS its composition: id -> mutable composition. */
  readonly compositions = new Map<number, CellComposition>();
  /** CPM ids that were PROMOTED from agents (so we know which to demote back). */
  readonly promoted = new Set<number>();

  controlledCellId = 0;
  deaths = 0;
  stats: WorldHudStats = {
    macrophages: 0, lining: 0, microbes: 0, nutrients: 0, energy: 0, hp: 0, combatStatus: "resting",
  };

  // Render state owned by the sim so the snapshot is self-contained (worker-ready).
  private readonly framebuffer: Uint32Array;
  private readonly colorCache = new Map<number, { r: number; g: number; b: number; maxAct: number }>();
  private fxQueue: SnapshotFx[] = [];
  private controlChangedFlag = false;

  private playerT = 0;
  private tickSeq = 0;
  private mcsPerSec = TARGET_MCS_PER_SEC;
  private simAccumMs = 0;
  private streamAccumMs = 0;
  private timeSec = 0;
  private buildIndex = 0;
  private input: WorldInput = { steering: false, pointerWX: 0, pointerWY: 0, engulf: false, viewHalfDiag: 600 };

  constructor(config: CpmWorldConfig = DEFAULT_WORLD_CONFIG) {
    const cfg = config;
    this.framebuffer = new Uint32Array(cfg.fieldSize * cfg.fieldSize);
    this.sim = new CpmSimulation(cfg, [
      PLAYER_PROFILE, // 1 CONTROLLED
      PLAYER_PROFILE, // 2 MACROPHAGE
      TISSUE_PROFILE, // 3 EPITHELIAL
      MICROBE_PROFILE, // 4 MICROBE
      ENDOTHELIAL_PROFILE, // 5 ENDOTHELIAL
      FIBROBLAST_PROFILE, // 6 FIBROBLAST
      DIGESTING_PROFILE, // 7 DIGEST
    ]);
    const center = Math.floor(cfg.fieldSize / 2);
    this.sim.originWX = -center * this.sim.scale;
    this.sim.originWY = -center * this.sim.scale;
    this.vessel = new CpmVessel(DEFAULT_VESSEL);

    this.agentWorld = new AgentWorld(2000, Math.random, false, this.sim.scale);
    this.signal = new CpmField(cfg.fieldSize);
    this.rules = new CpmRules(this.sim, {
      onDeath: (id, reason) => this.onCellDeath(id, reason),
      ignore: (id) => this.combat.isConsuming(id),
    });

    this.sim.setKindActive(MACROPHAGE_KIND, true);
    this.sim.setKindActive(MICROBE_KIND, true);
    this.sim.flow.setFlowingKinds([MACROPHAGE_KIND, MICROBE_KIND]);
    this.sim.setTransient(ENDOTHELIAL_KIND);
    this.sim.setTransient(FIBROBLAST_KIND);
    this.sim.setTransient(MICROBE_KIND);

    this.behavior = new CpmCellBehavior(this.sim, {
      controlledId: () => this.controlledCellId,
      getCaps: (id) => this.compositions.get(id)?.capabilities,
    });
    this.life = new CpmLife(this.sim, {
      getComposition: (id) => this.compositions.get(id),
      registerChild: (cid, comp) => this.compositions.set(cid, comp),
      damage: (id, amt) => this.rules.applyDamage(id, amt),
      onStarve: (id) => this.onCellDeath(id, "dissolved"),
      canDivide: () => false,
    });
    this.combat = new CpmCombat(this.sim, {
      playerKind: CONTROLLED_KIND,
      enemyKind: MICROBE_KIND,
      digestKind: DIGEST_KIND,
      getAttackerId: () => this.controlledCellId,
      onConsumeStart: (id) => this.forgetColor(id),
      onDigested: (wx, wy) => this.fxQueue.push({ kind: "digest", wx, wy, radius: 26, color: 0xffe066 }),
    });

    this.controlledCellId = this.spawnPreset("macrophage", center, center, true)!;
    for (let i = 0; i < 110; i++) this.sim.step();
    this.populateAgentVessel();

    this.grid = new CpmDeformGrid();
    this.bigOrganelles = new CpmBigOrganelles(this.sim, () => this.controlledCellId);
    const pc = this.sim.centroidLattice(this.controlledCellId);
    if (pc) this.bigOrganelles.add(NUCLEUS.type, NUCLEUS.color, pc.x, pc.y);
  }

  setInput(input: WorldInput): void {
    this.input = input;
  }

  /** Adjust the Monte-Carlo rate (live speed/smoothness dial). delta in MCS/sec. */
  setMcsRate(delta: number): void {
    this.mcsPerSec = Math.max(MIN_MCS, Math.min(MAX_MCS, this.mcsPerSec + delta));
  }

  /** Player's world-space centroid (for the camera to follow). Null if unknown. */
  playerWorldPos(): { x: number; y: number } | null {
    const c = this.sim.centroidLattice(this.controlledCellId);
    if (!c) return null;
    const [x, y] = this.sim.latticeToWorld(c.x, c.y);
    return { x, y };
  }

  // ---- rendering (pure; produces RGBA + a render snapshot) -----------------

  /** Drop a cell's cached colour (death/leave/consume). */
  private forgetColor(id: number): void {
    this.colorCache.delete(id);
  }

  private channels(id: number): { r: number; g: number; b: number; maxAct: number } {
    let c = this.colorCache.get(id);
    if (!c) {
      const rec = this.sim.getCell(id);
      const color = rec ? rec.profile.color : 0x888888;
      c = {
        r: (color >> 16) & 0xff,
        g: (color >> 8) & 0xff,
        b: color & 0xff,
        maxAct: rec ? rec.profile.maxAct || 1 : 1,
      };
      this.colorCache.set(id, c);
    }
    return c;
  }

  /** Paint the CPM lattice into the framebuffer (RGBA). Pure pixel math, lifted
   *  verbatim from CpmRenderer so it can run on a worker. */
  private renderLattice(): void {
    const buf = this.framebuffer;
    buf.fill(0);
    const grid = this.sim.cpm.grid;
    const field = this.sim.field;
    const molField = this.signal;
    for (const [[x, y], id] of grid.pixels()) {
      const c = this.channels(id);
      const a = this.sim.activityAtIndex(grid.p2i([x, y])) / c.maxAct;
      const t = a > 1 ? 1 : a < 0 ? 0 : a;
      let r = (c.r + (255 - c.r) * t) | 0;
      let g = (c.g + (245 - c.g) * t) | 0;
      let b = (c.b + (200 - c.b) * t) | 0;
      const right = grid.pixt([x + 1, y]);
      const down = grid.pixt([x, y + 1]);
      if ((right !== id && right !== 0) || (down !== id && down !== 0)) {
        r = (r * 0.32) | 0;
        g = (g * 0.32) | 0;
        b = (b * 0.32) | 0;
      }
      const fv = molField.valueAt(x, y) / FIELD_FULL;
      if (fv > 0) {
        const m = fv > 1 ? 1 : fv;
        r = (r * (1 - 0.5 * m)) | 0;
        g = Math.min(255, g + 210 * m) | 0;
        b = (b * (1 - 0.3 * m)) | 0;
      }
      buf[y * field + x] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }
  }

  /** Build a self-contained render snapshot (worker-ready). Renders the lattice,
   *  projects agents + interior to world coords, drains FX + control-change. */
  snapshot(): WorldSnapshot {
    this.renderLattice();

    const scale = this.sim.scale;
    const agents: SnapshotAgent[] = [];
    for (const a of this.agentWorld.all()) {
      agents.push({
        x: a.x,
        y: a.y,
        r: Math.sqrt(a.vol / Math.PI) * scale,
        color: AGENT_COLOR[a.bodyKind] ?? 0x888888,
      });
    }

    // Interior (small organelles + nucleus soft body) — only meaningful relative
    // to the controlled cell, mirroring drawInterior's early-out.
    const occupants: SnapshotOccupant[] = [];
    const organelles: SnapshotOrganelle[] = [];
    if (this.sim.centroidLattice(this.controlledCellId)) {
      for (const o of this.grid.occupants) {
        const [wx, wy] = this.sim.latticeToWorld(o.x, o.y);
        occupants.push({
          type: o.type, color: o.color, radius: o.radius,
          x: o.x, y: o.y, compressed: o.compressed, wx, wy,
        });
      }
      for (const big of this.bigOrganelles.organelles) {
        const nodes: Array<{ x: number; y: number }> = [];
        for (const nd of big.body.nodes) {
          const [wx, wy] = this.sim.latticeToWorld(nd.x, nd.y);
          nodes.push({ x: wx, y: wy });
        }
        const nc = big.body.center();
        const [cwx, cwy] = this.sim.latticeToWorld(nc.x, nc.y);
        organelles.push({
          type: big.type, color: big.color, stress: big.stress,
          nodes, cx: cwx, cy: cwy, restRadiusW: big.body.cfg.restRadius * scale * 0.35,
        });
      }
    }

    const fx = this.fxQueue;
    this.fxQueue = [];
    const controlChanged = this.controlChangedFlag;
    this.controlChangedFlag = false;

    return {
      framebuffer: this.framebuffer,
      field: this.sim.field,
      originWX: this.sim.originWX,
      originWY: this.sim.originWY,
      scale,
      agents,
      occupants,
      organelles,
      playerWorld: this.playerWorldPos(),
      stats: this.stats,
      profOverlay: this.prof.overlayText(),
      fx,
      controlChanged,
      simTimeSec: this.timeSec,
      tickSeq: this.tickSeq,
      mcsPerSec: Math.round(this.mcsPerSec),
    };
  }

  // ---- the one fixed-timestep tick ----------------------------------------
  tick(dtSec: number): void {
    this.timeSec += dtSec;
    this.tickSeq++;
    const input = this.input;

    // Controlled cell: rests by default, protrudes + steers only while LMB held.
    const kind = this.controlledKind();
    this.sim.setKindActive(kind, input.steering);
    if (input.steering) {
      const [lx, ly] = this.sim.worldToLattice(input.pointerWX, input.pointerWY);
      this.sim.steerCell(this.controlledCellId, lx, ly);
    } else {
      this.sim.restCell(this.controlledCellId);
    }

    // Vessel current (heart pump): flow dir = loop tangent at the player; pulsed.
    const pc0 = this.sim.centroidLattice(this.controlledCellId);
    if (pc0) {
      const [pwx, pwy] = this.sim.latticeToWorld(pc0.x, pc0.y);
      this.playerT = this.vessel.nearestT(pwx, pwy, this.playerT).t;
      const dir = this.vessel.tangent(this.playerT);
      const pulse = heartbeat(this.timeSec);
      const FLOW_BASE = 140;
      this.sim.flow.setFlow(dir.x, dir.y, FLOW_BASE * (0.3 + 0.7 * pulse));
    }

    const centroids = this.prof.measure("centroids", () => this.sim.centroidsAll());
    this.prof.measure("bubble", () => this.bubbleManagerStep(centroids));
    this.prof.measure("behavior", () => this.behavior.update(dtSec, centroids));
    this.prof.measure("life", () => this.life.update(centroids));
    this.combat.update(input.engulf);

    this.sim.setKindPerimeterTarget(
      kind,
      this.sim.basePerimeter(kind) + this.sim.compartmentPerimeterSum([DIGEST_KIND])
    );

    // Fixed-timestep: advance the sim at a constant real-time rate.
    this.simAccumMs += dtSec * 1000;
    const plan = simStepsFor(this.simAccumMs, 1000 / this.mcsPerSec, MAX_CATCHUP_STEPS);
    this.simAccumMs = plan.remainderMs;
    this.prof.measure("cpm.step", () => this.sim.stepN(plan.steps));

    // Infinite-world streaming (or, when frozen, edge-cull traffic).
    let shiftX = 0;
    let shiftY = 0;
    if (!DEV_FREEZE_STREAMING) {
      const r = this.prof.measure("stream", () => this.sim.streamAround(this.controlledCellId));
      shiftX = r.shiftX;
      shiftY = r.shiftY;
      for (const id of r.demoted) {
        this.forgetColor(id);
        this.rules.forget(id); // dormant != dead
      }
    } else {
      this.cullEdgeTraffic(centroids);
    }

    // Agent tier: step every off-lattice cell + confine + maintain.
    this.prof.measure("agents", () => {
      this.agentWorld.step(dtSec);
      this.confineAgentsToVessel();
    });
    this.streamAccumMs += dtSec * 1000;
    if (this.streamAccumMs >= 150) {
      this.streamAccumMs = 0;
      this.prof.measure("vessel", () => this.maintainAgentVessel());
    }

    // Deforming grid (small organelles flow with the cell's shape).
    const frame = this.sim.cellFrame(this.controlledCellId);
    if (frame) {
      this.grid.shift(shiftX, shiftY);
      this.grid.step(frame, (x, y) => this.sim.ownerAtLattice(x, y) === this.controlledCellId);
    }

    // Big organelles (nucleus): step soft bodies, footprint coupling, stress.
    let steerDir: { x: number; y: number } | null = null;
    if (input.steering) {
      const c = this.sim.centroidLattice(this.controlledCellId);
      const [lx, ly] = this.sim.worldToLattice(input.pointerWX, input.pointerWY);
      if (c) steerDir = { x: lx - c.x, y: ly - c.y };
    }
    this.prof.measure("interior", () => this.bigOrganelles.update(steerDir, shiftX, shiftY));
    if (this.bigOrganelles.consumeRupture()) {
      this.onCellDeath(this.controlledCellId, "ruptured");
    }

    // Molecular signal field: follow recenter, re-mask, produce around nucleus, diffuse.
    this.signal.shift(shiftX, shiftY);
    this.signal.setMask(this.sim.cellPixels(this.controlledCellId));
    const nucleus = this.bigOrganelles.organelles[0];
    if (nucleus) {
      const nc = nucleus.body.center();
      const rr = nucleus.body.cfg.restRadius;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        this.signal.addSource(nc.x + Math.cos(a) * (rr + 2), nc.y + Math.sin(a) * (rr + 2), 0.6);
      }
    }
    this.prof.measure("field", () => this.signal.step(0.18, 0.03));

    this.prof.measure("rules", () => this.rules.update());

    this.census();
    this.prof.frame();
  }

  // ---- census (HUD + profiler scale drivers) ------------------------------
  private census(): void {
    let activeCells = 0;
    let borderPixels = 0;
    let macrophages = 0;
    let lining = 0;
    let microbes = 0;
    for (const rec of this.sim.getCells()) {
      activeCells++;
      borderPixels += this.sim.cellPerimeter(rec.id);
      if (rec.kind === CONTROLLED_KIND || rec.kind === MACROPHAGE_KIND) macrophages++;
      else if (rec.kind === ENDOTHELIAL_KIND || rec.kind === FIBROBLAST_KIND) lining++;
      else if (rec.kind === MICROBE_KIND) microbes++;
    }
    this.stats = {
      macrophages, lining, microbes,
      nutrients: this.combat.nutrients,
      energy: Math.round(this.life.energyOf(this.controlledCellId)),
      hp: Math.round(this.rules.healthFraction(this.controlledCellId) * 100),
      combatStatus: this.combat.engulfing
        ? "ENGULFING"
        : this.combat.digestingCount > 0
          ? "DIGESTING"
          : this.input.steering
            ? "STEERING (hold LMB)"
            : "resting",
    };
    this.prof.metrics.activeCells = activeCells;
    this.prof.metrics.dormantCells = this.sim.dormantCount;
    this.prof.metrics.borderPixels = borderPixels;
  }

  // ---- LOD bubble manager -------------------------------------------------
  // The lattice is the simulated bubble. Anything OVERLAPPING it should be full CPM —
  // so we promote by LATTICE MEMBERSHIP (a square), not a radius from the player (which
  // left the grid's corners/edges as agent discs). Hysteresis: promote once an agent is
  // PROMOTE_MARGIN inside the field, demote only once its centroid leaves to within
  // DEMOTE_MARGIN, so cells near the boundary don't flicker between tiers.
  private bubbleManagerStep(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    const f = this.sim.field;
    const PROMOTE_MARGIN = 28;
    const DEMOTE_MARGIN = 12;
    const inField = (lx: number, ly: number, m: number): boolean =>
      lx >= m && lx < f - m && ly >= m && ly < f - m;

    // Promote every agent that overlaps the lattice interior.
    const toPromote: number[] = [];
    for (const a of this.agentWorld.all()) {
      const [lx, ly] = this.sim.worldToLattice(a.x, a.y);
      if (inField(lx, ly, PROMOTE_MARGIN)) toPromote.push(a.id);
    }
    for (const id of toPromote) {
      const wc = this.agentWorld.remove(id);
      if (!wc) continue;
      const [lx, ly] = this.sim.worldToLattice(wc.x, wc.y);
      const kind = this.bodyKind(wc.bodyKind, false);
      const radius = Math.sqrt(wc.vol / Math.PI);
      const rec = this.sim.spawnCellFilled(kind, Math.round(lx), Math.round(ly), radius);
      this.compositions.set(rec.id, wc.comp);
      this.life.seed(rec.id, wc.energy);
      this.promoted.add(rec.id);
    }

    // Demote promoted cells whose centroid has left the lattice interior.
    for (const id of [...this.promoted]) {
      const c = centroids.get(id);
      if (!c) {
        this.promoted.delete(id);
        continue;
      }
      if (inField(c.x, c.y, DEMOTE_MARGIN)) continue;
      const comp = this.compositions.get(id);
      const rec = this.sim.getCell(id);
      if (comp && rec) {
        const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
        this.agentWorld.adopt(comp, this.kindToBody(rec.kind), wx, wy, this.life.energyOf(id));
      }
      this.sim.killCell(id);
      this.compositions.delete(id);
      this.forgetColor(id);
      this.rules.forget(id);
      this.promoted.delete(id);
    }
  }

  // ---- death / control handoff --------------------------------------------
  private onCellDeath(id: number, reason: DeathReason): void {
    const c = this.sim.centroidLattice(id);
    const rec = this.sim.getCell(id);
    const color = rec ? rec.profile.color : 0xffffff;
    if (c) {
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      const radius = Math.sqrt(c.pixels / Math.PI) * this.sim.scale;
      this.fxQueue.push({ kind: "death", wx, wy, radius, color });
    }
    const wasControlled = id === this.controlledCellId;
    this.sim.killCell(id);
    this.forgetColor(id);
    this.compositions.delete(id);
    this.deaths++;
    console.log(`💀 cell ${id} died (${reason})${wasControlled ? " — CONTROLLED" : ""}`);
    if (wasControlled) this.handoffControl();
  }

  private handoffControl(): void {
    const center = Math.floor(this.sim.field / 2);
    const id = this.spawnPreset("macrophage", center, center, true);
    if (id === null) return;
    for (let i = 0; i < 110; i++) this.sim.step();
    this.bindControl(id);
  }

  private bindControl(id: number): void {
    this.controlledCellId = id;
    this.grid.clear();
    this.bigOrganelles.clear();
    const pc = this.sim.centroidLattice(id);
    if (pc) this.bigOrganelles.add(NUCLEUS.type, NUCLEUS.color, pc.x, pc.y);
    this.controlChangedFlag = true;
  }

  private controlledKind(): number {
    return this.sim.getCell(this.controlledCellId)?.kind ?? CONTROLLED_KIND;
  }

  /** Build: place a lightweight organelle at the cursor (or the cell centre). */
  growOrganelleAt(pwx: number, pwy: number): void {
    const frame = this.sim.cellFrame(this.controlledCellId);
    if (!frame) return;
    const [lx, ly] = this.sim.worldToLattice(pwx, pwy);
    const cx = Math.round(lx);
    const cy = Math.round(ly);
    const interior = this.sim.ownerAtLattice(cx, cy) === this.controlledCellId;
    const sx = interior ? cx : Math.round(frame.cx);
    const sy = interior ? cy : Math.round(frame.cy);
    const k = BUILDABLES[this.buildIndex % BUILDABLES.length];
    this.buildIndex++;
    this.grid.add(k.type, k.color, k.radius, frame, sx, sy);
  }

  // ---- spawning helpers ---------------------------------------------------
  private bodyKind(body: BodyKey, asControlled: boolean): number {
    switch (body) {
      case "macrophage":
        return asControlled ? CONTROLLED_KIND : MACROPHAGE_KIND;
      case "epithelial":
        return EPITHELIAL_KIND;
      case "microbe":
        return MICROBE_KIND;
      case "endothelial":
        return ENDOTHELIAL_KIND;
      case "fibroblast":
        return FIBROBLAST_KIND;
    }
  }

  private kindToBody(kind: number): BodyKey {
    switch (kind) {
      case MACROPHAGE_KIND:
        return "macrophage";
      case EPITHELIAL_KIND:
        return "epithelial";
      case MICROBE_KIND:
        return "microbe";
      case ENDOTHELIAL_KIND:
        return "endothelial";
      default:
        return "fibroblast";
    }
  }

  private spawnPreset(presetName: string, lx: number, ly: number, asControlled = false): number | null {
    const preset = PRESETS[presetName];
    if (!preset) return null;
    const kind = this.bodyKind(preset.body, asControlled);
    const rec = this.sim.spawnCellAtLattice(kind, Math.round(lx), Math.round(ly));
    this.compositions.set(rec.id, new CellComposition(rollComponents(preset, Math.random)));
    this.life.seed(rec.id);
    return rec.id;
  }

  private wallSpacing(): number {
    return this.vessel.cfg.lumenR * 0.7;
  }

  private populateAgentVessel(): void {
    const v = this.vessel;
    for (const s of v.slots(Math.PI, Math.PI, this.wallSpacing())) {
      this.agentWorld.spawnPreset(s.role === "lining" ? "endothelial" : "fibroblast", s.x, s.y);
    }
    for (let i = 0; i < MICROBE_CAP; i++) this.spawnLumenTraffic("microbe", Math.random() * Math.PI * 2);
    for (let i = 0; i < IMMUNE_CAP; i++) this.spawnLumenTraffic("macrophage", Math.random() * Math.PI * 2);
  }

  private confineAgentsToVessel(): void {
    for (const a of this.agentWorld.all()) {
      if (a.comp.capabilities.motility <= 0.05) continue;
      const c = this.vessel.confinement(a.x, a.y);
      if (c.over <= 0) continue;
      const push = Math.min(c.over, 40);
      a.vx += c.nx * push * 0.03;
      a.vy += c.ny * push * 0.03;
      a.x += c.nx * Math.min(c.over, 10);
      a.y += c.ny * Math.min(c.over, 10);
    }
  }

  private spawnLumenTraffic(body: "microbe" | "macrophage", t: number): void {
    const v = this.vessel;
    const p = v.pathPoint(t);
    const tan = v.tangent(t);
    const j = (Math.random() - 0.5) * v.cfg.lumenR * 1.4;
    this.agentWorld.spawnPreset(body, p.x - tan.y * j, p.y + tan.x * j);
  }

  private maintainAgentVessel(): void {
    let microbes = 0;
    let immune = 0;
    for (const a of this.agentWorld.all()) {
      if (a.bodyKind === "microbe") microbes++;
      else if (a.bodyKind === "macrophage") immune++;
    }
    if (microbes < MICROBE_CAP && Math.random() < 0.6) {
      this.spawnLumenTraffic("microbe", Math.random() * Math.PI * 2);
    }
    if (immune < IMMUNE_CAP && Math.random() < 0.05) {
      this.spawnLumenTraffic("macrophage", Math.random() * Math.PI * 2);
    }
  }

  private despawnCell(id: number): void {
    this.sim.killCell(id);
    this.forgetColor(id);
    this.compositions.delete(id);
  }

  private cullEdgeTraffic(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    const f = this.sim.field;
    const band = 10;
    for (const rec of [...this.sim.getCells()]) {
      if (rec.kind !== MICROBE_KIND && rec.kind !== MACROPHAGE_KIND) continue;
      const c = centroids.get(rec.id);
      if (!c) continue;
      if (c.x < band || c.x > f - band || c.y < band || c.y > f - band) {
        this.despawnCell(rec.id);
      }
    }
  }
}
