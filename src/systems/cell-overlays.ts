import type { Cargo, WorldRefs } from "../core/world-refs";
import { System } from "./system";
import type { NetBus } from "../network/net-bus";

/**
 * Consolidated Cell Overlays System
 * Handles: visual updates, icons, badges, flow indicators
 */
export class CellOverlays extends System {
  private worldRefs: WorldRefs;
  private overlayGraphics: Phaser.GameObjects.Graphics;
  
  // Milestone 8: Story 8.7 - Dirty tile redraw system
  private dirtyTiles: Set<string> = new Set(); // hex coordinates that need redraw

  constructor(scene: Phaser.Scene, bus: NetBus, worldRefs: WorldRefs, parentContainer?: Phaser.GameObjects.Container) {
    super(scene, bus, 'CellOverlays', (deltaSeconds: number) => this.update(deltaSeconds));
    this.worldRefs = worldRefs;
    
    // Create graphics object for overlay rendering
    this.overlayGraphics = scene.add.graphics();
    this.overlayGraphics.setDepth(10); // Above everything else
    
    // HOTFIX H2: Re-parent overlay graphics to cellRoot if provided
    if (parentContainer) {
      parentContainer.add(this.overlayGraphics);
    }
  }

  /**
   * Main update cycle - updates visual overlays
   */
  public override update(_deltaSeconds: number) {
    // Clear previous frame overlays
    this.overlayGraphics.clear();
    
    // Milestone 8: Story 8.7 - Process dirty tiles for redraw
    if (this.dirtyTiles.size > 0) {
      this.refreshDirtyTiles();
      this.dirtyTiles.clear();
    }
    
    // Milestone 9: Render cell motility overlays
    this.renderMotilityOverlays();
    
    // Milestone 13: Render transport progress indicators
    this.renderTransportProgress();
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

  /**
   * Milestone 9: Render cell motility overlays (polarity, membrane deformation, substrate)
   */
  private renderMotilityOverlays(): void {
    // Get motility system from world refs (will be added)
    const motility = (this.worldRefs as any).cellMotility;
    if (!motility) return;
    
    const motilityState = motility.getState();
    
    // Render polarity vector (front indicator)
    this.renderPolarityOverlay(motilityState);
    
    // Render membrane deformation
    this.renderMembraneDeformation(motilityState);
  }

  /**
   * Render polarity vector as front/rear indicators
   */
  private renderPolarityOverlay(motilityState: any): void {
    if (motilityState.polarity.magnitude < 0.1) return;
    
    const cellCenter = this.worldRefs.hexGrid.hexToWorld({ q: 0, r: 0 });
    const cellRadius = 220; // Standard cell radius for visual overlays - matches hex grid area
    
    // Front indicator (arrow/chevron)
    const frontDirection = motilityState.polarity.direction;
    const frontX = cellCenter.x + Math.cos(frontDirection) * (cellRadius + 20);
    const frontY = cellCenter.y + Math.sin(frontDirection) * (cellRadius + 20);
    
    // Draw front chevron
    this.overlayGraphics.lineStyle(3, 0x00ff00, 0.8 * motilityState.polarity.magnitude);
    const chevronSize = 15;
    const chevronAngle = 0.5;
    
    // Left arm of chevron
    const leftX = frontX - Math.cos(frontDirection - chevronAngle) * chevronSize;
    const leftY = frontY - Math.sin(frontDirection - chevronAngle) * chevronSize;
    this.overlayGraphics.moveTo(leftX, leftY);
    this.overlayGraphics.lineTo(frontX, frontY);
    
    // Right arm of chevron
    const rightX = frontX - Math.cos(frontDirection + chevronAngle) * chevronSize;
    const rightY = frontY - Math.sin(frontDirection + chevronAngle) * chevronSize;
    this.overlayGraphics.lineTo(rightX, rightY);
    
    // Rear indicator (dimmer ring)
    const rearDirection = frontDirection + Math.PI;
    const rearX = cellCenter.x + Math.cos(rearDirection) * (cellRadius + 10);
    const rearY = cellCenter.y + Math.sin(rearDirection) * (cellRadius + 10);
    
    this.overlayGraphics.fillStyle(0xff4444, 0.3 * motilityState.polarity.magnitude);
    this.overlayGraphics.fillCircle(rearX, rearY, 8);
  }

  /**
   * Render membrane deformation (squash/stretch)
   */
  private renderMembraneDeformation(motilityState: any): void {
    if (motilityState.membraneSquash < 0.05) return;
    
    const cellCenter = this.worldRefs.hexGrid.hexToWorld({ q: 0, r: 0 });
    const cellRadius = 220; // Standard cell radius for visual overlays - matches hex grid area
    
    // Calculate deformation based on squash direction and magnitude
    const squashDir = motilityState.membraneSquashDirection;
    const squashAmount = motilityState.membraneSquash;
    
    // Draw deformed membrane overlay
    this.overlayGraphics.lineStyle(2, 0xffff00, squashAmount * 0.5);
    
    // Draw deformation indicator at contact point
    const contactX = cellCenter.x + Math.cos(squashDir) * cellRadius;
    const contactY = cellCenter.y + Math.sin(squashDir) * cellRadius;
    
    this.overlayGraphics.fillStyle(0xffff00, squashAmount * 0.4);
    this.overlayGraphics.fillCircle(contactX, contactY, 5 + squashAmount * 10);
  }

  /**
   * Milestone 13: Render progress indicators for vesicles in transit and processing
   */
  private renderTransportProgress(): void {
    const allCargo = this.worldRefs.cargoSystem.getAllCargo();
    
    for (const cargo of allCargo) {
      // Render segment transit progress only if cargo is moving on a segment
      if (cargo.segmentState?.transitProgress !== undefined && cargo.state === 'MOVING') {
        this.renderSegmentTransitProgress(cargo);
      }
      
      // Always render unified progress indicators for all cargo states
      this.renderUnifiedCargoProgress(cargo);
    }
  }

  /**
   * Render progress bar for cargo moving along segment
   */
  private renderSegmentTransitProgress(cargo: any): void {
    const progress = cargo.segmentState.transitProgress || 0;
    const worldPos = cargo.worldPos;
    
    // Progress bar background
    this.overlayGraphics.fillStyle(0x000000, 0.6);
    this.overlayGraphics.fillRect(worldPos.x - 15, worldPos.y - 25, 30, 4);
    
    // Progress bar fill
    this.overlayGraphics.fillStyle(0x00ff00, 0.8);
    this.overlayGraphics.fillRect(worldPos.x - 15, worldPos.y - 25, 30 * progress, 4);
    
    // Progress bar border
    this.overlayGraphics.lineStyle(1, 0xffffff, 0.8);
    this.overlayGraphics.strokeRect(worldPos.x - 15, worldPos.y - 25, 30, 4);
  }

  /**
   * Render unified progress indicators for all cargo states
   */
  private renderUnifiedCargoProgress(cargo: Cargo): void {
    const worldPos = cargo.worldPos;
    if (!worldPos) return; // Skip if no world position
    
    let showIndicator = false;
    let progress = 0;
    let iconColor = 0xffffff;
    let indicatorType: 'circle' | 'pulse' | 'static' = 'static';
    let cargoShape: 'circle' | 'square' | 'diamond' = 'circle';
    
    // Determine cargo type visual appearance
    switch (cargo.currentType) {
      case 'transcript':
        cargoShape = 'square';
        break;
      case 'polypeptide':
        cargoShape = 'diamond';
        break;
      case 'vesicle':
        cargoShape = 'circle';
        break;
      default:
        cargoShape = 'circle';
    }
    
    // Determine state-based color and behavior
    switch (cargo.state) {
      case 'BLOCKED':
        showIndicator = true;
        iconColor = 0xff4444; // Red for blocked
        indicatorType = 'pulse';
        break;
        
      case 'TRANSFORMING':
        if (cargo.processingTimer > 0) {
          showIndicator = true;
          // Get the actual processing time from the current stage
          const currentStage = cargo.itinerary?.stages[cargo.itinerary.stageIndex];
          const totalTime = currentStage?.processMs || 2000; // Fallback to 2000ms
          const elapsedTime = totalTime - cargo.processingTimer;
          progress = Math.max(0, Math.min(1.0, elapsedTime / totalTime));
          iconColor = 0x9d4edd; // Purple for transformation
          indicatorType = 'circle';
        }
        break;
        
      case 'MOVING':
        if (cargo.segmentState?.transitProgress !== undefined) {
          // Segment movement progress is handled by renderSegmentTransitProgress
          // Don't show duplicate indicators
          return;
        } else {
          showIndicator = true;
          iconColor = 0x06ffa5; // Green for moving
          indicatorType = 'pulse';
        }
        break;
        
      case 'QUEUED':
        showIndicator = true;
        iconColor = 0xffaa00; // Orange for queued
        indicatorType = 'static';
        break;
    }
    
    if (!showIndicator) return;
    
    // Indicator background (circle)
    this.overlayGraphics.fillStyle(0x000000, 0.6);
    this.overlayGraphics.fillCircle(worldPos.x, worldPos.y - 20, 8);
    
    if (indicatorType === 'circle' && progress > 0) {
      // Circular progress indicator (pie chart style)
      this.overlayGraphics.fillStyle(iconColor, 0.8);
      this.overlayGraphics.beginPath();
      this.overlayGraphics.moveTo(worldPos.x, worldPos.y - 20);
      this.overlayGraphics.arc(worldPos.x, worldPos.y - 20, 6, -Math.PI / 2, -Math.PI / 2 + (progress * 2 * Math.PI));
      this.overlayGraphics.closePath();
      this.overlayGraphics.fillPath();
    } else {
      // Render cargo type-specific shape
      const alpha = indicatorType === 'pulse' ? 
        (0.4 + 0.4 * Math.sin((Date.now() % 1000 / 1000) * Math.PI * 2)) : 
        0.8;
      
      this.overlayGraphics.fillStyle(iconColor, alpha);
      
      switch (cargoShape) {
        case 'square':
          // Square for transcripts
          this.overlayGraphics.fillRect(worldPos.x - 4, worldPos.y - 24, 8, 8);
          break;
        case 'diamond':
          // Diamond for polypeptides
          this.overlayGraphics.beginPath();
          this.overlayGraphics.moveTo(worldPos.x, worldPos.y - 26);
          this.overlayGraphics.lineTo(worldPos.x + 4, worldPos.y - 20);
          this.overlayGraphics.lineTo(worldPos.x, worldPos.y - 14);
          this.overlayGraphics.lineTo(worldPos.x - 4, worldPos.y - 20);
          this.overlayGraphics.closePath();
          this.overlayGraphics.fillPath();
          break;
        case 'circle':
        default:
          // Circle for vesicles
          this.overlayGraphics.fillCircle(worldPos.x, worldPos.y - 20, 6);
          break;
      }
    }
    
    // Indicator border
    this.overlayGraphics.lineStyle(1, 0xffffff, 0.8);
    this.overlayGraphics.strokeCircle(worldPos.x, worldPos.y - 20, 8);
  }

  override destroy() {
    this.overlayGraphics?.destroy();
    super.destroy();
  }
}
