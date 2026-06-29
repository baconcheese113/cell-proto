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
import { planPromotions } from "./bubble-manager-core";
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
const TARGET_MCS_PER_SEC = 240;
const MS_PER_MCS = 1000 / TARGET_MCS_PER_SEC;
const MAX_CATCHUP_STEPS = 6; // cap per frame -> bounded slow-mo, no spiral of death

// Bubble manager LOD radii (world px from the player).
const R_PROMOTE = 560;
const R_PROMOTE_MAX = 700;

const NUCLEUS = { type: "nucleus", color: 0x9b6cff, radius: 6 };
const BUILDABLES = [
  { type: "mitochondrion", color: 0xff9d4d, radius: 3.5 },
  { type: "ribosome", color: 0x7cf6c7, radius: 2 },
  { type: "golgi", color: 0xffe066, radius: 3 },
];

const MICROBE_CAP = 110;
const IMMUNE_CAP = 14;

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

/** Plain callbacks for things that need the render/Phaser layer. WorldSim stays
 *  DOM-free; the scene plays the FX / resets the camera. */
export interface WorldSimHooks {
  onDeathFx?: (wx: number, wy: number, radius: number, color: number) => void;
  onDigestFx?: (wx: number, wy: number, radius: number, color: number) => void;
  onCellGone?: (id: number) => void; // drop renderer colour cache
  onControlChanged?: () => void; // camera should reset its follow
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

  private readonly hooks: WorldSimHooks;
  private playerT = 0;
  private simAccumMs = 0;
  private streamAccumMs = 0;
  private timeSec = 0;
  private buildIndex = 0;
  private input: WorldInput = { steering: false, pointerWX: 0, pointerWY: 0, engulf: false, viewHalfDiag: 600 };

  constructor(hooks: WorldSimHooks = {}, config: CpmWorldConfig = DEFAULT_WORLD_CONFIG) {
    this.hooks = hooks;
    const cfg = config;
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
      onConsumeStart: (id) => this.hooks.onCellGone?.(id),
      onDigested: (wx, wy) => this.hooks.onDigestFx?.(wx, wy, 26, 0xffe066),
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

  /** Player's world-space centroid (for the camera to follow). Null if unknown. */
  playerWorldPos(): { x: number; y: number } | null {
    const c = this.sim.centroidLattice(this.controlledCellId);
    if (!c) return null;
    const [x, y] = this.sim.latticeToWorld(c.x, c.y);
    return { x, y };
  }

  // ---- the one fixed-timestep tick ----------------------------------------
  tick(dtSec: number): void {
    this.timeSec += dtSec;
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
    const plan = simStepsFor(this.simAccumMs, MS_PER_MCS, MAX_CATCHUP_STEPS);
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
        this.hooks.onCellGone?.(id);
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
  private bubbleManagerStep(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    const pc = centroids.get(this.controlledCellId);
    if (!pc) return;
    const [pwx, pwy] = this.sim.latticeToWorld(pc.x, pc.y);

    const rPromote = Math.min(Math.max(this.input.viewHalfDiag + 80, R_PROMOTE), R_PROMOTE_MAX);
    const rDemote = rPromote + 100;

    const agentPos: Array<{ id: number; x: number; y: number }> = [];
    for (const a of this.agentWorld.all()) agentPos.push({ id: a.id, x: a.x, y: a.y });

    const promotedPos: Array<{ id: number; x: number; y: number }> = [];
    for (const id of this.promoted) {
      const c = centroids.get(id);
      if (!c) {
        this.promoted.delete(id);
        continue;
      }
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      promotedPos.push({ id, x: wx, y: wy });
    }

    const plan = planPromotions({ x: pwx, y: pwy }, agentPos, promotedPos, rPromote, rDemote);
    const f = this.sim.field;

    for (const id of plan.promote) {
      const wc = this.agentWorld.remove(id);
      if (!wc) continue;
      const [lx, ly] = this.sim.worldToLattice(wc.x, wc.y);
      const xi = Math.round(lx);
      const yi = Math.round(ly);
      if (xi < 22 || xi >= f - 22 || yi < 22 || yi >= f - 22) {
        this.agentWorld.adopt(wc.comp, wc.bodyKind, wc.x, wc.y, wc.energy);
        continue;
      }
      const kind = this.bodyKind(wc.bodyKind, false);
      const radius = Math.sqrt(wc.vol / Math.PI);
      const rec = this.sim.spawnCellFilled(kind, xi, yi, radius);
      this.compositions.set(rec.id, wc.comp);
      this.life.seed(rec.id, wc.energy);
      this.promoted.add(rec.id);
    }

    for (const id of plan.demote) {
      const c = centroids.get(id);
      const comp = this.compositions.get(id);
      const rec = this.sim.getCell(id);
      if (c && comp && rec) {
        const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
        this.agentWorld.adopt(comp, this.kindToBody(rec.kind), wx, wy, this.life.energyOf(id));
      }
      this.sim.killCell(id);
      this.compositions.delete(id);
      this.hooks.onCellGone?.(id);
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
      this.hooks.onDeathFx?.(wx, wy, radius, color);
    }
    const wasControlled = id === this.controlledCellId;
    this.sim.killCell(id);
    this.hooks.onCellGone?.(id);
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
    this.hooks.onControlChanged?.();
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
    this.hooks.onCellGone?.(id);
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
