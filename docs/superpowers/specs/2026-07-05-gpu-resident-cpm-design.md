# GPU-resident CPM substrate (staged) — design

**Date:** 2026-07-05
**Branch:** cpm-world
**Status:** approved design, ready for implementation plan

## Context

`src/cell/` is a Cellular Potts Model (CPM) prototype: you drive a deformable macrophage
through a lumen of other cells, simulated on a player-anchored lattice via vendored Artistoo.
This is a **prototype** whose distinctive bet — CPM as a real-time game substrate — will
eventually be re-implemented in UE5 (which has no native CPM either; what ports is *the
pattern*, a compute-shader sim feeding gameplay, not an engine feature).

Today the CPM step runs single-threaded (V8-optimal) in a Web Worker. Cost is
border-pixel-bounded (~250 ns/attempt). On a gaming PC it hovers near the edge of degraded
performance; on mainstream hardware it will be worse. Concretely:

- Perf must be good on a **mainstream Chrome/Edge desktop**, not just a 7800X3D + 4070 Ti.
- We want **headroom** to add features and to simulate *more* of the world (so less falls back
  to the cheap agent LOD tier, meaning fewer seams to hide).
- **Multiplayer** is a later goal; the substrate should not foreclose a server-authoritative,
  snapshot-streamed model.
- A concrete failure mode drives urgency: **below ~20fps the nucleus lags and steering can
  kill the player cell.** The perf floor is a correctness/feel problem, not just polish.

A validated WebGPU spike (`cpm-gpu-spike.ts`) already proved the substrate: a reduced
checkerboard CPM (adhesion + volume only) ran **37–114× faster** on the GPU than an identical
CPU reference, scaling with border count, at a flat ~0.07–0.11 ms/MCS. This design turns that
spike into the live simulation.

## Current architecture (what we're modifying)

- **Worker (`sim-worker.ts`)** hosts the entire `WorldSim` (all game logic) + `CpmSimulation`
  (Artistoo). It ticks at ~60Hz on its own clock, produces a snapshot, and `postMessage`s it.
- **Snapshot** carries a pre-computed **RGBA framebuffer** of the lattice (~400KB) + agent
  discs + interior/nucleus geometry + HUD stats.
- **Main thread** (`sim-client.ts` + `cpm-world-scene.ts`) blits the framebuffer into a Phaser
  `CanvasTexture` (`cpm-renderer.ts`), draws agents/interior/HUD, and follows the camera.
- **Physics:** nine constraints in `cpm-simulation.ts`:
  1. **Adhesion** — full per-kind `J` matrix
  2. **Volume** — `LAMBDA_V`, `V` per kind
  3. **Perimeter** — `LAMBDA_P`, `P` per kind (Artistoo auto-added)
  4. **Activity / Act model** — `LAMBDA_ACT`, `MAX_ACT`, geometric mean (auto-added) — *the
     crawl; the entire feel of the game*
  5. **PerCellAttraction** — per-cell steering target + strength (how the player moves)
  6. **Footprint** — couples the membrane to the nucleus soft-body
  7. **Flow** — vessel current pushing lumen kinds
  8. **PermeableBarrier** (hard) — vessel walls + frozen debris, permeable to the player
  9. (no SoftConnectivity — deliberately removed; cohesion comes from volume+perimeter)

The key architectural gift: **the framebuffer already crosses the worker→main boundary every
tick.** Sourcing it from a GPU readback instead of a CPU pass is bandwidth-equivalent, so the
renderer and the main thread are untouched by this work.

## Chosen approach: C — staged GPU-resident, CPU-oracle side-by-side

The GPU **owns** the lattice + Act state; a per-cell reduction runs on GPU; the framebuffer is
produced by a GPU color-map pass and read back (same size as today). Game logic reads a small
per-cell **summary** (centroid, volume, kind, contact flags — a few KB) read back each tick and
kept in a **CPU mirror inside the worker**; discrete edits (spawn/kill/rip/steer) are buffer
writes or micro-dispatches scheduled *between* MC batches so they never race the step. The
existing CPU `CpmSimulation` stays runnable as an **oracle** to A/B fidelity against until the
GPU path proves out.

Everything GPU lives **in the worker** (Chrome exposes `navigator.gpu` in workers). The
worker→main snapshot contract is unchanged.

### Why not the alternatives
- **A — "Mirror" (GPU accelerates the inner loop, CPU keeps ownership):** uploads+reads back
  the full lattice every tick and forces an O(N) CPU rescan to rebuild Artistoo's incremental
  bookkeeping. The readback stall erases the win at our size and cannot scale to a bigger
  field — the whole point. Rejected.
- **B — straight-to-GPU-resident (no staging):** correct target, but a big-bang rewrite of
  every lattice mutation with no playable intermediate and no oracle to diff against. Higher
  risk for a prototype. C reaches the same end state incrementally.

## Data model (GPU buffers, worker-resident)

- `lattice: array<i32>` — owner cell id per pixel (0 = background/medium). `field²`.
- `act: array<u32>` — Act model state per pixel (MCS-time of last successful copy; decays over
  `MAX_ACT`). `field²`.
- Per-cell param arrays, indexed by cell id: `kind`, `vol`, `targetVol`, `perim`, `targetPerim`,
  `steerX`, `steerY`, `steerStrength`, `flags` (barrier / frozen / permeable bits).
- `J: array<f32>` — flattened adhesion matrix (kind × kind).
- `framebuffer: array<u32>` (or a storage texture) — RGBA per pixel, produced by the color-map
  pass, copied to a `MAP_READ` staging buffer.
- `summary` — compact per-cell {centroidX, centroidY, vol, perim, kind, contactMask} for the
  CPU mirror.
- Uniforms per dispatch: `W, H, B, phase, ox, oy, seed`, plus global `T`, `MAX_ACT`, lambdas.

## Per-tick pipeline (in the worker)

1. **Apply queued edits** (spawn/kill/rip/steer) — buffer writes / micro-dispatches.
2. **N × MC step**: for each MCS, four checkerboard phases (4-colour block gate; per-block
   border-biased reservoir pick; hard-barrier short-circuit → deltaH over ported constraints →
   Metropolis accept → write lattice + update `act` + adjust `vol`). N is the live MCS-rate dial.
   **Per-MCS volume recompute** (the drift fix, see below) runs inside this loop so the value
   the next step reads is always exact.
3. **Per-tick reduction**: after the N MCS, compute the per-cell `perim`, `centroid`, `border`,
   and refresh `vol` **from the lattice** (segmented reduction / atomic scatter) for the CPU
   mirror. This is gameplay-facing state, needed once per rendered tick, not once per MCS.
4. **Color-map pass**: lattice → RGBA framebuffer (owner id / kind → colour, same palette as
   today).
5. **Readback (double-buffered)**: copy framebuffer + summary to staging; map *last* frame's
   staging while the GPU computes the next — hides `mapAsync` latency so the pipeline never
   stalls.
6. **CPU mirror update** from the summary; **snapshot** posts the framebuffer (unchanged
   contract).

## Volume-drift fix

The spike showed 13–23% volume drift from atomic races: a cell spanning two same-colour blocks
has two threads adjust its volume from stale reads, so the *decision* used a stale value even
though `atomicAdd` keeps the count consistent. Fix: **recompute each cell's volume from the
lattice in the reduction pass every MCS**, so the value the volume constraint reads next step is
exact and error cannot accumulate. Cheap on GPU; removes the drift entirely.

## Constraint port map

| Constraint | GPU strategy | Milestone |
|---|---|---|
| Adhesion (J matrix) | 8-neighbour unlike-count × `J[kindA][kindB]` from the flattened matrix | M1 |
| Volume | `LAMBDA_V·((v±1−V)²−(v−V)²)`, `v`/`V` from per-cell arrays; vol recomputed each MCS | M1 |
| Act model | `act` buffer; geometric-mean neighbourhood term; update `act` on accept | M1 |
| Barrier (hard) | flags bit → reject copy in/out before deltaH (short-circuit); permeable-to-player bit | M1 |
| Perimeter | local perimeter delta from 8-neighbourhood; `perim`/`targetPerim` per cell | M2 |
| PerCellAttraction | steer vector per cell → directional bias term in deltaH | M2 |
| Footprint (nucleus) | port or approximate (nucleus is a soft-body coupling) | M3 |
| Flow (vessel current) | directional bias for flowing kinds | M3 |

**Checkerboard fidelity caveat:** the checkerboard update order crawls ~14% slower per-MCS than
Artistoo's sequential border-sampling. Since MCS are near-free on the GPU, compensate by running
more MCS per tick and/or a small `LAMBDA_ACT` bump — validated against the oracle, not by eye
alone.

## Milestones

**M1 — GPU steps the real lattice, and it feels alive.**
GPU-resident lattice + `act` + Adhesion(matrix) + Volume + Act + Barrier. Framebuffer produced
on GPU and read back into the existing renderer. Player steers via a `steer*` buffer write.
Volume-drift fix in place. CPU `CpmSimulation` kept as oracle. **Ship criterion:** cells crawl,
walls are solid, the player moves, perf beats the CPU worker at equal border, no runaway volume;
A/B centroid/volume trajectories track the oracle within tolerance.

**M2 — full deform physics + GPU owns gameplay reads.**
Add Perimeter + PerCellAttraction. GPU reductions feed the CPU mirror (centroid/vol/perim/
contact); retire the CPU sim's per-tick stat work. **Ship criterion:** shape/steering match the
CPU feel; game logic reads only the mirror; no full-lattice readback for logic.

**M3 — discrete edits on GPU; retire the CPU step.**
Spawn / kill / rip / streaming as buffer ops / micro-dispatches between MC batches. Footprint
(nucleus) + Flow ported or approximated. CPU step demoted from default to oracle-only (behind a
dev flag). **Ship criterion:** every combat verb works on the GPU sim; CPU path no longer on the
hot path.

## What we accept (losses), and mitigations

- **Reads are ~1 frame stale** (no synchronous "what's at pixel (x,y)"). Mitigation: CPU mirror
  in the worker; 16ms latency is imperceptible for movement/combat.
- **Edits become scheduled, race-safe ops**, not instant `setpix`. Mitigation: queue + apply
  between MC batches.
- **Pixel-exact / bespoke edits each cost a WGSL kernel** → slower iteration on new
  membrane-reshaping verbs. Accepted as the main ongoing cost.
- **Weaker headless testing / inspection** of GPU buffers. Mitigation: keep the CPU oracle +
  node tests; validate GPU via readback assertions.
- **Determinism weakens** (per-block RNG + atomic ordering). Accepted: multiplayer is planned as
  snapshot-streamed, not lockstep.
- **GPU loses at trivial scale** (dispatch overhead). Non-issue at our border counts.

## Testing / verification

- **CPU oracle A/B:** run both substrates on the same seed/pack; compare per-cell volume &
  centroid trajectories and border count over N MCS; assert within tolerance. This is the
  primary fidelity gate at each milestone.
- **Keep the node unit tests** that exercise pure game logic against the CPU oracle
  (agent-world-core tearing, mass-conservation rip, behavior-mode branches).
- **In-browser readback assertions** for GPU-only state (no volume runaway; no fragmentation;
  barrier holds).
- **End-to-end:** dev app, `?local`. Confirm crawl, solid walls, responsive steering, a full
  combat encounter, and that perf holds well above 20fps at a border count that pinned the CPU
  worker.

## Risks & open questions

- **WebGPU-in-worker maturity** on target Chrome/Edge (expected fine; confirm at M1 start).
- **Act geometric-mean port** is the fiddliest physics; budget time to match the oracle's crawl.
- **Reduction cost** with many small cells (segmented scatter) — measure at M1; it must stay a
  small fraction of the MC cost.
- **Nucleus/Footprint** is a soft-body coupling that may not map cleanly to the lattice step;
  M3 may approximate rather than port exactly.
- **MCS-rate vs checkerboard crawl deficit** interaction — tune against the oracle.

## Out of scope

CPU fallback for non-WebGPU devices (prototype targets Chrome/Edge). Multiplayer netcode/server
(design only avoids foreclosing it). The `src/game` rebuild. New gameplay systems. Moving
*rendering* to WebGPU (framebuffer-readback into Phaser is sufficient; a WebGPU renderer is a
possible later optimization, not required).
