# CPM Interior Substrate (Hybrid Organelle Model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the detached lightweight-overlay / conforming-grid organelle experiments with a hybrid interior: the nucleus (and other "big" organelles) as controlled area-preserving soft bodies that recenter on their own and couple to the CPM membrane through a footprint-coverage constraint (squeeze bottleneck + confinement rupture), plus many small organelles as occupants on a deforming grid that flow and regroup under squeeze.

**Architecture:** The CPM membrane, crawl, world streaming, combat, fields, and rules layers are **unchanged**. Big organelles are pure soft bodies (mass-spring rings with area preservation) positioned by a cytoskeletal-force target; their only link to CPM is a per-frame footprint mask fed to one new `SoftConstraint` that penalizes the host for not covering it. Small organelles anchor to the cell's deforming local frame and are kept inside by containment. Pure-logic modules (`cpm-soft-body`, `footprint-cost`, `cpm-deform-grid`) are node-testable with `node --test`; CPM glue and in-game wiring are verified by `tsc` + targeted in-game assertions.

**Tech Stack:** TypeScript (ESM), Phaser 3, vendored Artistoo CPM (`src/vendor/artistoo`), Node 24 built-in test runner (`node --test`, native `.ts` type-stripping). No new dependencies.

## Global Constraints

- **CPM stays the membrane — non-negotiable.** No XPBD/soft-body for the membrane; soft bodies are interior-only.
- **The player stays ONE solid CPM cell.** Big/small organelles must never be CPM sub-cells (that fragmentation class is what we are escaping).
- **Do not start dev servers** — the user runs them already (port 5173). Never run `npm run dev`.
- **Playwright is token-expensive** — verify with `node --test` and `tsc` first; use the browser only at the two in-game GATE tasks, one `browser_evaluate` call each against the `window.__cpm` handle (no screenshot thrashing).
- **Pure modules only `import type` from `../vendor/artistoo`** (runtime imports break `node --test` resolution). Glue modules that `extends SoftConstraint` are not node-tested; their pure cost math lives in a separate node-tested module.
- **Type-check command:** `npm run build` runs `tsc` then `vite build`; for a fast type-only gate use `npx tsc --noEmit`.
- World/lattice facts to reuse verbatim: `sim.ownerAtLattice(x,y) === hostId` is the containment predicate; `sim.centroidLattice(id)` returns `{x,y,pixels}`; `sim.cellFrame(id)` returns `{cx,cy,halfW,halfH}`; lattice recentering returns `{demoted, promoted, shiftX, shiftY}` from `sim.streamAround(playerId)` and all interior state stored in lattice coords must be `shift(shiftX,shiftY)`-ed each frame.

---

## File Structure

**New (Phase A — nucleus de-risk):**
- `src/cell/cpm-soft-body.ts` — pure area-preserving mass-spring ring (one big organelle). No runtime CPM import.
- `src/cell/cpm-soft-body.test.ts` — node tests (recenter, area preservation under compression, footprint, exposedFraction, ovalness, shift).
- `src/cell/footprint-cost.ts` — pure `footprintDeltaH(...)` for the coverage coupling.
- `src/cell/footprint-cost.test.ts` — node tests for the cost math.
- `src/cell/cpm-footprint-constraint.ts` — thin `SoftConstraint` glue delegating to `footprintDeltaH`.
- `src/cell/cpm-big-organelles.ts` — manager: owns soft bodies, drives footprint constraint, accumulates confinement stress, reports rupture.

**Modified (Phase A):**
- `src/cell/cpm-simulation.ts` — register the footprint constraint; add `setBigOrganelleFootprint` / `clearBigOrganelleFootprint`.
- `src/cell/cpm-rules.ts` — add `"ruptured"` to `DeathReason`.
- `src/cell/cpm-world-scene.ts` — instantiate the nucleus soft body via the manager; render the oozing nucleus; rupture → death FX + respawn; HUD nucleus integrity; field source from the soft-body center.

**New (Phase B — grid + small organelles):**
- `src/cell/cpm-deform-grid.ts` — pure deforming-grid occupant manager (frame-fractional anchors + containment + spacing).
- `src/cell/cpm-deform-grid.test.ts` — node tests (regroup-on-squeeze, containment, spacing, shift).

**Modified (Phase B):**
- `src/cell/cpm-world-scene.ts` — swap `CpmBuildGrid` → `CpmDeformGrid` for small organelles; B builds into it; render + stress cue.

**Deleted:**
- `src/cell/cpm-organelles.ts` (dead; superseded) — Phase A Task 1.
- `src/cell/cpm-cytoskeleton.ts` (dead; no importers) — Phase A Task 1.
- `src/cell/cpm-build-grid.ts` (retired once `cpm-deform-grid` replaces it) — Phase B.

---

# Phase A — De-risk the nucleus

## Task 1: Remove dead interior experiments

**Files:**
- Delete: `src/cell/cpm-organelles.ts`
- Delete: `src/cell/cpm-cytoskeleton.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (both files are unreferenced — verified: no importers).

- [ ] **Step 1: Confirm both files are unreferenced**

Run: `grep -rn "cpm-organelles\|cpm-cytoskeleton" src` (Grep tool, pattern `cpm-organelles|cpm-cytoskeleton`)
Expected: no matches.

- [ ] **Step 2: Delete the files**

```bash
git rm src/cell/cpm-organelles.ts src/cell/cpm-cytoskeleton.ts
```

- [ ] **Step 3: Type-check still passes**

Run: `npx tsc --noEmit`
Expected: exits 0 (no missing-module errors).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove dead organelle/cytoskeleton experiments"
```

---

## Task 2: Pure soft body (`cpm-soft-body.ts`)

**Files:**
- Create: `src/cell/cpm-soft-body.ts`
- Test: `src/cell/cpm-soft-body.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface SoftBodyConfig { nodeCount: number; restRadius: number; posStiffness: number; shapeStiffness: number; areaStiffness: number; damping: number; maxSpeed: number; }`
  - `const DEFAULT_NUCLEUS_SOFT_BODY: SoftBodyConfig`
  - `class CpmSoftBody` with: `constructor(cx: number, cy: number, cfg: SoftBodyConfig)`; `readonly nodes: {x:number;y:number;vx:number;vy:number}[]`; `readonly area0: number`; `center(): {x:number;y:number}`; `area(): number`; `step(target: {x:number;y:number}, inside: (x:number,y:number)=>boolean): void`; `footprint(): Array<[number,number]>`; `exposedFraction(inside:(x:number,y:number)=>boolean): number`; `ovalness(): number`; `shift(dx:number,dy:number): void`.

- [ ] **Step 1: Write the failing test**

Create `src/cell/cpm-soft-body.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CpmSoftBody, DEFAULT_NUCLEUS_SOFT_BODY } from "./cpm-soft-body.ts";

const everywhere = () => true;

test("recenters toward its target after displacement", () => {
  // Body built off-target; with no confinement it should drift to the target.
  const b = new CpmSoftBody(60, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  for (let i = 0; i < 300; i++) b.step({ x: 50, y: 50 }, everywhere);
  const c = b.center();
  assert.ok(Math.abs(c.x - 50) < 1.5, `center.x=${c.x}`);
  assert.ok(Math.abs(c.y - 50) < 1.5, `center.y=${c.y}`);
});

test("preserves area and oozes oval when squeezed into a channel", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  // A vertical channel narrower than the body: |x-50| <= 4 (width 9 < diameter 14).
  const channel = (x: number, _y: number) => Math.abs(x - 50) <= 4;
  for (let i = 0; i < 400; i++) b.step({ x: 50, y: 50 }, channel);
  const area = b.area();
  // Area held within tolerance (soft preservation, not rigid).
  assert.ok(area > 0.6 * b.area0, `area=${area} area0=${b.area0}`);
  assert.ok(area < 1.6 * b.area0, `area=${area} area0=${b.area0}`);
  // Forced narrow horizontally -> taller than wide (oozed oval).
  assert.ok(b.ovalness() > 1.4, `ovalness=${b.ovalness()}`);
});

test("footprint area is close to the disc area", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  const fp = b.footprint();
  const r = DEFAULT_NUCLEUS_SOFT_BODY.restRadius;
  const expected = Math.PI * r * r;
  assert.ok(Math.abs(fp.length - expected) < expected * 0.45, `fp=${fp.length} ~ ${expected}`);
});

test("exposedFraction is 0 when fully contained, positive when over-confined", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  assert.equal(b.exposedFraction(everywhere), 0);
  const slit = (x: number, _y: number) => Math.abs(x - 50) <= 2; // width 5 << body
  // One step so the body hasn't fully conformed yet -> footprint pokes out.
  b.step({ x: 50, y: 50 }, slit);
  assert.ok(b.exposedFraction(slit) > 0.15, `exposed=${b.exposedFraction(slit)}`);
});

test("shift translates every node", () => {
  const b = new CpmSoftBody(50, 50, DEFAULT_NUCLEUS_SOFT_BODY);
  const before = b.center();
  b.shift(10, -4);
  const after = b.center();
  assert.ok(Math.abs(after.x - (before.x + 10)) < 1e-6);
  assert.ok(Math.abs(after.y - (before.y - 4)) < 1e-6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/cell/cpm-soft-body.test.ts`
Expected: FAIL — cannot find module `./cpm-soft-body.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/cell/cpm-soft-body.ts`:

```ts
// CpmSoftBody — a controlled, area-preserving deformable body for a BIG organelle
// (e.g. the nucleus). It is NOT a CPM cell. It is a ring of mass-spring nodes
// that (1) is rigidly pulled toward a cytoskeletal-force TARGET so it recenters on
// its own, (2) holds a smooth round rest shape and its enclosed area, and (3) is
// squished by the surrounding membrane via a CONTAINMENT predicate — so it oozes
// oval through a tight gap. It reports its footprint and how much of that
// footprint is currently exposed (outside the host), which drives the squeeze
// bottleneck and the confinement-rupture death mechanic.
//
// Pure: it knows nothing about CPM. The host passes `inside(x,y)` (true where its
// cytoplasm currently is). Node-testable.

export interface SoftBodyConfig {
  /** Ring resolution (boundary node count). */
  nodeCount: number;
  /** Rest radius in lattice px (sets target area = pi*r^2). */
  restRadius: number;
  /** Cytoskeletal positioning spring: how hard the whole ring is pulled toward
   *  its target each step (the "recenter" force / baseline cytoskeleton). */
  posStiffness: number;
  /** Restoring force toward a smooth circle of restRadius (shape memory). */
  shapeStiffness: number;
  /** Area-preservation strength (incompressible-ish nucleus). */
  areaStiffness: number;
  /** Velocity damping per step (0..1; lower = more viscous/suspended). */
  damping: number;
  /** Per-step speed cap (lattice px) so it never flies. */
  maxSpeed: number;
}

export const DEFAULT_NUCLEUS_SOFT_BODY: SoftBodyConfig = {
  nodeCount: 16,
  restRadius: 7,
  posStiffness: 0.08,
  shapeStiffness: 0.25,
  areaStiffness: 0.2,
  damping: 0.6,
  maxSpeed: 1.5,
};

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class CpmSoftBody {
  readonly nodes: Node[] = [];
  readonly area0: number;

  constructor(cx: number, cy: number, readonly cfg: SoftBodyConfig) {
    const n = cfg.nodeCount;
    const r = cfg.restRadius;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.nodes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0 });
    }
    this.area0 = Math.PI * r * r;
  }

  center(): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const nd of this.nodes) {
      sx += nd.x;
      sy += nd.y;
    }
    const n = this.nodes.length;
    return { x: sx / n, y: sy / n };
  }

  /** Enclosed polygon area (shoelace). */
  area(): number {
    const nd = this.nodes;
    const n = nd.length;
    let a = 0;
    for (let i = 0; i < n; i++) {
      const p = nd[i];
      const q = nd[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  step(target: { x: number; y: number }, inside: (x: number, y: number) => boolean): void {
    const cfg = this.cfg;
    const n = this.nodes.length;
    const c = this.center();

    // Position drive: rigid translation of the whole ring toward the target.
    const tdx = (target.x - c.x) * cfg.posStiffness;
    const tdy = (target.y - c.y) * cfg.posStiffness;

    // Area preservation: radial scale factor about the center toward area0.
    const area = this.area() || 1;
    const scale = Math.sqrt(this.area0 / area);

    for (let i = 0; i < n; i++) {
      const nd = this.nodes[i];
      const rx = nd.x - c.x;
      const ry = nd.y - c.y;
      const rl = Math.hypot(rx, ry) || 1;
      const ux = rx / rl;
      const uy = ry / rl;

      // Shape memory: pull toward a circle of restRadius along its radial.
      nd.vx += (c.x + ux * cfg.restRadius - nd.x) * cfg.shapeStiffness;
      nd.vy += (c.y + uy * cfg.restRadius - nd.y) * cfg.shapeStiffness;

      // Neighbor smoothing: pull toward the midpoint of its two ring neighbors.
      const prev = this.nodes[(i - 1 + n) % n];
      const next = this.nodes[(i + 1) % n];
      nd.vx += ((prev.x + next.x) / 2 - nd.x) * cfg.shapeStiffness * 0.3;
      nd.vy += ((prev.y + next.y) / 2 - nd.y) * cfg.shapeStiffness * 0.3;

      // Area preservation along the radial.
      nd.vx += (c.x + rx * scale - nd.x) * cfg.areaStiffness;
      nd.vy += (c.y + ry * scale - nd.y) * cfg.areaStiffness;

      // Position drive.
      nd.vx += tdx;
      nd.vy += tdy;
    }

    // Integrate with damping + speed cap.
    for (const nd of this.nodes) {
      nd.vx *= cfg.damping;
      nd.vy *= cfg.damping;
      const sp = Math.hypot(nd.vx, nd.vy);
      if (sp > cfg.maxSpeed) {
        nd.vx = (nd.vx / sp) * cfg.maxSpeed;
        nd.vy = (nd.vy / sp) * cfg.maxSpeed;
      }
      nd.x += nd.vx;
      nd.y += nd.vy;
    }

    // Containment: any node outside host cytoplasm is walked back inward toward
    // the center until inside (the membrane squishing the body) and its outward
    // velocity is bled off so it rests against the wall instead of re-poking.
    const c2 = this.center();
    for (const nd of this.nodes) {
      if (inside(Math.round(nd.x), Math.round(nd.y))) continue;
      let dx = c2.x - nd.x;
      let dy = c2.y - nd.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      let guard = 0;
      while (guard++ < 40 && !inside(Math.round(nd.x), Math.round(nd.y))) {
        nd.x += dx;
        nd.y += dy;
      }
      nd.vx *= 0.3;
      nd.vy *= 0.3;
    }
  }

  /** Rasterize the body polygon into footprint lattice cells (even-odd scanline). */
  footprint(): Array<[number, number]> {
    const nd = this.nodes;
    const n = nd.length;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of nd) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const out: Array<[number, number]> = [];
    const y0 = Math.floor(minY);
    const y1 = Math.ceil(maxY);
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = nd[i];
        const b = nd[(i + 1) % n];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const t = (y - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xl = Math.round(xs[k]);
        const xr = Math.round(xs[k + 1]);
        for (let x = xl; x <= xr; x++) out.push([x, y]);
      }
    }
    return out;
  }

  /** Fraction of the footprint NOT covered by host cytoplasm (0..1). */
  exposedFraction(inside: (x: number, y: number) => boolean): number {
    const fp = this.footprint();
    if (fp.length === 0) return 0;
    let exposed = 0;
    for (const [x, y] of fp) if (!inside(x, y)) exposed++;
    return exposed / fp.length;
  }

  /** Long-axis / short-axis bbox ratio (>= 1). The visible "ooze" stress cue. */
  ovalness(): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const nd of this.nodes) {
      if (nd.x < minX) minX = nd.x;
      if (nd.x > maxX) maxX = nd.x;
      if (nd.y < minY) minY = nd.y;
      if (nd.y > maxY) maxY = nd.y;
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    return Math.max(w, h) / Math.min(w, h);
  }

  /** Translate every node (call on lattice recentering so the body rides along). */
  shift(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    for (const nd of this.nodes) {
      nd.x += dx;
      nd.y += dy;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/cell/cpm-soft-body.test.ts`
Expected: PASS — all 5 tests pass. (If "recenters" is borderline, it indicates posStiffness/damping need a nudge — adjust within `DEFAULT_NUCLEUS_SOFT_BODY` and re-run; do not loosen the assertion.)

- [ ] **Step 5: Commit**

```bash
git add src/cell/cpm-soft-body.ts src/cell/cpm-soft-body.test.ts
git commit -m "feat: area-preserving soft body for big organelles (nucleus)"
```

---

## Task 3: Pure footprint cost (`footprint-cost.ts`)

**Files:**
- Create: `src/cell/footprint-cost.ts`
- Test: `src/cell/footprint-cost.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `function footprintDeltaH(mark: Uint8Array, hostId: number, tgt_i: number, src_type: number, tgt_type: number, lambda: number): number`.

- [ ] **Step 1: Write the failing test**

Create `src/cell/footprint-cost.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { footprintDeltaH } from "./footprint-cost.ts";

const HOST = 1;
const ENEMY = 0; // background
const LAMBDA = 30;

test("no cost off the footprint", () => {
  const mark = new Uint8Array(4); // none marked
  assert.equal(footprintDeltaH(mark, HOST, 2, ENEMY, HOST, LAMBDA), 0);
});

test("penalizes removing host cytoplasm from a footprint pixel", () => {
  const mark = new Uint8Array([0, 1, 0, 0]);
  // pixel 1 is footprint, currently host (tgt_type=HOST), would become bg (src_type=0)
  assert.equal(footprintDeltaH(mark, HOST, 1, 0, HOST, LAMBDA), LAMBDA);
});

test("rewards covering a footprint pixel with host cytoplasm", () => {
  const mark = new Uint8Array([0, 1, 0, 0]);
  // pixel 1 is footprint, currently bg (tgt_type=0), would become host (src_type=HOST)
  assert.equal(footprintDeltaH(mark, HOST, 1, HOST, 0, LAMBDA), -LAMBDA);
});

test("no cost for host->host or bg->bg on a footprint pixel", () => {
  const mark = new Uint8Array([0, 1, 0, 0]);
  assert.equal(footprintDeltaH(mark, HOST, 1, HOST, HOST, LAMBDA), 0);
  assert.equal(footprintDeltaH(mark, HOST, 1, 0, 0, LAMBDA), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/cell/footprint-cost.test.ts`
Expected: FAIL — cannot find module `./footprint-cost.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/cell/footprint-cost.ts`:

```ts
// footprint-cost.ts — pure deltaH math for the footprint-coverage coupling, the
// ONLY thing the CPM membrane needs to know about a big organelle. The host
// should keep cytoplasm over each big organelle's footprint:
//   - a copy attempt that REMOVES host cytoplasm from a footprint pixel costs
//     +lambda (resists retracting off the organelle -> squeeze BOTTLENECK),
//   - one that COVERS a footprint pixel with host is rewarded -lambda
//     (membrane self-heals over the organelle),
//   - everything else is free.
// Keeping this pure lets us node-test the coupling without a live CPM.

export function footprintDeltaH(
  mark: Uint8Array,
  hostId: number,
  tgt_i: number,
  src_type: number,
  tgt_type: number,
  lambda: number
): number {
  if (mark[tgt_i] !== 1) return 0;
  if (tgt_type === hostId && src_type !== hostId) return lambda; // removing host
  if (tgt_type !== hostId && src_type === hostId) return -lambda; // covering with host
  return 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/cell/footprint-cost.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cell/footprint-cost.ts src/cell/footprint-cost.test.ts
git commit -m "feat: pure footprint-coverage deltaH cost"
```

---

## Task 4: Footprint constraint glue + sim registration

**Files:**
- Create: `src/cell/cpm-footprint-constraint.ts`
- Modify: `src/cell/cpm-simulation.ts`

**Interfaces:**
- Consumes: `footprintDeltaH` (Task 3); `SoftConstraint`, `CPM`, `IndexCoordinate`, `CellId` from `../vendor/artistoo`; `CpmSimulation`.
- Produces:
  - `class CpmFootprintConstraint extends SoftConstraint` with `constructor(field: number)`, `setFootprint(hostId: CellId, cells: Iterable<[number,number]>, field: number, lambda: number): void`, `deltaH(src_i, tgt_i, src_type, tgt_type): number`.
  - On `CpmSimulation`: `setBigOrganelleFootprint(hostId: CellId, cells: Iterable<[number,number]>, lambda: number): void` and `clearBigOrganelleFootprint(): void`.

- [ ] **Step 1: Write the constraint**

Create `src/cell/cpm-footprint-constraint.ts`:

```ts
// CpmFootprintConstraint — a fork extension of Artistoo. The single soft link
// between the CPM membrane and the big-organelle soft bodies: it holds a mask of
// the organelles' current footprint pixels (rasterized each frame by the soft
// bodies) and penalizes the host for retracting cytoplasm off them / rewards
// covering them. From this one coupling: squeeze narrow -> the cell must keep
// cytoplasm over the (incompressible) nucleus -> BOTTLENECK; force it narrower
// than the nucleus can deform -> footprint exposed -> the manager raises stress
// to RUPTURE. The cost math is the node-tested `footprintDeltaH`.

import {
  SoftConstraint,
  type IndexCoordinate,
  type CellId,
} from "../vendor/artistoo";
import { footprintDeltaH } from "./footprint-cost";

export class CpmFootprintConstraint extends SoftConstraint {
  private mark: Uint8Array;
  private hostId = 0;
  private lambda = 0;

  constructor(field: number) {
    super({});
    this.mark = new Uint8Array(field * field);
  }

  /** Replace the footprint mask for this frame (all big organelles share one
   *  host = the player, so they accumulate into one mask). lambda=0 disables. */
  setFootprint(
    hostId: CellId,
    cells: Iterable<[number, number]>,
    field: number,
    lambda: number
  ): void {
    this.mark.fill(0);
    for (const [x, y] of cells) {
      if (x >= 0 && x < field && y >= 0 && y < field) this.mark[y * field + x] = 1;
    }
    this.hostId = hostId;
    this.lambda = lambda;
  }

  deltaH(
    _src_i: IndexCoordinate,
    tgt_i: IndexCoordinate,
    src_type: CellId,
    tgt_type: CellId
  ): number {
    if (this.lambda === 0) return 0;
    return footprintDeltaH(
      this.mark,
      this.hostId,
      tgt_i as unknown as number,
      src_type,
      tgt_type,
      this.lambda
    );
  }
}
```

- [ ] **Step 2: Register it in the simulation**

In `src/cell/cpm-simulation.ts`, add the import next to the other constraint import (`PerCellAttractionConstraint`):

```ts
import { PerCellAttractionConstraint } from "./per-cell-attraction-constraint";
import { CpmFootprintConstraint } from "./cpm-footprint-constraint";
```

Add a field next to `private readonly attraction: PerCellAttractionConstraint;`:

```ts
  private readonly attraction: PerCellAttractionConstraint;
  private readonly footprint: CpmFootprintConstraint;
```

In the constructor, right after `this.cpm.add(this.attraction);`, add:

```ts
    // The single coupling between the CPM membrane and the big-organelle soft
    // bodies (nucleus): the host is penalized for not covering their footprint.
    this.footprint = new CpmFootprintConstraint(this.field);
    this.cpm.add(this.footprint);
```

- [ ] **Step 3: Add the sim accessors**

In `src/cell/cpm-simulation.ts`, in the "compartments" section (after `attractCellTo`), add:

```ts
  /** Set the big-organelle footprint mask the membrane must keep covered this
   *  frame (rasterized by the soft bodies). `lambda` sets the bottleneck/rupture
   *  resistance; 0 disables. */
  setBigOrganelleFootprint(
    hostId: CellId,
    cells: Iterable<[number, number]>,
    lambda: number
  ): void {
    this.footprint.setFootprint(hostId, cells, this.field, lambda);
  }

  /** Clear the footprint coupling (no big organelles this frame). */
  clearBigOrganelleFootprint(): void {
    this.footprint.setFootprint(0, [], this.field, 0);
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/cell/cpm-footprint-constraint.ts src/cell/cpm-simulation.ts
git commit -m "feat: wire footprint-coverage constraint into the CPM sim"
```

---

## Task 5: Big-organelle manager (`cpm-big-organelles.ts`)

**Files:**
- Create: `src/cell/cpm-big-organelles.ts`

**Interfaces:**
- Consumes: `CpmSoftBody`, `SoftBodyConfig`, `DEFAULT_NUCLEUS_SOFT_BODY` (Task 2); `CpmSimulation` (`centroidLattice`, `ownerAtLattice`, `setBigOrganelleFootprint`, `clearBigOrganelleFootprint`); `CellId`.
- Produces:
  - `interface BigOrganelle { body: CpmSoftBody; type: string; color: number; stress: number; }`
  - `class CpmBigOrganelles` with: `constructor(sim: CpmSimulation, getHostId: () => CellId, footprintLambda?: number)`; `add(type: string, color: number, cx: number, cy: number, cfg?: SoftBodyConfig): BigOrganelle`; `clear(): void`; `update(steerDir: {x:number;y:number} | null, shiftX: number, shiftY: number): void`; `readonly organelles: BigOrganelle[]`; `maxStress(): number`; `consumeRupture(): BigOrganelle | null`.

- [ ] **Step 1: Write the manager**

Create `src/cell/cpm-big-organelles.ts`:

```ts
// CpmBigOrganelles — owns the cell's BIG organelles (the nucleus first; the same
// machinery takes a second type). Each is a CpmSoftBody positioned by a
// cytoskeletal-force target (the host's deep center, biased slightly to the rear
// while steering — actin cap / dynein), contained + deformed by the membrane, and
// coupled to CPM by feeding the union of their footprints to the sim's footprint
// constraint. It accumulates CONFINEMENT STRESS from sustained footprint exposure
// / extreme ovalness and reports a RUPTURE when a body's stress saturates — the
// "you squeezed too hard" death payoff. Soft bodies are pure; this is the glue.

import {
  CpmSoftBody,
  DEFAULT_NUCLEUS_SOFT_BODY,
  type SoftBodyConfig,
} from "./cpm-soft-body";
import type { CpmSimulation } from "./cpm-simulation";
import type { CellId } from "../vendor/artistoo";

export interface BigOrganelle {
  body: CpmSoftBody;
  type: string;
  color: number;
  /** Accumulated confinement stress 0..1; 1 = ruptured. */
  stress: number;
}

/** Footprint exposure above this (sustained) raises stress. */
const EXPOSE_THRESHOLD = 0.12;
/** Ovalness above this also raises stress (over-squeezed even if still covered). */
const OVAL_THRESHOLD = 2.2;
/** Stress per frame while over-confined / recovering otherwise. */
const STRESS_RAMP = 0.04;
const STRESS_RECOVER = 0.02;
/** How far behind the heading the target is nudged while steering (px). */
const REAR_BIAS = 3;

export class CpmBigOrganelles {
  readonly organelles: BigOrganelle[] = [];
  private ruptured: BigOrganelle | null = null;

  constructor(
    private readonly sim: CpmSimulation,
    private readonly getHostId: () => CellId,
    private readonly footprintLambda = 30
  ) {}

  add(
    type: string,
    color: number,
    cx: number,
    cy: number,
    cfg: SoftBodyConfig = DEFAULT_NUCLEUS_SOFT_BODY
  ): BigOrganelle {
    const o: BigOrganelle = { body: new CpmSoftBody(cx, cy, cfg), type, color, stress: 0 };
    this.organelles.push(o);
    return o;
  }

  clear(): void {
    this.organelles.length = 0;
    this.ruptured = null;
    this.sim.clearBigOrganelleFootprint();
  }

  /** Step every body, refresh the footprint coupling, accumulate stress.
   *  `steerDir` is the unit-ish direction the player is steering (for the rear
   *  bias), or null at rest. `shiftX/shiftY` come from streamAround so the bodies
   *  ride lattice recentering. */
  update(steerDir: { x: number; y: number } | null, shiftX: number, shiftY: number): void {
    const host = this.getHostId();
    const c = this.sim.centroidLattice(host);
    if (!c) {
      this.sim.clearBigOrganelleFootprint();
      return;
    }
    const inside = (x: number, y: number) => this.sim.ownerAtLattice(x, y) === host;

    // Target = deep center, nudged to the rear while steering (organic trailing).
    let tx = c.x;
    let ty = c.y;
    if (steerDir) {
      const d = Math.hypot(steerDir.x, steerDir.y) || 1;
      tx -= (steerDir.x / d) * REAR_BIAS;
      ty -= (steerDir.y / d) * REAR_BIAS;
    }
    const target = { x: tx, y: ty };

    const footprintCells: Array<[number, number]> = [];
    for (const o of this.organelles) {
      o.body.shift(shiftX, shiftY);
      o.body.step(target, inside);
      for (const cell of o.body.footprint()) footprintCells.push(cell);

      const exposed = o.body.exposedFraction(inside);
      const oval = o.body.ovalness();
      if (exposed > EXPOSE_THRESHOLD || oval > OVAL_THRESHOLD) {
        o.stress = Math.min(1, o.stress + STRESS_RAMP);
      } else {
        o.stress = Math.max(0, o.stress - STRESS_RECOVER);
      }
      if (o.stress >= 1 && !this.ruptured) this.ruptured = o;
    }

    if (footprintCells.length > 0) {
      this.sim.setBigOrganelleFootprint(host, footprintCells, this.footprintLambda);
    } else {
      this.sim.clearBigOrganelleFootprint();
    }
  }

  /** Highest stress across all big organelles (for the HUD warning ramp). */
  maxStress(): number {
    let m = 0;
    for (const o of this.organelles) if (o.stress > m) m = o.stress;
    return m;
  }

  /** If a body ruptured this frame, return + remove it (one-shot); else null. */
  consumeRupture(): BigOrganelle | null {
    const r = this.ruptured;
    if (!r) return null;
    this.ruptured = null;
    const i = this.organelles.indexOf(r);
    if (i >= 0) this.organelles.splice(i, 1);
    return r;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/cell/cpm-big-organelles.ts
git commit -m "feat: big-organelle manager (soft bodies + footprint + stress)"
```

---

## Task 6: Add `"ruptured"` death reason

**Files:**
- Modify: `src/cell/cpm-rules.ts:14`

**Interfaces:**
- Consumes: nothing.
- Produces: `type DeathReason = "fragmented" | "dissolved" | "apoptosis" | "ruptured"`.

- [ ] **Step 1: Extend the union**

In `src/cell/cpm-rules.ts`, change:

```ts
export type DeathReason = "fragmented" | "dissolved" | "apoptosis";
```

to:

```ts
export type DeathReason = "fragmented" | "dissolved" | "apoptosis" | "ruptured";
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 (the scene's `onCellDeath` switch already handles arbitrary reasons via its template string).

- [ ] **Step 3: Commit**

```bash
git add src/cell/cpm-rules.ts
git commit -m "feat: add 'ruptured' death reason for nucleus confinement"
```

---

## Task 7: Wire the nucleus soft body into the scene

**Files:**
- Modify: `src/cell/cpm-world-scene.ts`

**Interfaces:**
- Consumes: `CpmBigOrganelles` (Task 5); existing `CpmBuildGrid` stays for SMALL organelles this Phase.
- Produces: an in-scene nucleus soft body that recenters, bottlenecks, and ruptures; `window.__cpm.nucleus()` returning `{cx,cy,exposed,oval,stress}` for the GATE.

- [ ] **Step 1: Import the manager and remove the old nucleus constant usage**

In `src/cell/cpm-world-scene.ts`, add the import after the `CpmBuildGrid` import:

```ts
import { CpmBuildGrid } from "./cpm-build-grid";
import { CpmBigOrganelles } from "./cpm-big-organelles";
```

Add a field next to `private buildGrid!: CpmBuildGrid;`:

```ts
  private buildGrid!: CpmBuildGrid;
  private bigOrganelles!: CpmBigOrganelles;
```

- [ ] **Step 2: Create the nucleus soft body in `create()`**

In `create()`, replace this block:

```ts
    this.buildGrid = new CpmBuildGrid(this.sim, () => this.playerId, 5);
    this.interiorGfx = this.add.graphics().setDepth(12);
    const pc = this.sim.centroidLattice(this.playerId);
    if (pc) {
      const N = CpmWorldScene.NUCLEUS;
      this.buildGrid.place(N.type, N.color, N.radius, pc.x, pc.y);
    }
```

with:

```ts
    this.buildGrid = new CpmBuildGrid(this.sim, () => this.playerId, 5);
    this.interiorGfx = this.add.graphics().setDepth(12);
    // The nucleus is now a controlled soft body (not a grid slot): it recenters
    // on its own, bottlenecks the cell at tight gaps, and ruptures if over-squeezed.
    this.bigOrganelles = new CpmBigOrganelles(this.sim, () => this.playerId);
    const pc = this.sim.centroidLattice(this.playerId);
    if (pc) {
      const N = CpmWorldScene.NUCLEUS;
      this.bigOrganelles.add(N.type, N.color, pc.x, pc.y);
    }
```

- [ ] **Step 3: Step the manager + handle rupture in `update()`**

In `update()`, find the build-grid update line:

```ts
    // Build grid: relocate any structure whose slot was squeezed out of cytoplasm.
    this.buildGrid.update();
```

and insert immediately AFTER it:

```ts
    // Big organelles (nucleus): step the soft bodies, refresh the footprint
    // coupling, accumulate confinement stress. Pass the steer direction so the
    // nucleus trails slightly, and the recenter shift so it rides the world.
    let steerDir: { x: number; y: number } | null = null;
    if (this.steering) {
      const c = this.sim.centroidLattice(this.playerId);
      const ptr = this.input.activePointer;
      const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
      if (c) steerDir = { x: lx - c.x, y: ly - c.y };
    }
    this.bigOrganelles.update(steerDir, shiftX, shiftY);
    const burst = this.bigOrganelles.consumeRupture();
    if (burst) {
      // The nucleus ruptured under confinement — the player dies (the toy's fail
      // state for forcing too tight a gap).
      this.onCellDeath(this.playerId, "ruptured");
    }
```

Note: `shiftX`/`shiftY` are already destructured from `streamAround` earlier in `update()`.

- [ ] **Step 4: Source the molecular field from the nucleus soft body**

In `update()`, replace this block:

```ts
    const nuc = this.buildGrid.occupants[0];
    if (nuc) {
      const [nx, ny] = this.buildGrid.occupantLattice(nuc);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        this.signal.addSource(
          nx + Math.cos(a) * (nuc.radius + 2),
          ny + Math.sin(a) * (nuc.radius + 2),
          0.6
        );
      }
    }
```

with:

```ts
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
```

- [ ] **Step 5: Reset the nucleus on respawn**

In `respawnPlayer()`, replace:

```ts
    // Fresh interior: just a nucleus.
    this.buildGrid.clear();
    const pc = this.sim.centroidLattice(this.playerId);
    const N = CpmWorldScene.NUCLEUS;
    if (pc) this.buildGrid.place(N.type, N.color, N.radius, pc.x, pc.y);
```

with:

```ts
    // Fresh interior: just a nucleus (a new soft body).
    this.buildGrid.clear();
    this.bigOrganelles.clear();
    const pc = this.sim.centroidLattice(this.playerId);
    const N = CpmWorldScene.NUCLEUS;
    if (pc) this.bigOrganelles.add(N.type, N.color, pc.x, pc.y);
```

- [ ] **Step 6: Render the oozing nucleus and expose the GATE handle**

In `drawInterior()`, after the organelle-occupant loop (the `for (const o of this.buildGrid.occupants)` block), add a nucleus render pass:

```ts
    // The nucleus soft body: fill its polygon (oozes/ovals visibly) and tint the
    // outline toward red as confinement stress rises (the rupture warning ramp).
    const nucleus = this.bigOrganelles.organelles[0];
    if (nucleus) {
      const nodes = nucleus.body.nodes;
      const stress = nucleus.stress;
      const pts: Phaser.Math.Vector2[] = [];
      for (const nd of nodes) {
        const [wx, wy] = this.sim.latticeToWorld(nd.x, nd.y);
        pts.push(new Phaser.Math.Vector2(wx, wy));
      }
      g.fillStyle(nucleus.color, 0.9);
      g.lineStyle(Math.max(1, s * 0.35), stress > 0.01 ? 0xff5d5d : 0x2a1a4a, 0.7 + 0.3 * stress);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
      // Nucleolus at the (deforming) center.
      const nc = nucleus.body.center();
      const [cwx, cwy] = this.sim.latticeToWorld(nc.x, nc.y);
      g.fillStyle(0x5b2f9e, 0.9);
      g.fillCircle(cwx, cwy, nucleus.body.cfg.restRadius * s * 0.35);
    }
```

Then in `create()`, inside the `if (import.meta.env.DEV)` block, add a `nucleus` reader to `__cpm`:

```ts
        deaths: () => this.deaths,
        nucleus: () => {
          const n = this.bigOrganelles.organelles[0];
          if (!n) return null;
          const host = this.playerId;
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
```

- [ ] **Step 7: Show nucleus integrity in the HUD**

In `update()`, change the HUD `setText` call to include nucleus integrity. Replace:

```ts
    const hp = Math.round(this.rules.healthFraction(this.playerId) * 100);
    const stressed = this.buildGrid.displacedCount;
    this.hud.setText(
      `CPM world — ${combatStatus}   LMB move · RMB engulf · B build@cursor   ` +
        `hp ${hp}   organelles ${this.buildGrid.occupants.length}` +
        (stressed > 0 ? ` (${stressed} displaced!)` : "") +
        `   nutrients ${this.combat.nutrients}`
    );
```

with:

```ts
    const hp = Math.round(this.rules.healthFraction(this.playerId) * 100);
    const stressed = this.buildGrid.displacedCount;
    const nucInteg = Math.round((1 - this.bigOrganelles.maxStress()) * 100);
    this.hud.setText(
      `CPM world — ${combatStatus}   LMB move · RMB engulf · B build@cursor   ` +
        `hp ${hp}   nucleus ${nucInteg}%` +
        `   organelles ${this.buildGrid.occupants.length}` +
        (stressed > 0 ? ` (${stressed} displaced!)` : "") +
        `   nutrients ${this.combat.nutrients}`
    );
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/cell/cpm-world-scene.ts
git commit -m "feat: nucleus soft body in-scene (ooze, bottleneck, rupture, HUD)"
```

---

## Task 8: GATE — verify the nucleus end-to-end (single in-game check)

**Files:** none (verification only).

**Interfaces:**
- Consumes: `window.__cpm.nucleus()`, `window.__cpm.sim`, `window.__cpm.getPlayerId()`.
- Produces: a pass/fail judgment on the de-risk crux (recenter, bottleneck, rupture). If it fails, return to systematic-debugging on the soft body / footprint tuning before Phase B.

This is the **one** browser interaction in Phase A. The dev server is already running on the user's machine (do NOT start one). Use a single `mcp__playwright__browser_navigate` to the app, then a single `mcp__playwright__browser_evaluate` that runs the whole scripted check and returns a JSON verdict — no screenshots, no reload loops.

- [ ] **Step 1: Navigate to the running app**

Run (Playwright): `browser_navigate` to `http://localhost:5173`.
Expected: the CPM world scene loads; `window.__cpm` is defined.

- [ ] **Step 2: Run the scripted verdict**

Run (Playwright): `browser_evaluate` with this function body. It (a) records nucleus-vs-centroid distance while the cell is dragged, expecting the nucleus to track near center (recenter), then (b) reads exposure/stress. It uses the sim's steering API directly so it needs no mouse simulation.

```js
async () => {
  const h = window.__cpm;
  if (!h) return { ok: false, why: "no __cpm" };
  const sim = h.sim;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // (a) Recenter test: steer the player around for ~3s, sample nucleus offset
  //     from the host centroid; it should stay modest (not pinned to the rear
  //     membrane the way a CPM inclusion did).
  let maxOffset = 0;
  for (let k = 0; k < 60; k++) {
    const pid = h.getPlayerId();
    const c = sim.centroidLattice(pid);
    // Drive in a slow circle around the centroid.
    const a = (k / 60) * Math.PI * 2;
    if (c) sim.steerCell(pid, c.x + Math.cos(a) * 40, c.y + Math.sin(a) * 40);
    await sleep(50);
    const n = h.nucleus();
    const c2 = sim.centroidLattice(h.getPlayerId());
    if (n && c2) {
      const off = Math.hypot(n.cx - c2.x, n.cy - c2.y);
      if (off > maxOffset) maxOffset = off;
    }
  }
  const n1 = h.nucleus();

  return {
    ok: true,
    maxOffsetFromCenter: Math.round(maxOffset),
    nucleus: n1,
    // Heuristic pass: the nucleus never strays to the far membrane while crawling.
    recenters: maxOffset < 30,
  };
};
```

Expected: `{ ok: true, recenters: true, maxOffsetFromCenter: <~10-25>, nucleus: { exposed: 0, stress: 0, ... } }`.
- `recenters: true` confirms the core failure (drifts to membrane, won't return) is fixed.
- `exposed`/`stress` near 0 at normal size confirms no false rupture at rest.

- [ ] **Step 3: Judge feel (manual, brief)**

Ask the user to drive the cell into a tight gap between two enemies (or off the play area edge) and confirm by eye: the nucleus **bottlenecks** the cell, **oozes oval**, and **ruptures** (red ramp → death FX) only when forced too far. This is the toy gate — if the bottleneck/ooze/rupture does not read as satisfying, stop and tune `footprintLambda`, `EXPOSE_THRESHOLD`, and the soft-body stiffnesses before Phase B.

- [ ] **Step 4: No commit** (verification only). Record the verdict in the task notes and proceed only if recenter + no-false-rupture pass.

---

# Phase B — Deforming grid + small organelles

## Task 9: Pure deforming grid (`cpm-deform-grid.ts`)

**Files:**
- Create: `src/cell/cpm-deform-grid.ts`
- Test: `src/cell/cpm-deform-grid.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface Frame { cx: number; cy: number; halfW: number; halfH: number; }`
  - `interface GridOccupant { type: string; color: number; radius: number; fx: number; fy: number; x: number; y: number; compressed: number; }`
  - `interface DeformGridConfig { anchorStiffness: number; spacing: number; spacingStiffness: number; cytoskeleton: number; }`
  - `const DEFAULT_DEFORM_GRID: DeformGridConfig`
  - `class CpmDeformGrid` with `constructor(cfg?: DeformGridConfig)`; `readonly occupants: GridOccupant[]`; `add(type,color,radius,frame,lx,ly): GridOccupant`; `clear(): void`; `step(frame: Frame, inside: (x,y)=>boolean): void`; `shift(dx,dy): void`; `get compressedCount(): number`.

- [ ] **Step 1: Write the failing test**

Create `src/cell/cpm-deform-grid.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CpmDeformGrid, type Frame } from "./cpm-deform-grid.ts";

const everywhere = () => true;

test("occupant anchored in the frame regroups inward when the cell narrows", () => {
  const g = new CpmDeformGrid();
  const wide: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  const o = g.add("ribosome", 0xffffff, 2, wide, 66, 50); // fx ~ +0.8
  for (let i = 0; i < 50; i++) g.step(wide, everywhere);
  const xWide = o.x;
  // Squeeze the cell to a thin strip; the occupant should pull inward toward cx.
  const narrow: Frame = { cx: 50, cy: 50, halfW: 5, halfH: 20 };
  for (let i = 0; i < 80; i++) g.step(narrow, everywhere);
  assert.ok(o.x < xWide - 6, `xWide=${xWide} xNarrow=${o.x}`);
});

test("containment keeps an occupant inside the cytoplasm", () => {
  const g = new CpmDeformGrid();
  const frame: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  // Cytoplasm is only a disc of radius 6 about (50,50); anchor is far out.
  const disc = (x: number, y: number) => Math.hypot(x - 50, y - 50) <= 6;
  const o = g.add("ribosome", 0xffffff, 2, frame, 68, 50);
  for (let i = 0; i < 80; i++) g.step(frame, disc);
  assert.ok(disc(Math.round(o.x), Math.round(o.y)), `outside: ${o.x},${o.y}`);
});

test("two occupants at the same anchor are pushed apart by spacing", () => {
  const g = new CpmDeformGrid();
  const frame: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  const a = g.add("ribosome", 0xffffff, 2, frame, 50, 50);
  const b = g.add("ribosome", 0xffffff, 2, frame, 50, 50);
  for (let i = 0; i < 120; i++) g.step(frame, everywhere);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d > 4, `separation=${d}`);
});

test("shift translates all occupants", () => {
  const g = new CpmDeformGrid();
  const frame: Frame = { cx: 50, cy: 50, halfW: 20, halfH: 20 };
  const o = g.add("ribosome", 0xffffff, 2, frame, 55, 50);
  const x0 = o.x;
  g.shift(7, -3);
  assert.ok(Math.abs(o.x - (x0 + 7)) < 1e-6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/cell/cpm-deform-grid.test.ts`
Expected: FAIL — cannot find module `./cpm-deform-grid.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/cell/cpm-deform-grid.ts`:

```ts
// CpmDeformGrid — the cell's deforming interior grid for the MANY small
// organelles (ribosomes, vesicles, lysosomes; later factory machines). Each
// occupant holds an anchor in the cell's DEFORMING local frame (fractions of the
// bbox half-extents from sim.cellFrame), so it stretches and compresses WITH the
// cell automatically — round cell -> spread out, squeezed to a sliver -> packed
// into a thin strip. Each step it is (1) pulled toward its anchor by the baseline
// cytoskeleton, (2) softly spaced from its neighbors, and (3) kept inside the
// cytoplasm by containment — so under a squeeze they FLOW and REGROUP instead of
// clipping the wall or snapping. The grid can't break; it just re-lays.
//
// Pure: the host passes the current frame + an `inside(x,y)` predicate. The
// `compressed` field (how far an occupant sits from its ideal anchor) is the
// visible stress cue. Node-testable.

export interface Frame {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

export interface GridOccupant {
  type: string;
  color: number;
  radius: number;
  /** Anchor in frame fractions (roughly [-1.2, 1.2]). */
  fx: number;
  fy: number;
  /** Current lattice position. */
  x: number;
  y: number;
  /** 0..1 stress cue: how far it's pushed from its anchor right now. */
  compressed: number;
}

export interface DeformGridConfig {
  /** Spring toward the (deforming) anchor each step. */
  anchorStiffness: number;
  /** Desired clear gap between occupant edges (lattice px). */
  spacing: number;
  /** Mutual-spacing push strength. */
  spacingStiffness: number;
  /** Baseline cytoskeleton multiplier (0..1+; player-upgradeable later). */
  cytoskeleton: number;
}

export const DEFAULT_DEFORM_GRID: DeformGridConfig = {
  anchorStiffness: 0.15,
  spacing: 4,
  spacingStiffness: 0.1,
  cytoskeleton: 1,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class CpmDeformGrid {
  readonly occupants: GridOccupant[] = [];

  constructor(readonly cfg: DeformGridConfig = DEFAULT_DEFORM_GRID) {}

  add(
    type: string,
    color: number,
    radius: number,
    frame: Frame,
    lx: number,
    ly: number
  ): GridOccupant {
    const fx = clamp((lx - frame.cx) / frame.halfW, -1.2, 1.2);
    const fy = clamp((ly - frame.cy) / frame.halfH, -1.2, 1.2);
    const o: GridOccupant = { type, color, radius, fx, fy, x: lx, y: ly, compressed: 0 };
    this.occupants.push(o);
    return o;
  }

  clear(): void {
    this.occupants.length = 0;
  }

  step(frame: Frame, inside: (x: number, y: number) => boolean): void {
    const cfg = this.cfg;
    const k = cfg.anchorStiffness * cfg.cytoskeleton;

    // 1) Spring each occupant toward its anchor in the current (deforming) frame.
    for (const o of this.occupants) {
      const ax = frame.cx + o.fx * frame.halfW;
      const ay = frame.cy + o.fy * frame.halfH;
      o.x += (ax - o.x) * k;
      o.y += (ay - o.y) * k;
    }

    // 2) Soft mutual spacing so they don't pile up (flow/regroup, not overlap).
    const n = this.occupants.length;
    for (let i = 0; i < n; i++) {
      const a = this.occupants[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.occupants[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + b.radius + cfg.spacing;
        if (d > 1e-3 && d < min) {
          const f = (min - d) * cfg.spacingStiffness;
          dx /= d;
          dy /= d;
          a.x -= dx * f;
          a.y -= dy * f;
          b.x += dx * f;
          b.y += dy * f;
        }
      }
    }

    // 3) Containment + stress cue.
    for (const o of this.occupants) {
      if (!inside(Math.round(o.x), Math.round(o.y))) {
        let dx = frame.cx - o.x;
        let dy = frame.cy - o.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d;
        dy /= d;
        let guard = 0;
        while (guard++ < 80 && !inside(Math.round(o.x), Math.round(o.y))) {
          o.x += dx;
          o.y += dy;
        }
      }
      const ax = frame.cx + o.fx * frame.halfW;
      const ay = frame.cy + o.fy * frame.halfH;
      o.compressed = clamp(Math.hypot(o.x - ax, o.y - ay) / (o.radius * 3), 0, 1);
    }
  }

  /** Translate all occupants (lattice recentering). */
  shift(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    for (const o of this.occupants) {
      o.x += dx;
      o.y += dy;
    }
  }

  /** How many occupants are visibly displaced from their anchor (HUD cue). */
  get compressedCount(): number {
    let c = 0;
    for (const o of this.occupants) if (o.compressed > 0.5) c++;
    return c;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/cell/cpm-deform-grid.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cell/cpm-deform-grid.ts src/cell/cpm-deform-grid.test.ts
git commit -m "feat: deforming grid for small organelles (flow/regroup under squeeze)"
```

---

## Task 10: Swap small organelles onto the deforming grid in the scene

**Files:**
- Modify: `src/cell/cpm-world-scene.ts`
- Delete: `src/cell/cpm-build-grid.ts`

**Interfaces:**
- Consumes: `CpmDeformGrid`, `GridOccupant`, `Frame` (Task 9); existing `drawStructure` (adapted to lattice `x,y` + `compressed`).
- Produces: B builds small organelles into the deforming grid; `window.__cpm.occupants()` returns the deform-grid occupants.

- [ ] **Step 1: Replace the import and field**

In `src/cell/cpm-world-scene.ts`, replace:

```ts
import { CpmBuildGrid } from "./cpm-build-grid";
import { CpmBigOrganelles } from "./cpm-big-organelles";
```

with:

```ts
import { CpmDeformGrid } from "./cpm-deform-grid";
import { CpmBigOrganelles } from "./cpm-big-organelles";
```

Replace the field:

```ts
  private buildGrid!: CpmBuildGrid;
  private bigOrganelles!: CpmBigOrganelles;
```

with:

```ts
  private grid!: CpmDeformGrid;
  private bigOrganelles!: CpmBigOrganelles;
```

- [ ] **Step 2: Construct the grid in `create()`**

Replace:

```ts
    this.buildGrid = new CpmBuildGrid(this.sim, () => this.playerId, 5);
    this.interiorGfx = this.add.graphics().setDepth(12);
```

with:

```ts
    this.grid = new CpmDeformGrid();
    this.interiorGfx = this.add.graphics().setDepth(12);
```

- [ ] **Step 3: Build small organelles into the grid (`growOrganelle`)**

Replace `growOrganelle()`'s body:

```ts
  private growOrganelle(): void {
    const c = this.sim.centroidLattice(this.playerId);
    if (!c) return;
    const ptr = this.input.activePointer;
    const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
    const cx = Math.round(lx);
    const cy = Math.round(ly);
    const interior = this.sim.ownerAtLattice(cx, cy) === this.playerId;
    const sx = interior ? cx : Math.round(c.x);
    const sy = interior ? cy : Math.round(c.y);
    const kind = CpmWorldScene.BUILDABLES[this.buildIndex % CpmWorldScene.BUILDABLES.length];
    this.buildIndex++;
    this.buildGrid.place(kind.type, kind.color, kind.radius, sx, sy);
  }
```

with:

```ts
  private growOrganelle(): void {
    const frame = this.sim.cellFrame(this.playerId);
    if (!frame) return;
    const ptr = this.input.activePointer;
    const [lx, ly] = this.sim.worldToLattice(ptr.worldX, ptr.worldY);
    const cx = Math.round(lx);
    const cy = Math.round(ly);
    const interior = this.sim.ownerAtLattice(cx, cy) === this.playerId;
    const sx = interior ? cx : Math.round(frame.cx);
    const sy = interior ? cy : Math.round(frame.cy);
    const kind = CpmWorldScene.BUILDABLES[this.buildIndex % CpmWorldScene.BUILDABLES.length];
    this.buildIndex++;
    this.grid.add(kind.type, kind.color, kind.radius, frame, sx, sy);
  }
```

- [ ] **Step 4: Step the grid in `update()`**

Replace:

```ts
    // Build grid: relocate any structure whose slot was squeezed out of cytoplasm.
    this.buildGrid.update();
```

with:

```ts
    // Deforming grid: small organelles flow/regroup with the cell's current shape.
    const frame = this.sim.cellFrame(this.playerId);
    if (frame) {
      this.grid.shift(shiftX, shiftY);
      this.grid.step(frame, (x, y) => this.sim.ownerAtLattice(x, y) === this.playerId);
    }
```

- [ ] **Step 5: Render the grid occupants from lattice positions**

In `drawInterior()`, replace the valid-slots loop AND the occupant loop:

```ts
    // The buildable interior: faint dots on every cytoplasm slot (this set grows
    // and shrinks with the cell, showing the conforming grid the factory uses).
    g.fillStyle(0xbfefff, 0.06);
    for (const slot of this.buildGrid.validSlots()) {
      const [lx, ly] = this.buildGrid.slotToLattice(c.x, c.y, slot.gx, slot.gy);
      const [wx, wy] = this.sim.latticeToWorld(lx, ly);
      g.fillCircle(wx, wy, s * 0.45);
    }

    // Organelles as distinct, placed structures.
    for (const o of this.buildGrid.occupants) {
      const [lx, ly] = this.buildGrid.occupantLattice(o);
      const [wx, wy] = this.sim.latticeToWorld(lx, ly);
      this.drawStructure(g, o, wx, wy, s);
    }
```

with:

```ts
    // Small organelles as distinct, placed structures on the deforming grid.
    for (const o of this.grid.occupants) {
      const [wx, wy] = this.sim.latticeToWorld(o.x, o.y);
      this.drawStructure(g, o, wx, wy, s);
    }
```

- [ ] **Step 6: Adapt `drawStructure` to the new occupant shape**

`drawStructure` currently keys orientation off `o.gx/o.gy` and dims on `o.displaced`. Replace its signature + the displaced/orientation references:

Change the signature:

```ts
  private drawStructure(
    g: Phaser.GameObjects.Graphics,
    o: { type: string; color: number; radius: number; gx: number; gy: number; displaced: boolean },
    wx: number,
    wy: number,
    s: number
  ): void {
    const r = o.radius * s;
    const alpha = o.displaced ? 0.4 : 0.92;
```

to:

```ts
  private drawStructure(
    g: Phaser.GameObjects.Graphics,
    o: { type: string; color: number; radius: number; x: number; y: number; compressed: number },
    wx: number,
    wy: number,
    s: number
  ): void {
    const r = o.radius * s;
    const alpha = 0.92 - 0.4 * o.compressed;
```

And the mitochondrion orientation line, change:

```ts
        const ang = (((o.gx * 3 + o.gy * 7) % 6) / 6) * Math.PI;
```

to (orient by a stable hash of its lattice position):

```ts
        const ang = (((Math.round(o.x) * 3 + Math.round(o.y) * 7) % 6) / 6) * Math.PI;
```

- [ ] **Step 7: Update respawn + HUD + `__cpm.occupants`**

In `respawnPlayer()`, replace:

```ts
    // Fresh interior: just a nucleus (a new soft body).
    this.buildGrid.clear();
    this.bigOrganelles.clear();
```

with:

```ts
    // Fresh interior: just a nucleus (a new soft body); no small organelles.
    this.grid.clear();
    this.bigOrganelles.clear();
```

In `create()`'s `__cpm` block, replace:

```ts
        occupants: () => this.buildGrid.occupants,
        occupantLattice: (o: unknown) =>
          this.buildGrid.occupantLattice(o as never),
```

with:

```ts
        occupants: () => this.grid.occupants,
```

In `update()`'s HUD block, replace:

```ts
    const stressed = this.buildGrid.displacedCount;
    const nucInteg = Math.round((1 - this.bigOrganelles.maxStress()) * 100);
    this.hud.setText(
      `CPM world — ${combatStatus}   LMB move · RMB engulf · B build@cursor   ` +
        `hp ${hp}   nucleus ${nucInteg}%` +
        `   organelles ${this.buildGrid.occupants.length}` +
        (stressed > 0 ? ` (${stressed} displaced!)` : "") +
        `   nutrients ${this.combat.nutrients}`
    );
```

with:

```ts
    const stressed = this.grid.compressedCount;
    const nucInteg = Math.round((1 - this.bigOrganelles.maxStress()) * 100);
    this.hud.setText(
      `CPM world — ${combatStatus}   LMB move · RMB engulf · B build@cursor   ` +
        `hp ${hp}   nucleus ${nucInteg}%` +
        `   organelles ${this.grid.occupants.length}` +
        (stressed > 0 ? ` (${stressed} squeezed!)` : "") +
        `   nutrients ${this.combat.nutrients}`
    );
```

- [ ] **Step 8: Delete the retired build grid**

```bash
git rm src/cell/cpm-build-grid.ts
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 (no remaining references to `CpmBuildGrid`, `validSlots`, `slotToLattice`, `occupantLattice`, `displacedCount`).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: small organelles on the deforming grid; retire build grid"
```

---

## Task 11: Prove generality — a second big organelle type

**Files:**
- Modify: `src/cell/cpm-world-scene.ts`

**Interfaces:**
- Consumes: `CpmBigOrganelles.add`, `DEFAULT_NUCLEUS_SOFT_BODY` (as a base to derive a smaller config).
- Produces: a second soft body (a large mitochondrion) coexisting with the nucleus — confirms multiple footprints + soft bodies don't fragment the host (the spec's "nucleus, then a second type").

- [ ] **Step 1: Import the soft-body default config**

In `src/cell/cpm-world-scene.ts`, add to the config import block:

```ts
import { DEFAULT_NUCLEUS_SOFT_BODY } from "./cpm-soft-body";
```

- [ ] **Step 2: Seed a second big organelle in `create()`**

Right after the nucleus `this.bigOrganelles.add(N.type, N.color, pc.x, pc.y);` line, add:

```ts
    if (pc) {
      // A second, smaller big organelle (a large mitochondrion) to prove multiple
      // soft bodies + footprints coexist without fragmenting the host.
      this.bigOrganelles.add("mito-big", 0xff9d4d, pc.x + 14, pc.y, {
        ...DEFAULT_NUCLEUS_SOFT_BODY,
        restRadius: 4,
        nodeCount: 12,
      });
    }
```

- [ ] **Step 3: Render every big organelle, not just `[0]`**

In `drawInterior()`, change the nucleus render to loop over all big organelles. Replace:

```ts
    const nucleus = this.bigOrganelles.organelles[0];
    if (nucleus) {
      const nodes = nucleus.body.nodes;
      const stress = nucleus.stress;
```

with:

```ts
    for (const nucleus of this.bigOrganelles.organelles) {
      const nodes = nucleus.body.nodes;
      const stress = nucleus.stress;
```

(The block already closes with the nucleolus draw; the `for` simply replaces the single `if`. Keep the body of the block identical — it references `nucleus`, `nodes`, `stress`, `nc`, `pts` which all stay in-scope per iteration.)

- [ ] **Step 4: Keep the field source on the nucleus only**

The molecular field still sources from `this.bigOrganelles.organelles[0]` (the nucleus) — leave that block unchanged; it correctly targets index 0.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 6: GATE — multi-body integrity check (single browser_evaluate)**

Run (Playwright): `browser_navigate` to `http://localhost:5173`, then one `browser_evaluate`:

```js
async () => {
  const h = window.__cpm;
  const sim = h.sim;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Drive hard for ~4s; the host must stay ONE connected component (no fragmentation)
  // and report 0 deaths from normal movement with two big organelles inside.
  const deaths0 = h.deaths();
  for (let k = 0; k < 80; k++) {
    const pid = h.getPlayerId();
    const c = sim.centroidLattice(pid);
    const a = (k / 80) * Math.PI * 4;
    if (c) sim.steerCell(pid, c.x + Math.cos(a) * 50, c.y + Math.sin(a) * 50);
    await sleep(50);
  }
  const pid = h.getPlayerId();
  const comps = sim.structureComponentSizes(pid, []); // host alone, no member kinds
  return {
    deathsDuringRun: h.deaths() - deaths0,
    componentCount: comps.length,
    largest: comps[0] ?? 0,
    ok: (h.deaths() - deaths0) === 0 && comps.length === 1,
  };
};
```

Expected: `{ ok: true, deathsDuringRun: 0, componentCount: 1 }` — two big organelles ride along without fragmenting the crawling host. If `ok` is false, the footprint lambda is too high (freezing/pinching the membrane) — lower `footprintLambda` in `CpmBigOrganelles` and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/cell/cpm-world-scene.ts
git commit -m "feat: second big organelle proves multi-soft-body integrity"
```

---

## Task 12: Final type-check, test sweep, and feel gate

**Files:** none (verification only).

- [ ] **Step 1: Run the whole pure-test suite**

Run: `node --test src/cell/*.test.ts`
Expected: all tests across `cpm-soft-body`, `footprint-cost`, `cpm-deform-grid` pass.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: `tsc` + `vite build` succeed with no errors.

- [ ] **Step 3: Final feel gate (manual, brief)**

Ask the user to play one minute: build a handful of small organelles (B), crawl around, and thread a tight gap. Confirm the success criteria from the spec read as fun:
- small organelles **flow and regroup** as the cell squeezes (not clipping the wall);
- the nucleus **bottlenecks + oozes oval** at a gap;
- over-forcing **ruptures** the nucleus (red ramp → death), not instant/arbitrary death;
- the nucleus **recenters** after you stop.

If any of these is unsatisfying, return to systematic-debugging with the specific failing behavior (do not bulk-tune). Otherwise the interior substrate (layers 1–2) is complete.

- [ ] **Step 4: Update the living plan + memory**

- Append a short "interior substrate (hybrid model) — DONE" note under §G in `C:\Users\bacon\.claude\plans\look-through-what-i-ve-starry-curry.md` listing the new modules and what was verified.
- Update memory `cpm-substrate-status` to record the hybrid model shipped (soft-body big organelles + footprint coupling + deforming grid) and that the old embed-as-CPM-sub-cell approach is retired.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/superpowers/plans/2026-06-25-cpm-interior-substrate.md
git commit -m "docs: record interior substrate completion"
```

---

## Self-Review

**Spec coverage (against the 2026-06-25 addendum):**
- *Deforming grid* → Task 9/10 (`cpm-deform-grid`, frame-fractional anchors that reflow). ✓
- *Big-organelle soft body, positioned by cytoskeletal-force targets, recenters on its own, deforms under load* → Task 2/5/7 (`CpmSoftBody` + `CpmBigOrganelles`, target = deep-center/rear-bias). ✓
- *Footprint-coverage coupling → bottleneck + rupture* → Task 3/4/5 (`footprintDeltaH`, `CpmFootprintConstraint`, stress ramp). ✓
- *Small organelles flow/regroup, distinct look, groupable* → Task 10 (grid occupants + `drawStructure` per type). ✓
- *Baseline cytoskeleton sets how well arrangement holds* → `posStiffness` (soft body) + `cytoskeleton` multiplier (grid). ✓
- *Stress & rupture feed the HUD with a warning ramp before rupture* → Task 5 stress accumulation + Task 7 HUD `nucleus %` + red outline ramp. ✓
- *De-risk the nucleus first* → Phase A (Tasks 1–8) before Phase B. ✓
- *Nucleus, then a second type* → Task 11. ✓
- *CPM membrane/crawl/streaming/combat/fields/rules unchanged* → only additive constraint + interior modules; no edits to combat/field/streaming logic. ✓
- *Toy/fun gates* → Task 8 Step 3 + Task 12 Step 3 manual feel gates with explicit criteria. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; all tests have concrete assertions; all wiring shows exact before/after.

**Type consistency:** `CpmSoftBody` API (`nodes`, `center()`, `cfg`, `footprint()`, `exposedFraction()`, `ovalness()`, `shift()`) is used consistently in `CpmBigOrganelles` and the scene. `CpmBigOrganelles.update(steerDir, shiftX, shiftY)` matches the scene call. `setBigOrganelleFootprint(hostId, cells, lambda)` signature matches sim + constraint. `CpmDeformGrid.step(frame, inside)` / `add(type,color,radius,frame,lx,ly)` / `shift` / `compressedCount` match the scene. `footprintDeltaH(mark, hostId, tgt_i, src_type, tgt_type, lambda)` matches both the test and the constraint delegation. `DeathReason` includes `"ruptured"` before the scene passes it.

**Scope:** Layers 1–2 only (interior substrate). Out-of-scope (cargo routing, economy, ports, locomotion modes, combat changes) is not touched — matches the spec's scope fence.
