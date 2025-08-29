# COPILOT\_INSTRUCTIONS.md

## Project summary

Build a fast prototype of an educational **cell/molecular biology** game using **Vite + TypeScript + Phaser 3 + XState**.
Core loop: **gather substrates → transcribe mRNA in nucleus → translate protein at ribosome → deliver to peroxisome** to mitigate **ROS (stress) waves**.

## Tech stack and constraints

* Runtime: Vite (ESM), TypeScript strict.
* Rendering/Input: Phaser 3, **Arcade** physics (not Matter).
* State: XState for gameplay/biology state machines.
* No server or persistence yet.

## Naming & style

* **Folders and files**: kebab-case (e.g., `game-scene.ts`, `cell-machine.ts`, `textures.ts`).
* **Variables, functions, methods**: camelCase.
* **Types, interfaces, enums, classes**: PascalCase.
* **Imports**: do **not** include `.ts` extensions.
* Prefer pure functions for logic; keep side-effects in scenes/render code.

## Directory structure

```
src/
  main.ts
  phaser-config.ts

  scenes/
    boot-scene.ts
    game-scene.ts

  state/
    game-machine.ts
    cell-machine.ts

  gfx/
    textures.ts

  ui/
    hud.ts

  types/
    index.ts
```

## tsconfig (baseline)

* Keep strict. Don’t add `"allowImportingTsExtensions": true`.
* Use path alias `@/*` if needed.
* Example:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "noEmit": true,

    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "importsNotUsedAsValues": "error",
    "resolveJsonModule": true,

    "strict": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,

    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,

    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vite/client"],
    "skipLibCheck": true,
    "useDefineForClassFields": true
  },
  "include": ["src"]
}
```

## Core gameplay model (what Copilot should preserve)

* **Resources**: `atp`, `aa`, `nt`.
* **Biology state**:

  * `mrna` count.
  * `catalaseFree` (produced, carried).
  * `catalaseActive` (delivered to peroxisome).
  * `stress` (0–100), `hp` (simple fail condition).
* **Stations** (gated actions by proximity):

  * **Nucleus**: only place you can `TRANSCRIBE`.
  * **Ribosome**: only place you can `TRANSLATE`.
  * **Peroxisome**: `DELIVER_CATALASE` activates protection against ROS.
* **Events**:

  * `PICKUP { kind: "glucose" | "aa" | "nt" }`
  * `TRANSCRIBE`, `TRANSLATE`, `DELIVER_CATALASE`
  * `STRESS { amount: number }`, `TICK { dt: number }`
* **Skill**: timing + positioning. Actions have small cooldowns; stress damages unless mitigated by delivered catalase.

## Input & controls

* Movement: WASD.
* Actions: `1` = TRANSCRIBE (must be inside nucleus), `2` = TRANSLATE (inside ribosome bay).
* `R` = trigger test stress wave.
* Auto-deliver catalase when standing in peroxisome.

## Rendering rules

* **Arcade physics**; no Matter bodies/joints.
* Procedural textures are cached by key and **regenerated on resize** instead of scaling blurrily.
* HUD always shows: ATP/AA/NT, mRNA, Catalase (free/active), Stress, HP.
* Visual feedback:

  * Flash station rim green on success, red on invalid action or insufficient resources.
  * Flash peroxisome when stress wave triggers.

## File-level responsibilities (Copilot should keep these boundaries)

* `scenes/game-scene.ts`

  * Input, player movement, overlaps.
  * Distance checks for station-gated actions.
  * Spawning pickups.
  * Wiring XState machine (`cell-machine`) and sending events.
  * Resize handler to regenerate grid texture and reposition the cell.
* `state/cell-machine.ts`

  * All biology/resource logic and cooldowns.
  * No Phaser imports or side effects.
* `gfx/textures.ts`

  * `makeGridTexture(width,height,bg,minor,major)`
  * `makeCellTexture(size,rim,fill,edge)`
  * `makeRingTexture(size,rim,color)`
  * `makeDotTexture(size,color)`
  * `makeStationTexture(kind)` for `"Nucleus" | "Ribosome" | "Peroxisome"`
* `ui/hud.ts`

  * `addHud(scene)` and `setHud(scene, ctx)`.
* `types/index.ts`

  * Shared types (StationKind, ResourceKind, etc.).

## Tasks for Copilot (in order, with acceptance criteria)

### 1) Add failure and survive states

* Add `hp <= 0` → freeze player, show “Cell died: oxidative stress” overlay with restart key (`Enter`).
* Add a simple timer: survive `120s` → show “Survived wave” overlay.
* **Acceptance**: Both overlays render; input disabled during failure; restarting resets machine context and respawns pickups.

### 2) Cooldowns and UI indicators

* Show `TRANSCRIBE` and `TRANSLATE` cooldown bars near player when active.
* **Acceptance**: Bars appear for \~0.8s after action; actions ignored while cooling down.

### 3) Add misfolding risk at low ATP

* If `atp < 2` when translating, 30% chance to create `misfolded` protein instead of catalase.
* Add a **chaperone** station or temporary buff: standing near it converts `misfolded` → `catalaseFree` at ATP cost.
* **Acceptance**: Misfolds appear under low ATP; chaperone fixes them with a visible effect.

### 4) ROS waves progression

* Every 30s, raise `stress` by +20 (cap 100) and spawn a short overlay pulse.
* **Acceptance**: Damage scales with stress unless mitigated by `catalaseActive`.

### 5) Proper resize behavior

* On window resize, regenerate grid texture and re-center the cell and stations without stretching artifacts.
* **Acceptance**: No blurry scaling; textures keyed by dimensions; memory does not balloon after repeated resizes.

### 6) Minimal audio cues (optional)

* Add click/pulse SFX for action success/fail.
* **Acceptance**: Distinct SFX for success vs fail; no audio on every frame.

## Non-goals for now

* No Matter physics, no complex projectile combat, no inventory UI beyond HUD text, no networking yet.

## Code style specifics

* Use **camelCase** for variables/functions; **kebab-case** for folders and filenames.
* No `.ts` in import paths.
* Avoid magic numbers; put constants at top of the file or in `const` blocks.
* Scene classes should avoid holding “game logic” state beyond input and rendering references.
* Pure functions and XState for logic make testing easier.

## Example prompts to use with Copilot

* “Refactor `scenes/game-scene.ts` to gate `TRANSCRIBE` to the nucleus radius and flash red if attempted outside.”
* “Add a failure overlay when `hp <= 0` with ‘Press Enter to restart’ and wire it to reset the cell-machine context.”
* “Implement cooldown bars for `TRANSCRIBE` and `TRANSLATE` above the player sprite; show while cooldown > 0.”
* “Create a chaperone station that repairs `misfolded` to `catalaseFree` at 1 ATP per repair.”
* “On window resize, regenerate the grid texture to the new width/height and update the image’s texture instead of scaling.”

---

**Notes for Copilot**
Prefer small, isolated diffs per task. Keep gameplay logic in `state/cell-machine.ts`. Any Phaser-specific code belongs in scenes or UI. Do not add third-party libs without being asked.
