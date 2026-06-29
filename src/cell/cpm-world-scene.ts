// CpmWorldScene — the home of the CPM cell world. This is the migration target
// that will progressively replace the hex GameScene. For now it hosts the
// deformable player cell + a few other cells in an (effectively infinite)
// scrolling world, steered by holding the left mouse button.

import Phaser from "phaser";
import { CpmSimulation } from "./cpm-simulation";
import { CpmRenderer } from "./cpm-renderer";
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
  PLAYER_PROFILE,
  TISSUE_PROFILE,
  MICROBE_PROFILE,
  ENDOTHELIAL_PROFILE,
  FIBROBLAST_PROFILE,
  DIGESTING_PROFILE,
} from "./cpm-config";

// Kinds = physics bodies only (NOT identities — a cell's identity is its
// composition). CONTROLLED is the macrophage body reserved for the player's cell
// (its own Act group). Map a preset's BodyKey -> kind via bodyKind().
const CONTROLLED_KIND = 1; // macrophage body, player-driven
const MACROPHAGE_KIND = 2; // macrophage body, autonomous
const EPITHELIAL_KIND = 3;
const MICROBE_KIND = 4;
const ENDOTHELIAL_KIND = 5; // vessel lining
const FIBROBLAST_KIND = 6; // tissue beyond
const DIGEST_KIND = 7;

// DEV: freeze the player-anchored streaming bubble so the whole fixed lattice is
// visible and stable to study (camera fits the map + mouse-wheel zoom). Flowing
// traffic is culled at the lattice edge instead of streamed out. This is a STUDY
// aid only — for actual play it must be false so the camera follows the player at a
// playable zoom (fit-to-map makes the cell tiny and movement feel glacial).
const DEV_FREEZE_STREAMING = false;

// Fixed-timestep clock: advance the CPM sim at a CONSTANT real-time rate so movement
// speed is independent of render FPS (a frame hitch must not slow the cell down).
const TARGET_MCS_PER_SEC = 240; // snappier crawl; affordable at the new ~79fps headroom
const MS_PER_MCS = 1000 / TARGET_MCS_PER_SEC;
const MAX_CATCHUP_STEPS = 6; // cap per frame -> bounded slow-mo, no spiral of death

// Bubble manager LOD radii (world px from the player). Agents within R_PROMOTE become
// full CPM cells (physical: collide/engulf/squeeze); CPM cells beyond R_DEMOTE revert
// to cheap agents. Both sit inside the lattice interior; the gap is hysteresis.
const R_PROMOTE = 560; // minimum promote radius (covers the default-zoom viewport)
// Max promote radius: cells must fit inside the lattice (field*scale/2 minus margin).
// Beyond this the player is zoomed out into the overview, where agents are the point.
const R_PROMOTE_MAX = 700;

/** Heartbeat: a sharp systolic surge each ~beat seconds (a pulsed 0..1). */
function heartbeat(timeSec: number, bpm = 70): number {
  const phase = (timeSec * (bpm / 60)) % 1; // 0..1 per beat
  const s = Math.sin(phase * Math.PI); // up then down within the beat
  return s > 0 ? s * s * s : 0; // sharpened surge, near-zero lull
}

export class CpmWorldScene extends Phaser.Scene {
  private sim!: CpmSimulation;
  private cpmRenderer!: CpmRenderer;
  private rules!: CpmRules;
  private behavior!: CpmCellBehavior;
  private life!: CpmLife;
  private combat!: CpmCombat;
  private signal!: CpmField;
  private grid!: CpmDeformGrid;
  private bigOrganelles!: CpmBigOrganelles;
  private vessel!: CpmVessel;
  /** The always-on agent tier: the cheap, off-lattice source of truth for every cell
   *  in the world. The CPM bubble is a detail window that promotes nearby agents. */
  private agentWorld!: AgentWorld;
  /** World-space layer that draws agents as simple body-coloured shapes. */
  private agentGfx!: Phaser.GameObjects.Graphics;
  /** CPM cell ids that were PROMOTED from agents (so we know which to demote back).
   *  The controlled player is NOT in here — it's permanently CPM. */
  private readonly promoted = new Set<number>();
  /** Player's parameter along the loop (for windowed nearest-point + flow dir). */
  private playerT = 0;
  /** Accumulated real ms for the fixed-timestep sim clock. */
  private simAccumMs = 0;
  /** Accumulated real ms for streaming the agent vessel ahead of the player. */
  private streamAccumMs = 0;
  /** A cell IS its composition. The registry maps every live cell -> its mutable
   *  composition; behaviour + life + (later) the factory all read from here. */
  private readonly compositions = new Map<number, CellComposition>();
  private interiorGfx!: Phaser.GameObjects.Graphics;
  private prof = new CpmProfiler();
  /** The one cell the player input is bound to. NOT special in any other way —
   *  it runs the same systems as every peer; input just overrides its behavior. */
  private controlledCellId = 0;
  private bg!: Phaser.GameObjects.TileSprite;
  private hud!: Phaser.GameObjects.Text;
  private profText!: Phaser.GameObjects.Text;
  private steering = false;
  private deaths = 0;
  private camCx: number | undefined;
  private camCy: number | undefined;
  private camZoom = 1.8;

  // Lightweight-organelle prototype: a couple of organelle "kinds" with a colour
  // and size, placed as entities on the cytoplasm rather than as CPM sub-cells.
  private static readonly NUCLEUS = { type: "nucleus", color: 0x9b6cff, radius: 6 };
  private static readonly BUILDABLES = [
    { type: "mitochondrion", color: 0xff9d4d, radius: 3.5 },
    { type: "ribosome", color: 0x7CF6C7, radius: 2 },
    { type: "golgi", color: 0xffe066, radius: 3 },
  ];
  private buildIndex = 0;

  constructor() {
    super("CpmWorldScene");
  }

  create(): void {
    const cfg = DEFAULT_WORLD_CONFIG;
    // Kinds 1..5 are pure physics bodies (see kind constants). Macrophage body
    // (PLAYER_PROFILE) is registered twice — controlled + autonomous — so the two
    // have independent Act groups while sharing identical physics.
    this.sim = new CpmSimulation(cfg, [
      PLAYER_PROFILE, // 1 CONTROLLED
      PLAYER_PROFILE, // 2 MACROPHAGE
      TISSUE_PROFILE, // 3 EPITHELIAL
      MICROBE_PROFILE, // 4 MICROBE
      ENDOTHELIAL_PROFILE, // 5 ENDOTHELIAL (lining)
      FIBROBLAST_PROFILE, // 6 FIBROBLAST (tissue)
      DIGESTING_PROFILE, // 7 DIGEST
    ]);
    // Anchor the bubble so its centre maps to world (0,0) — the loop's start.
    const center = Math.floor(cfg.fieldSize / 2);
    this.sim.originWX = -center * this.sim.scale;
    this.sim.originWY = -center * this.sim.scale;
    this.vessel = new CpmVessel(DEFAULT_VESSEL);

    this.makeBackground();
    // Agent tier: the cheap off-lattice world. Rendered BELOW the CPM lattice (depth
    // 8 < 10) so promoted CPM detail draws over agents where they coincide. Division
    // is OFF — vessel cells don't breed (walls are structural, traffic is spawned, not
    // bred); resident dividing populations return with the factory milestone.
    this.agentWorld = new AgentWorld(2000, Math.random, false, this.sim.scale);
    this.agentGfx = this.add.graphics().setDepth(8);
    this.cpmRenderer = new CpmRenderer(this, this.sim, 10);
    this.signal = new CpmField(cfg.fieldSize);
    this.cpmRenderer.setField(this.signal);
    this.rules = new CpmRules(this.sim, {
      onDeath: (id, reason) => this.onCellDeath(id, reason),
      ignore: (id) => this.combat.isConsuming(id),
    });

    // Autonomous motile kinds protrude (Act on). The CONTROLLED cell is NOT forced
    // active here — it rests by default and only protrudes WHILE the player steers
    // (toggled in update), so it never drifts on its own. Sessile wall kinds get no Act.
    this.sim.setKindActive(MACROPHAGE_KIND, true);
    this.sim.setKindActive(MICROBE_KIND, true);

    // The current carries the autonomous lumen dwellers, NOT the player — the player
    // moves only on input (never swept downstream), so it never gets shoved into the
    // lining and wedged. Sessile walls are excluded too.
    this.sim.flow.setFlowingKinds([MACROPHAGE_KIND, MICROBE_KIND]);
    // Lining + tissue are procedurally maintained, so drop (don't remember) them
    // when they stream out; the vessel maintainer refills ahead.
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
      // Nothing in the vessel auto-divides: the player body shouldn't split, the
      // lining/tissue are structural (the maintainer keeps them), and lumen traffic
      // (bacteria/RBC) is spawned-and-culled, not bred — a few dividing microbes do
      // NOT clog an artery. (Resident breeding populations return with tissue/M2.)
      canDivide: () => false,
    });
    this.combat = new CpmCombat(this.sim, {
      playerKind: CONTROLLED_KIND,
      enemyKind: MICROBE_KIND,
      digestKind: DIGEST_KIND,
      getAttackerId: () => this.controlledCellId,
      onConsumeStart: (id) => this.cpmRenderer.forgetCell(id),
      onDigested: (wx, wy) => this.spawnDeathFx(wx, wy, 26, 0xffe066),
    });

    // The controlled cell (a macrophage) starts in the lumen at the loop's start
    // (world 0,0), grown to size. Then lay the vessel lining + tissue + a little
    // lumen traffic around it.
    this.controlledCellId = this.spawnPreset("macrophage", center, center, true)!;
    for (let i = 0; i < 110; i++) this.sim.step();
    this.populateAgentVessel();

    // Shape-conforming internal build grid. Organelles are structures placed in
    // slots that exist only where there's cytoplasm — so the cell's size/shape
    // shapes its interior. The cell ships with a nucleus; the player builds more.
    this.grid = new CpmDeformGrid();
    this.interiorGfx = this.add.graphics().setDepth(12);
    // The nucleus is now a controlled soft body (not a grid slot): it recenters
    // on its own, bottlenecks the cell at tight gaps, and ruptures if over-squeezed.
    this.bigOrganelles = new CpmBigOrganelles(this.sim, () => this.controlledCellId);
    const pc = this.sim.centroidLattice(this.controlledCellId);
    if (pc) {
      const N = CpmWorldScene.NUCLEUS;
      this.bigOrganelles.add(N.type, N.color, pc.x, pc.y);
    }

    // Camera. In dev (streaming frozen) fit the whole fixed lattice in view and
    // let the mouse wheel zoom; otherwise follow the player.
    const worldSize = cfg.fieldSize * this.sim.scale;
    this.camZoom = DEV_FREEZE_STREAMING
      ? (Math.min(this.scale.width, this.scale.height) / worldSize) * 0.95
      : 1.8;
    this.cameras.main.setZoom(this.camZoom);
    this.cameras.main.setBackgroundColor("#1a0d12"); // deep tissue red-brown
    this.cameras.main.centerOn(0, 0);
    // Mouse wheel = zoom in/out (clamped).
    this.input.on(
      "wheel",
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        this.camZoom *= dy > 0 ? 0.9 : 1.1;
        this.camZoom = Math.max(0.2, Math.min(6, this.camZoom));
        this.cameras.main.setZoom(this.camZoom);
      }
    );
    this.cameras.main.centerOn(0, 0);

    this.hud = this.add
      .text(12, 10, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#9bdcff",
      })
      .setScrollFactor(0)
      .setDepth(1000);

    // Always-on performance overlay (top-right): per-system ms + scale drivers.
    this.profText = this.add
      .text(this.scale.width - 12, 10, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#8fe39b",
        align: "right",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      this.profText.setX(size.width - 12);
    });

    this.input.mouse?.disableContextMenu();
    // B = build: grow a new organelle compartment.
    this.input.keyboard?.on("keydown-B", () => this.growOrganelle());

    // Dev-only handle for automated verification (connectivity, centroids, tear).
    if (import.meta.env.DEV) {
      (window as unknown as { __cpm?: unknown }).__cpm = {
        sim: this.sim,
        scene: this,
        combat: this.combat,
        rules: this.rules,
        getPlayerId: () => this.controlledCellId,
        occupants: () => this.grid.occupants,
        deaths: () => this.deaths,
        perf: () => this.prof.report(),
        nucleus: () => {
          const n = this.bigOrganelles.organelles[0];
          if (!n) return null;
          const host = this.controlledCellId;
          const inside = (x: number, y: number) =>
            this.sim.ownerAtLattice(x, y) === host;
          const c = n.body.center();
          return {
            cx: c.x,
            cy: c.y,
            exposed: n.body.exposedFraction(inside),
            oval: n.body.ovalness(),
            stress: n.stress,
          };
        },
        tear: (id?: number, axis: "h" | "v" = "h", halfWidth = 1) =>
          this.sim.tearCell(id ?? this.controlledCellId, axis, halfWidth),
      };
    }
  }

  /** A cell crossed a fatal threshold. EVERY cell dies the same way — the only
   *  extra step for the controlled cell is handing off control (the world never
   *  "game over"s; you're reborn as another cell). */
  private onCellDeath(id: number, reason: DeathReason): void {
    const c = this.sim.centroidLattice(id);
    const rec = this.sim.getCell(id);
    const color = rec ? rec.profile.color : 0xffffff;
    if (c) {
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      const radius = Math.sqrt(c.pixels / Math.PI) * this.sim.scale;
      this.spawnDeathFx(wx, wy, radius, color);
    }
    const wasControlled = id === this.controlledCellId;
    this.sim.killCell(id);
    this.cpmRenderer.forgetCell(id);
    this.compositions.delete(id);
    this.deaths++;
    console.log(`💀 cell ${id} died (${reason})${wasControlled ? " — CONTROLLED" : ""}`);
    if (wasControlled) this.handoffControl();
  }

  /** Re-bind player input to another cell after the controlled one dies. For now
   *  we're reborn as a fresh cell at centre; taking over an existing peer is
   *  enabled by `bindControl` and comes once behaviour/kinds are unified. */
  private handoffControl(): void {
    const center = Math.floor(this.sim.field / 2);
    const id = this.spawnPreset("macrophage", center, center, true);
    if (id === null) return;
    for (let i = 0; i < 110; i++) this.sim.step();
    this.bindControl(id);
  }

  /** Resolve a preset's body to a CPM kind (CONTROLLED reserved for the player). */
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

  /** Spawn a cell from a preset: physics body + a randomized composition (the cell
   *  is then defined by that composition, not the preset). Returns its id. */
  private spawnPreset(
    presetName: string,
    lx: number,
    ly: number,
    asControlled = false
  ): number | null {
    const preset = PRESETS[presetName];
    if (!preset) return null;
    const kind = this.bodyKind(preset.body, asControlled);
    const rec = this.sim.spawnCellAtLattice(kind, Math.round(lx), Math.round(ly));
    this.compositions.set(rec.id, new CellComposition(rollComponents(preset, Math.random)));
    this.life.seed(rec.id);
    return rec.id;
  }

  /** Body -> render colour for agents (mirrors the CPM profiles). */
  private static readonly BODY_COLOR: Record<BodyKey, number> = {
    macrophage: 0x49d0ff,
    epithelial: 0x6b8f9c,
    microbe: 0xe7d14b,
    endothelial: 0x8a6f9e,
    fibroblast: 0x5d7d6a,
  };

  /** Lumen-traffic population target for the WHOLE loop (microbes + immune cells).
   *  Topped back up globally as immune cells eat microbes — so the world stays lively
   *  everywhere, not just around the player. */
  private static readonly TRAFFIC_CAP = 140;

  /** Seed the agent tier across the ENTIRE vessel loop (t: 0..2*PI), once. The whole
   *  world is a persistent simulation: walls everywhere, immune cells + microbes
   *  scattered around the full loop, all stepping every frame regardless of where the
   *  player is. The player is just a body moving THROUGH this pre-existing world; the
   *  bubble manager promotes only the nearby agents to CPM for physical interaction. */
  private populateAgentVessel(): void {
    const v = this.vessel;
    const spacing = v.cfg.lumenR * 0.7;
    // Walls: lining + tissue slots around the full circumference.
    for (const s of v.slots(Math.PI, Math.PI, spacing)) {
      this.agentWorld.spawnPreset(s.role === "lining" ? "endothelial" : "fibroblast", s.x, s.y);
    }
    // Lumen traffic distributed around the whole loop.
    for (let i = 0; i < CpmWorldScene.TRAFFIC_CAP; i++) {
      this.spawnLumenTraffic(Math.random() * Math.PI * 2);
    }
  }

  /** Keep wandering motile agents inside the vessel lumen (the cheap tier has no hard
   *  walls, only soft separation, so traffic would otherwise drift into tissue/void).
   *  Sessile wall agents are left where they're placed (they ARE the lining/tissue). */
  private confineAgentsToVessel(): void {
    for (const a of this.agentWorld.all()) {
      if (a.comp.capabilities.motility <= 0.05) continue; // walls / sessile stay put
      const c = this.vessel.confinement(a.x, a.y);
      if (c.over <= 0) continue;
      // Nudge velocity inward + hard-correct position a little so it can't accumulate
      // outside the lumen over time.
      const push = Math.min(c.over, 40);
      a.vx += c.nx * push * 0.03;
      a.vy += c.ny * push * 0.03;
      a.x += c.nx * Math.min(c.over, 10);
      a.y += c.ny * Math.min(c.over, 10);
    }
  }

  /** Spawn one lumen-traffic agent (mostly microbes, some immune cells) at loop
   *  parameter `t`, jittered across the lumen width. */
  private spawnLumenTraffic(t: number): void {
    const v = this.vessel;
    const p = v.pathPoint(t);
    const tan = v.tangent(t);
    const j = (Math.random() - 0.5) * v.cfg.lumenR * 1.4;
    this.agentWorld.spawnPreset(
      Math.random() < 0.8 ? "microbe" : "macrophage",
      p.x - tan.y * j,
      p.y + tan.x * j
    );
  }

  /** Keep the whole-loop traffic topped up as immune cells eat microbes. Global (not
   *  player-anchored) so the world stays alive everywhere. Walls are permanent (seeded
   *  once, never culled) so they need no upkeep. Cheap; run a few times a second. */
  private maintainAgentVessel(): void {
    let traffic = 0;
    for (const a of this.agentWorld.all()) {
      if (a.bodyKind === "microbe" || a.bodyKind === "macrophage") traffic++;
    }
    if (traffic < CpmWorldScene.TRAFFIC_CAP && Math.random() < 0.5) {
      this.spawnLumenTraffic(Math.random() * Math.PI * 2);
    }
  }

  /** Draw every agent as a simple body-coloured disc in world space. Agents that got
   *  promoted to CPM this frame are gone from the agent world, so they aren't drawn
   *  twice (the CPM renderer draws them as detailed cells instead). */
  private renderAgents(): void {
    const g = this.agentGfx;
    g.clear();
    const scale = this.sim.scale;
    for (const a of this.agentWorld.all()) {
      g.fillStyle(CpmWorldScene.BODY_COLOR[a.bodyKind] ?? 0x888888, 1);
      g.fillCircle(a.x, a.y, Math.sqrt(a.vol / Math.PI) * scale);
    }
  }

  /** Reverse of bodyKind(): a promoted CPM cell's kind -> its BodyKey, so demotion
   *  re-creates the right kind of agent. */
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

  /** LOD handoff: promote agents near the player into physical CPM cells and demote
   *  far CPM cells back to agents, preserving composition + energy both ways. The
   *  promoted cell is stamped at the agent's size so the disc->cell swap is
   *  size-preserving (no bloom/pop). */
  private bubbleManagerStep(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    const pc = centroids.get(this.controlledCellId);
    if (!pc) return;
    const [pwx, pwy] = this.sim.latticeToWorld(pc.x, pc.y);

    // Promote everything the player can SEE: track the viewport half-diagonal so all
    // on-screen cells are real CPM cells, clamped to fit inside the lattice (beyond
    // that — very zoomed out — cells stay agents, which IS the overview LOD).
    const cam = this.cameras.main;
    const viewHalfDiag = Math.hypot(cam.width / cam.zoom, cam.height / cam.zoom) / 2;
    const rPromote = Math.min(Math.max(viewHalfDiag + 80, R_PROMOTE), R_PROMOTE_MAX);
    const rDemote = rPromote + 100;

    const agentPos: Array<{ id: number; x: number; y: number }> = [];
    for (const a of this.agentWorld.all()) agentPos.push({ id: a.id, x: a.x, y: a.y });

    const promotedPos: Array<{ id: number; x: number; y: number }> = [];
    for (const id of this.promoted) {
      const c = centroids.get(id);
      if (!c) {
        this.promoted.delete(id); // died / gone
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
      // Must fit inside the lattice interior; otherwise leave it an agent.
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
      this.cpmRenderer.forgetCell(id);
      this.rules.forget(id);
      this.promoted.delete(id);
    }
  }

  /** Remove a cell with no death FX/handoff (e.g. traffic flowing off the edge). */
  private despawnCell(id: number): void {
    this.sim.killCell(id);
    this.cpmRenderer.forgetCell(id);
    this.compositions.delete(id);
  }

  /** With streaming frozen, cull lumen traffic (microbes) that has flowed to the
   *  lattice edge so the passage keeps circulating instead of piling up. */
  private cullEdgeTraffic(
    centroids: Map<number, { x: number; y: number; pixels: number }>
  ): void {
    const f = this.sim.field;
    const band = 10;
    for (const rec of [...this.sim.getCells()]) {
      // Autonomous lumen traffic (bacteria + immune cells), not the player/walls.
      if (rec.kind !== MICROBE_KIND && rec.kind !== MACROPHAGE_KIND) continue;
      const c = centroids.get(rec.id);
      if (!c) continue;
      if (c.x < band || c.x > f - band || c.y < band || c.y > f - band) {
        this.despawnCell(rec.id);
      }
    }
  }

  /** Bind player input + camera + the (controlled-cell-only) interior to `id`. */
  private bindControl(id: number): void {
    this.controlledCellId = id;
    this.camCx = undefined;
    this.camCy = undefined;
    // Fresh interior for the newly-controlled cell: just a nucleus soft body.
    this.grid.clear();
    this.bigOrganelles.clear();
    const pc = this.sim.centroidLattice(id);
    const N = CpmWorldScene.NUCLEUS;
    if (pc) this.bigOrganelles.add(N.type, N.color, pc.x, pc.y);
  }

  /** Kind of the controlled cell (so steering activates the right kind's Act,
   *  whatever cell we're bound to). */
  private controlledKind(): number {
    return this.sim.getCell(this.controlledCellId)?.kind ?? CONTROLLED_KIND;
  }

  /** Build interaction: place a lightweight organelle where the cursor points (if
   *  that spot is interior to the cell, else fall back to the centre). Cycles
   *  through buildable types so you can see several kinds coexist. */
  private growOrganelle(): void {
    const frame = this.sim.cellFrame(this.controlledCellId);
    if (!frame) return;
    const ptr = this.input.activePointer;
    const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
    const cx = Math.round(lx);
    const cy = Math.round(ly);
    const interior = this.sim.ownerAtLattice(cx, cy) === this.controlledCellId;
    const sx = interior ? cx : Math.round(frame.cx);
    const sy = interior ? cy : Math.round(frame.cy);
    const kind = CpmWorldScene.BUILDABLES[this.buildIndex % CpmWorldScene.BUILDABLES.length];
    this.buildIndex++;
    this.grid.add(kind.type, kind.color, kind.radius, frame, sx, sy);
  }

  /** Brief expanding, fading ring + flash where a cell died. */
  private spawnDeathFx(wx: number, wy: number, radius: number, color: number): void {
    const ring = this.add.circle(wx, wy, radius, color, 0.5).setDepth(20);
    this.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: 520,
      ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
  }

  private makeBackground(): void {
    // A faint grid tile, drawn once into a texture, shown as a screen-filling
    // TileSprite whose tilePosition tracks the camera -> infinite scrolling grid.
    const key = "cpm-grid-tile";
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(0x0b1119, 1).fillRect(0, 0, 64, 64);
      g.lineStyle(1, 0x16222e, 1).strokeRect(0, 0, 64, 64);
      g.generateTexture(key, 64, 64);
      g.destroy();
    }
    this.bg = this.add
      .tileSprite(0, 0, this.scale.width, this.scale.height, key)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-100);
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      this.bg.setSize(size.width, size.height);
    });
  }

  override update(_time: number, delta: number): void {
    const pointer = this.input.activePointer;
    // Real-time dt (s), clamped so a big hitch/tab-stall can't lurch everything.
    const dtSec = Math.min(delta, 100) / 1000;

    // The controlled cell RESTS by default and only protrudes while steered, so with
    // no input it holds still (just Monte-Carlo wiggle) and never drifts. Hold LMB to
    // steer toward the cursor; release to stop.
    this.steering = pointer.leftButtonDown();
    const kind = this.controlledKind();
    this.sim.setKindActive(kind, this.steering);
    if (this.steering) {
      const [lx, ly] = this.sim.worldToLattice(pointer.worldX, pointer.worldY);
      this.sim.steerCell(this.controlledCellId, lx, ly);
    } else {
      this.sim.restCell(this.controlledCellId);
    }

    // The vessel current (heart pump): flow direction = the loop tangent at the
    // player; magnitude pulses with the heartbeat. Carries every flowing kind.
    const pc0 = this.sim.centroidLattice(this.controlledCellId);
    if (pc0) {
      const [pwx, pwy] = this.sim.latticeToWorld(pc0.x, pc0.y);
      this.playerT = this.vessel.nearestT(pwx, pwy, this.playerT).t;
      const dir = this.vessel.tangent(this.playerT);
      const pulse = heartbeat(this.time.now / 1000);
      // Strong pump: carried noticeably downstream, surging on each beat. (Steer
      // lambda is ~220, so the player can still cut across the flow.)
      const FLOW_BASE = 140;
      this.sim.flow.setFlow(dir.x, dir.y, FLOW_BASE * (0.3 + 0.7 * pulse));
    }

    // ONE centroid pass for all cells, shared by every system (was the dominant
    // cost when each system scanned per-cell). Every other cell then runs the SAME
    // autonomous stack: behaviour (hunt/flee/sit by capability) then life
    // (metabolize/feed/divide/starve). Combat is the player's manual engulf (RMB).
    const centroids = this.prof.measure("centroids", () => this.sim.centroidsAll());
    // LOD handoff: promote nearby agents to physical CPM cells, demote far ones back.
    this.prof.measure("bubble", () => this.bubbleManagerStep(centroids));
    this.prof.measure("behavior", () => this.behavior.update(dtSec, centroids));
    this.prof.measure("life", () => this.life.update(centroids));
    this.combat.update(pointer.rightButtonDown());

    // Size the controlled cell's perimeter budget for any prey it's digesting.
    this.sim.setKindPerimeterTarget(
      kind,
      this.sim.basePerimeter(kind) + this.sim.compartmentPerimeterSum([DIGEST_KIND])
    );

    // Fixed-timestep: advance the sim at a constant real-time rate (decoupled from
    // render FPS), so movement speed no longer depends on frame latency.
    this.simAccumMs += dtSec * 1000;
    const plan = simStepsFor(this.simAccumMs, MS_PER_MCS, MAX_CATCHUP_STEPS);
    this.simAccumMs = plan.remainderMs;
    this.prof.measure("cpm.step", () => this.sim.stepN(plan.steps));

    // Infinite-world streaming: recenter the bubble on the player, demote cells
    // that left, re-activate ones that returned. (Frozen in dev — see below.)
    let shiftX = 0;
    let shiftY = 0;
    if (!DEV_FREEZE_STREAMING) {
      const r = this.prof.measure("stream", () =>
        this.sim.streamAround(this.controlledCellId)
      );
      shiftX = r.shiftX;
      shiftY = r.shiftY;
      for (const id of r.demoted) {
        this.cpmRenderer.forgetCell(id);
        this.rules.forget(id); // dormant != dead
      }
    } else {
      // Cull flowing traffic that reaches the lattice edge so the lumen keeps
      // circulating (spawn upstream -> flow -> remove downstream) without streaming.
      this.cullEdgeTraffic(centroids);
    }

    // Agent tier: step every off-lattice cell (cheap) + draw it. This is the world
    // BEYOND the CPM detail bubble — zooming out reveals agents, not a lattice edge.
    // (LW2-A: agents own walls/traffic; the player is the only CPM cell until the
    // bubble manager promotes nearby agents in LW2-B.)
    this.prof.measure("agents", () => {
      this.agentWorld.step(dtSec);
      this.confineAgentsToVessel();
    });
    // Stream the vessel ahead of the player + cull behind (a few times a second).
    this.streamAccumMs += dtSec * 1000;
    if (this.streamAccumMs >= 150) {
      this.streamAccumMs = 0;
      this.prof.measure("vessel", () => this.maintainAgentVessel());
    }
    this.prof.measure("agentRender", () => this.renderAgents());

    // Deforming grid: small organelles flow/regroup with the cell's current shape.
    const frame = this.sim.cellFrame(this.controlledCellId);
    if (frame) {
      this.grid.shift(shiftX, shiftY);
      this.grid.step(frame, (x, y) => this.sim.ownerAtLattice(x, y) === this.controlledCellId);
    }

    // Big organelles (nucleus): step the soft bodies, refresh the footprint
    // coupling, accumulate confinement stress. Pass the steer direction so the
    // nucleus trails slightly, and the recenter shift so it rides the world.
    let steerDir: { x: number; y: number } | null = null;
    if (this.steering) {
      const c = this.sim.centroidLattice(this.controlledCellId);
      const ptr = this.input.activePointer;
      const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
      if (c) steerDir = { x: lx - c.x, y: ly - c.y };
    }
    this.prof.measure("interior", () =>
      this.bigOrganelles.update(steerDir, shiftX, shiftY)
    );
    const burst = this.bigOrganelles.consumeRupture();
    if (burst) {
      // The nucleus ruptured under confinement — the player dies (the toy's fail
      // state for forcing too tight a gap).
      this.onCellDeath(this.controlledCellId, "ruptured");
    }

    // Molecular signal field: follow the recenter, re-mask to the current cytosol
    // shape, produce around the nucleus (first occupant), diffuse.
    this.signal.shift(shiftX, shiftY);
    this.signal.setMask(this.sim.cellPixels(this.controlledCellId));
    const nucleus = this.bigOrganelles.organelles[0];
    if (nucleus) {
      const nc = nucleus.body.center();
      const rr = nucleus.body.cfg.restRadius;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        this.signal.addSource(
          nc.x + Math.cos(a) * (rr + 2),
          nc.y + Math.sin(a) * (rr + 2),
          0.6
        );
      }
    }
    this.prof.measure("field", () => this.signal.step(0.18, 0.03));

    // Biology/rules layer: structural-failure death etc.
    this.prof.measure("rules", () => this.rules.update());

    this.prof.measure("render", () => {
      this.cpmRenderer.render();
      this.drawInterior();
    });

    // Camera. In dev (streaming frozen) the camera stays put on the map centre so
    // the whole sim is stable to study (wheel zooms). Otherwise follow the player
    // with a little lag.
    if (!DEV_FREEZE_STREAMING) {
      const c = this.sim.centroidLattice(this.controlledCellId);
      if (c) {
        const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
        const cx = this.camCx;
        const cy = this.camCy;
        this.camCx = cx === undefined ? wx : cx + (wx - cx) * 0.1;
        this.camCy = cy === undefined ? wy : cy + (wy - cy) * 0.1;
        this.cameras.main.centerOn(this.camCx, this.camCy);
      }
    }

    // Scroll the grid backdrop with the camera (infinite-world feel).
    this.bg.tilePositionX = this.cameras.main.scrollX;
    this.bg.tilePositionY = this.cameras.main.scrollY;

    // One pass over live cells: population census + profiler scale drivers.
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

    const combatStatus = this.combat.engulfing
      ? "ENGULFING"
      : this.combat.digestingCount > 0
        ? "DIGESTING"
        : this.steering
          ? "STEERING (hold LMB)"
          : "resting";
    const energy = Math.round(this.life.energyOf(this.controlledCellId));
    const hp = Math.round(this.rules.healthFraction(this.controlledCellId) * 100);
    this.hud.setText(
      `Vessel world — ${combatStatus}   LMB steer · RMB engulf   ` +
        `you: hp ${hp} energy ${energy}\n` +
        `world:  macrophages ${macrophages}   vessel-wall ${lining}   ` +
        `microbes ${microbes}   nutrients ${this.combat.nutrients}`
    );

    this.prof.metrics.activeCells = activeCells;
    this.prof.metrics.dormantCells = this.sim.dormantCount;
    this.prof.metrics.borderPixels = borderPixels;
    this.prof.frame();
    this.profText.setText(this.prof.overlayText());
  }

  /** Draw the deforming-grid small organelles + the nucleus soft body. */
  private drawInterior(): void {
    const g = this.interiorGfx;
    g.clear();
    const s = this.sim.scale;
    const c = this.sim.centroidLattice(this.controlledCellId);
    if (!c) return;

    // Small organelles as distinct, placed structures on the deforming grid.
    for (const o of this.grid.occupants) {
      const [wx, wy] = this.sim.latticeToWorld(o.x, o.y);
      this.drawStructure(g, o, wx, wy, s);
    }

    // Big organelles (nucleus + mitochondrion): fill each soft-body polygon
    // (oozes/ovals visibly) and tint the outline toward red as confinement stress
    // rises (the rupture warning ramp).
    for (const big of this.bigOrganelles.organelles) {
      const nodes = big.body.nodes;
      const stress = big.stress;
      const pts: Phaser.Math.Vector2[] = [];
      for (const nd of nodes) {
        const [wx, wy] = this.sim.latticeToWorld(nd.x, nd.y);
        pts.push(new Phaser.Math.Vector2(wx, wy));
      }
      g.fillStyle(big.color, 0.9);
      g.lineStyle(Math.max(1, s * 0.35), stress > 0.01 ? 0xff5d5d : 0x2a1a4a, 0.7 + 0.3 * stress);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
      // Nucleolus at the (deforming) center — nucleus only.
      if (big.type === "nucleus") {
        const nc = big.body.center();
        const [cwx, cwy] = this.sim.latticeToWorld(nc.x, nc.y);
        g.fillStyle(0x5b2f9e, 0.9);
        g.fillCircle(cwx, cwy, big.body.cfg.restRadius * s * 0.35);
      }
    }
  }

  private drawStructure(
    g: Phaser.GameObjects.Graphics,
    o: { type: string; color: number; radius: number; x: number; y: number; compressed: number },
    wx: number,
    wy: number,
    s: number
  ): void {
    const r = o.radius * s;
    const alpha = 0.92 - 0.4 * o.compressed;
    g.lineStyle(Math.max(1, s * 0.28), 0x0a0f14, 0.5);
    g.fillStyle(o.color, alpha);
    switch (o.type) {
      case "nucleus":
        g.fillCircle(wx, wy, r);
        g.strokeCircle(wx, wy, r);
        g.fillStyle(0x5b2f9e, 0.9);
        g.fillCircle(wx + r * 0.2, wy - r * 0.15, r * 0.35); // nucleolus
        break;
      case "mitochondrion": {
        // Oriented capsule (overlapping discs along a stable axis) = a rod, not a ball.
        const ang = (((Math.round(o.x) * 3 + Math.round(o.y) * 7) % 6) / 6) * Math.PI;
        const len = r * 2.0;
        for (let k = 0; k < 4; k++) {
          const t = (k / 3 - 0.5) * len;
          g.fillCircle(wx + Math.cos(ang) * t, wy + Math.sin(ang) * t, r * 0.8);
        }
        break;
      }
      case "golgi":
        // Stacked cisternae.
        for (let k = 0; k < 3; k++) {
          g.fillStyle(o.color, alpha * (1 - k * 0.18));
          g.fillEllipse(wx, wy + (k - 1) * r * 0.55, r * 2.4, r * 0.7);
        }
        break;
      default: // ribosome and other small structures
        g.fillCircle(wx, wy, r);
        break;
    }
  }
}
