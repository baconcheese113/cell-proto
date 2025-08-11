import type { WorldRefs } from "../core/world-refs";
import { SystemObject } from "./system-object";

/**
 * Consolidated Cell Overlays System
 * Handles: visual updates, icons, badges, flow indicators
 */
export class CellOverlays extends SystemObject {
  private worldRefs: WorldRefs;

  constructor(scene: Phaser.Scene, worldRefs: WorldRefs) {
    super(scene, 'CellOverlays', (deltaSeconds: number) => this.update(deltaSeconds));
    this.worldRefs = worldRefs;
  }

  /**
   * Main update cycle - updates visual overlays
   */
  override update(_deltaSeconds: number) {
    // Phase 1: Update heatmap visualization if enabled
    // (Current heatmap system doesn't need per-frame updates)
    
    // Phase 2: Update any membrane protein icons
    // (Currently handled by UI refresh triggers)
    
    // Phase 3: Update any flow indicators or particle effects
    // (To be implemented in future)
    
    // For now, this is mostly a placeholder for future visual systems
    // The heavy lifting is done by the transcript rendering in CellProduction
    // and the tile info panel refresh system
    
    // Reference worldRefs to avoid lint warning (will be used for future overlays)
    if (this.worldRefs) {
      // Future overlay updates will use worldRefs
    }
  }

  override destroy() {
    // Nothing to clean up yet
    super.destroy();
  }
}
