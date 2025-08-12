import type { WorldRefs } from "../core/world-refs";
import { SystemObject } from "./system-object";
import { getVesicleMetrics } from "./vesicle-system";

/**
 * Consolidated Cell Overlays System
 * Handles: visual updates, icons, badges, flow indicators
 */
export class CellOverlays extends SystemObject {
  private worldRefs: WorldRefs;
  private overlayGraphics: Phaser.GameObjects.Graphics;
  private showQueueBadges = true;
  private showVesicleDebug = false;
  
  // Persistent debug panel (like other HUD elements)
  private vesicleDebugPanel?: Phaser.GameObjects.Text;
  
  // Milestone 8: Story 8.7 - Dirty tile redraw system
  private dirtyTiles: Set<string> = new Set(); // hex coordinates that need redraw

  constructor(scene: Phaser.Scene, worldRefs: WorldRefs) {
    super(scene, 'CellOverlays', (deltaSeconds: number) => this.update(deltaSeconds));
    this.worldRefs = worldRefs;
    
    // Create graphics object for overlay rendering
    this.overlayGraphics = scene.add.graphics();
    this.overlayGraphics.setDepth(10); // Above everything else
    
    // Create persistent debug panel (like other HUD elements)
    this.createVesicleDebugPanel();
  }

  /**
   * Main update cycle - updates visual overlays
   */
  override update(_deltaSeconds: number) {
    // Clear previous frame overlays
    this.overlayGraphics.clear();
    
    // Milestone 8: Story 8.7 - Process dirty tiles for redraw
    if (this.dirtyTiles.size > 0) {
      this.refreshDirtyTiles();
      this.dirtyTiles.clear();
    }
    
    // Milestone 8: Story 8.6 - Render queue badges and incoming indicators
    if (this.showQueueBadges) {
      this.renderQueueBadges();
      this.renderIncomingVesicleIndicators();
    }
    
    // Optional debug information
    if (this.showVesicleDebug) {
      this.renderVesicleDebugInfo();
    }
  }

  /**
   * Milestone 8: Render queue badges at ER and Golgi organelles
   */
  private renderQueueBadges(): void {
    const organelles = this.worldRefs.organelleSystem.getAllOrganelles();
    
    for (const organelle of organelles) {
      if (organelle.type === 'proto-er') {
        const queueCount = this.getERQueueCount();
        if (queueCount > 0) {
          this.renderQueueBadge(organelle.coord, queueCount, 0xff6699); // Pink for ER
        }
      } else if (organelle.type === 'golgi') {
        const queueCount = this.getGolgiQueueCount();
        if (queueCount > 0) {
          this.renderQueueBadge(organelle.coord, queueCount, 0xffcc66); // Yellow for Golgi
        }
      }
    }
  }

  /**
   * Milestone 8: Render incoming vesicle pips at membrane destinations
   */
  private renderIncomingVesicleIndicators(): void {
    const incomingCounts = new Map<string, number>();
    
    // Count incoming vesicles by destination
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (vesicle.state === 'EN_ROUTE_MEMBRANE' || vesicle.state === 'INSTALLING') {
        const destKey = `${vesicle.destHex.q},${vesicle.destHex.r}`;
        incomingCounts.set(destKey, (incomingCounts.get(destKey) || 0) + 1);
      }
    }
    
    // Render pips for each destination with incoming vesicles
    for (const [destKey, count] of incomingCounts) {
      const [qStr, rStr] = destKey.split(',');
      const coord = { q: parseInt(qStr), r: parseInt(rStr) };
      this.renderIncomingPips(coord, count);
    }
  }

  /**
   * Render a queue badge at an organelle
   */
  private renderQueueBadge(coord: { q: number; r: number }, count: number, color: number): void {
    const worldPos = this.worldRefs.hexGrid.hexToWorld(coord);
    const badgeRadius = 8;
    const offsetX = 15; // Offset from organelle center
    const offsetY = -15;
    
    // Badge background
    this.overlayGraphics.fillStyle(color, 0.8);
    this.overlayGraphics.fillCircle(worldPos.x + offsetX, worldPos.y + offsetY, badgeRadius);
    
    // Badge border
    this.overlayGraphics.lineStyle(2, 0xffffff, 1.0);
    this.overlayGraphics.strokeCircle(worldPos.x + offsetX, worldPos.y + offsetY, badgeRadius);
    
    // Queue count text
    const text = this.scene.add.text(
      worldPos.x + offsetX, 
      worldPos.y + offsetY, 
      count.toString(), 
      {
        fontSize: '12px',
        fontFamily: 'Arial',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 1
      }
    );
    text.setOrigin(0.5, 0.5);
    text.setDepth(11);
    
    // Store text for cleanup
    this.scene.time.delayedCall(1000, () => text.destroy());
  }

  /**
   * Render incoming vesicle pips at membrane destination
   */
  private renderIncomingPips(coord: { q: number; r: number }, count: number): void {
    const worldPos = this.worldRefs.hexGrid.hexToWorld(coord);
    const pipRadius = 3;
    
    for (let i = 0; i < Math.min(count, 5); i++) { // Max 5 pips to avoid clutter
      const angle = (i / 5) * Math.PI * 2;
      const pipX = worldPos.x + Math.cos(angle) * 12;
      const pipY = worldPos.y + Math.sin(angle) * 12;
      
      // Pip background
      this.overlayGraphics.fillStyle(0x9966ff, 0.9); // Purple for incoming
      this.overlayGraphics.fillCircle(pipX, pipY, pipRadius);
      
      // Pip border
      this.overlayGraphics.lineStyle(1, 0xffffff, 1.0);
      this.overlayGraphics.strokeCircle(pipX, pipY, pipRadius);
    }
    
    // If more than 5, show "+N" indicator
    if (count > 5) {
      const text = this.scene.add.text(
        worldPos.x, 
        worldPos.y + 20, 
        `+${count - 5}`, 
        {
          fontSize: '10px',
          fontFamily: 'Arial',
          color: '#9966ff',
          stroke: '#ffffff',
          strokeThickness: 1
        }
      );
      text.setOrigin(0.5, 0.5);
      text.setDepth(11);
      
      // Store text for cleanup
      this.scene.time.delayedCall(1000, () => text.destroy());
    }
  }

  /**
   * Get number of vesicles queued at ER
   */
  private getERQueueCount(): number {
    let count = 0;
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (vesicle.state === 'QUEUED_ER') {
        count++;
      }
    }
    return count;
  }

  /**
   * Get number of vesicles queued at Golgi
   */
  private getGolgiQueueCount(): number {
    let count = 0;
    for (const vesicle of this.worldRefs.vesicles.values()) {
      if (vesicle.state === 'QUEUED_GOLGI') {
        count++;
      }
    }
    return count;
  }

  /**
   * Create persistent vesicle debug panel (like other HUD elements)
   */
  private createVesicleDebugPanel(): void {
    this.vesicleDebugPanel = this.scene.add.text(14, 150, '', {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 5, y: 5 }
    });
    this.vesicleDebugPanel.setDepth(1000); // Same depth as HUD
    this.vesicleDebugPanel.setScrollFactor(0); // Screen-fixed like HUD
    this.vesicleDebugPanel.setVisible(false); // Hidden by default
  }

  /**
   * Render debug information about vesicle system
   */
  private renderVesicleDebugInfo(): void {
    if (!this.vesicleDebugPanel) return;
    
    const metrics = getVesicleMetrics(this.worldRefs);
    
    const debugText = [
      'Vesicle Debug:',
      `Active: ${metrics.activeVesicles}`,
      `Avg Path: ${metrics.avgPathLength.toFixed(1)}`,
      `Queued@Golgi: ${metrics.queuedAtGolgi}`,
      `→Membrane: ${metrics.enRouteToMembrane}`,
      `Installing: ${metrics.installing}`,
      `Blocked: ${metrics.blocked}`
    ].join('\n');
    
    this.vesicleDebugPanel.setText(debugText);
    this.vesicleDebugPanel.setVisible(true);
  }

  /**
   * Toggle queue badge visibility
   */
  public toggleQueueBadges(): void {
    this.showQueueBadges = !this.showQueueBadges;
    console.log(`Queue badges: ${this.showQueueBadges ? 'ON' : 'OFF'}`);
  }

  /**
   * Toggle vesicle debug info
   */
  public toggleVesicleDebug(): void {
    this.showVesicleDebug = !this.showVesicleDebug;
    console.log(`Vesicle debug: ${this.showVesicleDebug ? 'ON' : 'OFF'}`);
    
    // Hide panel when debug is turned off
    if (!this.showVesicleDebug && this.vesicleDebugPanel) {
      this.vesicleDebugPanel.setVisible(false);
    }
  }

  /**
   * Milestone 8: Story 8.7 - Mark tile for redraw
   */
  public markTileDirty(coord: { q: number; r: number }): void {
    const tileKey = `${coord.q},${coord.r}`;
    this.dirtyTiles.add(tileKey);
  }

  /**
   * Milestone 8: Story 8.7 - Refresh dirty tiles
   */
  private refreshDirtyTiles(): void {
    // For now, trigger a full membrane debug refresh
    // In the future, this could be optimized to only redraw specific tiles
    this.scene.events.emit('refresh-membrane-glyphs');
    console.log(`♻️ Refreshed ${this.dirtyTiles.size} dirty tiles`);
  }

  override destroy() {
    this.overlayGraphics?.destroy();
    this.vesicleDebugPanel?.destroy();
    super.destroy();
  }
}
