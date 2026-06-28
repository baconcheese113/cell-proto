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
  /** Player's parameter along the loop (for windowed nearest-point + flow dir). */
  private playerT = 0;
  private vesselMaintainAccum = 0;
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
    this.cpmRenderer = new CpmRenderer(this, this.sim, 10);
    this.signal = new CpmField(cfg.fieldSize);
    this.cpmRenderer.setField(this.signal);
    this.rules = new CpmRules(this.sim, {
      onDeath: (id, reason) => this.onCellDeath(id, reason),
      ignore: (id) => this.combat.isConsuming(id),
    });

    // Motile kinds protrude (Act on). In the vessel the controlled cell is always
    // active too — it's continuously being pumped (carried by the current), not
    // resting; input just directs it. Sessile wall kinds get no Act.
    this.sim.setKindActive(CONTROLLED_KIND, true);
    this.sim.setKindActive(MACROPHAGE_KIND, true);
    this.sim.setKindActive(MICROBE_KIND, true);

    // The current carries the lumen dwellers (incl. the player), not the walls.
    this.sim.flow.setFlowingKinds([CONTROLLED_KIND, MACROPHAGE_KIND, MICROBE_KIND]);
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
    this.maintainVessel(true);

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

    // Zoom so the visible window is well inside the (now larger) bubble — its
    // streaming boundary stays off-screen.
    this.cameras.main.setZoom(1.8);
    this.cameras.main.setBackgroundColor("#1a0d12"); // deep tissue red-brown
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

  /** Keep the vessel lining + tissue populated around the player's current arc,
   *  and sprinkle a little lumen traffic. Empty wall slots (lattice background)
   *  within the bubble interior get filled; streaming demotes ones left behind.
   *  Cheap: throttled (called periodically), and only the local arc is generated. */
  private maintainVessel(initial = false): void {
    const f = this.sim.field;
    const margin = 16;
    const span = 0.16; // radians of loop arc to cover around the player
    const spacing = this.vessel.cfg.lumenR * 0.7; // world px between wall slots
    const slots = this.vessel.slots(this.playerT, span, spacing);
    for (const s of slots) {
      const [lx, ly] = this.sim.worldToLattice(s.x, s.y);
      const xi = Math.round(lx);
      const yi = Math.round(ly);
      if (xi < margin || xi >= f - margin || yi < margin || yi >= f - margin) continue;
      if (this.sim.ownerAtLattice(xi, yi) !== 0) continue; // already occupied
      this.spawnPreset(s.role === "lining" ? "endothelial" : "fibroblast", xi, yi);
    }

    // A little lumen traffic (microbes) drifting with the current.
    const want = initial ? 6 : 1;
    for (let i = 0; i < want; i++) {
      // A point in the lumen ahead of the player along the flow.
      const t = this.playerT + (Math.random() - 0.5) * span;
      const p = this.vessel.pathPoint(t);
      const jitter = (Math.random() - 0.5) * this.vessel.cfg.lumenR * 1.2;
      const tan = this.vessel.tangent(t);
      const nx = -tan.y;
      const ny = tan.x;
      const wx = p.x + nx * jitter;
      const wy = p.y + ny * jitter;
      const [lx, ly] = this.sim.worldToLattice(wx, wy);
      const xi = Math.round(lx);
      const yi = Math.round(ly);
      if (xi < margin || xi >= f - margin || yi < margin || yi >= f - margin) continue;
      if (this.sim.ownerAtLattice(xi, yi) !== 0) continue;
      this.spawnPreset("microbe", xi, yi);
    }

    if (initial) for (let i = 0; i < 40; i++) this.sim.step(); // let them take shape
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

  override update(): void {
    const pointer = this.input.activePointer;

    // The controlled cell is always Act-on (it's being pumped, not resting). Hold
    // LMB to steer it across/along the current toward the cursor; release and the
    // current carries it.
    this.steering = pointer.leftButtonDown();
    const kind = this.controlledKind();
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
      const FLOW_BASE = 14;
      this.sim.flow.setFlow(dir.x, dir.y, FLOW_BASE * (0.25 + 0.75 * pulse));
    }

    // ONE centroid pass for all cells, shared by every system (was the dominant
    // cost when each system scanned per-cell). Every other cell then runs the SAME
    // autonomous stack: behaviour (hunt/flee/sit by capability) then life
    // (metabolize/feed/divide/starve). Combat is the player's manual engulf (RMB).
    const centroids = this.prof.measure("centroids", () => this.sim.centroidsAll());
    this.prof.measure("behavior", () => this.behavior.update(1 / 60, centroids));
    this.prof.measure("life", () => this.life.update(centroids));
    this.combat.update(pointer.rightButtonDown());

    // Size the controlled cell's perimeter budget for any prey it's digesting.
    this.sim.setKindPerimeterTarget(
      kind,
      this.sim.basePerimeter(kind) + this.sim.compartmentPerimeterSum([DIGEST_KIND])
    );

    this.prof.measure("cpm.step", () => this.sim.step());

    // Infinite-world streaming: recenter the bubble on the player, demote cells
    // that left, re-activate ones that returned.
    const { demoted, shiftX, shiftY } = this.prof.measure("stream", () =>
      this.sim.streamAround(this.controlledCellId)
    );
    for (const id of demoted) {
      this.cpmRenderer.forgetCell(id);
      this.rules.forget(id); // dormant != dead
    }

    // Vessel upkeep: refill lining/tissue ahead + a little lumen traffic. Throttled
    // (a few times a second) — the walls don't need per-frame attention.
    if (++this.vesselMaintainAccum >= 12) {
      this.vesselMaintainAccum = 0;
      this.prof.measure("vessel", () => this.maintainVessel());
    }

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

    // Camera follows the player, but with a little lag so the cell visibly drifts
    // as it crawls instead of being pinned dead-centre (gives the interior life).
    const c = this.sim.centroidLattice(this.controlledCellId);
    if (c) {
      const [wx, wy] = this.sim.latticeToWorld(c.x, c.y);
      const cx = this.camCx;
      const cy = this.camCy;
      this.camCx = cx === undefined ? wx : cx + (wx - cx) * 0.1;
      this.camCy = cy === undefined ? wy : cy + (wy - cy) * 0.1;
      this.cameras.main.centerOn(this.camCx, this.camCy);
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
