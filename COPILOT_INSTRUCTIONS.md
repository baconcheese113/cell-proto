# COPILOT_INSTRUCTIONS.md

## Project Summary

Build a fast prototype of an educational **cell/molecular biology** game using **Vite + TypeScript + Phaser 3 + XState**.
Core loop: **gather substrates → transcribe mRNA in nucleus → translate protein at ribosome → deliver to peroxisome** to mitigate **ROS (stress) waves**.

## Tech Stack and Constraints

* Runtime: Vite (ESM), TypeScript strict.
* Multiplayer: Custom NetComponent architecture with host-authoritative design
* Graphics: Phaser 3 for rendering, WebGL for performance
* State Management: XState for complex behaviors, reactive state channels for networking

## Multiplayer Architecture Best Practices

### NetComponent System
- **Base Class Pattern**: All multiplayer objects extend `NetComponent` with stable addresses for proper routing
- **State Replication**: Use `stateChannel<T>()` for automatic client-server state synchronization
- **Server Authority**: Host is authoritative - all game state changes happen on host first
- **RPC Pattern**: Use `@RunOnServer()` decorators for remote method calls from clients

## Code Quality Standards

### Production Code Guidelines
- **User Feedback**: Combine debug logging with toast notifications for user-facing actions
- **TypeScript**: Proper typing, interfaces, and parameter validation. NO "ANY" TYPES.

## Implementation Patterns

### State Management
- Implement reactive patterns with state channels for automatic UI updates
- Host maintains authoritative state, clients receive updates

### User Interface
- Toast-based feedback for actions (success, error, informational)
- Clean parameter passing to UI components
- Minimal UI state - derive from game state where possible

## Anti-Patterns to Avoid

### Code Smells
- ❌ "any" type usage
- ❌ Hardcoded values without configuration

### Architecture Violations
- ❌ Client-side state mutations without server validation
- ❌ Circular dependencies between systems
- ❌ Mixing rendering and game logic
- ❌ Bypassing the NetComponent architecture for multiplayer features
- ❌ Using Object.prototype methods on Map collections

### Performance Issues
- ❌ Creating new objects in update loops
- ❌ Unnecessary network calls or state updates
- ❌ Blocking operations in main game thread
- ❌ Memory leaks from improper cleanup
- ❌ Redundant graphics operations

## System-Specific Guidelines

### Production System
- Handle transcript creation with proper vesicle transport
- Integrate with InstallOrderSystem for protein requests
- Provide visual feedback for production state changes
- Maintain clean update cycles with minimal logging

### Cargo System
- Implement pickup/drop mechanics with multiplayer sync
- Use defensive parameter validation for all operations
- Provide immediate user feedback via toast messages
- Handle edge cases gracefully (invalid targets, full inventory)

### Construction System
- Blueprint-based building with validation
- Resource checking before construction
- Visual feedback for build states
- Integration with player inventory and world state

### Membrane Systems
- Exchange system for substrate transport
- Port system for controlled molecular flow
- Protein registry for membrane components
- Proper integration with diffusion mechanics

## Future Development Notes

- Maintain NetComponent patterns for all new multiplayer features
- Follow established RPC patterns with proper validation
- Keep production code clean with minimal debug output
- Use toast notifications for all user-facing feedback
- Test multiplayer scenarios thoroughly before deployment
- Document new systems following these established patterns
* Rendering/Input: Phaser 3, **Arcade** physics (not Matter).

## Naming & style

* **Folders and files**: kebab-case (e.g., `game-scene.ts`, `cell-machine.ts`, `textures.ts`).
* **Variables, functions, methods**: camelCase.
* **Types, interfaces, enums, classes**: PascalCase.

## Directory structure


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

