/**
 * VesicleRenderer - Handles visual rendering of vesicles
 * 
 * Renders vesicles with state-based visual effects:
 * - Size scaling based on vesicle radius
 * - Color changes based on membrane proximity
 * - Endocytosis progress visualization
 * - Adhesion strength indicators
 */

import { SystemObject } from './system-object';
import { VesicleEntity, VesicleState } from '../entities/vesicle';
import type { WorldRefs } from '../core/world-refs';

export interface VesicleRenderConfig {
  layerDepth: number;
  
  // Base vesicle colors
  freeColor: number;        // Color when free floating
  approachingColor: number; // Color when approaching membrane
  adheredColor: number;     // Color when adhered to membrane
  endocytosingColor: number; // Color during endocytosis
  internalizedColor: number; // Color when internalized
  
  // Visual effects
  pulseSpeed: number;       // Speed of pulsing animation
  adhesionGlowStrength: number; // Strength of adhesion glow effect
  endocytosisAlpha: number; // Alpha during endocytosis
  
  // Size scaling
  minScale: number;         // Minimum scale factor
  maxScale: number;         // Maximum scale factor
  sizeVariation: number;    // Random size variation range
  
  // Trail effects
  showTrails: boolean;      // Whether to show movement trails
  trailLength: number;      // Length of movement trails
  trailAlpha: number;       // Alpha of trail particles
}

export class VesicleRenderer extends SystemObject {
  private worldRefs: WorldRefs;
  
  // Rendering layers
  private vesicleLayer!: Phaser.GameObjects.Container;
  private vesicleGraphics!: Phaser.GameObjects.Graphics;
  private trailLayer!: Phaser.GameObjects.Container;
  
  // Animation state
  private animationTime = 0;
  
  // Trail particles for movement visualization
  private trailParticles: Map<string, Array<{
    position: Phaser.Math.Vector2;
    age: number;
    maxAge: number;
  }>> = new Map();
  
  private config: VesicleRenderConfig = {
    layerDepth: 5, // Above membrane, below overlays
    
    freeColor: 0x87ceeb,        // Sky blue
    approachingColor: 0xffd700,  // Gold
    adheredColor: 0xff6347,      // Tomato red
    endocytosingColor: 0xda70d6, // Orchid purple
    internalizedColor: 0x98fb98, // Pale green
    
    pulseSpeed: 2.0,
    adhesionGlowStrength: 0.3,
    endocytosisAlpha: 0.7,
    
    minScale: 0.8,
    maxScale: 1.2,
    sizeVariation: 0.2,
    
    showTrails: true,
    trailLength: 5,
    trailAlpha: 0.4
  };

  constructor(scene: Phaser.Scene, worldRefs: WorldRefs) {
    super(scene, "VesicleRenderer", (deltaSeconds: number) => this.update(deltaSeconds));
    
    this.worldRefs = worldRefs;
    this.createRenderingLayers();
  }

  /**
   * Create rendering layers for vesicles
   */
  private createRenderingLayers(): void {
    // Trail layer - behind vesicles
    this.trailLayer = this.scene.add.container(0, 0);
    this.trailLayer.setDepth(this.config.layerDepth - 1);
    
    // Vesicle layer
    this.vesicleLayer = this.scene.add.container(0, 0);
    this.vesicleLayer.setDepth(this.config.layerDepth);
    
    // Graphics object for drawing
    this.vesicleGraphics = this.scene.add.graphics();
    this.vesicleLayer.add(this.vesicleGraphics);
  }

  /**
   * Main update method - renders all vesicles
   */
  public override update(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    
    // Clear previous frame
    this.vesicleGraphics.clear();
    
    // Get vesicles from vesicle system (will be implemented later)
    const vesicles = this.getVesicles();
    
    // Update trails
    this.updateTrails(vesicles, deltaSeconds);
    
    // Render vesicles
    for (const vesicle of vesicles) {
      this.renderVesicle(vesicle);
    }
    
    // Render trails
    if (this.config.showTrails) {
      this.renderTrails();
    }
  }

  /**
   * Get vesicles from the vesicle system
   */
  private getVesicles(): VesicleEntity[] {
    if (this.worldRefs.vesicleSystem) {
      return this.worldRefs.vesicleSystem.getAllVesicles();
    }
    return [];
  }

  /**
   * Update movement trails for vesicles
   */
  private updateTrails(vesicles: VesicleEntity[], deltaSeconds: number): void {
    if (!this.config.showTrails) return;
    
    for (const vesicle of vesicles) {
      // Get or create trail for this vesicle
      let trail = this.trailParticles.get(vesicle.id);
      if (!trail) {
        trail = [];
        this.trailParticles.set(vesicle.id, trail);
      }
      
      // Add new trail point if vesicle has moved
      const velocity = vesicle.velocity.length();
      if (velocity > 5) { // Only add trail if moving fast enough
        trail.push({
          position: vesicle.position.clone(),
          age: 0,
          maxAge: this.config.trailLength
        });
      }
      
      // Update existing trail points
      for (let i = trail.length - 1; i >= 0; i--) {
        const point = trail[i];
        point.age += deltaSeconds;
        
        // Remove old trail points
        if (point.age >= point.maxAge) {
          trail.splice(i, 1);
        }
      }
    }
    
    // Clean up trails for vesicles that no longer exist
    const vesicleIds = new Set(vesicles.map(v => v.id));
    for (const trailId of this.trailParticles.keys()) {
      if (!vesicleIds.has(trailId)) {
        this.trailParticles.delete(trailId);
      }
    }
  }

  /**
   * Render a single vesicle with state-based visuals
   */
  private renderVesicle(vesicle: VesicleEntity): void {
    const graphics = this.vesicleGraphics;
    
    // Calculate visual properties based on state
    const color = this.getVesicleColor(vesicle);
    const alpha = this.getVesicleAlpha(vesicle);
    const scale = this.getVesicleScale(vesicle);
    const glowStrength = this.getGlowStrength(vesicle);
    
    // Main vesicle body
    graphics.fillStyle(color, alpha);
    graphics.fillCircle(
      vesicle.position.x,
      vesicle.position.y,
      vesicle.radius * scale
    );
    
    // Glow effect for adhesion
    if (glowStrength > 0) {
      this.renderGlowEffect(vesicle, glowStrength);
    }
    
    // Endocytosis progress indicator
    if (vesicle.state === VesicleState.ENDOCYTOSING) {
      this.renderEndocytosisProgress(vesicle);
    }
    
    // State-specific effects
    this.renderStateEffects(vesicle);
  }

  /**
   * Get color based on vesicle state
   */
  private getVesicleColor(vesicle: VesicleEntity): number {
    switch (vesicle.state) {
      case VesicleState.FREE:
        return this.config.freeColor;
      case VesicleState.APPROACHING:
        return this.config.approachingColor;
      case VesicleState.ADHERED:
        return this.config.adheredColor;
      case VesicleState.ENDOCYTOSING:
        return this.config.endocytosingColor;
      case VesicleState.INTERNALIZED:
        return this.config.internalizedColor;
      default:
        return this.config.freeColor;
    }
  }

  /**
   * Get alpha based on vesicle state and endocytosis progress
   */
  private getVesicleAlpha(vesicle: VesicleEntity): number {
    let baseAlpha = 1.0;
    
    if (vesicle.state === VesicleState.ENDOCYTOSING) {
      // Fade during endocytosis
      baseAlpha = this.config.endocytosisAlpha * (1 - vesicle.endocytosisProgress * 0.5);
    } else if (vesicle.state === VesicleState.INTERNALIZED) {
      baseAlpha = 0.6; // Semi-transparent when internalized
    }
    
    return baseAlpha;
  }

  /**
   * Get scale factor with pulsing animation
   */
  private getVesicleScale(vesicle: VesicleEntity): number {
    let baseScale = 1.0;
    
    // Add size variation based on vesicle ID (consistent per vesicle)
    const hash = this.hashString(vesicle.id);
    const sizeVariation = (hash % 100) / 100; // 0-1
    baseScale += (sizeVariation - 0.5) * this.config.sizeVariation;
    
    // Add pulsing for adhered vesicles
    if (vesicle.state === VesicleState.ADHERED || vesicle.state === VesicleState.ENDOCYTOSING) {
      const pulsePhase = this.animationTime * this.config.pulseSpeed + hash;
      const pulseAmount = Math.sin(pulsePhase) * 0.1;
      baseScale += pulseAmount;
    }
    
    return Math.max(this.config.minScale, Math.min(this.config.maxScale, baseScale));
  }

  /**
   * Get glow strength based on membrane adhesion
   */
  private getGlowStrength(vesicle: VesicleEntity): number {
    if (vesicle.state === VesicleState.ADHERED || vesicle.state === VesicleState.ENDOCYTOSING) {
      return vesicle.membraneAdhesion * this.config.adhesionGlowStrength;
    }
    return 0;
  }

  /**
   * Render glow effect around vesicle
   */
  private renderGlowEffect(vesicle: VesicleEntity, strength: number): void {
    const graphics = this.vesicleGraphics;
    const color = this.getVesicleColor(vesicle);
    
    // Multiple glow rings for smooth effect
    for (let i = 1; i <= 3; i++) {
      const glowRadius = vesicle.radius * (1 + i * 0.3);
      const glowAlpha = strength * (0.4 / i); // Fade outward
      
      graphics.lineStyle(2, color, glowAlpha);
      graphics.strokeCircle(vesicle.position.x, vesicle.position.y, glowRadius);
    }
  }

  /**
   * Render endocytosis progress indicator
   */
  private renderEndocytosisProgress(vesicle: VesicleEntity): void {
    const graphics = this.vesicleGraphics;
    const progress = vesicle.endocytosisProgress;
    
    if (progress <= 0) return;
    
    // Progress ring
    const ringRadius = vesicle.radius * 1.2;
    
    graphics.lineStyle(3, 0xffffff, 0.8);
    graphics.beginPath();
    graphics.arc(
      vesicle.position.x,
      vesicle.position.y,
      ringRadius,
      -Math.PI / 2, // Start at top
      -Math.PI / 2 + (progress * 2 * Math.PI), // Progress angle
      false
    );
    graphics.strokePath();
  }

  /**
   * Render state-specific visual effects
   */
  private renderStateEffects(vesicle: VesicleEntity): void {
    if (vesicle.state === VesicleState.APPROACHING) {
      // Subtle attraction indicator toward membrane
      this.renderAttractionIndicator(vesicle);
    }
  }

  /**
   * Render attraction indicator showing movement toward membrane
   */
  private renderAttractionIndicator(vesicle: VesicleEntity): void {
    const graphics = this.vesicleGraphics;
    
    // Get direction to nearest membrane point (if membrane physics is available)
    let attractionDirection = new Phaser.Math.Vector2(1, 0); // Default direction
    
    if (this.worldRefs.membranePhysics) {
      const sample = this.worldRefs.membranePhysics.getNearestSurfaceSample(vesicle.position);
      attractionDirection = sample.pos.clone().subtract(vesicle.position).normalize();
    }
    
    // Draw small arrow indicating direction
    const arrowLength = vesicle.radius * 0.8;
    const arrowStart = vesicle.position.clone().add(
      attractionDirection.clone().scale(vesicle.radius * 1.5)
    );
    const arrowEnd = arrowStart.clone().add(
      attractionDirection.clone().scale(arrowLength)
    );
    
    graphics.lineStyle(2, 0xffffff, 0.6);
    graphics.lineBetween(arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y);
    
    // Arrow head
    const headLength = 4;
    const headAngle = Math.PI / 6; // 30 degrees
    const arrowAngle = Math.atan2(attractionDirection.y, attractionDirection.x);
    
    const head1 = new Phaser.Math.Vector2(
      arrowEnd.x - headLength * Math.cos(arrowAngle - headAngle),
      arrowEnd.y - headLength * Math.sin(arrowAngle - headAngle)
    );
    const head2 = new Phaser.Math.Vector2(
      arrowEnd.x - headLength * Math.cos(arrowAngle + headAngle),
      arrowEnd.y - headLength * Math.sin(arrowAngle + headAngle)
    );
    
    graphics.lineBetween(arrowEnd.x, arrowEnd.y, head1.x, head1.y);
    graphics.lineBetween(arrowEnd.x, arrowEnd.y, head2.x, head2.y);
  }

  /**
   * Render movement trails
   */
  private renderTrails(): void {
    const graphics = this.vesicleGraphics;
    
    for (const [, trail] of this.trailParticles) {
      if (trail.length < 2) continue;
      
      for (let i = 1; i < trail.length; i++) {
        const prev = trail[i - 1];
        const curr = trail[i];
        
        // Calculate alpha based on age
        const ageRatio = curr.age / curr.maxAge;
        const alpha = this.config.trailAlpha * (1 - ageRatio);
        
        if (alpha <= 0) continue;
        
        graphics.lineStyle(2, 0xffffff, alpha);
        graphics.lineBetween(
          prev.position.x, prev.position.y,
          curr.position.x, curr.position.y
        );
      }
    }
  }

  /**
   * Simple hash function for consistent vesicle variations
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Set vesicle system reference (will be called when VesicleSystem is created)
   */
  public setVesicleSystem(_vesicleSystem: any): void {
    // TODO: Store reference to vesicle system for getting vesicles
    // This will be implemented when VesicleSystem is created
  }

  /**
   * Toggle trail visualization
   */
  public toggleTrails(): void {
    this.config.showTrails = !this.config.showTrails;
    if (!this.config.showTrails) {
      this.trailParticles.clear();
    }
  }

  /**
   * Update render configuration
   */
  public updateConfig(newConfig: Partial<VesicleRenderConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Clean up resources
   */
  public override destroy(): void {
    this.vesicleGraphics?.destroy();
    this.vesicleLayer?.destroy();
    this.trailLayer?.destroy();
    this.trailParticles.clear();
    super.destroy();
  }
}
