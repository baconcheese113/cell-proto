/**
 * Milestone 13 - Filament Builder System
 * 
 * Story 13.2: Buildable Filaments (rules + differences)
 * 
 * Handles interactive placement of cytoskeleton filaments:
 * - Click-and-drag to place segments
 * - Validation rules for actin vs microtubules  
 * - Cost enforcement and resource consumption
 * - Visual feedback during placement
 */

import type { HexCoord } from "../hex/hex-grid";
import type { WorldRefs } from "../core/world-refs";
import type { CytoskeletonSystem, FilamentType } from "./cytoskeleton-system";
import { SystemObject } from "./system-object";

interface PlacementState {
  isPlacing: boolean;
  filamentType: FilamentType;
  startHex: HexCoord | null;
  currentHex: HexCoord | null;
  previewSegments: { from: HexCoord; to: HexCoord }[];
  
  // Chain tracking for length limits
  chainLength: number;
  chainStartHex: HexCoord | null;
}

interface FilamentCost {
  AA: number;
  PROTEIN: number;
  description: string;
}

// Story 13.2: Filament build costs and rules
interface FilamentBuildConfig {
  actin: {
    cost: FilamentCost;
    maxChainLength: number;
    canStartFromMTOC: boolean;
    canStartFromExisting: boolean;
    description: string;
  };
  microtubule: {
    cost: FilamentCost;
    maxChainLength: number;
    canStartFromMTOC: boolean;
    canStartFromExisting: boolean;
    description: string;
  };
}

export class FilamentBuilder extends SystemObject {
  private worldRefs: WorldRefs;
  private cytoskeletonSystem: CytoskeletonSystem;
  
  // Placement state
  private placementState: PlacementState = {
    isPlacing: false,
    filamentType: 'actin',
    startHex: null,
    currentHex: null,
    previewSegments: [],
    chainLength: 0,
    chainStartHex: null
  };
  
  // Visual feedback
  private previewGraphics?: Phaser.GameObjects.Graphics;
  private isEnabled = false;
  
  // Build configuration
  private readonly BUILD_CONFIG: FilamentBuildConfig = {
    actin: {
      cost: { AA: 5, PROTEIN: 3, description: "5 AA + 3 PROTEIN" },
      maxChainLength: 8,
      canStartFromMTOC: false,
      canStartFromExisting: true,
      description: "Short, flexible filament for local transport"
    },
    microtubule: {
      cost: { AA: 8, PROTEIN: 12, description: "8 AA + 12 PROTEIN" },
      maxChainLength: 20,
      canStartFromMTOC: true,
      canStartFromExisting: true,
      description: "Long, rigid highway for fast transport"
    }
  };

  constructor(
    scene: Phaser.Scene,
    worldRefs: WorldRefs,
    cytoskeletonSystem: CytoskeletonSystem
  ) {
    super(scene, "FilamentBuilder", (_deltaSeconds: number) => this.update());
    
    this.worldRefs = worldRefs;
    this.cytoskeletonSystem = cytoskeletonSystem;
    
    this.createPreviewGraphics();
    this.setupInputHandlers();
  }

  override update(): void {
    if (this.isEnabled && this.placementState.isPlacing) {
      this.updatePreview();
    }
  }

  /**
   * Enable/disable the filament builder
   */
  public override setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.cancelPlacement();
    }
    
    if (this.previewGraphics) {
      this.previewGraphics.setVisible(enabled);
    }
  }

  /**
   * Set the current filament type to build
   */
  public setFilamentType(type: FilamentType): void {
    this.placementState.filamentType = type;
    this.cancelPlacement(); // Reset any active placement
    
    const config = this.BUILD_CONFIG[type];
    this.worldRefs.showToast(`Building ${type}: ${config.description} (${config.cost.description})`);
  }

  /**
   * Get current filament type
   */
  public getCurrentFilamentType(): FilamentType {
    return this.placementState.filamentType;
  }

  /**
   * Get build cost for current filament type
   */
  public getCurrentBuildCost(): FilamentCost {
    return this.BUILD_CONFIG[this.placementState.filamentType].cost;
  }

  /**
   * Check if builder is currently placing
   */
  public isPlacing(): boolean {
    return this.placementState.isPlacing;
  }

  /**
   * Create preview graphics
   */
  private createPreviewGraphics(): void {
    this.previewGraphics = this.scene.add.graphics();
    this.previewGraphics.setDepth(20); // Above everything
    this.previewGraphics.setVisible(false);
    this.worldRefs.cellRoot.add(this.previewGraphics);
  }

  /**
   * Setup input handlers for filament placement
   */
  private setupInputHandlers(): void {
    // Handle mouse/pointer input for drag placement
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.isEnabled) return;
      
      this.startPlacement(pointer.worldX - this.worldRefs.cellRoot.x, pointer.worldY - this.worldRefs.cellRoot.y);
    });
    
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isEnabled || !this.placementState.isPlacing) return;
      
      this.updatePlacement(pointer.worldX - this.worldRefs.cellRoot.x, pointer.worldY - this.worldRefs.cellRoot.y);
    });
    
    this.scene.input.on('pointerup', () => {
      if (!this.isEnabled || !this.placementState.isPlacing) return;
      
      this.completePlacement();
    });
  }

  /**
   * Start placement at world coordinates
   */
  private startPlacement(worldX: number, worldY: number): void {
    const hex = this.worldRefs.hexGrid.getTileAtWorld(worldX, worldY);
    if (!hex) return;
    
    // Validate starting position
    const validation = this.validateStartingPosition(hex.coord);
    if (!validation.isValid) {
      this.worldRefs.showToast(validation.error || "Invalid starting position");
      return;
    }
    
    this.placementState.isPlacing = true;
    this.placementState.startHex = { ...hex.coord };
    this.placementState.currentHex = { ...hex.coord };
    this.placementState.chainStartHex = validation.chainStartHex || null;
    this.placementState.chainLength = validation.chainLength;
    this.placementState.previewSegments = [];
    
    console.log(`Started placing ${this.placementState.filamentType} at (${hex.coord.q}, ${hex.coord.r})`);
  }

  /**
   * Update placement during drag
   */
  private updatePlacement(worldX: number, worldY: number): void {
    const hex = this.worldRefs.hexGrid.getTileAtWorld(worldX, worldY);
    if (!hex || !this.placementState.startHex) return;
    
    this.placementState.currentHex = { ...hex.coord };
    
    // Generate preview segments along the path
    this.generatePreviewPath();
  }

  /**
   * Complete placement on mouse up
   */
  private completePlacement(): void {
    if (!this.placementState.startHex || !this.placementState.currentHex) {
      this.cancelPlacement();
      return;
    }
    
    // Validate final placement
    const validation = this.validatePlacement();
    if (!validation.isValid) {
      this.worldRefs.showToast(validation.error || "Invalid placement");
      this.cancelPlacement();
      return;
    }
    
    // Check resource costs
    if (!this.canAffordPlacement()) {
      this.worldRefs.showToast("Insufficient resources");
      this.cancelPlacement();
      return;
    }
    
    // Create the actual filament segments
    this.createFilamentSegments();
    
    this.cancelPlacement();
  }

  /**
   * Cancel current placement
   */
  private cancelPlacement(): void {
    this.placementState.isPlacing = false;
    this.placementState.startHex = null;
    this.placementState.currentHex = null;
    this.placementState.previewSegments = [];
    this.placementState.chainLength = 0;
    this.placementState.chainStartHex = null;
    
    if (this.previewGraphics) {
      this.previewGraphics.clear();
    }
  }

  /**
   * Story 13.2: Validate starting position for filament type
   */
  private validateStartingPosition(hex: HexCoord): { isValid: boolean; error?: string; chainStartHex?: HexCoord; chainLength: number } {
    // Check if hex is valid for filament placement
    const tile = this.worldRefs.hexGrid.getTile(hex);
    if (!tile) {
      return { isValid: false, error: "Invalid hex", chainLength: 0 };
    }
    
    // Both types are cytosol-only
    if (tile.isMembrane) {
      return { isValid: false, error: "Cannot place filaments on membrane", chainLength: 0 };
    }
    
    // Check for organelle occupancy
    if (this.worldRefs.organelleSystem.hasTileOrganelle(hex)) {
      return { isValid: false, error: "Hex occupied by organelle", chainLength: 0 };
    }
    
    // Microtubule-specific rules
    if (this.placementState.filamentType === 'microtubule') {
      const mtocLocation = this.cytoskeletonSystem.getMTOCLocation();
      
      // Check if starting from MTOC
      if (mtocLocation && hex.q === mtocLocation.q && hex.r === mtocLocation.r) {
        return { isValid: true, chainStartHex: hex, chainLength: 0 };
      }
      
      // Check if starting from existing microtubule
      const existingSegments = this.cytoskeletonSystem.getSegmentsByType('microtubule');
      for (const segment of existingSegments) {
        if ((segment.fromHex.q === hex.q && segment.fromHex.r === hex.r) ||
            (segment.toHex.q === hex.q && segment.toHex.r === hex.r)) {
          // Find chain start and length for this existing network
          const chainInfo = this.findChainInfo(hex, 'microtubule');
          return { 
            isValid: true, 
            chainStartHex: chainInfo.startHex, 
            chainLength: chainInfo.length 
          };
        }
      }
      
      return { isValid: false, error: "Microtubules must start from MTOC or existing microtubule", chainLength: 0 };
    }
    
    // Actin can start anywhere valid (not from MTOC)
    if (this.placementState.filamentType === 'actin') {
      const mtocLocation = this.cytoskeletonSystem.getMTOCLocation();
      if (mtocLocation && hex.q === mtocLocation.q && hex.r === mtocLocation.r) {
        return { isValid: false, error: "Actin cannot start from MTOC", chainLength: 0 };
      }
      
      // Check if connecting to existing actin
      const existingSegments = this.cytoskeletonSystem.getSegmentsByType('actin');
      for (const segment of existingSegments) {
        if ((segment.fromHex.q === hex.q && segment.fromHex.r === hex.r) ||
            (segment.toHex.q === hex.q && segment.toHex.r === hex.r)) {
          const chainInfo = this.findChainInfo(hex, 'actin');
          return { 
            isValid: true, 
            chainStartHex: chainInfo.startHex, 
            chainLength: chainInfo.length 
          };
        }
      }
      
      // Actin can start anywhere else
      return { isValid: true, chainStartHex: hex, chainLength: 0 };
    }
    
    return { isValid: false, error: "Unknown filament type", chainLength: 0 };
  }

  /**
   * Find chain start and length for existing filament network
   */
  private findChainInfo(_hex: HexCoord, _type: FilamentType): { startHex: HexCoord; length: number } {
    // For now, return simplified info
    // TODO: Implement proper chain traversal when network topology is needed
    return { startHex: _hex, length: 0 };
  }

  /**
   * Generate preview path from start to current hex
   */
  private generatePreviewPath(): void {
    if (!this.placementState.startHex || !this.placementState.currentHex) return;
    
    // For now, just create a single segment
    // TODO: Implement multi-segment paths for complex placement
    this.placementState.previewSegments = [{
      from: this.placementState.startHex,
      to: this.placementState.currentHex
    }];
  }

  /**
   * Validate current placement
   */
  private validatePlacement(): { isValid: boolean; error?: string } {
    if (!this.placementState.startHex || !this.placementState.currentHex) {
      return { isValid: false, error: "No placement defined" };
    }
    
    // Check if start and end are the same (no-op)
    if (this.placementState.startHex.q === this.placementState.currentHex.q &&
        this.placementState.startHex.r === this.placementState.currentHex.r) {
      return { isValid: false, error: "Start and end are the same" };
    }
    
    // Check chain length limits
    const config = this.BUILD_CONFIG[this.placementState.filamentType];
    const proposedLength = this.placementState.chainLength + this.placementState.previewSegments.length;
    
    if (proposedLength > config.maxChainLength) {
      return { 
        isValid: false, 
        error: `Chain too long (${proposedLength}/${config.maxChainLength})` 
      };
    }
    
    // Check if end hex is valid
    const endTile = this.worldRefs.hexGrid.getTile(this.placementState.currentHex);
    if (!endTile) {
      return { isValid: false, error: "Invalid end position" };
    }
    
    if (endTile.isMembrane) {
      return { isValid: false, error: "Cannot end on membrane" };
    }
    
    if (this.worldRefs.organelleSystem.hasTileOrganelle(this.placementState.currentHex)) {
      return { isValid: false, error: "End position occupied" };
    }
    
    return { isValid: true };
  }

  /**
   * Check if placement location is valid (blueprints don't need instant resources)
   */
  private canAffordPlacement(): boolean {
    // For blueprints, we just need valid placement - resources are consumed gradually
    // The main validation is done in validatePlacement() and validateStartingPosition()
    return this.placementState.previewSegments.length > 0;
  }

  /**
   * Create filament blueprints that will gradually consume resources
   */
  private createFilamentSegments(): void {
    for (const segment of this.placementState.previewSegments) {
      // Create blueprint instead of instant filament
      const blueprintId = this.cytoskeletonSystem.createFilamentBlueprint(
        this.placementState.filamentType,
        segment.from,
        segment.to
      );
      
      if (blueprintId) {
        console.log(`Created ${this.placementState.filamentType} blueprint: ${blueprintId}`);
      }
    }
    
    this.worldRefs.showToast(
      `Started building ${this.placementState.previewSegments.length} ${this.placementState.filamentType} segment(s)`
    );
  }

  /**
   * Update preview visuals
   */
  private updatePreview(): void {
    if (!this.previewGraphics) return;
    
    this.previewGraphics.clear();
    
    if (this.placementState.previewSegments.length === 0) return;
    
    // Preview style based on filament type
    const isActin = this.placementState.filamentType === 'actin';
    const color = isActin ? 0xff6b6b : 0x4ecdc4;
    const thickness = isActin ? 3 : 4;
    
    this.previewGraphics.lineStyle(thickness, color, 0.7);
    
    for (const segment of this.placementState.previewSegments) {
      const fromWorld = this.worldRefs.hexGrid.hexToWorld(segment.from);
      const toWorld = this.worldRefs.hexGrid.hexToWorld(segment.to);
      
      this.previewGraphics.lineBetween(fromWorld.x, fromWorld.y, toWorld.x, toWorld.y);
      
      // Add end markers
      this.previewGraphics.fillStyle(color, 0.8);
      this.previewGraphics.fillCircle(fromWorld.x, fromWorld.y, 3);
      this.previewGraphics.fillCircle(toWorld.x, toWorld.y, 3);
    }
  }

  /**
   * Cleanup
   */
  override destroy(): void {
    this.previewGraphics?.destroy();
    super.destroy();
  }
}
