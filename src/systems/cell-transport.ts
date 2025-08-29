import type { WorldRefs } from "../core/world-refs";
import { System } from "./system";
import type { NetBus } from "../network/net-bus";

/**
 * Consolidated Cell Transport System
 * Handles: organelle updates, membrane exchange, diffusion, passive effects
 */
export class CellTransport extends System {
  private worldRefs: WorldRefs;
  private diffusionTimeAccumulator = 0;
  private readonly diffusionTimestep = 1/30; // 30 Hz diffusion rate
  
  // Performance tracking
  private updateCount = 0;
  private lastPerformanceLog = 0;

  constructor(scene: Phaser.Scene, bus: NetBus, worldRefs: WorldRefs) {
    super(scene, bus, 'CellTransport', (deltaSeconds: number) => this.update(deltaSeconds));
    this.worldRefs = worldRefs;
  }

  /**
   * Main update cycle - runs all transport phases in order
   */
  public override update(deltaSeconds: number) {
    this.updateCount++;
    
    // Log performance metrics every 5 seconds
    const now = Date.now();
    if (now - this.lastPerformanceLog > 5000) {
      const diffusionSteps = Math.round(this.diffusionTimeAccumulator / this.diffusionTimestep);
      console.log(`🚚 Cell-Transport: ${diffusionSteps} diffusion steps queued, ${Math.round(this.updateCount / 5)} updates/sec`);
      this.updateCount = 0;
      this.lastPerformanceLog = now;
    }
    
    // Phase 1: Update organelle systems
    this.worldRefs.organelleSystem.update(deltaSeconds);

    // Phase 2: Process membrane exchange (installed protein transport)
    this.worldRefs.membraneExchangeSystem.processExchange(deltaSeconds * 1000); // Convert back to ms

    // Phase 3: Update diffusion at fixed timestep
    this.diffusionTimeAccumulator += deltaSeconds;
    while (this.diffusionTimeAccumulator >= this.diffusionTimestep) {
      this.worldRefs.diffusionSystem.step();
      this.diffusionTimeAccumulator -= this.diffusionTimestep;
    }

    // Phase 4: Update passive effects (species production/consumption)
    this.worldRefs.passiveEffectsSystem.step(deltaSeconds);
  }
}
