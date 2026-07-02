# cell-proto — Master Design Document

> A living, deformable **cell world** you play from inside a single cell. This doc
> consolidates the vision, the architecture, what's built, and what's next. It reconciles
> the three planning docs in `~/.claude/plans/` (see [Source plans](#source-plans)) with the
> current code on branch `cpm-world`. Where those plans disagree, the **later** decision and
> the **current code** win; this document is the reconciled snapshot.

---

## 1. What we're building

**North star:** a competitive, biologically-honest **cell-vs-cell match**. You are a nanobot
living inside your own cell — you never leave it — building its internal **factory** (an
in-match economy + military of organelles and membrane machinery) to out-compete enemy cells
and win match objectives. AI opponents first (the designer plays solo for months); real
multiplayer later.

Around that north star sits a **living simulation of many autonomous cells**. The player's
cell is **not special**: it runs the *exact same systems* every other cell runs. The only
difference is that player input binds to **one tracked cell** (`controlledCellId`).
Autonomous cells pursue their real biological purpose — a macrophage hunts and engulfs, an
epithelial cell holds tissue and divides, a microbe multiplies and flees — using the same
steering / combat / life code the player uses.

The game has **two views** onto that one cell:

- **Cell-commanding (world) view — the current prototyping pass.** You steer your whole
  deformable cell through a blood vessel, hunt pathogens, and physically tear or engulf them.
  This is where movement and combat *feel* is being validated.
- **Nanobot interior (factory) view — the deep layer, later.** You drop inside your cell as
  a nanobot, work stations, and build/route the organelle factory that determines what your
  cell can do. This is the original "only validated fun" and the eventual competitive core.

The two are the same cell at two zoom levels; "what you build inside" (the factory) determines
"what your cell can do outside" (the combat/movement).

---

## 2. Hard constraints (non-negotiable)

These were learned by repeatedly getting it wrong. Every feature must respect them.

1. **The factory is the only validated fun.** Moving the nanobot inside the cell, building on
   tiles, optimizing small molecules (ATP / amino acids / nucleotides) into chains to craft
   structures. Every mechanic must **amplify** the factory, not sit beside it. (Rejected for
   sitting beside it: an antibody "turret", a "fire-the-pump" button, the nanobot personally
   chasing pathogens.)
2. **Biology stays honest.** No misleading dress-up — a secretion pump is not a turret; B/plasma
   cells make antibodies; a macrophage engulfs. The game teaches real cell biology. Legibility
   and feel may win ties over exact scale, but never over honesty of *mechanism*.
3. **Design is judged by concrete moment-to-moment player actions,** validated by small in-game
   prototypes and measurement — not abstract systems or design docs.
4. **A cell IS its composition** (the architectural spine, below): there is no authoritative
   "type" field. What a cell can do is derived from the components it has built.
5. **It's a toy before it's a simulation.** It only succeeds if it's *satisfying to fiddle
   with* — squeezing through a gap, gripping and tearing prey. Scientific grounding is a
   constraint, not the goal.

---

## 3. The core architecture — "a cell IS its composition"

The single source of truth for what a cell *is* = its **composition**: the set of components
it has built (organelles, membrane proteins, receptors), each with its own (often randomized)
parameters. **Metabolism, capabilities, behavior, and identity all derive from the components
present.** "Differentiation" is therefore emergent and honest: a cell becomes what it builds —
change the components, change the cell.

A **preset** is *only* a convenience: a named bundle of components with randomization ranges,
used to spawn cells that resemble a real cell type (macrophage, epithelial, microbe,
endothelial, fibroblast). After spawn the preset is forgotten; the cell is defined by its
mutable composition. Two cells from the same preset differ because their component strengths
are randomized. (`src/cell/cell-composition.ts`, `src/cell/cell-presets.ts`.)

Every living cell (the player's included) is a **Cell Agent** = a `CellId` + an identical
stack, every layer of which reads from the cell's composition:

| Layer | What it is | Driven by | Module(s) |
|---|---|---|---|
| **Composition** | the components a cell has built (mutable) | — (source of truth) | `cell-composition.ts`, `cell-presets.ts` |
| **Body (physics)** | a deformable cell on the CPM lattice | composition → a base CPM profile | `cpm-simulation.ts`, `cpm-config.ts` |
| **Capabilities / behavior** | drives + actions (motile, phagocytic, tearing, chemotactic) | the **capabilities the components grant** | `cell-composition.ts` (derive), `cpm-cell-behavior.ts` |
| **Life cycle** | metabolize → feed → grow → divide → die | metabolic balance from composition | `cpm-life.ts` |
| **Combat** | engulf / rip other cells | offensive capabilities + allegiance | `cpm-combat.ts`, `cpm-trogocytosis.ts` |

**Player binding:** the scene tracks `controlledCellId`. Player input *overrides* that one
cell's behavior. Camera follows it, HUD inspects it. On its death, control hands off to a
newborn/nearby cell — **there is no "game over"**, the world simply continues.

---

## 4. The technical substrate — Cellular Potts Model (CPM)

### 4.1 Why CPM

The game's headline is **deep phagocytosis** and a **deformable** cell, which requires
**topology changes** — true engulfment (target ends up *inside* a new closed compartment),
rupture, pinch-off, division. The earlier **XPBD particle membrane** could not do this
(a known-hard problem in position-based dynamics), and it stalled the project.

The **Cellular Potts Model** (via a vendored fork of **Artistoo**, MIT, pure JS) solves it:
cells are **lattice regions, not fixed connectivity**, so topology changes happen *for free*,
and it natively supports adhesion-driven cell–cell interaction and amoeboid protrusion (the
Act model). This is not a preference — a deforming cell cannot contain a rigid interior grid,
so the *whole* cell (membrane + interior) must live on one deformable substrate.

- Vendored fork: `src/vendor/artistoo/` (ESM source minus the Node-coupled Canvas/Simulation
  files; browser-safe `index.js` + `index.d.ts`). The pristine baseline is committed to
  `master`; our edits show up as diffs. One runtime dep: `mersenne-twister`.
- We drive the raw `CPM` + `GridManipulator` (not Artistoo's Node/Canvas `Simulation` class)
  and render the lattice ourselves via Phaser.

### 4.2 Cell types = parameter profiles → rock/paper/scissors

Each cell type is a CPM parameter vector (`CpmCellProfile` in `cpm-config.ts`): adhesion `J`,
perimeter tension `lambdaP` (stiffness), `lambdaV` (turgor), Act `lambdaAct`/`maxAct`
(protrusiveness/speed), cohesion (tear-resistance). Different vectors give asymmetric
strengths — e.g. high `lambdaP` = rigid/tough, resists tearing but can't squeeze through
narrow channels — so **there is no single perfect cell**. This is the core balance lever, and
it's just data. (Bonus: CPM's Monte-Carlo fluctuation gives free, realistic micro-motion.)

### 4.3 The interior — a hybrid organelle model

Organelles are **NOT** CPM sub-cells (that was tried and fails: many inclusions thread the
cytoplasm thin → perimeter-lock, pinching, rupture-on-normal-movement). Instead, split by
scale:

- **Big organelles** (nucleus first; then a mitochondrion) = pure area-preserving mass-spring
  **soft bodies** (`cpm-soft-body.ts`), positioned by a cytoskeletal-force target (host
  deep-center, slight rear bias while steering) so they **recenter on their own**. Their only
  CPM link is a **footprint-coverage** soft constraint (`footprint-cost.ts` +
  `cpm-footprint-constraint.ts`): the membrane is penalized for retracting cytoplasm off an
  organelle's footprint → squeeze **bottleneck**; over-squeeze exposes the footprint →
  confinement **rupture**. Managed by `cpm-big-organelles.ts` (stress + `consumeRupture()`).
- **Small organelles** (ribosomes, vesicles) = lightweight **occupants on a deforming grid**
  (`cpm-deform-grid.ts`), anchored in the cell's bounding-box frame; they flow/regroup under
  squeeze and can't fragment anything (zero physics cost).

This makes the **skill test** of the interior: *thread the cell through a tight gap without
rupturing your nucleus* — ease off, let it ooze, don't force it. It's grounded in real biology
(nuclear positioning by the cytoskeleton/LINC complex; confinement-induced envelope rupture).

### 4.4 Molecular fields

Small molecules (RNA/protein/ATP/…) are **reaction-diffusion fields** on the lattice
(`cpm-field.ts`), diffusing through the cytosol; the field domain deforms with the cell
automatically. Currently one signal field around the nucleus; the multi-species factory field
is the M2 layer.

### 4.5 Structural integrity & tearing

Cells must **not** split spontaneously, but tearing must remain **possible** as a response to
adverse force/chemistry (the combat mechanic). Strong cohesion (volume + perimeter tension)
holds a cell together in normal conditions; deliberate mechanical force overcomes it locally.
A connectivity check detects when a cell id splits into non-contiguous parts and fires a
discrete **structural-failure event** to the rules layer (`cpm-rules.ts`) → spill/death.
Health = **membrane integrity (mass)**, not an abstract bar. (Note: the always-on
`SoftConnectivityConstraint` was **removed** — it was ~72% of `cpm.step` and the solid cell +
soft-body nucleus stays cohesive from volume+perimeter alone.)

---

## 5. Scaling to a living world — the two-tier LOD

CPM is a single-threaded CPU Monte-Carlo sweep; it can't simulate a whole map at full
fidelity. The measured architecture (see [Performance](#8-performance-model)) is **two tiers
driven by one rule-set**:

| Tier | Representation | Runs | Cost |
|---|---|---|---|
| **Agent tier** (source of truth) | off-lattice `WorldCell` (world pos, velocity, composition, energy, team) + spatial hash | EVERYWHERE, every cell, every tick | ~free (thousands) |
| **CPM bubble** (transient detail) | the deformable `CpmSimulation` lattice around the player | only ~cells near the player | the ceiling |

The **agent tier is the durable identity.** A cell always lives in `agent-world.ts` as a
`WorldCell`. When it overlaps the player's lattice bubble it is **promoted** — given a
transient CPM **shadow** (`tier: "cpm"` + a `cpmId` link). Each tick the shadow's centroid +
energy are mirrored back onto the durable record. Leaving the bubble (or a streaming clip)
just **drops the shadow**; the agent resumes as a cheap disc. **Only real death removes the
agent.** This shadow model is what fixed cells being erased/duplicated at the boundary.

- Same **composition rules** drive both tiers (CPM vs agent is purely level-of-detail):
  `agent-world-core.ts` holds the pure agent-tier physics + predicates (separation, feeding,
  tearing, hostility), mirroring what the CPM systems do in-bubble.
- **Infinite world via streaming:** the lattice is a player-anchored bubble; it recenters as
  the player moves (`streamAround`), so the world is effectively infinite. Cells cross the
  bubble boundary by flipping CPM↔disc, conserved, never erased.
- **Continuous zoom (planned):** the two tiers are meant to be the two ends of one continuous
  zoom (Factorio/EU4-style) — zooming out crossfades the deformable bubble into the agent-tier
  overview. Today the boundary is a visible square when you zoom way out; making it seamless is
  the LW4 item.

### The Web Worker

The whole sim (`world-sim.ts`, Phaser-free) runs on a **Web Worker** (`sim-worker.ts` +
`sim-client.ts`); the render thread (`cpm-world-scene.ts`) just blits the latest snapshot at
60fps. This **decouples render FPS from `cpm.step` cost** — the sim advances at its own
real-time rate on the worker while the screen stays smooth. A `?local` URL flag runs the sim
inline on the render thread for debugging (exposes `window.__cpm`).

---

## 6. The world — a blood vessel

The world is a **blood-vessel passage**, not a random blob of cells (`cpm-vessel.ts`):

- A **closed-loop centerline** in world space (large, winding, returns to start). A point's
  role is its distance to the nearest path point: **lumen** (open fluid where cells flow),
  **lining** (endothelial cells), **tissue** (beyond).
- **Open lumen** = CPM background/medium (room to move), cells suspended in it.
- **Endothelial lining** = cohesive, fully-alive endothelial cells (they metabolize/divide/die
  like any cell). Containment is the **cells themselves** — there are **no impassable mask
  walls**. The vessel maintainer keeps the band populated as the bubble streams.
- **Tissue beyond** = fibroblast cells (thin for now) — the future diapedesis destination.
- **Pulsatile current** = a CPM-native `CpmFlowConstraint` (`flow-cost.ts`): biases copy
  attempts along the path tangent, magnitude **pulsed by a heartbeat**. Default (no input) =
  you're carried; steering moves you across/within the flow. Sessile walls are excluded from
  the flow.

**Diapedesis** — the player WBC squeezing *between* endothelial cells into the tissue space —
is the headline vessel mechanic and is **planned** (Artistoo's CancerInvasion example does the
equivalent Act-model migration well).

---

## 7. Combat

Combat is **cell-vs-cell**, mechanically physical (grab, tear, engulf), and — like everything —
**derived from composition**. Two allegiance-orthogonal ideas:

- **Abilities are components.** Each combat verb is a component + a capability axis, exactly
  parallel to how `phagocytic-receptor` grants engulfing. This means the whole roadmap of
  attacks (below) each reduces to *one component + one axis*, reusing the entire rule-set/LOD
  machinery.
- **Team is a separate self-marker.** `WorldCell.team` (0 = neutral; other ids mutually
  hostile) is orthogonal to composition — a team can field mixed ability-cells. `hostile(a,b)`
  (pure, in `agent-world-core.ts`) drives who-attacks-whom. Rendered as a small **team-coloured
  nucleus dot** at each cell's centre (blue = immune, red = microbe), readable at both zooms.

### 7.1 Phagocytosis (shipped) — `cpm-combat.ts`

The headline mechanic: grab a nearby enemy → wrap it (flow the membrane around it via lowered
adhesion + protrusion) → once internalized (a closed interior compartment — the topology change
CPM gives for free) → **digest** it for nutrients. Structured as *prep gates a physical grapple*
in the north-star design.

### 7.2 Trogocytosis / grab-and-rend (shipped) — `cpm-trogocytosis.ts`

A **Carrion-style** second verb, and the one that *justifies* CPM (mass-conserving membrane
rupture with persistent debris). It's built on real membrane physics, not a health bar:

- **Extend & grab on contact.** Hold RMB → the player's own membrane extends toward the cursor
  (a short CPM protrusion). When it *touches* a hostile cell it **grabs** it (a mere click
  never rips — you must reach and touch).
- **Held, not nibbled.** On grab the prey is converted to a **`GRIPPED` kind**: immobilized
  (can't flee) with its volume target pinned to its grab-time size (via `setKindVolumeTarget`),
  so it **resists being crushed but cannot heal** between tears. It's reeled onto the tentacle
  and held beside you.
- **Thrash to rend.** After a brief grab-settle, *moving the cursor* (thrashing — measured in
  **screen** space so the camera can't fake it) tears a chunk off every interval; the grip is
  kept across tears, so you **rip the prey apart over several motions** until it lyses.
- **Conserved, colour-carrying debris.** Each torn chunk becomes a real CPM cell of an inert
  **`DEBRIS` kind** — pixels *moved*, not deleted (mass conserved by construction), inheriting
  the prey's colour. It persists (frozen by a barrier constraint so it neither evaporates nor
  gets eaten), fades over a TTL, then is removed. Debris is **permeable to the player** (a
  custom `PermeableBarrierConstraint`) so you plow right through it while it stays solid to
  everything else.
- **Off-screen parity.** The agent tier runs the same move cheaply (`tearingEvents`): a tearing
  cell reduces a touching hostile's mass; below a fraction it dies. So off-screen cells fight
  with the same verb — we just don't render the debris.

RMB routes to engulf-vs-trog by the cell's **dominant offensive capability**
(`playerPrefersTrog`). The macrophage preset currently makes tearing dominant, so the player
grabs-and-rends by default while keeping phagocytosis for agent-tier hunting.

### 7.3 The planned ability kit (framework in place, abilities TODO)

Each reuses the ability-as-component + team framework (one component + one axis each):

| Ability | Biology | Substrate | Status |
|---|---|---|---|
| **Phagocytosis** | engulf whole | membrane topology (engulf) | **shipped** |
| **Trogocytosis** | bite off membrane | membrane tearing + debris | **shipped** |
| **Perforin** | drill pores → osmotic collapse | membrane puncture + leak | planned (needs projectile/aim) |
| **ROS burst** | oxidative spray | diffusion field | planned (field-native) |
| **NETosis** | suicide net, area denial | field mesh | planned (field-native) |
| **Apoptosis induction** | force self-destruct | signal debuff | planned |

Human-vs-human PvP and per-ability keybinds are deferred to the multiplayer milestone.

---

## 8. Performance model (measured, not assumed)

The whole scaling strategy rests on measured facts — keep these when tuning:

- **`cpm.step` cost ≈ `border-pixels × MCS/sec × ~250ns`.** It's driven by the border-pixel ΔH
  evaluation, **not** motion (a busy world ≈ a resting one, +0–23%) and is robust to crowding
  (cells compress gracefully; rupture only above ~100% packing). `cpm.step` is **near-optimal
  JS** — micro-opts *deopt* it — so the GPU does not help `cpm.step` (only render).
- **Perceived crawl speed = MCS/sec × worldPerPixel only** (per-step displacement is saturated
  — `lambdaAct`/`maxAct`/temperature/`steerLambda`/flow do NOT change it).
- **Lattice resolution is the unifying lever.** Border is in *lattice* pixels, so fewer pixels
  per cell (higher `worldPerPixel`) makes the sim cheaper AND the world crawl faster, at the
  same world cell size. This is how the world got to 60Hz + responsive crawl.
- **A single lattice for the whole map is dead past ~100 cells** — hence the agent-tier LOD.
  One field-~220 bubble holds ~80–115 full-CPM cells; the agent tier carries 5000 cells at
  ~2.3ms/tick.
- **`fieldSize` scales cost ~with area** (~5.6× for a 4× bubble); prefer a modest bump or the
  agent tier over doubling. `recenterMargin` is the cheap lever for **leading-edge pop-in**
  (recenter eagerly so the promote boundary stays off-screen while moving).
- **Live dials:** MCS rate is player-tunable (`[` / `]` keys) — there's no single value that's
  both fast and smooth on a heavy view, so the player picks. HUD shows `render Nfps · sim NHz`
  to diagnose render- vs sim-bound.

**Build note:** the vendored Artistoo registers/looks up constraints by `constructor.name`, so
the production build **must** keep class names (`esbuild.keepNames: true` in `vite.config.js`),
or the minified worker throws `No constraint of name exists in this CPM!` and the world renders
as just the grid.

---

## 9. Status — what's built vs planned

Branch `cpm-world` (off `master`, which holds the pristine vendored Artistoo baseline). The old
hex-grid factory game is untouched as scene #2; the CPM world is the boot scene.

### Shipped ✅
- **CPM substrate:** world-integrated deformable cell, rest-by-default, hold-LMB steer,
  multi-cell collision; infinite scrolling world via lattice recentering + streaming;
  condition-gated tearing + apoptosis death; per-cell directed motion + AI.
- **Interior hybrid model:** soft-body nucleus (recenters, bottlenecks, ruptures under
  confinement) + deforming-grid small organelles + footprint coupling.
- **Phagocytosis** (grab → wrap → digest → nutrient).
- **Living Cell World (M1):** "a cell IS its composition" — composition → capabilities +
  metabolism; presets; capability-driven behavior (hunt/flee/sit); life cycle (feed/divide with
  mutation/starve); peer-cell scene (`controlledCellId` + death handoff); always-on profiler.
- **Vessel World (M1.5):** closed-loop blood vessel, pulsatile heart-pump current, fully-alive
  endothelial lining + fibroblast tissue, streaming off-screen.
- **Scaling architecture:** two-tier LOD (durable agent tier + transient CPM shadow bubble);
  Web Worker sim decoupled from render; resolution-tuned to 60Hz; live MCS dial.
- **Trogocytosis combat + framework:** grab-and-rend with conserved fading debris, held-not-
  healing gripped prey, player-permeable debris; abilities-as-components + `tearing` axis; team
  allegiance + `hostile`; agent-tier parity; team nucleus markers.
- **Networking seam:** `cpm-replication.ts` binary dirty-segment delta codec (node-verified).
- **Prod build fix:** `esbuild.keepNames` so the minified worker's constraint lookup works.

### Planned / next
- **Diapedesis** — the WBC squeezing between endothelial cells into the tissue space (the
  headline vessel mechanic).
- **Seamless continuous-zoom LOD (LW4)** — crossfade the CPM bubble into the agent-tier overview
  so there's no hard square edge when zooming out.
- **The rest of the combat kit** — perforin, ROS, NETosis, apoptosis (each = one component +
  one axis on the existing framework).
- **Factory grounding + dormant-but-alive LOD (M2)** — drive each cell's metabolism from the
  **organelles in its composition** over a multi-species field; make dormant (off-bubble) cells
  keep metabolizing and preserve collisions off-lattice (the genuinely novel LOD research item).
- **Factory migration (substrate Step 5)** — re-home the ~28 hex-factory files
  (production/diffusion/cytoskeleton/cargo/organelle-IO/construction) onto the lattice and retire
  the hex systems at parity. Large; dismantles the working hex game — do under no time pressure.
- **Nanobot interior view + deliberate differentiation (M3)** — the hands-on factory/station
  view (player as nanobot inside the cell), building/removing components; differentiation falls
  out of the composition model ("a cell is what it builds").
- **Multiplayer (LW5)** — host-authoritative over the cheap agent world; each player's CPM
  bubble replicated via the binary delta codec; clients are pure renderers (never re-sim CPM).
- **Interior/combat tails** — player-built cytoskeleton + cargo roads; richer leakage-on-breach;
  rupture DNA-spill FX; interior feel polish.

---

## 10. Key decisions & hard-won lessons

- **Adopt CPM, drop XPBD** — topology changes (engulf/rupture/divide) are the whole point and
  XPBD can't do them.
- **Organelles are not CPM sub-cells** — many inclusions fragment a crawling host; use the
  hybrid soft-body + deforming-grid model instead.
- **A cell IS its composition** — no type field; capabilities/metabolism/identity derive from
  components; presets are just spawn convenience; differentiation is emergent.
- **The player is not special** — one code path for "a cell living its life"; input is a thin
  adapter on one agent; death hands off, no game-over.
- **Two tiers, one rule-set** — a durable off-lattice agent tier (thousands, ~free) + a
  transient CPM shadow bubble (the detailed foreground). The agent is the identity; the CPM cell
  is a shadow. Never destroy/recreate at the boundary.
- **Move the sim off the render thread** — a Web Worker keeps render at 60fps while the sim runs
  at its own rate; `cpm.step` is CPU-bound and near-optimal in JS.
- **Resolution is the master perf lever** — border is in lattice pixels, so coarser pixels are
  cheaper *and* faster-crawling at the same world size.
- **Removed the SoftConnectivityConstraint** — it was ~72% of `cpm.step`; the solid cell + soft
  nucleus stay cohesive from volume+perimeter alone.
- **Combat health = membrane integrity (mass), conserved** — tearing moves pixels into debris;
  gripped prey is held (immobile) and can't heal, so it rends rather than nibbles.
- **Measure, don't guess** — an always-on profiler + `browser_evaluate` microbenches drove every
  scaling decision. Prefer targeted measurement over screenshot loops.

---

## 11. Code map (`src/cell/`)

**Sim core & substrate**
- `cpm-simulation.ts` — owns the CPM lattice + all cells; spawn/kill/steer; world↔lattice
  transform + streaming; constraint wiring (incl. the `PermeableBarrierConstraint` for debris).
- `cpm-config.ts` — per-kind `CpmCellProfile` parameter vectors + world config (`fieldSize`,
  `worldPerPixel`, temperature, `recenterMargin`).
- `world-sim.ts` — the Phaser-free simulation orchestrator: one fixed-timestep tick over every
  system; builds the render snapshot; owns kinds, debris/gripped lifecycles, teams, combat
  routing.
- `sim-worker.ts` / `sim-client.ts` — Web Worker boundary (worker runs `WorldSim`; client posts
  input + renders snapshots; `LocalSimClient` for `?local`).
- `sim-clock.ts` — fixed-timestep clock (`simStepsFor`).
- `cpm-renderer.ts` — thin Phaser blitter for the lattice framebuffer.
- `cpm-world-scene.ts` — Phaser render/input client: input capture, snapshot render, camera,
  HUD, FX, `__cpm` debug handle.

**The rule-set (composition-driven, tier-agnostic)**
- `cell-composition.ts` — components → capabilities + metabolism (pure, node-tested).
- `cell-presets.ts` — randomized spawn bundles (pure).
- `cpm-cell-behavior.ts` — capability-driven steering (hunt/flee/sit).
- `cpm-life.ts` — energy balance, feeding, division-with-mutation, starvation.
- `world-cell.ts` — the durable `WorldCell` identity (tier, cpmId link, team).

**Agent tier (LOD)**
- `agent-world.ts` — the off-lattice population; runs the shared rules over `WorldCell`s.
- `agent-world-core.ts` — pure agent-tier physics + predicates (`SpatialHash`, `separation`,
  `feedingEvents`, `tearingEvents`, `hostile`) — node-tested.
- `bubble-manager-core.ts` — promote/demote seam helpers.

**Combat**
- `cpm-combat.ts` — phagocytosis (grab → wrap → digest).
- `cpm-trogocytosis.ts` — grab-and-rend control (extend → grab → thrash-to-tear).

**Interior**
- `cpm-soft-body.ts` — area-preserving mass-spring ring (big organelles).
- `cpm-big-organelles.ts` — soft-body manager + confinement stress + rupture.
- `cpm-footprint-constraint.ts` / `footprint-cost.ts` — the CPM↔organelle coupling.
- `cpm-deform-grid.ts` — small-organelle occupants on the deforming grid.
- `cpm-field.ts` — reaction-diffusion molecular field.

**World & rules**
- `cpm-vessel.ts` — closed-loop vessel geometry (lumen/lining/tissue, flow tangent, slots).
- `cpm-flow-constraint.ts` / `flow-cost.ts` — pulsatile current.
- `cpm-rules.ts` — damage/health/apoptosis/structural-failure death.
- `per-cell-attraction-constraint.ts` — per-cell directed steering (fork extension).
- `cpm-profiler.ts` — always-on per-system + per-cell timing.
- `cpm-replication.ts` — binary delta codec (multiplayer seam).

Vendored engine: `src/vendor/artistoo/` (forked ESM; edits show as diffs vs the `master`
baseline).

---

## 12. Verification conventions

- **Pure cores:** `node --test --experimental-strip-types src/cell/*.test.ts` (strip-only mode
  forbids TS parameter properties and extensionless relative imports — keep node-tested modules
  self-contained or `import type`-only).
- **Build:** `npx tsc --noEmit` + `npx vite build`.
- **In-game (dev):** `?local` exposes `window.__cpm` (live `worldSim`, `sim`, `perf()`, debug
  hooks). Prefer targeted `browser_evaluate` / profiler measurement over screenshot loops.
- **Prod build:** verify via `vite preview` (the minified worker path is where the
  constructor-name / `keepNames` class of bug shows up; dev won't catch it).

---

## Source plans

This document reconciles three planning docs (in `~/.claude/plans/`). They remain the detailed,
dated design record; this doc is the consolidated snapshot.

- **`look-through-what-i-ve-starry-curry.md`** — *Adopt CPM as the deformable cell substrate.*
  The foundational technical decision, build order (Steps 0–6), the interior-substrate hybrid
  redesign, networking approach, and dated implementation-status addenda. Mostly shipped;
  factory migration (Step 5) outstanding.
- **`replicated-jumping-parnas.md`** — *Living Cell World — the unified "Cell OS" foundation.*
  The reframe to a world of composition-driven peer cells; milestones M1 (movement+combat living
  world, done), M1.5 (vessel world, done), M2 (factory + dormant-but-alive LOD), M3 (nanobot
  interior + differentiation).
- **`maybe-we-write-it-golden-riddle.md`** (≡ `federated-sleeping-ripple.md`) — *Trogocytosis —
  physical membrane-ripping combat + ability/team framework.* The T1–T5 combat plan (shipped),
  which itself superseded an earlier LOD-Living-World + Web-Worker plan (also shipped; captured
  in the memory notes).

The living memory notes (in `~/.claude/projects/.../memory/`) carry the finest-grained current
status and tuning lessons: `game-design-direction`, `cpm-substrate-status`,
`cpm-perf-resolution-and-tuning`, `cpm-step-perf-ceiling`, `smallcell-spike-findings`,
`trogocytosis-combat-status`, `phagocytosis-prototype-status`.
