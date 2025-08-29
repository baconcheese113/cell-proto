/**
 * System - Base class for networked game systems
 * 
 * Combines NetComponent networking with SystemObject lifecycle management.
 * Provides both:
 * - NetComponent: stateChannels, @RunOnServer, @Multicast decorators, networking
 * - SystemObject: update() lifecycle, scene integration, automatic disposal
 * 
 * Use this for systems that need both networking and frame-by-frame updates.
 * Examples: CargoSystem, ThrowSystem, etc.
 */

import type { NetBus } from "../network/net-bus";
import { NetComponent } from "../network/net-entity";

export abstract class System extends NetComponent {
  protected scene: Phaser.Scene;
  protected systemName: string;
  private updateFn: (deltaSeconds: number) => void;
  private isActive = true;

  constructor(
    scene: Phaser.Scene,
    bus: NetBus,
    systemName: string,
    updateFn: (deltaSeconds: number) => void,
    netComponentOptions?: { address?: string }
  ) {
    super(bus, netComponentOptions);
    
    this.scene = scene;
    this.systemName = systemName;
    this.updateFn = updateFn;
    
    // Register with scene's preUpdate event for automatic lifecycle
    this.scene.events.on('preupdate', this.preUpdate, this);
    
    console.log(`🌐 ${this.systemName} initialized as System`);
  }

  /**
   * Called every frame by Phaser's preUpdate event
   */
  private preUpdate(_time: number, deltaMs: number): void {
    if (!this.isActive) return;
    
    const deltaSeconds = deltaMs / 1000;
    this.updateFn(deltaSeconds);
  }

  /**
   * Override this in subclasses for frame-by-frame logic
   */
  protected update(_deltaSeconds: number): void {
    // Default implementation - subclasses can override
  }

  /**
   * Pause this system's updates
   */
  public pause(): void {
    this.isActive = false;
  }

  /**
   * Resume this system's updates
   */
  public resume(): void {
    this.isActive = true;
  }

  /**
   * Check if system is currently active
   */
  public get active(): boolean {
    return this.isActive;
  }

  /**
   * Clean up system (from SystemObject pattern)
   */
  public destroy(): void {
    this.isActive = false;
    
    // Unregister from scene events
    this.scene.events.off('preupdate', this.preUpdate, this);
    
    // NetComponent doesn't have a destroy method, but we can clean up our state
    // The networking infrastructure will handle cleanup
    
    console.log(`🗑️ ${this.systemName} destroyed`);
  }

  /**
   * Get system name for debugging
   */
  public get name(): string {
    return this.systemName;
  }
}
