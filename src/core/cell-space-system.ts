/**
 * CellSpace Transform System
 * 
 * Manages the spatial relationship between the cell's internal coordinate system
 * and the external world. Provides a single source of truth for cell position,
 * rotation, and scale that all world↔hex conversions reference.
 */

export interface CellSpaceTransform {
  /** World position of the cell center */
  position: { x: number; y: number };
  
  /** Cell rotation in radians (0 = facing right) */
  rotation: number;
  
  /** Cell scale factor (1.0 = normal size) */
  scale: number;
  
  /** Target position for smooth movement */
  targetPosition: { x: number; y: number };
  
  /** Target rotation for smooth turning */
  targetRotation: number;
  
  /** Movement interpolation speed (0-1) */
  lerpSpeed: number;
}

export class CellSpaceSystem {
  private transform: CellSpaceTransform;
  
  constructor(initialX: number = 0, initialY: number = 0) {
    this.transform = {
      position: { x: initialX, y: initialY },
      rotation: 0,
      scale: 1.0,
      targetPosition: { x: initialX, y: initialY },
      targetRotation: 0,
      lerpSpeed: 0.1
    };
  }
  
  getTransform(): Readonly<CellSpaceTransform> {
    return this.transform;
  }
  
  /**
   * Set immediate position (no interpolation)
   */
  setPosition(x: number, y: number): void {
    this.transform.position.x = x;
    this.transform.position.y = y;
    this.transform.targetPosition.x = x;
    this.transform.targetPosition.y = y;
  }
  
  /**
   * Set target position for smooth movement
   */
  setTargetPosition(x: number, y: number): void {
    this.transform.targetPosition.x = x;
    this.transform.targetPosition.y = y;
  }
  
  /**
   * Set immediate rotation (no interpolation)
   */
  setRotation(rotation: number): void {
    this.transform.rotation = rotation;
    this.transform.targetRotation = rotation;
  }
  
  /**
   * Set target rotation for smooth turning
   */
  setTargetRotation(rotation: number): void {
    // Handle angle wrapping for shortest path
    const currentRot = this.transform.rotation;
    let targetRot = rotation;
    
    // Find shortest angular distance
    const diff = targetRot - currentRot;
    if (diff > Math.PI) {
      targetRot -= Math.PI * 2;
    } else if (diff < -Math.PI) {
      targetRot += Math.PI * 2;
    }
    
    this.transform.targetRotation = targetRot;
  }
  
  /**
   * Update transform interpolation
   */
  update(deltaSeconds: number): void {
    const lerp = Math.min(1.0, this.transform.lerpSpeed * deltaSeconds * 10);
    
    // Interpolate position
    this.transform.position.x += (this.transform.targetPosition.x - this.transform.position.x) * lerp;
    this.transform.position.y += (this.transform.targetPosition.y - this.transform.position.y) * lerp;
    
    // Interpolate rotation
    this.transform.rotation += (this.transform.targetRotation - this.transform.rotation) * lerp;
    
    // Normalize rotation to [-π, π]
    while (this.transform.rotation > Math.PI) {
      this.transform.rotation -= Math.PI * 2;
      this.transform.targetRotation -= Math.PI * 2;
    }
    while (this.transform.rotation < -Math.PI) {
      this.transform.rotation += Math.PI * 2;
      this.transform.targetRotation += Math.PI * 2;
    }
  }
  
  /**
   * Convert world coordinates to hex grid coordinates
   */
  worldToHex(worldX: number, worldY: number): { x: number; y: number } {
    // Transform world point relative to cell center
    const dx = worldX - this.transform.position.x;
    const dy = worldY - this.transform.position.y;
    
    // Apply inverse rotation
    const cos = Math.cos(-this.transform.rotation);
    const sin = Math.sin(-this.transform.rotation);
    
    const hexX = (dx * cos - dy * sin) / this.transform.scale;
    const hexY = (dx * sin + dy * cos) / this.transform.scale;
    
    return { x: hexX, y: hexY };
  }
  
  /**
   * Convert hex grid coordinates to world coordinates
   */
  hexToWorld(hexX: number, hexY: number): { x: number; y: number } {
    // Apply scale and rotation
    const scaledX = hexX * this.transform.scale;
    const scaledY = hexY * this.transform.scale;
    
    const cos = Math.cos(this.transform.rotation);
    const sin = Math.sin(this.transform.rotation);
    
    const rotatedX = scaledX * cos - scaledY * sin;
    const rotatedY = scaledX * sin + scaledY * cos;
    
    // Translate to world position
    const worldX = rotatedX + this.transform.position.x;
    const worldY = rotatedY + this.transform.position.y;
    
    return { x: worldX, y: worldY };
  }
  
  /**
   * Get the forward direction vector in world coordinates
   */
  getForwardVector(): { x: number; y: number } {
    return {
      x: Math.cos(this.transform.rotation),
      y: Math.sin(this.transform.rotation)
    };
  }
  
  /**
   * Get the right direction vector in world coordinates
   */
  getRightVector(): { x: number; y: number } {
    return {
      x: Math.cos(this.transform.rotation + Math.PI / 2),
      y: Math.sin(this.transform.rotation + Math.PI / 2)
    };
  }
}
