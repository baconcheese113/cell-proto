/**
 * Milestone 13 - Cytoskeleton Renderer
 * 
 * Story 13.1: Filament Underlay & Rendering
 * 
 * Handles visualization of the cytoskeleton system:
 * - Separate rails layer behind organelles
 * - Distinct visual styles for actin vs microtubules
 * - Infrastructure overlay with flow arrows and utilization
 * - Performance-optimized rendering
 */

import type { WorldRefs } from "../core/world-refs";
import type { CytoskeletonSystem, FilamentSegment, FilamentBlueprint } from "./cytoskeleton-system";
import { SystemObject } from "./system-object";

interface RenderConfig {
  // Layer settings
  railsLayerDepth: number;
  overlayLayerDepth: number;
  
  // Actin visual style
  actinColor: number;
  actinAlpha: number;
  actinThickness: number;
  
  // Microtubule visual style
  microtubuleColor: number;
  microtubuleAlpha: number;
  microtubuleThickness: number;
  showPlusEndTips: boolean;
  
  // Infrastructure overlay
  infrastructureAlpha: number;
  flowArrowColor: number;
  utilizationColors: {
    low: number;    // Green
    medium: number; // Yellow  
    high: number;   // Red
  };
  
  // Milestone 13 Part B: Speed visualization
  chevronConfig: {
    enabled: boolean;
    size: number;           // Chevron size in pixels
    spacing: number;        // Distance between chevrons
    baseSpeed: number;      // Base animation speed (chevrons per second)
    alphaInOverlay: number; // Alpha when overlay is on
    alphaOffOverlay: number; // Alpha when overlay is off
    showDirection: boolean; // Show polarity (microtubule plus-end direction)
  };
  
  // Performance
  maxSegmentsPerFrame: number;
  redrawThrottle: number; // ms between full redraws
}

export class CytoskeletonRenderer extends SystemObject {
  private worldRefs: WorldRefs;
  private cytoskeletonSystem: CytoskeletonSystem;
  
  // Rendering layers
  private railsLayer!: Phaser.GameObjects.Container;
  private railsGraphics!: Phaser.GameObjects.Graphics;
  private overlayLayer!: Phaser.GameObjects.Container;
  private overlayGraphics!: Phaser.GameObjects.Graphics;
  
  // State
  private infrastructureOverlayEnabled = false;
  private lastFullRedraw = 0;
  
  // Milestone 13 Part B: Animation state for chevrons
  private animationTime = 0; // Accumulated time for chevron animation
  
  // Configuration
  private config: RenderConfig = {
    railsLayerDepth: -5,      // Behind organelles
    overlayLayerDepth: 15,    // Above everything when active
    
    actinColor: 0xff6b6b,     // Red-ish
    actinAlpha: 0.3,          // Low alpha when overlay off
    actinThickness: 1.5,      // Thin lines
    
    microtubuleColor: 0x4ecdc4, // Teal
    microtubuleAlpha: 0.4,      // Low alpha when overlay off  
    microtubuleThickness: 2.5,  // Slightly thicker
    showPlusEndTips: true,
    
    infrastructureAlpha: 0.8,   // Bright when overlay on
    flowArrowColor: 0xffffff,
    utilizationColors: {
      low: 0x50e3c2,     // Green
      medium: 0xf5a623,  // Yellow
      high: 0xd0021b     // Red
    },
    
    // Milestone 13 Part B: Speed visualization chevrons
    chevronConfig: {
      enabled: true,
      size: 4,              // Small chevrons
      spacing: 20,          // 20 pixels between chevrons
      baseSpeed: 2.0,       // 2 chevrons per second at speed 1.0
      alphaInOverlay: 0.9,  // Bright when overlay is on
      alphaOffOverlay: 0.4, // Dimmed when overlay is off
      showDirection: true   // Show microtubule polarity
    },
    
    maxSegmentsPerFrame: 50,
    redrawThrottle: 100  // 10 FPS max redraw rate
  };

  constructor(
    scene: Phaser.Scene, 
    worldRefs: WorldRefs, 
    cytoskeletonSystem: CytoskeletonSystem
  ) {
    super(scene, "CytoskeletonRenderer", (deltaSeconds: number) => this.update(deltaSeconds));
    
    this.worldRefs = worldRefs;
    this.cytoskeletonSystem = cytoskeletonSystem;
    
    this.createRenderingLayers();
  }

  /**
   * Story 13.1: Create separate rendering layers
   */
  private createRenderingLayers(): void {
    // Rails layer - behind organelles and players
    this.railsLayer = this.scene.add.container(0, 0);
    this.railsLayer.setDepth(this.config.railsLayerDepth);
    this.worldRefs.cellRoot.add(this.railsLayer);
    
    this.railsGraphics = this.scene.add.graphics();
    this.railsLayer.add(this.railsGraphics);
    
    // Overlay layer - appears above everything when infrastructure overlay is on
    this.overlayLayer = this.scene.add.container(0, 0);
    this.overlayLayer.setDepth(this.config.overlayLayerDepth);
    this.overlayLayer.setVisible(false); // Hidden by default
    this.worldRefs.cellRoot.add(this.overlayLayer);
    
    this.overlayGraphics = this.scene.add.graphics();
    this.overlayLayer.add(this.overlayGraphics);
    
    console.log("Cytoskeleton rendering layers created");
  }

  override update(deltaSeconds: number): void {
    const now = Date.now();
    
    // Milestone 13 Part B: Update animation time for chevrons
    this.animationTime += deltaSeconds;
    
    // Throttle full redraws for performance
    if (now - this.lastFullRedraw > this.config.redrawThrottle) {
      this.renderAll();
      this.lastFullRedraw = now;
    }
  }

  /**
   * Toggle infrastructure overlay on/off
   */
  public toggleInfrastructureOverlay(): void {
    this.infrastructureOverlayEnabled = !this.infrastructureOverlayEnabled;
    this.overlayLayer.setVisible(this.infrastructureOverlayEnabled);
    
    // Adjust base layer alpha based on overlay state
    this.renderAll();
    
    console.log(`Infrastructure overlay: ${this.infrastructureOverlayEnabled ? 'ON' : 'OFF'}`);
  }

  /**
   * Main rendering method
   */
  private renderAll(): void {
    this.clearGraphics();
    
    // Always render base filaments
    this.renderBaseFilaments();
    
    // Render overlays if enabled
    if (this.infrastructureOverlayEnabled) {
      this.renderInfrastructureOverlay();
    }
  }

  /**
   * Clear all graphics
   */
  private clearGraphics(): void {
    this.railsGraphics.clear();
    this.overlayGraphics.clear();
  }

  /**
   * Story 13.1: Render base filaments with distinct styles
   */
  private renderBaseFilaments(): void {
    const segments = this.cytoskeletonSystem.getAllSegments();
    const blueprints = this.cytoskeletonSystem.getActiveBlueprints();
    const baseAlpha = this.infrastructureOverlayEnabled ? 0.2 : 1.0; // Dim when overlay is on
    
    // Render actin filaments
    const actinSegments = segments.filter(seg => seg.type === 'actin');
    this.renderFilamentType(actinSegments, {
      color: this.config.actinColor,
      alpha: this.config.actinAlpha * baseAlpha,
      thickness: this.config.actinThickness,
      style: 'meandering'
    });
    
    // Render microtubules  
    const microtubuleSegments = segments.filter(seg => seg.type === 'microtubule');
    this.renderFilamentType(microtubuleSegments, {
      color: this.config.microtubuleColor,
      alpha: this.config.microtubuleAlpha * baseAlpha,
      thickness: this.config.microtubuleThickness,
      style: 'straight'
    });
    
    // Milestone 13: Render blueprints under construction
    this.renderFilamentBlueprints(blueprints, baseAlpha);
  }

  /**
   * Render filaments of a specific type with consistent styling
   */
  private renderFilamentType(
    segments: FilamentSegment[], 
    style: { color: number; alpha: number; thickness: number; style: 'straight' | 'meandering' }
  ): void {
    this.railsGraphics.lineStyle(style.thickness, style.color, style.alpha);
    
    for (const segment of segments) {
      const fromWorld = this.worldRefs.hexGrid.hexToWorld(segment.fromHex);
      const toWorld = this.worldRefs.hexGrid.hexToWorld(segment.toHex);
      
      if (style.style === 'meandering') {
        // Actin: short, meandering segments with slight curves
        this.renderMeanderingLine(fromWorld, toWorld);
      } else {
        // Microtubules: straight lines
        this.railsGraphics.lineBetween(fromWorld.x, fromWorld.y, toWorld.x, toWorld.y);
        
        // Optional plus-end tips for microtubules
        if (this.config.showPlusEndTips && segment.type === 'microtubule') {
          this.renderPlusEndTip(toWorld, style.color, style.alpha);
        }
      }
    }
  }

  /**
   * Render a meandering line for actin filaments
   */
  private renderMeanderingLine(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2): void {
    // Add slight random curves to make actin look more organic
    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 8;
    const midY = (from.y + to.y) / 2 + (Math.random() - 0.5) * 8;
    
    // Draw as a simple curve
    const path = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(from.x, from.y),
      new Phaser.Math.Vector2(midX, midY),
      new Phaser.Math.Vector2(to.x, to.y)
    );
    
    path.draw(this.railsGraphics, 16); // 16 points for smooth curve
  }

  /**
   * Milestone 13: Render filament blueprints under construction
   */
  private renderFilamentBlueprints(blueprints: FilamentBlueprint[], baseAlpha: number): void {
    if (blueprints.length === 0) return;
    
    for (const blueprint of blueprints) {
      // Calculate construction progress
      const aaProgress = blueprint.progress.AA / blueprint.required.AA;
      const proteinProgress = blueprint.progress.PROTEIN / blueprint.required.PROTEIN;
      const overallProgress = Math.min(aaProgress, proteinProgress);
      
      // Style based on filament type
      const isActin = blueprint.type === 'actin';
      const baseColor = isActin ? this.config.actinColor : this.config.microtubuleColor;
      const thickness = (isActin ? this.config.actinThickness : this.config.microtubuleThickness) - 1;
      
      // Visual style: dashed line with progress-based alpha
      const alpha = (0.3 + overallProgress * 0.5) * baseAlpha;
      
      // Get world positions
      const fromWorld = this.worldRefs.hexGrid.hexToWorld(blueprint.fromHex);
      const toWorld = this.worldRefs.hexGrid.hexToWorld(blueprint.toHex);
      
      // Draw dashed line to indicate "under construction"
      this.renderDashedLine(fromWorld, toWorld, baseColor, alpha, thickness);
      
      // Add construction progress indicator at midpoint
      const midX = (fromWorld.x + toWorld.x) / 2;
      const midY = (fromWorld.y + toWorld.y) / 2;
      this.renderConstructionProgress(midX, midY, overallProgress, baseColor);
    }
  }
  
  /**
   * Render a dashed line for blueprint visualization
   */
  private renderDashedLine(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2, color: number, alpha: number, thickness: number): void {
    const dashLength = 8;
    const gapLength = 6;
    const totalLength = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
    const direction = new Phaser.Math.Vector2(to.x - from.x, to.y - from.y).normalize();
    
    this.railsGraphics.lineStyle(thickness, color, alpha);
    
    let currentDistance = 0;
    while (currentDistance < totalLength) {
      const startX = from.x + direction.x * currentDistance;
      const startY = from.y + direction.y * currentDistance;
      
      const endDistance = Math.min(currentDistance + dashLength, totalLength);
      const endX = from.x + direction.x * endDistance;
      const endY = from.y + direction.y * endDistance;
      
      this.railsGraphics.lineBetween(startX, startY, endX, endY);
      currentDistance += dashLength + gapLength;
    }
  }
  
  /**
   * Render construction progress indicator
   */
  private renderConstructionProgress(x: number, y: number, progress: number, color: number): void {
    // Small progress circle
    const radius = 4;
    
    // Background circle (faded)
    this.railsGraphics.fillStyle(0x333333, 0.6);
    this.railsGraphics.fillCircle(x, y, radius);
    
    // Progress arc
    if (progress > 0) {
      this.railsGraphics.lineStyle(2, color, 0.9);
      
      const startAngle = -Math.PI / 2; // Top
      
      // Draw arc manually since Phaser graphics.arc might not be available
      const steps = Math.max(8, Math.floor(progress * 16));
      for (let i = 0; i < steps; i++) {
        const angle1 = startAngle + (i / steps) * progress * Math.PI * 2;
        const angle2 = startAngle + ((i + 1) / steps) * progress * Math.PI * 2;
        
        const x1 = x + Math.cos(angle1) * (radius - 1);
        const y1 = y + Math.sin(angle1) * (radius - 1);
        const x2 = x + Math.cos(angle2) * (radius - 1);
        const y2 = y + Math.sin(angle2) * (radius - 1);
        
        this.railsGraphics.lineBetween(x1, y1, x2, y2);
      }
    }
  }

  /**
   * Render a plus-end tip for microtubules
   */
  private renderPlusEndTip(position: Phaser.Math.Vector2, color: number, alpha: number): void {
    this.railsGraphics.fillStyle(color, alpha * 1.5); // Slightly brighter
    this.railsGraphics.fillCircle(position.x, position.y, 3);
  }

  /**
   * Story 13.1: Render infrastructure overlay with flow arrows and utilization
   */
  private renderInfrastructureOverlay(): void {
    if (!this.infrastructureOverlayEnabled) return;
    
    const segments = this.cytoskeletonSystem.getAllSegments();
    
    // Render utilization-colored segments
    for (const segment of segments) {
      this.renderUtilizationOverlay(segment);
    }
    
    // Render flow arrows
    this.renderFlowArrows(segments);
    
    // Milestone 13 Part B: Render animated chevrons showing design speed
    if (this.config.chevronConfig.enabled) {
      this.renderSpeedChevrons(segments);
    }
    
    // Render junction activity
    this.renderJunctionActivity();
    
    // Render upgrade badges
    this.renderUpgradeBadges();
  }

  /**
   * Render segment utilization as colored overlays
   */
  private renderUtilizationOverlay(segment: FilamentSegment): void {
    const utilization = Math.min(1.0, Math.max(0.0, segment.utilization));
    let color: number;
    
    if (utilization < 0.3) {
      color = this.config.utilizationColors.low;
    } else if (utilization < 0.7) {
      color = this.config.utilizationColors.medium;
    } else {
      color = this.config.utilizationColors.high;
    }
    
    const alpha = 0.6 + (utilization * 0.4); // More opaque when more utilized
    
    this.overlayGraphics.lineStyle(segment.type === 'actin' ? 3 : 4, color, alpha);
    
    const fromWorld = this.worldRefs.hexGrid.hexToWorld(segment.fromHex);
    const toWorld = this.worldRefs.hexGrid.hexToWorld(segment.toHex);
    
    this.overlayGraphics.lineBetween(fromWorld.x, fromWorld.y, toWorld.x, toWorld.y);
  }

  /**
   * Render flow arrows showing cargo movement direction
   */
  private renderFlowArrows(segments: FilamentSegment[]): void {
    this.overlayGraphics.fillStyle(this.config.flowArrowColor, 0.8);
    
    for (const segment of segments) {
      if (segment.currentLoad > 0) {
        // Only show arrows on segments with active cargo
        const fromWorld = this.worldRefs.hexGrid.hexToWorld(segment.fromHex);
        const toWorld = this.worldRefs.hexGrid.hexToWorld(segment.toHex);
        
        this.renderArrow(fromWorld, toWorld);
      }
    }
  }

  /**
   * Render a directional arrow
   */
  private renderArrow(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2): void {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    
    const angle = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
    const arrowLength = 6;
    const arrowWidth = 3;
    
    // Arrow tip
    const tipX = midX + Math.cos(angle) * arrowLength * 0.5;
    const tipY = midY + Math.sin(angle) * arrowLength * 0.5;
    
    // Arrow base points
    const baseX = midX - Math.cos(angle) * arrowLength * 0.5;
    const baseY = midY - Math.sin(angle) * arrowLength * 0.5;
    
    const leftX = baseX + Math.cos(angle + Math.PI/2) * arrowWidth;
    const leftY = baseY + Math.sin(angle + Math.PI/2) * arrowWidth;
    
    const rightX = baseX + Math.cos(angle - Math.PI/2) * arrowWidth;
    const rightY = baseY + Math.sin(angle - Math.PI/2) * arrowWidth;
    
    // Draw arrow as triangle
    this.overlayGraphics.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
  }

  /**
   * Milestone 13 Part B: Render animated chevrons showing design speed
   */
  private renderSpeedChevrons(segments: FilamentSegment[]): void {
    const chevronConfig = this.config.chevronConfig;
    
    // Alpha based on overlay state
    const alpha = this.infrastructureOverlayEnabled 
      ? chevronConfig.alphaInOverlay 
      : chevronConfig.alphaOffOverlay;
    
    for (const segment of segments) {
      const fromTile = this.worldRefs.hexGrid.getTile(segment.fromHex);
      const toTile = this.worldRefs.hexGrid.getTile(segment.toHex);
      if (!fromTile || !toTile) continue;
      
      const from = fromTile.worldPos;
      const to = toTile.worldPos;
      
      // Calculate segment properties
      const segmentLength = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
      const angle = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
      
      // Animation speed based on segment speed
      const animationSpeed = chevronConfig.baseSpeed * segment.speed;
      const animationOffset = (this.animationTime * animationSpeed * chevronConfig.spacing) % chevronConfig.spacing;
      
      // Color based on filament type
      const color = segment.type === 'actin' ? this.config.actinColor : this.config.microtubuleColor;
      this.overlayGraphics.fillStyle(color, alpha);
      
      // Draw chevrons along the segment
      const numChevrons = Math.floor(segmentLength / chevronConfig.spacing) + 2; // +2 for partial chevrons
      
      for (let i = 0; i < numChevrons; i++) {
        const distanceAlongSegment = (i * chevronConfig.spacing - animationOffset) % (segmentLength + chevronConfig.spacing);
        
        // Skip chevrons outside the segment
        if (distanceAlongSegment < 0 || distanceAlongSegment > segmentLength) continue;
        
        const progress = distanceAlongSegment / segmentLength;
        const chevronX = from.x + (to.x - from.x) * progress;
        const chevronY = from.y + (to.y - from.y) * progress;
        
        this.renderChevron(chevronX, chevronY, angle, chevronConfig.size, segment.type);
      }
    }
  }

  /**
   * Milestone 13 Part B: Render a single chevron
   */
  private renderChevron(x: number, y: number, angle: number, size: number, filamentType: 'actin' | 'microtubule'): void {
    const halfSize = size * 0.5;
    
    // Set line style for chevron (white with good visibility)
    this.overlayGraphics.lineStyle(1, 0xffffff, 0.8);
    
    // For microtubules, show directional chevrons (polarity)
    // For actin, show neutral lines
    if (filamentType === 'microtubule' && this.config.chevronConfig.showDirection) {
      // Draw directional chevron (>)
      const tip1X = x + Math.cos(angle + Math.PI * 0.25) * halfSize;
      const tip1Y = y + Math.sin(angle + Math.PI * 0.25) * halfSize;
      
      const tip2X = x + Math.cos(angle - Math.PI * 0.25) * halfSize;
      const tip2Y = y + Math.sin(angle - Math.PI * 0.25) * halfSize;
      
      const baseX = x - Math.cos(angle) * halfSize;
      const baseY = y - Math.sin(angle) * halfSize;
      
      // Draw chevron lines
      this.overlayGraphics.lineBetween(baseX, baseY, tip1X, tip1Y);
      this.overlayGraphics.lineBetween(baseX, baseY, tip2X, tip2Y);
    } else {
      // Draw neutral line perpendicular to segment
      const perpAngle = angle + Math.PI * 0.5;
      const lineX1 = x + Math.cos(perpAngle) * halfSize;
      const lineY1 = y + Math.sin(perpAngle) * halfSize;
      const lineX2 = x - Math.cos(perpAngle) * halfSize;
      const lineY2 = y - Math.sin(perpAngle) * halfSize;
      
      this.overlayGraphics.lineBetween(lineX1, lineY1, lineX2, lineY2);
    }
  }

  /**
   * Render junction activity indicators
   */
  private renderJunctionActivity(): void {
    const junctions = this.cytoskeletonSystem.getAllJunctions();
    
    for (const junction of junctions) {
      if (junction.isActive) {
        const worldPos = this.worldRefs.hexGrid.hexToWorld(junction.hexCoord);
        
        // Animated pulse effect for active junctions
        const pulseScale = 1.0 + 0.3 * Math.sin(Date.now() * 0.01);
        
        this.overlayGraphics.fillStyle(0xffffff, 0.7);
        this.overlayGraphics.fillCircle(worldPos.x, worldPos.y, 4 * pulseScale);
        
        this.overlayGraphics.lineStyle(2, 0x000000, 0.8);
        this.overlayGraphics.strokeCircle(worldPos.x, worldPos.y, 4 * pulseScale);
      }
    }
  }

  /**
   * Render upgrade badges on organelle rims
   */
  private renderUpgradeBadges(): void {
    const upgrades = this.cytoskeletonSystem.getAllUpgrades();
    
    for (const upgrade of upgrades) {
      const worldPos = this.worldRefs.hexGrid.hexToWorld(upgrade.rimHex);
      
      // Badge background
      const badgeColor = this.getUpgradeBadgeColor(upgrade.type);
      this.overlayGraphics.fillStyle(badgeColor, 0.9);
      this.overlayGraphics.fillCircle(worldPos.x, worldPos.y, 6);
      
      // Badge border
      this.overlayGraphics.lineStyle(1, 0xffffff, 1.0);
      this.overlayGraphics.strokeCircle(worldPos.x, worldPos.y, 6);
      
      // Queue indicators if upgrade has queued items
      const queueLength = upgrade.inputQueue.length + upgrade.outputQueue.length;
      if (queueLength > 0) {
        this.renderQueuePips(worldPos, queueLength);
      }
    }
  }

  /**
   * Get badge color for upgrade type
   */
  private getUpgradeBadgeColor(type: string): number {
    const colors: Record<string, number> = {
      npc_exporter: 0x3779c2,    // Blue (nucleus)
      er_exit: 0xd07de0,         // Purple (ER)
      golgi_tgn: 0xf5a623,       // Yellow (Golgi)
      exocyst_hotspot: 0x50e3c2  // Green (membrane)
    };
    
    return colors[type] || 0xffffff;
  }

  /**
   * Render queue pips around an upgrade
   */
  private renderQueuePips(center: Phaser.Math.Vector2, count: number): void {
    const pipRadius = 2;
    const orbitRadius = 12;
    
    for (let i = 0; i < Math.min(count, 8); i++) { // Max 8 pips
      const angle = (i / 8) * Math.PI * 2;
      const pipX = center.x + Math.cos(angle) * orbitRadius;
      const pipY = center.y + Math.sin(angle) * orbitRadius;
      
      this.overlayGraphics.fillStyle(0xff6b6b, 0.8);
      this.overlayGraphics.fillCircle(pipX, pipY, pipRadius);
    }
  }

  /**
   * Public interface for enabling/disabling infrastructure overlay
   */
  public setInfrastructureOverlay(enabled: boolean): void {
    if (this.infrastructureOverlayEnabled !== enabled) {
      this.toggleInfrastructureOverlay();
    }
  }

  /**
   * Get current infrastructure overlay state
   */
  public isInfrastructureOverlayEnabled(): boolean {
    return this.infrastructureOverlayEnabled;
  }

  /**
   * Force a full redraw (useful when segments change)
   */
  public forceRedraw(): void {
    this.renderAll();
  }

  /**
   * Cleanup when destroying
   */
  override destroy(): void {
    this.railsLayer?.destroy();
    this.overlayLayer?.destroy();
    super.destroy();
  }
}
