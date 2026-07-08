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
import { CpmTrogocytosis } from "./cpm-trogocytosis";
import { CpmField } from "./cpm-field";
import { CpmDeformGrid } from "./cpm-deform-grid";
import { CpmBigOrganelles } from "./cpm-big-organelles";
import { CpmProfiler } from "./cpm-profiler";
import { CpmLife } from "./cpm-life";
import { CellComposition } from "./cell-composition";
import { PRESETS, rollComponents, type BodyKey } from "./cell-presets";
import { CpmVessel, DEFAULT_VESSEL } from "./cpm-vessel";
import { simStepsFor } from "./sim-clock";
import { checkerboardStepN } from "./cpm-checkerboard-spike";
import { GpuStepBridge } from "./gpu/gpu-step-bridge";
import { AgentWorld, TEAM } from "./agent-world";
import { hostile } from "./agent-world-core";
import {
  DEFAULT_WORLD_CONFIG,
  type CpmWorldConfig,
  PLAYER_PROFILE,
  TISSUE_PROFILE,
  MICROBE_PROFILE,
  ENDOTHELIAL_PROFILE,
  FIBROBLAST_PROFILE,
  DIGESTING_PROFILE,
  GRIPPED_PROFILE,
  DEBRIS_PROFILE,
} from "./cpm-config";

// Kinds = physics bodies only (NOT identities — a cell's identity is its composition).
export const CONTROLLED_KIND = 1; // macrophage body, player-driven
export const MACROPHAGE_KIND = 2; // macrophage body, autonomous
export const EPITHELIAL_KIND = 3;
export const MICROBE_KIND = 4;
export const ENDOTHELIAL_KIND = 5; // vessel lining
export const FIBROBLAST_KIND = 6; // tissue beyond
export const DIGEST_KIND = 7;
export const DEBRIS_KIND = 8; // ripped-off membrane fragment (inert, faded + resorbed)
export const GRIPPED_KIND = 9; // prey held by the tentacle (immobile, can't heal — rendable)

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

// 60 (was 110): the big bubble promoted the whole cap into full CPM at once — clutter + the
// dominant AWAKE border cost now that walls sleep. 60 still reads as a busy vessel while
// halving the promoted microbe load. Total across the agent tier (they persist — no distance
// culling; far ones are cheap discs), biased to spawn near the player.
const MICROBE_CAP = 60;
const IMMUNE_CAP = 14;
// How firmly a promoted wall cell is anchored to its home slot — the SNAP-BACK force
// that pulls the floppy lining cells back to their original configuration after an
// immune cell transmigrates through. Firm enough to restore the arrangement; the immune
// cell's strong Act still pushes through regardless (Artistoo diapedesis physics).
const WALL_SEAL_LAMBDA = 110;
// Lattice radius around the steering player within which lining cells get
// transmigration-immunity (exempt from death while being crossed), + how long it
// lingers so they reconnect/regrow after the player passes.
const XMIGRATE_R = 22;
const XMIGRATE_TICKS = 60;

// ---- wall sleeping (cpm.step optimization) --------------------------------
// Sessile vessel walls are ~3/4 of the CPM border, and every Monte-Carlo sweep pays the
// full soft-constraint deltaH on each of their border pixels only to reject the copy. So a
// wall that has SETTLED into the sealed sheet AND is FAR from the player is put to SLEEP
// (per-cell barrier): its copy attempts reject at the cheap hard-check. It runs full CPM
// again the moment the player nears it (deform/reseal) — so behaviour is preserved where it
// matters, and a resting wall (which never moves anyway) just stops burning CPU.
const WALL_SETTLE_TICKS = 40; // run full CPM this long after promotion so it packs + seals first
const WALL_WAKE_R = 34; // lattice px: walls within this of the player stay awake (deformable)

/** How long a ripped membrane fragment persists (seconds) before it fades out + is
 *  removed. It holds full opacity for the first ~40%, then fades to nothing. */
const DEBRIS_TTL = 4;

/** Membrane-integrity death: a cell torn below this fraction of its full volume LYSES — the
 *  rest scatters into debris. Low, so a gripped prey is RENT over several tears (grab, then
 *  thrash it down) rather than popping on the first hit — the Carrion-style rend. */
const RIP_DEATH_FRACTION = 0.32;

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

/** Team (allegiance) marker colour — the small NUCLEUS DOT at a cell's centre that shows
 *  whose side it's on, readable at both the disc and CPM zoom. Neutral (0) gets no marker
 *  (lining/tissue don't fight). Body colour still encodes the cell's class/abilities. */
const TEAM_COLOR: Record<number, number> = {
  [TEAM.immune]: 0x6fd3ff, // blue — your side
  [TEAM.microbe]: 0xff5a5a, // red — pathogens
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
  engulf: boolean; // RMB held (the unified "grab": engulf or trogocytosis by build)
  pointerSpeed: number; // cursor speed in SCREEN px/sec — the trogocytosis THRASH signal
                        // (screen space so holding while the camera drifts doesn't tear)
  viewHalfDiag: number; // world px from screen centre to a corner (bubble promote radius)
  diag: boolean; // DEV seam-diagnostic overlay (G): tint CPM cells + emit promoted agents
                 // as durable-record markers so the agent↔CPM handoff is visible.
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
  /** Which tier the durable record is in. "agent" = a normal LOD disc; "cpm" = it has a
   *  CPM shadow (normally NOT emitted, but the seam-diagnostic overlay emits it so the
   *  durable record can be drawn over its blob to check the handoff). */
  tier: "agent" | "cpm";
  /** Diagnostic: this record claims a CPM shadow (tier "cpm") but no live CPM cell exists
   *  for it — a LEAK (the handoff back to a disc was missed). Drawn red, not magenta. */
  ghost?: boolean;
}

/** A team NUCLEUS DOT at a cell's centre (world coords), coloured by allegiance. Emitted
 *  for every non-neutral cell at BOTH tiers (agent disc + CPM shadow) so you can read whose
 *  side a cell is on at any zoom. */
export interface SnapshotMarker {
  wx: number;
  wy: number;
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
  markers: SnapshotMarker[];
  /** Diagnostic (diag only): CPM cells with NO durable agent link — true orphans that would
   *  vanish (not demote to a disc) on stream-out. The player is excluded (it's CPM-only by
   *  design). Drawn as red rings so a real leak is unmistakable. */
  diagOrphans: SnapshotMarker[];
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
  readonly trog: CpmTrogocytosis;
  readonly signal: CpmField;
  readonly grid: CpmDeformGrid;
  readonly bigOrganelles: CpmBigOrganelles;
  readonly vessel: CpmVessel;
  readonly agentWorld: AgentWorld;
  readonly prof = new CpmProfiler();

  /** A cell IS its composition: id -> mutable composition. */
  readonly compositions = new Map<number, CellComposition>();
  /** CPM-shadow link: cpmCellId -> the durable agentId it represents. The agent stays in
   *  agentWorld the whole time (never destroyed by promotion); this just records which
   *  CPM cell is currently shadowing it so we can mirror it + release it back. */
  readonly cpmToAgent = new Map<number, number>();
  /** Lining cell id -> ticks of transmigration-immunity: a lining cell the immune cell
   *  is currently crossing is exempt from structural-failure/damage death (crossing
   *  transiently splits it; it reconnects + regrows after). Real diapedesis is non-lethal. */
  private readonly xmigrateTTL = new Map<number, number>();
  /** Wall cell id -> ticks it has been on the lattice (its "settle" age). Used by the
   *  wall-sleep pass: a wall only sleeps once it has run full CPM long enough to pack into
   *  the sealed sheet. */
  private readonly wallAge = new Map<number, number>();
  /** DEV: cpm id -> a short tag of the code path that created it (promote/preset/rip/…),
   *  for the hover-inspect logger to trace where an unexpected/orphan cell came from. */
  private readonly cellOrigin = new Map<number, string>();
  private originSeq = 0;

  controlledCellId = 0;
  deaths = 0;
  /** SPIKE (dev): drive the CPM with the checkerboard step instead of Artistoo's sequential
   *  MC, to judge whether the parallel-friendly update preserves the dynamics. */
  useCheckerboard = false;
  checkerboardB = 4;
  stats: WorldHudStats = {
    macrophages: 0, lining: 0, microbes: 0, nutrients: 0, energy: 0, hp: 0, combatStatus: "resting",
  };

  // Render state owned by the sim so the snapshot is self-contained (worker-ready).
  private readonly framebuffer: Uint32Array;
  private readonly colorCache = new Map<number, { r: number; g: number; b: number; maxAct: number }>();
  /** Per-cell render-colour override (0xRRGGBB) — debris fragments inherit the colour of
   *  the cell they were torn from instead of their kind's profile colour. */
  private readonly colorOverride = new Map<number, number>();
  /** Live debris fragments: cpm id -> remaining time-to-live (seconds). They fade (alpha)
   *  + slowly resorb over this window, then are killed. */
  private readonly debris = new Map<number, number>();
  /** Prey currently GRIPPED by the tentacle: cpm id -> its original kind (to restore on
   *  release). While gripped it's the immobile, non-healing GRIPPED_KIND so tears rend it. */
  private readonly grippedOriginalKind = new Map<number, number>();
  /** Per-debris render alpha (0..255), recomputed from its TTL each tick. */
  private readonly debrisAlpha = new Map<number, number>();
  private fxQueue: SnapshotFx[] = [];
  private controlChangedFlag = false;

  private playerT = 0;
  private tickSeq = 0;
  private mcsPerSec = TARGET_MCS_PER_SEC;
  private simAccumMs = 0;
  private streamAccumMs = 0;
  private timeSec = 0;
  private buildIndex = 0;
  private input: WorldInput = { steering: false, pointerWX: 0, pointerWY: 0, engulf: false, pointerSpeed: 0, viewHalfDiag: 600, diag: false };

  // GPU-offloaded Monte-Carlo step (?gpu). When enabled, the per-tick `cpm.step` runs on the GPU via
  // GpuStepBridge instead of `sim.stepN`. Everything else (streaming, combat, nucleus, rendering)
  // stays on the CPU exactly as before — the bridge just advances the lattice. Built lazily on the
  // first stepped tick; falls back to CPU if WebGPU is unavailable. NOTE: Footprint (nucleus) + Flow
  // are not yet in the GPU step (M-Bridge-2), so those couplings are inert while GPU-stepping.
  private gpuEnabled = false;
  private gpu: GpuStepBridge | null = null;
  private gpuFailed = false;
  /** Spare per-cell id headroom so occasional spawns don't force a bridge rebuild every time. */
  private static readonly GPU_ID_HEADROOM = 256;

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
      DEBRIS_PROFILE, // 8 DEBRIS
      GRIPPED_PROFILE, // 9 GRIPPED
    ], CONTROLLED_KIND); // the player plows through debris; it's frozen vs everything else
    const center = Math.floor(cfg.fieldSize / 2);
    this.sim.originWX = -center * this.sim.scale;
    this.sim.originWY = -center * this.sim.scale;
    this.vessel = new CpmVessel(DEFAULT_VESSEL);

    this.agentWorld = new AgentWorld(2000, Math.random, false, this.sim.scale);
    this.signal = new CpmField(cfg.fieldSize);
    this.rules = new CpmRules(this.sim, {
      onDeath: (id, reason) => this.onCellDeath(id, reason),
      // Not judged/killed by the rules layer: combat-owned prey; inert debris (has its
      // own TTL); OR a lining cell being transmigrated through (transiently split, then
      // reconnects — diapedesis is non-lethal).
      ignore: (id) =>
        this.combat.isConsuming(id) || this.debris.has(id) || this.xmigrateTTL.has(id),
    });

    this.sim.setKindActive(MACROPHAGE_KIND, true);
    this.sim.setKindActive(MICROBE_KIND, true);
    this.sim.flow.setFlowingKinds([MACROPHAGE_KIND, MICROBE_KIND]);

    // DIAPEDESIS — Artistoo EpidermisWithTCells adhesion: the immune↔lining boundary is EXPENSIVE
    // (J high), so the immune cell doesn't stick/spread on the lining — its strong Act
    // drives it THROUGH to the tissue on the far side. The lining is cohesive (J low)
    // and volume-filling, so bacteria (which lack the Act) can't push through.
    const ENDO_COHESION = 20; // endo↔endo (Artistoo epi↔epi = 20)
    const IMMUNE_ENDO = 100;  // endo↔immune (Artistoo epi↔Tcell = 100): unfavorable
    const MICROBE_ENDO = 100; // bacteria: same expensive interface, and no Act -> blocked
    this.sim.setKindAdhesion(ENDOTHELIAL_KIND, ENDOTHELIAL_KIND, ENDO_COHESION);
    this.sim.setKindAdhesion(FIBROBLAST_KIND, FIBROBLAST_KIND, ENDO_COHESION);
    for (const immune of [CONTROLLED_KIND, MACROPHAGE_KIND]) {
      this.sim.setKindAdhesion(immune, ENDOTHELIAL_KIND, IMMUNE_ENDO);
      this.sim.setKindAdhesion(immune, FIBROBLAST_KIND, IMMUNE_ENDO);
    }
    this.sim.setKindAdhesion(MICROBE_KIND, ENDOTHELIAL_KIND, MICROBE_ENDO);
    this.sim.setKindAdhesion(MICROBE_KIND, FIBROBLAST_KIND, MICROBE_ENDO);


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
    this.trog = new CpmTrogocytosis(this.sim, {
      playerKind: CONTROLLED_KIND,
      getAttackerId: () => this.controlledCellId,
      // Allegiance-based: rip any cell on a hostile team (never self/ally/neutral/debris).
      isHostile: (id) =>
        id !== this.controlledCellId &&
        hostile(this.teamOf(id), this.teamOf(this.controlledCellId)),
      rip: (targetId, lx, ly, count) => this.ripFragment(targetId, lx, ly, count),
      onGrab: (id) => this.gripCell(id),
      onRelease: (id) => this.ungripCell(id),
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

  /** Allegiance of a CPM cell: the controlled cell is on the immune team; a promoted
   *  shadow inherits its durable agent's team; anything else (incl. debris) is neutral. */
  private teamOf(cpmId: number): number {
    if (cpmId === this.controlledCellId) return TEAM.immune;
    const agentId = this.cpmToAgent.get(cpmId);
    if (agentId !== undefined) return this.agentWorld.get(agentId)?.team ?? TEAM.neutral;
    return TEAM.neutral;
  }

  /** Which offensive verb the player's RMB "grab" performs, from its composition: rip if
   *  it's built more for tearing than engulfing, else engulf. (The unified grab — T4.) */
  private playerPrefersTrog(): boolean {
    const caps = this.compositions.get(this.controlledCellId)?.capabilities;
    if (!caps) return false;
    return caps.tearing > caps.phagocytic;
  }

  /** Player's world-space centroid (for the camera to follow). Null if unknown. */
  playerWorldPos(): { x: number; y: number } | null {
    const c = this.sim.centroidLattice(this.controlledCellId);
    if (!c) return null;
    const [x, y] = this.sim.latticeToWorld(c.x, c.y);
    return { x, y };
  }

  // ---- rendering (pure; produces RGBA + a render snapshot) -----------------

  /** Drop a cell's cached colour + any debris/override state (death/leave/consume). */
  private forgetColor(id: number): void {
    this.colorCache.delete(id);
    this.colorOverride.delete(id);
    this.debris.delete(id);
    this.debrisAlpha.delete(id);
    this.cellOrigin.delete(id);
    this.wallAge.delete(id);
  }

  private channels(id: number): { r: number; g: number; b: number; maxAct: number } {
    let c = this.colorCache.get(id);
    if (!c) {
      const override = this.colorOverride.get(id);
      const rec = this.sim.getCell(id);
      const color = override ?? (rec ? rec.profile.color : 0x888888);
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
    const hasDebris = this.debrisAlpha.size > 0;
    // Seam diagnostic: push every CPM cell's body toward a distinct orange so a blob can
    // never be mistaken for its cyan/magenta agent overlay (border + activity still read).
    const diag = this.input.diag;
    for (const [[x, y], id] of grid.pixels()) {
      const c = this.channels(id);
      const a = this.sim.activityAtIndex(grid.p2i([x, y])) / c.maxAct;
      const t = a > 1 ? 1 : a < 0 ? 0 : a;
      let r = (c.r + (255 - c.r) * t) | 0;
      let g = (c.g + (245 - c.g) * t) | 0;
      let b = (c.b + (200 - c.b) * t) | 0;
      if (diag) {
        r = (r + (0xff - r) * 0.55) | 0;
        g = (g + (0x8c - g) * 0.55) | 0;
        b = (b + (0x2a - b) * 0.55) | 0;
      }
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
      let alpha = 0xff;
      if (hasDebris) {
        const da = this.debrisAlpha.get(id);
        if (da !== undefined) alpha = da;
      }
      buf[y * field + x] = (alpha << 24) | (b << 16) | (g << 8) | r;
    }
  }

  /** Build a self-contained render snapshot (worker-ready). Renders the lattice,
   *  projects agents + interior to world coords, drains FX + control-change. */
  snapshot(): WorldSnapshot {
    this.renderLattice();

    const scale = this.sim.scale;
    const diag = this.input.diag;
    const agents: SnapshotAgent[] = [];
    const markers: SnapshotMarker[] = [];
    for (const a of this.agentWorld.all()) {
      const teamColor = TEAM_COLOR[a.team];
      // Team nucleus dot at the cell's centre — for a CPM shadow its x/y were mirrored from
      // the CPM centroid; for an agent it's the disc centre. Neutral cells get none.
      if (teamColor !== undefined) {
        markers.push({ wx: a.x, wy: a.y, r: Math.max(2, Math.sqrt(a.vol / Math.PI) * scale * 0.34), color: teamColor });
      }
      // Normally a promoted cell renders ONLY as its CPM shadow. In diag mode we ALSO emit
      // its durable record (tier "cpm") so the scene can draw it over the blob and reveal
      // whether the agent↔CPM handoff landed in the right place/size.
      if (a.tier === "cpm" && !diag) continue;
      // A tier-"cpm" record whose CPM cell no longer exists is a GHOST leak (marker with no
      // body): the demote-to-disc handoff was missed and the record is stranded off-tier.
      const ghost = a.tier === "cpm" && (a.cpmId === undefined || !this.sim.getCell(a.cpmId));
      agents.push({
        x: a.x,
        y: a.y,
        r: Math.sqrt(a.vol / Math.PI) * scale,
        color: AGENT_COLOR[a.bodyKind] ?? 0x888888,
        tier: a.tier,
        ghost,
      });
    }

    // Diagnostic: find true ORPHANS — live CPM cells with no durable agent link that
    // aren't the player or a transient body kind (debris/gripped/digest). These would
    // vanish, not demote, if they left the bubble.
    const diagOrphans: SnapshotMarker[] = [];
    if (diag) {
      for (const rec of this.sim.getCells()) {
        if (rec.id === this.controlledCellId) continue; // player is CPM-only by design
        if (rec.kind === DEBRIS_KIND || rec.kind === GRIPPED_KIND || rec.kind === DIGEST_KIND) continue;
        if (this.cpmToAgent.has(rec.id)) continue; // properly linked
        const c = this.sim.centroidLattice(rec.id);
        if (!c) continue;
        const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
        diagOrphans.push({ wx, wy, r: Math.sqrt(c.pixels / Math.PI) * scale, color: 0xff2a2a });
      }
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
      markers,
      diagOrphans,
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

  /** Turn on GPU-offloaded stepping (?gpu). Idempotent; the bridge is built lazily on the first
   *  stepped tick so cells already exist when it snapshots the config. */
  enableGpu(): void {
    this.gpuEnabled = true;
  }

  /** True once the GPU step bridge is built and actually stepping the lattice. False if GPU stepping
   *  is disabled or WebGPU was unavailable and it fell back to the CPU. */
  gpuActive(): boolean {
    return this.gpuEnabled && !this.gpuFailed && this.gpu !== null;
  }

  /** Perf triage for ?gpuworld: per-phase timings of the last GPU step + MCS driven this tick. */
  gpuDiag(): object {
    return { timings: this.gpu?.lastTimings ?? null, lastSteps: this.lastGpuSteps, capacity: this.gpu?.capacity };
  }
  private lastGpuSteps = 0;

  /** Advance the CPM lattice `steps` MCS on the GPU. Builds the bridge lazily and rebuilds it if the
   *  live cell-id range has outgrown the GPU buffers (a spawn beyond headroom). Falls back to CPU
   *  permanently if WebGPU is unavailable. */
  private async gpuStep(steps: number): Promise<void> {
    const needed = GpuStepBridge.maxLiveId(this.sim);
    if (this.gpu && needed > this.gpu.capacity) {
      this.gpu.destroy();
      this.gpu = null;
    }
    if (!this.gpu) {
      const built = await GpuStepBridge.create(this.sim, {
        permeableKind: CONTROLLED_KIND, // the player plows through barriers, matching the CPU sim
        barrierKinds: [DEBRIS_KIND], // inert ripped-membrane fragments are hard barriers
        idHeadroom: WorldSim.GPU_ID_HEADROOM,
      });
      if ("error" in built) {
        console.warn("GPU step unavailable, staying on CPU:", built.error);
        this.gpuFailed = true;
        this.sim.stepN(steps); // this tick still advances, on the CPU
        return;
      }
      this.gpu = built;
    }
    await this.gpu.step(steps);
  }

  // ---- the one fixed-timestep tick ----------------------------------------
  // Async because the GPU step awaits its readback; when GPU-stepping is OFF the function hits no
  // `await` and so completes synchronously (the worker path is unaffected).
  async tick(dtSec: number): Promise<void> {
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
    this.prof.measure("bubble", () => {
      this.bubbleManagerStep(centroids);
      this.mirrorShadows(centroids);
      this.resealWalls(centroids);
      this.protectTransmigrated(centroids, input.steering);
      this.updateWallSleep(centroids);
    });
    this.prof.measure("behavior", () => this.behavior.update(dtSec, centroids));
    this.prof.measure("life", () => this.life.update(centroids));
    // RMB is the unified "grab": route it to trogocytosis (rip) or engulf by the player's
    // dominant offensive capability (its composition decides which verb it can use).
    if (this.playerPrefersTrog()) {
      const [clx, cly] = this.sim.worldToLattice(input.pointerWX, input.pointerWY);
      this.trog.update(input.engulf, clx, cly, input.pointerSpeed, dtSec * 1000);
    } else {
      this.combat.update(input.engulf);
    }

    this.sim.setKindPerimeterTarget(
      kind,
      this.sim.basePerimeter(kind) + this.sim.compartmentPerimeterSum([DIGEST_KIND])
    );

    // Fixed-timestep: advance the sim at a constant real-time rate.
    this.simAccumMs += dtSec * 1000;
    const plan = simStepsFor(this.simAccumMs, 1000 / this.mcsPerSec, MAX_CATCHUP_STEPS);
    this.simAccumMs = plan.remainderMs;
    if (this.gpuEnabled && !this.gpuFailed && plan.steps > 0) {
      this.lastGpuSteps = plan.steps;
      await this.gpuStep(plan.steps);
    } else {
      // SPIKE: swap in the checkerboard step (same math, phase-alternating order) to eyeball
      // whether the parallel-friendly scheme preserves the dynamics. DEV toggle only.
      this.prof.measure("cpm.step", () =>
        this.useCheckerboard
          ? checkerboardStepN(this.sim, plan.steps, this.checkerboardB)
          : this.sim.stepN(plan.steps)
      );
    }

    // Infinite-world streaming (or, when frozen, edge-cull traffic).
    let shiftX = 0;
    let shiftY = 0;
    if (!DEV_FREEZE_STREAMING) {
      // Capture each shadow's absolute WORLD position/energy BEFORE streaming clips the
      // lattice (the recenter destroys the CPM cell), so any shadow the stream removes is
      // handed BACK to the agent tier as a disc instead of being erased.
      const shadowWorld = new Map<number, { wx: number; wy: number; energy: number }>();
      for (const [cpmId] of this.cpmToAgent) {
        const c = centroids.get(cpmId);
        if (!c) continue;
        const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
        shadowWorld.set(cpmId, { wx, wy, energy: this.life.energyOf(cpmId) });
      }

      const r = this.prof.measure("stream", () => this.sim.streamAround(this.controlledCellId));
      shiftX = r.shiftX;
      shiftY = r.shiftY;
      for (const id of r.demoted) {
        const agentId = this.cpmToAgent.get(id);
        const info = shadowWorld.get(id);
        if (agentId !== undefined && info) {
          // streamAround already removed the CPM cell -> killCpm=false.
          this.releaseToAgent(id, agentId, info.wx, info.wy, info.energy, false);
        } else {
          this.forgetColor(id);
          this.rules.forget(id);
        }
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
    this.stepDebris(dtSec);

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
      combatStatus: this.playerPrefersTrog()
        ? this.trog.latched
          ? "TROG: GRIPPING — thrash the mouse to rip it apart"
          : this.input.engulf
            ? "TROG: reaching… (hold RMB, touch a microbe to grab)"
            : this.input.steering
              ? "STEERING (hold LMB)"
              : "resting"
        : this.combat.engulfing
          ? "ENGULFING"
          : this.combat.digestingCount > 0
            ? "DIGESTING"
            : this.input.steering
              ? "STEERING (hold LMB)"
              : "resting",
    };
    this.prof.metrics.activeCells = activeCells;
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

    // Demote first: any shadow whose centroid left the lattice interior loses its CPM
    // cell and resumes as an agent disc. (Cells promoted THIS tick aren't in `centroids`
    // yet, so they're naturally skipped until next tick.)
    for (const [cpmId, agentId] of [...this.cpmToAgent]) {
      const c = centroids.get(cpmId);
      if (!c) continue; // brand-new shadow, or already removed (death handled elsewhere)
      if (inField(c.x, c.y, DEMOTE_MARGIN)) continue;
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      this.releaseToAgent(cpmId, agentId, wx, wy, this.life.energyOf(cpmId), true);
    }

    // Promote: every agent overlapping the lattice interior gets a CPM SHADOW. The agent
    // record stays in agentWorld (durable) — it just stops self-integrating + disc-
    // rendering while the CPM cell represents it.
    for (const a of this.agentWorld.all()) {
      if (a.tier !== "agent") continue;
      const [lx, ly] = this.sim.worldToLattice(a.x, a.y);
      if (!inField(lx, ly, PROMOTE_MARGIN)) continue;
      const kind = this.bodyKind(a.bodyKind, false);
      const radius = Math.sqrt(a.vol / Math.PI);
      const rec = this.sim.spawnCellFilled(kind, Math.round(lx), Math.round(ly), radius);
      this.compositions.set(rec.id, a.comp);
      this.life.seed(rec.id, a.energy);
      this.agentWorld.markPromoted(a.id, rec.id);
      this.cpmToAgent.set(rec.id, a.id);
      this.tagOrigin(rec.id, `promote:${a.bodyKind}#agent${a.id}`);
    }
  }

  /** DEV: record where a CPM cell was created, for the hover-inspect provenance logger. */
  private tagOrigin(id: number, reason: string): void {
    this.cellOrigin.set(id, `${reason} @tick${this.tickSeq}#${this.originSeq++}`);
  }

  /** DEV (hover + I): log full provenance of the CPM cell at a world position so we can trace
   *  where an unexpected/orphan cell (a CPM cell with no durable agent link) came from. */
  pickCellAt(wx: number, wy: number): void {
    const [lxf, lyf] = this.sim.worldToLattice(wx, wy);
    const lx = Math.round(lxf);
    const ly = Math.round(lyf);
    const id = this.sim.ownerAtLattice(lx, ly);
    if (id === 0) {
      console.log(`🔍 pick @(${lx},${ly}) lattice: BACKGROUND (no cell)`);
      return;
    }
    const rec = this.sim.getCell(id);
    const c = this.sim.centroidLattice(id);
    const agentId = this.cpmToAgent.get(id);
    const agent = agentId !== undefined ? this.agentWorld.get(agentId) : undefined;
    const linked = agentId !== undefined;
    const isPlayer = id === this.controlledCellId;
    const transient =
      rec !== undefined &&
      (rec.kind === DEBRIS_KIND || rec.kind === GRIPPED_KIND || rec.kind === DIGEST_KIND);
    const isOrphan = rec !== undefined && !isPlayer && !linked && !transient;
    console.log(
      `🔍 PICK cell ${id} — ${isOrphan ? "⚠️ ORPHAN (no agent link)" : isPlayer ? "PLAYER" : linked ? "linked" : "transient/unlinked"}`,
      {
        kind: rec?.kind,
        profile: rec?.profile.name,
        origin: this.cellOrigin.get(id) ?? "(untracked — created before tagging or by a path with no tag)",
        isPlayer,
        linkedToAgent: linked,
        agentId,
        frozen: this.sim.isFrozen(id),
        wallAge: this.wallAge.get(id),
        pixels: c?.pixels,
        lattice: c ? { x: Math.round(c.x), y: Math.round(c.y) } : null,
        team: this.teamOf(id),
        hasComposition: this.compositions.has(id),
        agent: agent
          ? { tier: agent.tier, body: agent.bodyKind, team: agent.team, x: Math.round(agent.x), y: Math.round(agent.y), cpmId: agent.cpmId }
          : null,
      }
    );
  }

  /** Drop a CPM shadow and hand its durable agent back to the agent tier at a world
   *  position (so leaving the bubble NEVER deletes a cell — it just becomes a disc). */
  private releaseToAgent(
    cpmId: number,
    agentId: number,
    wx: number,
    wy: number,
    energy: number,
    killCpm: boolean
  ): void {
    this.agentWorld.markDemoted(agentId, wx, wy, energy);
    this.cpmToAgent.delete(cpmId);
    if (killCpm) this.sim.killCell(cpmId);
    this.compositions.delete(cpmId);
    this.forgetColor(cpmId);
    this.rules.forget(cpmId);
  }

  /** Mirror each CPM shadow's centroid + energy onto its durable agent record, so the
   *  agent tracks the cell and reappears in the right place + state when demoted. */
  private mirrorShadows(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    for (const [cpmId, agentId] of this.cpmToAgent) {
      const c = centroids.get(cpmId);
      if (!c) continue;
      const wc = this.agentWorld.get(agentId);
      if (!wc) continue;
      // Sessile wall cells keep their durable position at their SPAWN slot (their
      // "home"): we don't track their displaced centroid, so when the player wedges
      // through them, the reseal force (resealWalls) pulls them back home and the
      // lining re-closes. Only mobile cells mirror their displaced position.
      if (wc.comp.capabilities.motility > 0.05) {
        const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
        wc.x = wx;
        wc.y = wy;
      }
      wc.energy = this.life.energyOf(cpmId);
    }
  }

  /** Grant transmigration-immunity to lining cells the steering immune cell is crossing
   *  (within XMIGRATE_R of its centroid), so they don't die when the crossing transiently
   *  splits them; immunity lingers XMIGRATE_TICKS after so they reconnect + regrow. */
  private protectTransmigrated(
    centroids: Map<number, { x: number; y: number; pixels: number }>,
    steering: boolean
  ): void {
    if (steering) {
      const pc = centroids.get(this.controlledCellId);
      if (pc) {
        const r2 = XMIGRATE_R * XMIGRATE_R;
        for (const [cpmId] of this.cpmToAgent) {
          const rec = this.sim.getCell(cpmId);
          if (!rec || (rec.kind !== ENDOTHELIAL_KIND && rec.kind !== FIBROBLAST_KIND)) continue;
          const c = centroids.get(cpmId);
          if (!c) continue;
          const dx = c.x - pc.x;
          const dy = c.y - pc.y;
          if (dx * dx + dy * dy < r2) this.xmigrateTTL.set(cpmId, XMIGRATE_TICKS);
        }
      }
    }
    for (const [id, t] of this.xmigrateTTL) {
      if (t <= 1) this.xmigrateTTL.delete(id);
      else this.xmigrateTTL.set(id, t - 1);
    }
  }

  /** WALL SLEEP: put settled, far-from-player wall cells to sleep (per-cell barrier) so the
   *  Monte-Carlo step stops paying the soft-constraint deltaH on their border (~3/4 of it).
   *  A wall stays AWAKE while it settles (WALL_SETTLE_TICKS after promotion) and whenever the
   *  player is within WALL_WAKE_R — so it still packs into the seal and still deforms/reseals
   *  for a transmigrating player. A sleeping wall never moves, so this is ~behaviour-neutral. */
  private updateWallSleep(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    const pc = centroids.get(this.controlledCellId);
    const wakeR2 = WALL_WAKE_R * WALL_WAKE_R;
    for (const rec of this.sim.getCells()) {
      if (rec.kind !== ENDOTHELIAL_KIND && rec.kind !== FIBROBLAST_KIND) continue;
      const c = centroids.get(rec.id);
      if (!c) continue;
      const age = (this.wallAge.get(rec.id) ?? 0) + 1;
      this.wallAge.set(rec.id, age);
      const settled = age >= WALL_SETTLE_TICKS;
      const near =
        pc !== undefined && (c.x - pc.x) ** 2 + (c.y - pc.y) ** 2 < wakeR2;
      this.sim.setCellFrozen(rec.id, settled && !near);
    }
    // Forget ages for walls that have left the lattice.
    for (const id of [...this.wallAge.keys()]) {
      if (!this.sim.getCell(id)) this.wallAge.delete(id);
    }
  }

  /** SNAP-BACK: each promoted wall cell is firmly anchored to its home slot. The FLOPPY
   *  lining cells (no perimeter constraint) deform to admit a transmigrating immune cell,
   *  then this anchor pulls them back to their original configuration once it passes (the
   *  endothelial junctions re-forming). The immune cell's strong Act still drives it
   *  through regardless; bacteria (unfavorable adhesion, no strong Act) can't. */
  private resealWalls(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    for (const [cpmId, agentId] of this.cpmToAgent) {
      const rec = this.sim.getCell(cpmId);
      if (!rec || (rec.kind !== ENDOTHELIAL_KIND && rec.kind !== FIBROBLAST_KIND)) continue;
      if (!centroids.get(cpmId)) continue; // not on the lattice yet
      const wc = this.agentWorld.get(agentId);
      if (!wc) continue;
      const [lx, ly] = this.sim.worldToLattice(wc.x, wc.y); // home slot
      this.sim.attractCellTo(cpmId, Math.round(lx), Math.round(ly), WALL_SEAL_LAMBDA);
    }
  }

  // ---- trogocytosis: rip a conserved, colour-carrying fragment ------------
  // Tear a chunk off `targetId` toward a LATTICE point (the puller side). The chunk becomes
  // fading debris that inherits the torn cell's colour (mass conserved — pixels moved, not
  // deleted). If the tear drops the target below RIP_DEATH_FRACTION of its full size it
  // LYSES: the remainder scatters into debris too (so a killed cell leaves persistent
  // fragments with no hungry parent to reabsorb them). Returns the surgery result.
  ripFragment(
    targetId: number,
    towardLX: number,
    towardLY: number,
    count: number
  ): { fragmentId: number; moved: number; remaining: number } | null {
    const rec = this.sim.getCell(targetId);
    const fullVol = rec ? rec.profile.volume : 0;
    const ch = this.channels(targetId);
    const fxColor = (ch.r << 16) | (ch.g << 8) | ch.b;
    const c0 = this.sim.centroidLattice(targetId);

    const res = this.ripOnce(targetId, towardLX, towardLY, count);
    if (!res) return null;

    const lethal = res.remaining <= 0 || res.remaining < RIP_DEATH_FRACTION * fullVol;
    if (lethal) {
      // Scatter whatever's left into a second fragment so the cell visibly bursts apart,
      // then finalize the death (the last tear empties + purges the target).
      if (res.remaining > 0) {
        this.ripOnce(targetId, towardLX, towardLY, res.remaining);
        res.remaining = 0;
      }
      if (c0) {
        const [wx, wy] = this.sim.latticeToWorld(c0.x, c0.y);
        this.fxQueue.push({ kind: "death", wx, wy, radius: 24, color: fxColor });
      }
      this.deaths++;
    }
    return res;
  }

  /** One tear: move a chunk of `targetId` into a debris fragment and register it (colour
   *  inherited from the torn cell, TTL fade). Purges the target's links if it's emptied. */
  private ripOnce(
    targetId: number,
    towardLX: number,
    towardLY: number,
    count: number
  ): { fragmentId: number; moved: number; remaining: number } | null {
    const ch = this.channels(targetId);
    const color = (ch.r << 16) | (ch.g << 8) | ch.b; // the torn cell's current render hue
    const res = this.sim.tearChunkToward(targetId, towardLX, towardLY, count, DEBRIS_KIND);
    if (!res) return null;
    this.tagOrigin(res.fragmentId, `rip-debris(from ${targetId})`);
    this.colorOverride.set(res.fragmentId, color);
    this.debris.set(res.fragmentId, DEBRIS_TTL);
    this.debrisAlpha.set(res.fragmentId, 0xff);
    if (res.remaining <= 0) this.purgeCellLinks(targetId);
    return res;
  }

  /** Grab: convert a prey to the immobile, non-healing GRIPPED kind so the tentacle can
   *  hold it and tears actually rend it (a live prey would flee + regrow between tears).
   *  Keeps its original colour (via override) so it still looks like the bacterium. */
  private gripCell(id: number): void {
    const rec = this.sim.getCell(id);
    if (!rec || rec.kind === GRIPPED_KIND) return;
    this.grippedOriginalKind.set(id, rec.kind);
    const ch = this.channels(id);
    this.colorOverride.set(id, (ch.r << 16) | (ch.g << 8) | ch.b);
    this.colorCache.delete(id); // recompute against the new profile (maxAct) + override colour
    this.sim.setCellKind(id, GRIPPED_KIND);
  }

  /** Release: restore a still-living gripped prey to its original kind (it recovers + flees
   *  again). A prey that died while gripped is cleaned up by onCellDeath/purgeCellLinks. */
  private ungripCell(id: number): void {
    const orig = this.grippedOriginalKind.get(id);
    if (orig === undefined) return;
    this.grippedOriginalKind.delete(id);
    if (this.sim.getCell(id)) {
      this.sim.setCellKind(id, orig);
      this.colorCache.delete(id);
      this.colorOverride.delete(id);
    }
  }

  /** Drop all of a cell's world-sim bookkeeping (agent shadow link, composition, colour,
   *  rules state). Shared by death + full-tear cleanup. Does NOT touch the CPM lattice. */
  private purgeCellLinks(id: number): void {
    this.grippedOriginalKind.delete(id);
    const agentId = this.cpmToAgent.get(id);
    if (agentId !== undefined) {
      this.agentWorld.remove(agentId);
      this.cpmToAgent.delete(id);
    }
    this.compositions.delete(id);
    this.forgetColor(id);
    this.rules.forget(id);
  }

  /** Age every debris fragment: fade its alpha from its TTL, kill it when the TTL ends.
   *  Mass stays intact until removal (the fragment is SEEN to persist, then vanish). */
  private stepDebris(dtSec: number): void {
    if (this.debris.size === 0) return;
    for (const [id, ttl] of [...this.debris]) {
      if (!this.sim.getCell(id)) {
        this.forgetColor(id); // already gone (streamed out / killed elsewhere)
        continue;
      }
      const next = ttl - dtSec;
      if (next <= 0) {
        this.sim.killCell(id);
        this.forgetColor(id);
        continue;
      }
      this.debris.set(id, next);
      // Hold full opacity for the first ~40% of life, then fade linearly to 0.
      const f = Math.min(1, next / (DEBRIS_TTL * 0.6));
      this.debrisAlpha.set(id, Math.round(0xff * f));
    }
  }

  /** DEBUG (T1 gate): rip a chunk off the nearest non-player CPM cell toward the player,
   *  and report pixel mass before/after so a test can assert conservation. */
  debugRip(count = 30): {
    targetId: number;
    before: number;
    moved: number;
    remaining: number;
    fragmentId: number;
  } | null {
    const pc = this.sim.centroidLattice(this.controlledCellId);
    if (!pc) return null;
    // Prefer the nearest MICROBE (the realistic trog prey); fall back to any non-player,
    // non-debris cell so the hook still works if no microbe is in the bubble.
    let best: number | null = null;
    let bestD = Infinity;
    let bestMicrobe: number | null = null;
    let bestMicrobeD = Infinity;
    for (const rec of this.sim.getCells()) {
      if (rec.id === this.controlledCellId || rec.kind === DEBRIS_KIND) continue;
      const c = this.sim.centroidLattice(rec.id);
      if (!c) continue;
      const d = Math.hypot(c.x - pc.x, c.y - pc.y);
      if (d < bestD) { bestD = d; best = rec.id; }
      if (rec.kind === MICROBE_KIND && d < bestMicrobeD) { bestMicrobeD = d; bestMicrobe = rec.id; }
    }
    best = bestMicrobe ?? best;
    if (best === null) return null;
    const before = this.sim.centroidLattice(best)?.pixels ?? 0;
    const res = this.ripFragment(best, pc.x, pc.y, count);
    if (!res) return null;
    return { targetId: best, before, moved: res.moved, remaining: res.remaining, fragmentId: res.fragmentId };
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
    // A shadow that DIES (digested/dissolved/ruptured) takes its durable agent with it —
    // it's gone from the world, not demoted back to a disc.
    const agentId = this.cpmToAgent.get(id);
    if (agentId !== undefined) {
      this.agentWorld.remove(agentId);
      this.cpmToAgent.delete(id);
    }
    this.sim.killCell(id);
    this.forgetColor(id);
    this.compositions.delete(id);
    this.grippedOriginalKind.delete(id);
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

  private spawnPreset(presetName: string, lx: number, ly: number, asControlled = false): number | null {
    const preset = PRESETS[presetName];
    if (!preset) return null;
    const kind = this.bodyKind(preset.body, asControlled);
    const rec = this.sim.spawnCellAtLattice(kind, Math.round(lx), Math.round(ly));
    this.compositions.set(rec.id, new CellComposition(rollComponents(preset, Math.random)));
    this.life.seed(rec.id);
    this.tagOrigin(rec.id, `preset:${presetName}${asControlled ? "(controlled)" : ""}`);
    return rec.id;
  }

  private wallSpacing(): number {
    // < a wall cell's diameter so adjacent cells OVERLAP into a continuous, gap-free
    // lining (rendered as discs / promoted to CPM, they only touch at a point
    // otherwise). The spike confirmed sealing is affordable (cost is border-bounded).
    return this.vessel.cfg.lumenR * 0.45;
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
      if (a.tier === "cpm") continue; // driven by its CPM shadow, not agent physics
      if (a.comp.capabilities.motility <= 0.05) continue;
      const c = this.vessel.confinement(a.x, a.y);
      if (c.over <= 0) continue;
      // The agent tier has no hard walls, so the lining is enforced here. FIRM for
      // bacteria (they must NOT breach the wall far from the player, where there's no
      // CPM to block them) — a hard position clamp, not just a nudge. (Diapedesis is a
      // CPM-bubble mechanic; far autonomous immune cells are confined too for now.)
      const push = Math.min(c.over, 60);
      a.vx += c.nx * push * 0.08;
      a.vy += c.ny * push * 0.08;
      a.x += c.nx * c.over; // hard-clamp fully back inside the lumen
      a.y += c.ny * c.over;
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
    // Spawn microbes BIASED to the player's stretch of vessel (upstream/downstream of
    // playerT) so there's always prey to chase nearby — the whole loop is huge, so
    // uniform spawning left the player with nothing in range. They drift in on the flow.
    if (microbes < MICROBE_CAP && Math.random() < 0.85) {
      this.spawnLumenTraffic("microbe", this.playerT + (Math.random() - 0.5) * 1.4);
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
