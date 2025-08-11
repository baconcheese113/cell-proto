import Phaser from "phaser";
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture, makeDotTexture, makeRingTexture } from "../gfx/textures";
import { HexGrid, type HexCoord, type HexTile } from "../hex/hex-grid";
import { getAllSpecies, type SpeciesId } from "../species/species-registry";
import { DiffusionSystem } from "../species/diffusion-system";
import { HeatmapSystem } from "../species/heatmap-system";
import { PassiveEffectsSystem } from "../species/passive-effects-system";
import { ConservationTracker } from "../species/conservation-tracker";
import { OrganelleSystem } from "../organelles/organelle-system";
import { OrganelleRenderer } from "../organelles/organelle-renderer";
import { OrganelleSelectionSystem } from "../organelles/organelle-selection";
import { PlayerInventorySystem } from "../player/player-inventory";
import { BlueprintSystem } from "../construction/blueprint-system";
import { BuildPaletteUI } from "../construction/build-palette-ui";
import type { OrganelleType } from "../organelles/organelle-registry";
import { BlueprintRenderer } from "../construction/blueprint-renderer";
import { CONSTRUCTION_RECIPES } from "../construction/construction-recipes";
import { getOrganelleDefinition, definitionToConfig } from "../organelles/organelle-registry";
import { MembraneExchangeSystem } from "../membrane/membrane-exchange-system";
import { getAllMembraneProteins } from "../membrane/membrane-protein-registry";
import { getFootprintTiles } from "../organelles/organelle-footprints";

// Milestone 7 Task 1: Data types for orders & transcripts
type ProteinId = 'GLUT' | 'AA_TRANSPORTER' | 'NT_TRANSPORTER' | 'ROS_EXPORTER' | 'SECRETION_PUMP' | 'GROWTH_FACTOR_RECEPTOR';

interface InstallOrder {
  id: string;
  proteinId: ProteinId;
  destHex: HexCoord;
  createdAt: number; // timestamp for priority/aging
}

interface Transcript {
  id: string;
  proteinId: ProteinId;
  atHex: HexCoord;
  ttlSeconds: number;
  worldPos: Phaser.Math.Vector2; // for smooth movement rendering
  isCarried: boolean; // true if player is carrying it
  moveAccumulator: number; // accumulated movement distance for discrete hex movement
  destHex?: HexCoord; // original destination from install order
  state: 'traveling' | 'processing_at_er' | 'packaged_for_transport' | 'installing_at_membrane';
  processingTimer: number; // time remaining for current state
}

type Keys = Record<"W" | "A" | "S" | "D" | "R" | "ENTER" | "SPACE" | "G" | "I" | "C" | "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "SIX" | "H" | "LEFT" | "RIGHT" | "P" | "T" | "V" | "Q" | "E" | "B" | "X" | "M" | "F", Phaser.Input.Keyboard.Key>;

export class GameScene extends Phaser.Scene {
  private grid!: Phaser.GameObjects.Image;
  private cellSprite!: Phaser.GameObjects.Image;

  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private ring!: Phaser.GameObjects.Image;
  private keys!: Keys;

  private cellCenter = new Phaser.Math.Vector2(0, 0);
  private cellRadius = 220;
  private membraneThickness = 10;
  // Hex grid system
  private hexGrid!: HexGrid;
  private hexSize = 16; // Tunable hex tile size
  private gridRadius = 12; // Tunable number of hex rings
  private hexGraphics!: Phaser.GameObjects.Graphics;
  private showHexGrid = true;
  private hoveredTile: any = null; // HexTile | null
  private selectedTile: any = null; // HexTile | null
  private hexInteractionGraphics!: Phaser.GameObjects.Graphics;
  private tileInfoPanel!: Phaser.GameObjects.Text;
  private debugInfoPanel!: Phaser.GameObjects.Text;

  // Milestone 6: Membrane debug visualization
  private membraneGraphics!: Phaser.GameObjects.Graphics;
  private showMembraneDebug = false;
  private transporterLabels: Phaser.GameObjects.Text[] = [];
  private proteinGlyphs: Phaser.GameObjects.Text[] = [];
  
  // Milestone 6: Membrane exchange system
  private membraneExchangeSystem!: MembraneExchangeSystem;

  // Species diffusion system - Task 3
  private diffusionSystem!: DiffusionSystem;
  private diffusionTimeAccumulator = 0;
  private diffusionTimestep = 1/30; // 30 Hz diffusion rate

  // Heatmap visualization - Task 5
  private heatmapSystem!: HeatmapSystem;

  // Passive effects system - Task 6
  private passiveEffectsSystem!: PassiveEffectsSystem;

  // Conservation tracking - Task 8
  private conservationTracker!: ConservationTracker;
  private conservationPanel!: Phaser.GameObjects.Text;

  // Organelle system - Milestone 3 Task 1
  private organelleSystem!: OrganelleSystem;
  private organelleRenderer!: OrganelleRenderer;
  private organelleSelection!: OrganelleSelectionSystem;

  // Player inventory system - Milestone 4 Task 1
  private playerInventory!: PlayerInventorySystem;

  // Blueprint system - Milestone 5
  private blueprintSystem!: BlueprintSystem;
  private buildPalette!: BuildPaletteUI;
  private blueprintRenderer!: BlueprintRenderer;
  private selectedRecipeId: OrganelleType | null = null;
  private isInBuildMode: boolean = false;

  // Milestone 6: Current tile tracking - Task 1
  private currentTileRef: HexTile | null = null;
  private currentTileLabel!: Phaser.GameObjects.Text;

  // Milestone 6: Toast system - Task 2
  private toastText!: Phaser.GameObjects.Text;

  // Milestone 7: Orders & Transcripts system - Task 1
  private installOrders: Map<string, InstallOrder> = new Map(); // keyed by order.id
  private transcripts: Map<string, Transcript> = new Map(); // keyed by transcript.id
  private transcriptGraphics!: Phaser.GameObjects.Graphics; // for rendering transcript dots
  private carriedTranscripts: Transcript[] = []; // transcripts carried by player (max 1-2)
  private nextOrderId = 1;
  private nextTranscriptId = 1;
  private isInProteinRequestMode = false; // Task 2: flag for protein selection menu

  // Movement mechanics
  private dashCooldown = 0;
  private maxDashCooldown = 1.2;
  private dashSpeed = 320;
  private normalMaxSpeed = 120;
  private acceleration = 600;
  private isDashing = false;
  private dashDuration = 0.25;
  private dashTimer = 0;

  // Membrane physics
  private membraneSpringForce = 400;
  private cameraLerpSpeed = 0.08;
  private cameraSmoothTarget = new Phaser.Math.Vector2(0, 0);
  private lastMembraneHit = 0;

  private col = {
    bg: 0x0b0f14, gridMinor: 0x10141d, gridMajor: 0x182131,
    cellFill: 0x0f2030, membrane: 0x2b6cb0,
    nucleusFill: 0x122742, nucleusRim: 0x3779c2,
    riboFill: 0x173a3a, riboRim: 0x39b3a6,
    peroxiFill: 0x2a1a2a, peroxiRim: 0xd07de0,
    chaperoneFill: 0x2a3a1a, chaperoneRim: 0x88cc44,
    player: 0x66ffcc, playerRing: 0xbfffe6,
    glucose: 0xffc300, aa: 0x8ef58a, nt: 0x52a7ff
  };

  constructor() { super("game"); }

  create() {
    // Background grid - cap size to prevent memory issues
    const view = this.scale.gameSize;
    const maxGridSize = 2048; // Reasonable maximum for browser memory
    const gridSize = Math.min(Math.max(view.width, view.height) * 2, maxGridSize);
    const gridKey = makeGridTexture(this, gridSize, gridSize, this.col.bg, this.col.gridMinor, this.col.gridMajor);
    this.grid = this.add.image(0, 0, gridKey).setOrigin(0.5, 0.5).setDepth(0);
    this.grid.setPosition(view.width * 0.5, view.height * 0.5);

    // Cell membrane
    this.cellCenter.set(view.width * 0.5, view.height * 0.5);
    const cellKey = makeCellTexture(this, this.cellRadius * 2 + this.membraneThickness * 2, this.membraneThickness, this.col.cellFill, this.col.membrane);
    this.cellSprite = this.add.image(this.cellCenter.x, this.cellCenter.y, cellKey).setDepth(1);

    // Player
    const pkey = makeDotTexture(this, 16, this.col.player);
    this.player = this.physics.add.sprite(this.cellCenter.x, this.cellCenter.y, pkey).setDepth(4);
    this.player.setCircle(8).setMaxVelocity(this.normalMaxSpeed).setDamping(true).setDrag(0.7);
    const rkey = makeRingTexture(this, 22, 3, this.col.playerRing);
    this.ring = this.add.image(this.player.x, this.player.y, rkey).setDepth(3).setAlpha(0.9);

    // Input keys
    this.keys = {
      W: this.input.keyboard!.addKey("W"),
      A: this.input.keyboard!.addKey("A"),
      S: this.input.keyboard!.addKey("S"),
      D: this.input.keyboard!.addKey("D"),
      R: this.input.keyboard!.addKey("R"),
      ENTER: this.input.keyboard!.addKey("ENTER"),
      SPACE: this.input.keyboard!.addKey("SPACE"),
      G: this.input.keyboard!.addKey("G"),
      I: this.input.keyboard!.addKey("I"),
      C: this.input.keyboard!.addKey("C"),
      ONE: this.input.keyboard!.addKey("ONE"),
      TWO: this.input.keyboard!.addKey("TWO"),
      THREE: this.input.keyboard!.addKey("THREE"),
      FOUR: this.input.keyboard!.addKey("FOUR"),
      FIVE: this.input.keyboard!.addKey("FIVE"),
      SIX: this.input.keyboard!.addKey("SIX"),
      H: this.input.keyboard!.addKey("H"),
      LEFT: this.input.keyboard!.addKey("LEFT"),
      RIGHT: this.input.keyboard!.addKey("RIGHT"),
      P: this.input.keyboard!.addKey("P"),
      T: this.input.keyboard!.addKey("T"),
      V: this.input.keyboard!.addKey("V"),
      Q: this.input.keyboard!.addKey("Q"),
      E: this.input.keyboard!.addKey("E"),
      B: this.input.keyboard!.addKey("B"),
      X: this.input.keyboard!.addKey("X"),
      M: this.input.keyboard!.addKey("M"),
      F: this.input.keyboard!.addKey("F"),
    };

    // Initialize systems
    addHud(this);
    this.initializeHexGrid();
    this.initializeHexGraphics();
    this.initializeHexInteraction();
    this.initializeTileInfoPanel();
    this.initializeDiffusionSystem();
    this.initializeHeatmapSystem();
    this.initializePassiveEffectsSystem();
    this.initializeConservationTracker();
    this.initializeOrganelleSystem();
    this.initializePlayerInventory();
    this.initializeMembraneExchangeSystem();
    this.initializeBlueprintSystem(); // After membrane exchange system
    this.initializeDebugInfo();
    this.initializeTranscriptSystem(); // Milestone 7 Task 1
    
    // Initialize protein glyphs by rendering membrane debug
    this.renderMembraneDebug();
    
    // Initialize HUD with current information
    this.updateHUD();

    // Window resize handling
    this.scale.on("resize", (sz: Phaser.Structs.Size) => {
      const newWidth = Math.ceil(sz.width);
      const newHeight = Math.ceil(sz.height);
      
      // Regenerate background grid
      const gridSize = Math.max(newWidth, newHeight) * 2;
      const key = makeGridTexture(this, gridSize, gridSize, this.col.bg, this.col.gridMinor, this.col.gridMajor);
      this.grid.setTexture(key).setOrigin(0.5, 0.5);
      this.grid.setPosition(newWidth * 0.5, newHeight * 0.5);
      
      // Re-center cell
      this.cellCenter.set(newWidth * 0.5, newHeight * 0.5);
      this.cellSprite.setPosition(this.cellCenter.x, this.cellCenter.y);

      // Update hex grid
      if (this.hexGrid) {
        this.hexGrid.updateCenter(this.cellCenter.x, this.cellCenter.y);
        this.renderHexGrid();
        
        // Reinitialize diffusion system buffers after grid change
        if (this.diffusionSystem) {
          this.diffusionSystem.reinitialize();
        }
        
        // Re-render organelles with new positions
        if (this.organelleRenderer) {
          this.organelleRenderer.onResize();
        }
        
        // Update selection system
        if (this.organelleSelection) {
          this.organelleSelection.onResize();
        }
        
        // Re-render protein glyphs with new positions
        this.updateProteinGlyphs();
      }
    });
  }

  override update() {
    // Handle hex grid toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.G)) {
      this.toggleHexGrid();
    }

    // Milestone 6: Handle membrane debug toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.M)) {
      this.toggleMembraneDebug();
    }

    // Handle heatmap controls - Task 5
    if (Phaser.Input.Keyboard.JustDown(this.keys.H)) {
      this.heatmapSystem.toggle();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.LEFT)) {
      this.heatmapSystem.prevSpecies();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.RIGHT)) {
      this.heatmapSystem.nextSpecies();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.P)) {
      // Toggle passive effects
      const firstEffect = this.passiveEffectsSystem.getAllEffects()[0];
      const newState = !firstEffect?.enabled;
      this.passiveEffectsSystem.setAllEffectsEnabled(newState);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.T)) {
      // Toggle conservation tracking / pause simulation
      this.conservationTracker.togglePause();
      this.updateConservationPanel();
    }

    // Debug species controls - Task 4
    this.handleDebugControls();

    // Blueprint system input handling - Milestone 5
    this.handleBlueprintInput();

    // Milestone 6: Membrane protein interaction handling - Task 7
    this.handleMembraneProteinInput();

    // Milestone 7 Task 6: Transcript pickup/carry mechanics
    this.handleTranscriptInput();

    // Update hex interaction
    this.updateHexInteraction();

    // Core movement system
    const deltaSeconds = this.game.loop.delta / 1000;
    this.updateMovement(deltaSeconds);
    
    // Milestone 6 Task 1: Update current tile tracking
    this.updateCurrentTile();
    
    // Update diffusion system - Task 3 (only if not paused)
    if (!this.conservationTracker.isPausedState()) {
      this.updateDiffusion(deltaSeconds);
      
      // Update blueprint construction - Milestone 5
      this.blueprintSystem.processConstruction(this.game.loop.delta);
    }
    
    // Update heatmap - Task 5
    this.heatmapSystem.update();
    
    // Update blueprint rendering - Milestone 5 Task 5
    this.blueprintRenderer.render();
    
    // Milestone 7 Task 7: Render transcript dots
    this.renderTranscripts();
    
    // Update build palette position to maintain fixed screen location
    this.buildPalette.updatePosition();
    
    // Update HUD with current information
    this.updateHUD();
    
    // Update conservation tracking - Task 8
    this.conservationTracker.update();
    this.updateConservationPanel();
    
    // Milestone 7 Task 3: Process nucleus transcription
    if (!this.conservationTracker.isPausedState()) {
      this.updateNucleusTranscription(deltaSeconds);
      // Task 4: Update transcript TTL and decay
      this.updateTranscriptDecay(deltaSeconds);
      // Task 5: Route transcripts toward ER
      this.updateTranscriptRouting(deltaSeconds);
    }
  }

  private updateMovement(deltaSeconds: number) {
    // Update dash timers
    if (this.dashTimer > 0) {
      this.dashTimer -= deltaSeconds;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        this.player.setMaxVelocity(this.normalMaxSpeed);
        this.ring.setScale(1).setAlpha(0.9);
      }
    }

    if (this.dashCooldown > 0) {
      this.dashCooldown -= deltaSeconds;
    }

    let vx = 0, vy = 0;
    
    // Handle dash input
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.dashCooldown <= 0 && !this.isDashing) {
      this.startDash();
    }

    // Get input direction
    vx = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    vy = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);

    const inputDir = new Phaser.Math.Vector2(vx, vy);
    const elasticForce = this.calculateElasticForces();
    
    if (inputDir.lengthSq() > 0) {
      inputDir.normalize();
      
      let baseAcceleration = this.acceleration;
      
      if (this.isDashing) {
        baseAcceleration *= 2.5;
      } else {
        const currentSpeed = this.player.body.velocity.length();
        const speedRatio = currentSpeed / this.normalMaxSpeed;
        baseAcceleration *= (1 - speedRatio * 0.3);
      }
      
      const inputForce = inputDir.scale(baseAcceleration);
      const totalForce = inputForce.add(elasticForce);
      this.player.setAcceleration(totalForce.x, totalForce.y);
    } else {
      const currentVel = this.player.body.velocity;
      const deceleration = 600;
      
      let totalForce = elasticForce.clone();
      
      if (currentVel.lengthSq() > 0) {
        const decelDir = currentVel.clone().normalize().scale(-deceleration);
        totalForce.add(decelDir);
        
        if (currentVel.lengthSq() < 100) {
          this.player.setVelocity(0, 0);
          totalForce.set(0, 0);
        }
      }
      
      this.player.setAcceleration(totalForce.x, totalForce.y);
    }

    this.updateCameraSmoothing();
    this.ring.setPosition(this.player.x, this.player.y);
  }

  /**
   * Milestone 6 Task 1: Update current tile tracking
   * Store the player's current tile each frame and update the debug label
   */
  private updateCurrentTile(): void {
    const newCurrentTile = this.getPlayerHex();
    const previousTile = this.currentTileRef;
    this.currentTileRef = newCurrentTile;

    // Update debug label
    if (newCurrentTile) {
      this.currentTileLabel.setText(`Current Tile: (${newCurrentTile.coord.q}, ${newCurrentTile.coord.r})`);
    } else {
      this.currentTileLabel.setText("Current Tile: outside grid");
    }

    // Milestone 6 Task 4 & 7: Update build palette filter when tile changes and handle menu state
    const tileChanged = (!previousTile && newCurrentTile) || 
                       (previousTile && !newCurrentTile) ||
                       (previousTile && newCurrentTile && 
                        (previousTile.coord.q !== newCurrentTile.coord.q || 
                         previousTile.coord.r !== newCurrentTile.coord.r));

    if (tileChanged) {
      // Update build palette filter if it's open
      if (this.buildPalette && this.buildPalette.getIsVisible()) {
        this.updateBuildPaletteFilter();
      }

      // Task 7: Close menu if player moves off tile while menu is open
      if (!newCurrentTile && this.buildPalette && this.buildPalette.getIsVisible()) {
        this.buildPalette.hide();
        this.isInBuildMode = false;
        this.selectedRecipeId = null;
      }
    }
  }

  /**
   * Milestone 6 Task 2: Show a temporary toast message
   */
  private showToast(message: string, duration: number = 2000): void {
    this.toastText.setText(message);
    this.toastText.setVisible(true);
    
    // Clear any existing toast timer
    if (this.toastText.getData('timer')) {
      this.toastText.getData('timer').remove();
    }
    
    // Set new timer to hide toast
    const timer = this.time.delayedCall(duration, () => {
      this.toastText.setVisible(false);
    });
    this.toastText.setData('timer', timer);
  }

  private startDash() {
    this.isDashing = true;
    this.dashTimer = this.dashDuration;
    this.dashCooldown = this.maxDashCooldown;
    
    this.player.setMaxVelocity(this.dashSpeed);
    
    // Visual feedback
    this.ring.setScale(1.8).setAlpha(1).setTint(0xffdd44);
    this.tweens.add({
      targets: this.ring,
      scale: 1,
      alpha: 0.9,
      duration: this.dashDuration * 1000,
      ease: "Back.easeOut"
    });
    
    this.time.delayedCall(this.dashDuration * 1000, () => {
      this.ring.setTint(0xffffff);
    });

    this.cameras.main.shake(80, 0.008);
    
    const originalZoom = this.cameras.main.zoom;
    this.cameras.main.setZoom(originalZoom * 1.05);
    this.tweens.add({
      targets: this.cameras.main,
      zoom: originalZoom,
      duration: this.dashDuration * 800,
      ease: "Power2"
    });
  }

  private calculateElasticForces(): Phaser.Math.Vector2 {
    const force = new Phaser.Math.Vector2(0, 0);
    const playerPos = new Phaser.Math.Vector2(this.player.x, this.player.y);
    
    const distanceFromCenter = Phaser.Math.Distance.BetweenPoints(playerPos, this.cellCenter);
    const maxDistance = this.cellRadius - this.player.width / 2;
    
    if (distanceFromCenter > maxDistance) {
      const penetration = distanceFromCenter - maxDistance;
      const directionToCenter = new Phaser.Math.Vector2(
        this.cellCenter.x - playerPos.x,
        this.cellCenter.y - playerPos.y
      ).normalize();
      
      const springForce = directionToCenter.scale(penetration * this.membraneSpringForce);
      force.add(springForce);
      
      if (this.time.now - this.lastMembraneHit > 200) {
        this.lastMembraneHit = this.time.now;
        this.createMembraneRipple(playerPos);
      }
    }
    
    return force;
  }

  private createMembraneRipple(position: Phaser.Math.Vector2) {
    const ripple = this.add.circle(position.x, position.y, 20, 0x66ccff, 0.3);
    ripple.setDepth(2);
    
    this.tweens.add({
      targets: ripple,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 300,
      ease: "Power2",
      onComplete: () => ripple.destroy()
    });
  }

  private updateCameraSmoothing() {
    this.cameraSmoothTarget.set(this.player.x, this.player.y);
    
    const currentCenterX = this.cameras.main.scrollX + this.cameras.main.width / 2;
    const currentCenterY = this.cameras.main.scrollY + this.cameras.main.height / 2;
    
    const newCenterX = Phaser.Math.Linear(currentCenterX, this.cameraSmoothTarget.x, this.cameraLerpSpeed);
    const newCenterY = Phaser.Math.Linear(currentCenterY, this.cameraSmoothTarget.y, this.cameraLerpSpeed);
    
    this.cameras.main.centerOn(newCenterX, newCenterY);
  }

  // Hex Grid System
  private initializeHexGrid(): void {
    console.log('Initializing hex grid...');
    
    // Task 1: Log species registry
    console.log('Species Registry:');
    const allSpecies = getAllSpecies();
    allSpecies.forEach(species => {
      console.log(`  ${species.id}: ${species.label} (diffusion: ${species.diffusionCoefficient})`);
    });
    console.log(`Total species: ${allSpecies.length}`);
    
    this.hexGrid = new HexGrid(this.hexSize, this.cellCenter.x, this.cellCenter.y);
    this.hexGrid.generateTiles(this.gridRadius);
    
    const maxDistance = this.cellRadius - this.hexSize;
    this.hexGrid.filterTilesInCircle(this.cellCenter.x, this.cellCenter.y, maxDistance);
    
    // Milestone 6 Task 1: Compute membrane tiles
    this.hexGrid.recomputeMembranes(this.cellCenter.x, this.cellCenter.y, this.cellRadius);
    
    console.log(`Hex Grid initialized:
      - Tiles: ${this.hexGrid.getTileCount()}
      - Hex size: ${this.hexSize}
      - Grid radius: ${this.gridRadius}
      - Cell radius: ${this.cellRadius}
      - Max distance: ${maxDistance}
      - Cell center: (${this.cellCenter.x}, ${this.cellCenter.y})`);
    
    // Test coordinate conversion and neighbors
    const testTiles = this.hexGrid.getAllTiles().slice(0, 3);
    testTiles.forEach((tile, i) => {
      const neighbors = this.hexGrid.getNeighbors(tile.coord);
      console.log(`Tile ${i}: coord(${tile.coord.q},${tile.coord.r}) world(${Math.round(tile.worldPos.x)},${Math.round(tile.worldPos.y)}) neighbors: ${neighbors.length}`);
    });
    
    // Test center tile conversion
    const centerTile = this.hexGrid.getTile({ q: 0, r: 0 });
    if (centerTile) {
      const backToHex = this.hexGrid.worldToHex(centerTile.worldPos.x, centerTile.worldPos.y);
      console.log(`Center tile test: original(0,0) -> world(${Math.round(centerTile.worldPos.x)}, ${Math.round(centerTile.worldPos.y)}) -> back to hex(${backToHex.q}, ${backToHex.r})`);
    }
    
    console.log('Hex grid initialization complete!');
  }

  private initializeHexGraphics(): void {
    this.hexGraphics = this.add.graphics();
    this.hexGraphics.setDepth(1.5); // Above background, below organelles
    this.hexGraphics.setVisible(this.showHexGrid);
    this.renderHexGrid();
    
    // Milestone 6: Initialize membrane debug graphics
    this.initializeMembraneGraphics();
  }

  private initializeMembraneGraphics(): void {
    this.membraneGraphics = this.add.graphics();
    this.membraneGraphics.setDepth(1.6); // Above hex grid, below organelles
    this.membraneGraphics.setVisible(true); // Always visible now that it contains protein glyphs
    // Note: renderMembraneDebug() will be called after membrane exchange system is initialized
  }

  private renderMembraneDebug(): void {
    if (!this.hexGrid || !this.membraneGraphics) return;
    
    this.membraneGraphics.clear();
    
    // Clean up old transporter labels
    for (const label of this.transporterLabels) {
      label.destroy();
    }
    this.transporterLabels = [];
    
    // Clean up old protein glyphs
    for (const glyph of this.proteinGlyphs) {
      glyph.destroy();
    }
    this.proteinGlyphs = [];
    
    const membraneTiles = this.hexGrid.getMembraneTiles();
    
    // Only draw membrane outline/fill if debug mode is on
    if (this.showMembraneDebug) {
      // Draw membrane tiles with a distinct outline
      this.membraneGraphics.lineStyle(2, 0xff4444, 0.8); // Red outline
      this.membraneGraphics.fillStyle(0xff4444, 0.2); // Semi-transparent red fill
      
      for (const tile of membraneTiles) {
        // Draw each hexagon individually for proper fill and stroke
        this.membraneGraphics.beginPath();
        this.drawSingleHexagon(tile.worldPos.x, tile.worldPos.y, this.hexSize);
        this.membraneGraphics.fillPath();
        this.membraneGraphics.strokePath();
      }
      
      // Draw transporter indicators
      this.membraneGraphics.lineStyle(2, 0x00ff00, 1.0); // Green for transporters
      this.membraneGraphics.fillStyle(0x00ff00, 0.6); // Semi-transparent green fill
      
      for (const tile of membraneTiles) {
        const transporters = this.membraneExchangeSystem.getTransportersAt(tile.coord);
        if (transporters.length > 0) {
          // Draw small circles to indicate transporters
          const radius = this.hexSize * 0.3;
          this.membraneGraphics.fillCircle(tile.worldPos.x, tile.worldPos.y, radius);
          this.membraneGraphics.strokeCircle(tile.worldPos.x, tile.worldPos.y, radius);
          
          // Add text label showing number of transporters
          if (transporters.length > 1) {
            const label = this.add.text(tile.worldPos.x, tile.worldPos.y, transporters.length.toString(), {
              fontSize: '12px',
              fontFamily: 'Arial',
              color: '#ffffff',
              backgroundColor: '#000000',
              padding: { x: 2, y: 2 }
            });
            label.setOrigin(0.5, 0.5);
            label.setDepth(10);
            this.transporterLabels.push(label);
          }
        }
      }
      
      console.log(`Membrane debug rendered: ${membraneTiles.length} membrane tiles`);
    }
    
    // Always render protein glyphs (regardless of debug mode)
    this.renderProteinGlyphsAsGraphics();
  }

  private renderProteinGlyphsAsGraphics(): void {
    if (!this.hexGrid || !this.membraneExchangeSystem) return;
    
    const membraneTiles = this.hexGrid.getMembraneTiles();
    let glyphsRendered = 0;
    
    for (const tile of membraneTiles) {
      const installedProtein = this.membraneExchangeSystem.getInstalledProtein(tile.coord);
      if (installedProtein) {
        // Draw a colored circle with a symbol inside using graphics
        this.membraneGraphics.lineStyle(1, 0x000000, 1.0); // Black outline
        
        if (installedProtein.kind === 'transporter') {
          const color = installedProtein.direction === 'in' ? 0x00ff88 : 0xff8800;
          this.membraneGraphics.fillStyle(color, 0.8);
          this.membraneGraphics.lineStyle(2, 0x000000, 1.0); // Black outline for circle
          const radius = this.hexSize * 0.3; // Smaller circle to make room for arrow
          this.membraneGraphics.fillCircle(tile.worldPos.x, tile.worldPos.y, radius);
          this.membraneGraphics.strokeCircle(tile.worldPos.x, tile.worldPos.y, radius);
          
          // Calculate direction toward/away from cell center for more intuitive arrows
          const centerX = this.cellCenter.x;
          const centerY = this.cellCenter.y;
          const deltaX = tile.worldPos.x - centerX;
          const deltaY = tile.worldPos.y - centerY;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          
          // Normalize to unit vector
          const unitX = deltaX / distance;
          const unitY = deltaY / distance;
          
          // Arrow properties
          this.membraneGraphics.lineStyle(1, 0xffffff, 1.0); // Thick white arrow for visibility
          const arrowLength = this.hexSize * 0.4;
          const arrowHeadSize = this.hexSize * 0.2;
          
          if (installedProtein.direction === 'in') {
            // Arrow points TOWARD center (import)
            const startX = tile.worldPos.x + unitX * (radius + 4);
            const startY = tile.worldPos.y + unitY * (radius + 4);
            const endX = startX - unitX * arrowLength;
            const endY = startY - unitY * arrowLength;
            
            // Arrow shaft
            this.membraneGraphics.lineBetween(startX, startY, endX, endY);
            
            // Arrow head (pointing toward center)
            const perpX = -unitY; // Perpendicular vector
            const perpY = unitX;
            this.membraneGraphics.lineBetween(
              endX, endY,
              endX + unitX * arrowHeadSize + perpX * arrowHeadSize * 0.5,
              endY + unitY * arrowHeadSize + perpY * arrowHeadSize * 0.5
            );
            this.membraneGraphics.lineBetween(
              endX, endY,
              endX + unitX * arrowHeadSize - perpX * arrowHeadSize * 0.5,
              endY + unitY * arrowHeadSize - perpY * arrowHeadSize * 0.5
            );
          } else {
            // Arrow points AWAY from center (export)
            const startX = tile.worldPos.x - unitX * (radius + 4);
            const startY = tile.worldPos.y - unitY * (radius + 4);
            const endX = startX + unitX * arrowLength;
            const endY = startY + unitY * arrowLength;
            
            // Arrow shaft
            this.membraneGraphics.lineBetween(startX, startY, endX, endY);
            
            // Arrow head (pointing away from center)
            const perpX = -unitY; // Perpendicular vector
            const perpY = unitX;
            this.membraneGraphics.lineBetween(
              endX, endY,
              endX - unitX * arrowHeadSize + perpX * arrowHeadSize * 0.5,
              endY - unitY * arrowHeadSize + perpY * arrowHeadSize * 0.5
            );
            this.membraneGraphics.lineBetween(
              endX, endY,
              endX - unitX * arrowHeadSize - perpX * arrowHeadSize * 0.5,
              endY - unitY * arrowHeadSize - perpY * arrowHeadSize * 0.5
            );
          }
        } else if (installedProtein.kind === 'receptor') {
          // Draw receptor as a square
          this.membraneGraphics.fillStyle(0xff44ff, 0.8);
          const size = this.hexSize * 0.6;
          this.membraneGraphics.fillRect(tile.worldPos.x - size/2, tile.worldPos.y - size/2, size, size);
          this.membraneGraphics.strokeRect(tile.worldPos.x - size/2, tile.worldPos.y - size/2, size, size);
        }
        
        glyphsRendered++;
      }
    }
    
    // Only log when there are actually glyphs to render, and less frequently
    if (glyphsRendered > 0 && Math.random() < 0.01) { // 1% chance to log
      console.log(`🎨 Rendered ${glyphsRendered} protein glyphs as graphics`);
    }
  }

  private updateProteinGlyphs(): void {
    // Clear existing glyphs
    for (const glyph of this.proteinGlyphs) {
      glyph.destroy();
    }
    this.proteinGlyphs = [];
    
    // Re-render membrane graphics which now includes protein glyphs
    this.renderMembraneDebug();
  }

  private drawSingleHexagon(x: number, y: number, size: number): void {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      
      if (i === 0) {
        this.membraneGraphics.moveTo(px, py);
      } else {
        this.membraneGraphics.lineTo(px, py);
      }
    }
    this.membraneGraphics.closePath();
  }

  private renderHexGrid(): void {
    if (!this.hexGrid || !this.hexGraphics) return;
    
    this.hexGraphics.clear();
    this.hexGraphics.lineStyle(1, 0x88ddff, 0.3);
    
    const tiles = this.hexGrid.getAllTiles();
    this.hexGraphics.beginPath();
    
    for (const tile of tiles) {
      this.addHexagonToPath(tile.worldPos.x, tile.worldPos.y, this.hexSize);
    }
    
    this.hexGraphics.strokePath();
  }

  private addHexagonToPath(x: number, y: number, size: number): void {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      
      if (i === 0) {
        this.hexGraphics.moveTo(px, py);
      } else {
        this.hexGraphics.lineTo(px, py);
      }
    }
    this.hexGraphics.closePath();
  }

  private toggleHexGrid(): void {
    this.showHexGrid = !this.showHexGrid;
    if (this.hexGraphics) {
      this.hexGraphics.setVisible(this.showHexGrid);
    }
    if (this.organelleRenderer) {
      this.organelleRenderer.setVisible(this.showHexGrid);
    }
    console.log(`Hex grid ${this.showHexGrid ? 'shown' : 'hidden'}`);
  }

  private toggleMembraneDebug(): void {
    this.showMembraneDebug = !this.showMembraneDebug;
    if (this.membraneGraphics) {
      this.membraneGraphics.setVisible(this.showMembraneDebug);
      this.renderMembraneDebug();
    }
    console.log(`Membrane debug ${this.showMembraneDebug ? 'shown' : 'hidden'}`);
  }

  // Hex Interaction System
  private initializeHexInteraction(): void {
    this.hexInteractionGraphics = this.add.graphics();
    this.hexInteractionGraphics.setDepth(1.6); // Above hex grid, below organelles
    
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerdown', this.onPointerDown, this);
  }

  private updateHexInteraction(): void {
    this.renderHexInteractionHighlights();
    this.updateTileInfoPanel();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.hexGrid) return;
    
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;
    const tile = this.hexGrid.getTileAtWorld(worldX, worldY);
    
    this.hoveredTile = tile || null;
    
    // Milestone 6 Task 3: Mouse hover only for info, not for actions
    // Removed build palette filter update - that's now based on current tile only
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.hexGrid) return;
    
    if (pointer.leftButtonDown()) {
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const tile = this.hexGrid.getTileAtWorld(worldX, worldY);
      
      // Milestone 6 Task 3: Mouse click only for tile selection (info), not actions
      // Remove blueprint placement - that's now handled by ENTER key on current tile
      
      // Normal tile selection for info/inspection
      this.selectedTile = tile || null;
      
      if (tile) {
        console.log(`Clicked: mouse world(${Math.round(worldX)}, ${Math.round(worldY)}) -> hex(${tile.coord.q}, ${tile.coord.r}) at world(${Math.round(tile.worldPos.x)}, ${Math.round(tile.worldPos.y)})`);
      } else {
        console.log(`Clicked: mouse world(${Math.round(worldX)}, ${Math.round(worldY)}) -> no hex found`);
      }
    }
  }

  private renderHexInteractionHighlights(): void {
    if (!this.hexInteractionGraphics) return;
    
    this.hexInteractionGraphics.clear();
    
    // Milestone 6 Task 4: Current tile highlight (soft ring or pulse)
    if (this.currentTileRef) {
      this.hexInteractionGraphics.fillStyle(0xffcc00, 0.15); // Soft yellow fill
      this.hexInteractionGraphics.lineStyle(2, 0xffcc00, 0.6); // Yellow ring
      this.drawHexagonHighlight(this.currentTileRef.worldPos.x, this.currentTileRef.worldPos.y, this.hexSize);
    }
    
    // Blueprint preview in build mode (now uses current tile)
    if (this.isInBuildMode && this.selectedRecipeId && this.currentTileRef) {
      this.renderBlueprintPreview();
    }
    
    // Selected tile highlight (only if not in build mode and different from current tile)
    if (this.selectedTile && !this.isInBuildMode) {
      const isDifferentFromCurrent = !this.currentTileRef || 
        (this.selectedTile.coord.q !== this.currentTileRef.coord.q || 
         this.selectedTile.coord.r !== this.currentTileRef.coord.r);
      
      if (isDifferentFromCurrent) {
        this.hexInteractionGraphics.fillStyle(0x66ffcc, 0.2);
        this.hexInteractionGraphics.lineStyle(2, 0x66ffcc, 0.8);
        this.drawHexagonHighlight(this.selectedTile.worldPos.x, this.selectedTile.worldPos.y, this.hexSize);
      }
    }
    
    // Hovered tile highlight (only if not in build mode and different from current and selected)
    if (this.hoveredTile && !this.isInBuildMode) {
      const isDifferentFromCurrent = !this.currentTileRef || 
        (this.hoveredTile.coord.q !== this.currentTileRef.coord.q || 
         this.hoveredTile.coord.r !== this.currentTileRef.coord.r);
      const isDifferentFromSelected = !this.selectedTile ||
        (this.hoveredTile.coord.q !== this.selectedTile.coord.q || 
         this.hoveredTile.coord.r !== this.selectedTile.coord.r);
      
      if (isDifferentFromCurrent && isDifferentFromSelected) {
        this.hexInteractionGraphics.fillStyle(0x88ddff, 0.1);
        this.hexInteractionGraphics.lineStyle(1, 0x88ddff, 0.5);
        this.drawHexagonHighlight(this.hoveredTile.worldPos.x, this.hoveredTile.worldPos.y, this.hexSize);
      }
    }
  }

  private renderBlueprintPreview(): void {
    if (!this.selectedRecipeId || !this.currentTileRef) return;
    
    const validation = this.blueprintSystem.validatePlacement(
      this.selectedRecipeId,
      this.currentTileRef.coord.q,
      this.currentTileRef.coord.r
    );
    
    // Use red for invalid, green for valid
    const color = validation.isValid ? 0x00ff00 : 0xff0000;
    const alpha = validation.isValid ? 0.3 : 0.2;
    
    this.hexInteractionGraphics.fillStyle(color, alpha);
    this.hexInteractionGraphics.lineStyle(2, color, 0.8);
    
    // Draw all footprint tiles
    for (const tile of validation.footprintTiles) {
      const hexTile = this.hexGrid.getTile({ q: tile.q, r: tile.r });
      if (hexTile) {
        this.drawHexagonHighlight(hexTile.worldPos.x, hexTile.worldPos.y, this.hexSize);
      }
    }
  }

  private drawHexagonHighlight(x: number, y: number, size: number): void {
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      points.push(px, py);
    }
    
    this.hexInteractionGraphics.beginPath();
    this.hexInteractionGraphics.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) {
      this.hexInteractionGraphics.lineTo(points[i], points[i + 1]);
    }
    this.hexInteractionGraphics.closePath();
    this.hexInteractionGraphics.fillPath();
    this.hexInteractionGraphics.strokePath();
  }

  // Tile Info Debug Panel
  private initializeTileInfoPanel(): void {
    this.tileInfoPanel = this.add.text(14, 50, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#88ddff",
      backgroundColor: "#000000",
      padding: { x: 8, y: 4 },
      stroke: "#444444",
      strokeThickness: 1,
    });
    
    this.tileInfoPanel.setDepth(1001);
    this.tileInfoPanel.setScrollFactor(0);
    this.tileInfoPanel.setVisible(false);
  }

  private updateTileInfoPanel(): void {
    if (!this.tileInfoPanel) return;
    
    if (this.selectedTile) {
      const tile = this.selectedTile;
      const concentrations = tile.concentrations;
      
      const info = [
        `Hex Tile Info:`,
        `Coord: (${tile.coord.q}, ${tile.coord.r})`,
        `World: (${Math.round(tile.worldPos.x)}, ${Math.round(tile.worldPos.y)})`
      ];
      
      // Check for organelle on this tile
      const organelle = this.organelleSystem.getOrganelleAtTile(tile.coord);
      if (organelle) {
        info.push(...this.organelleSystem.getOrganelleInfo(tile.coord));
        info.push(''); // Add spacing
      }
      
      // Check for blueprint on this tile
      const blueprint = this.blueprintSystem.getBlueprintAtTile(tile.coord.q, tile.coord.r);
      if (blueprint) {
        const recipe = CONSTRUCTION_RECIPES.getRecipe(blueprint.recipeId);
        info.push(`🔨 Blueprint: ${recipe?.label}`);
        
        // Show progress for each species requirement
        for (const [speciesId, requiredAmount] of Object.entries(recipe?.buildCost || {})) {
          const currentProgress = blueprint.progress[speciesId as SpeciesId] || 0;
          const percent = Math.round((currentProgress / requiredAmount) * 100);
          const status = currentProgress >= requiredAmount ? '✅' : '⏳';
          info.push(`  ${status} ${speciesId}: ${currentProgress.toFixed(1)}/${requiredAmount} (${percent}%)`);
        }
        
        info.push(`Press X to cancel (50% refund)`);
        info.push(''); // Add spacing
      }
      
      // Milestone 6: Membrane and organelle info
      if (tile.isMembrane) {
        info.push(`🧬 Membrane Tile`);
        
        // Check for installed membrane proteins (new system)
        const installedProtein = this.membraneExchangeSystem.getInstalledProtein(tile.coord);
        if (installedProtein) {
          info.push(`🔬 Installed: ${installedProtein.label}`);
          
          if (installedProtein.kind === 'transporter') {
            const direction = installedProtein.direction === 'in' ? '⬇️ Import' : '⬆️ Export';
            info.push(`  ${direction} ${installedProtein.speciesId}: ${installedProtein.ratePerTick}/tick`);
          } else if (installedProtein.kind === 'receptor') {
            info.push(`  🔥 Signal: ${installedProtein.messengerId} (${installedProtein.messengerRate}/tick)`);
            info.push(`  📡 Ligand: ${installedProtein.ligandId}`);
          }
          
          info.push(`Use X to uninstall (future feature)`);
        } else {
          // Check if there's a membrane organelle built on this tile
          if (organelle && (organelle.type === 'membrane-port' || organelle.type === 'transporter' || organelle.type === 'receptor')) {
            // Show installation options for built organelles
            info.push(`🔧 Ready for protein installation`);
            info.push(`Press number keys:`);
            info.push(`  1: GLUT (Glucose import)`);
            info.push(`  2: AA Transporter`);
            info.push(`  3: NT Transporter`);
            info.push(`  4: ROS Exporter`);
            info.push(`  5: Secretion Pump (Cargo export)`);
            info.push(`  6: Growth Factor Receptor`);
          } else {
            // No organelle built - can't install proteins
            info.push(`❌ Build a transporter or receptor here first`);
            info.push(`Use build mode (B) to place organelles`);
            
            // Show legacy transporters if any
            const transporters = this.membraneExchangeSystem.getTransportersAt(tile.coord);
            if (transporters.length > 0) {
              info.push(`🚛 Legacy Transporters:`);
              for (const transporter of transporters) {
                const direction = transporter.fluxRate > 0 ? '⬇️' : '⬆️';
                info.push(`  ${direction} ${transporter.type}: ${transporter.speciesId} ${transporter.fluxRate > 0 ? '+' : ''}${transporter.fluxRate}/sec`);
              }
            }
          }
        }
        info.push(''); // Add spacing
      }
      
      info.push(`Species Concentrations:`);
      
      // Show all species concentrations
      for (const speciesId in concentrations) {
        const concentration = concentrations[speciesId];
        info.push(`  ${speciesId}: ${concentration.toFixed(2)}`);
      }
      
      this.tileInfoPanel.setText(info.join('\n'));
      this.tileInfoPanel.setVisible(true);
    } else {
      this.tileInfoPanel.setVisible(false);
    }
  }

  // Debug Info Panel - Task 4
  
  private initializeDebugInfo(): void {
    const debugText = [
      "B - Build menu",
      "ENTER - Confirm build",
      "X - Cancel blueprint",
      "Q/E - Scoop/Drop",
      "1-6 - Install proteins",
      "DEBUG CONTROLS:",
      "G - Toggle hex grid",
      "H - Toggle heatmap",
      "← → - Cycle species",
      "P - Toggle passive effects",
      "T - Pause/show conservation",
      "M - Toggle membrane debug",
      "F - Instant construction",
      "Click tile to inspect",
      "C - Clear selected tile"
    ].join('\n');

    this.debugInfoPanel = this.add.text(14, 600, debugText, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#88ddff",
      backgroundColor: "#000000",
      padding: { x: 6, y: 4 },
      stroke: "#444444",
      strokeThickness: 1,
    });
    
    this.debugInfoPanel.setDepth(1001);
    this.debugInfoPanel.setScrollFactor(0);

    // Milestone 6 Task 1: Initialize current tile label
    this.currentTileLabel = this.add.text(600, 5, "Current Tile: none", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#ffcc00",
      backgroundColor: "#000000",
      padding: { x: 6, y: 4 },
      stroke: "#444444",
      strokeThickness: 1,
    });
    this.currentTileLabel.setDepth(1002);
    this.currentTileLabel.setScrollFactor(0);

    // Milestone 6 Task 2: Initialize toast system
    this.toastText = this.add.text(this.scale.width / 2, 100, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ffaa00",
      backgroundColor: "#000000",
      padding: { x: 8, y: 6 },
      stroke: "#444444",
      strokeThickness: 1,
    });
    this.toastText.setOrigin(0.5, 0.5);
    this.toastText.setDepth(1003);
    this.toastText.setScrollFactor(0);
    this.toastText.setVisible(false);
  }

  // Milestone 7 Task 1: Initialize transcript system
  private initializeTranscriptSystem(): void {
    // Graphics for rendering transcript dots
    this.transcriptGraphics = this.add.graphics();
    this.transcriptGraphics.setDepth(3.5); // Above organelles, below player
    
    console.log('Transcript system initialized');
  }

  /**
   * Milestone 7 Task 7: Render transcript dots
   * Show transcripts as colored dots with TTL-based alpha
   */
  private renderTranscripts(): void {
    this.transcriptGraphics.clear();
    
    // Protein type to color mapping
    const proteinColors: Record<ProteinId, number> = {
      'GLUT': 0xFFFF00,              // Yellow - glucose transporter
      'AA_TRANSPORTER': 0x00FF00,    // Green - amino acid transporter  
      'NT_TRANSPORTER': 0x0088FF,    // Blue - nucleotide transporter
      'ROS_EXPORTER': 0xFF4444,      // Red - ROS exporter
      'SECRETION_PUMP': 0xFF88FF,    // Magenta - secretion pump
      'GROWTH_FACTOR_RECEPTOR': 0x888888 // Gray - growth factor receptor
    };
    
    for (const transcript of this.transcripts.values()) {
      // Skip carried transcripts (they'll be rendered near player)
      if (transcript.isCarried) continue;
      
      const color = proteinColors[transcript.proteinId] || 0xFFFFFF;
      
      // Calculate alpha based on TTL (fade as it approaches expiration)
      const maxTTL = 15; // seconds
      const alphaFactor = Math.max(0.3, Math.min(1.0, transcript.ttlSeconds / maxTTL));
      
      // Draw transcript dot
      this.transcriptGraphics.fillStyle(color, alphaFactor);
      this.transcriptGraphics.fillCircle(
        transcript.worldPos.x,
        transcript.worldPos.y,
        4 // radius
      );
      
      // Add a subtle pulse effect for recently created transcripts
      if (transcript.ttlSeconds > maxTTL * 0.8) {
        const pulseScale = 1 + 0.3 * Math.sin(Date.now() * 0.01);
        this.transcriptGraphics.fillStyle(color, 0.3);
        this.transcriptGraphics.fillCircle(
          transcript.worldPos.x,
          transcript.worldPos.y,
          4 * pulseScale
        );
      }
    }
    
    // Render carried transcripts near player with a different visual
    if (this.carriedTranscripts.length > 0) {
      const playerX = this.player.x;
      const playerY = this.player.y;
      
      for (let i = 0; i < this.carriedTranscripts.length; i++) {
        const transcript = this.carriedTranscripts[i];
        const color = proteinColors[transcript.proteinId] || 0xFFFFFF;
        
        // Position carried transcripts in a small orbit around player
        const angle = (i / this.carriedTranscripts.length) * Math.PI * 2;
        const orbitRadius = 12;
        const x = playerX + Math.cos(angle) * orbitRadius;
        const y = playerY + Math.sin(angle) * orbitRadius;
        
        // Update carried transcript world position for consistency
        transcript.worldPos.set(x, y);
        
        // Draw with a distinct border to show it's carried
        this.transcriptGraphics.lineStyle(1, 0xFFFFFF, 0.8);
        this.transcriptGraphics.fillStyle(color, 0.9);
        this.transcriptGraphics.fillCircle(x, y, 3);
        this.transcriptGraphics.strokeCircle(x, y, 3);
      }
    }
  }

  // Conservation Tracking - Task 8
  
  private initializeConservationTracker(): void {
    this.conservationTracker = new ConservationTracker(this.hexGrid, this.passiveEffectsSystem);
    
    this.conservationPanel = this.add.text(14, 750, "", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#ffcc88",
      backgroundColor: "#000000",
      padding: { x: 6, y: 4 },
      stroke: "#444444",
      strokeThickness: 1,
    });
    
    this.conservationPanel.setDepth(1001);
    this.conservationPanel.setScrollFactor(0);
    this.conservationPanel.setVisible(false);
    
    console.log('Conservation tracker initialized');
  }

  // Organelle System - Milestone 3 Task 1
  
  private initializeOrganelleSystem(): void {
    this.organelleSystem = new OrganelleSystem(this.hexGrid);
    this.organelleRenderer = new OrganelleRenderer(this, this.organelleSystem, this.hexSize);
    this.organelleSelection = new OrganelleSelectionSystem(this, this.organelleSystem, this.hexSize);
    
    // Set up selection callback
    this.organelleSelection.onSelectionChanged = (organelle) => {
      if (organelle) {
        console.log(`Selected organelle: ${organelle.config.label} (${organelle.id})`);
      } else {
        console.log('Selection cleared');
      }
    };
    
    // Always show organelles when grid is visible
    this.organelleRenderer.setVisible(this.showHexGrid);
    
    console.log('Organelle system initialized');
  }

  // Player Inventory System - Milestone 4 Task 1
  
  private initializePlayerInventory(): void {
    this.playerInventory = new PlayerInventorySystem(50); // Max capacity of 50 units
    console.log('Player inventory system initialized');
  }

  // Blueprint System - Milestone 5
  
  private initializeBlueprintSystem(): void {
    // Initialize blueprint system with reference to organelle occupied tiles and membrane exchange system
    this.blueprintSystem = new BlueprintSystem(
      this.hexGrid, 
      () => this.organelleSystem.getOccupiedTiles(),
      (organelleType: OrganelleType, coord: HexCoord) => this.spawnOrganelleFromBlueprint(organelleType, coord),
      this.membraneExchangeSystem
    );
    
    // Initialize build palette UI
    this.buildPalette = new BuildPaletteUI(this, 350, 50);
    this.buildPalette.onRecipeSelected = (recipeId: OrganelleType) => {
      this.selectedRecipeId = recipeId;
      this.isInBuildMode = true;
      console.log(`Entered build mode with recipe: ${recipeId}`);
    };
    
    // Initialize blueprint renderer
    this.blueprintRenderer = new BlueprintRenderer(this, this.blueprintSystem, this.hexSize);
    
    console.log('Blueprint system initialized');
  }

  private spawnOrganelleFromBlueprint(organelleType: OrganelleType, coord: HexCoord): void {
    console.log(`🔧 spawnOrganelleFromBlueprint called: type="${organelleType}", coord=(${coord.q}, ${coord.r})`);
    
    // Use centralized organelle registry instead of hardcoded mapping
    const definition = getOrganelleDefinition(organelleType);
    if (definition) {
      const config = definitionToConfig(definition);
      console.log(`📍 Creating organelle with config:`, config);
      const success = this.organelleSystem.createOrganelle(config, coord);
      console.log(`🏗️ Organelle creation result: ${success}`);
      console.log(`✅ Spawned ${config.label} at (${coord.q}, ${coord.r})`);
      
      // Force visual update to show the new organelle immediately
      if (success && this.organelleRenderer) {
        this.organelleRenderer.update();
        console.log(`🎨 Organelle renderer updated after spawning ${config.label}`);
      }
      
      // Force an update of the tile info panel if this tile is selected
      if (this.selectedTile && this.selectedTile.coord.q === coord.q && this.selectedTile.coord.r === coord.r) {
        console.log(`🔄 Selected tile matches spawned organelle, updating info panel`);
        this.updateTileInfoPanel();
      }
    } else {
      console.warn(`Unknown organelle type for blueprint completion: ${organelleType}`);
    }
  }

  private updateHUD(): void {
    const heatmapInfo = this.heatmapSystem.getCurrentSpeciesInfo();
    const heatmapStatus = `Heatmap: ${heatmapInfo.label} (${heatmapInfo.index}/${heatmapInfo.total})`;
    
    // Player inventory status
    const loadRatio = this.playerInventory.getLoadRatio();
    const loadBar = this.createLoadBar(loadRatio);
    const inventoryStatus = `Inventory: ${loadBar} ${this.playerInventory.getCurrentLoad().toFixed(0)}/${this.playerInventory.getMaxCapacity()}`;
    
    // Blueprint status (Task 10 UX polish)
    let blueprintStatus = '';
    if (this.isInBuildMode && this.selectedRecipeId) {
      const recipe = CONSTRUCTION_RECIPES.getRecipe(this.selectedRecipeId);
      blueprintStatus = ` | 🔨 Building: ${recipe?.label}`;
    }
    
    // Milestone 7 Task 8: Transcript and order status
    const carriedCount = this.carriedTranscripts.length;
    const totalTranscripts = this.transcripts.size;
    const pendingOrders = this.installOrders.size;
    const transcriptStatus = `Transcripts: ${carriedCount}/2 carried, ${totalTranscripts} total | Orders: ${pendingOrders} pending`;
    
    // Milestone 6 Task 8: Updated control hints for current-tile interaction  
    // Milestone 7: Added transcript controls
    const controls = `B: Build/Request | ENTER: Confirm | X: Cancel | Q/E: Scoop/Drop | R: Pickup/Drop transcript | Shift+R: Drop all transcripts`;
    const message = `${heatmapStatus} | ${inventoryStatus}${blueprintStatus} | ${transcriptStatus} | ${controls}`;
    
    setHud(this, { message });
  }

  /**
   * Create a visual load bar for inventory
   */
  private createLoadBar(ratio: number): string {
    const barLength = 8;
    const filled = Math.floor(ratio * barLength);
    const empty = barLength - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  private updateConservationPanel(): void {
    if (!this.conservationPanel || !this.conservationTracker) return;
    
    const isPaused = this.conservationTracker.isPausedState();
    if (isPaused) {
      const report = this.conservationTracker.getSummaryReport();
      this.conservationPanel.setText(report.join('\n'));
      this.conservationPanel.setVisible(true);
    } else {
      this.conservationPanel.setVisible(false);
    }
  }

  // Heatmap System - Task 5
  
  private initializeHeatmapSystem(): void {
    this.heatmapSystem = new HeatmapSystem(this, this.hexGrid, this.hexSize);
    // Start with heatmap visible
    this.heatmapSystem.toggle();
    console.log('Heatmap system initialized and visible');
  }

  // Passive Effects System - Task 6
  
  private initializePassiveEffectsSystem(): void {
    this.passiveEffectsSystem = new PassiveEffectsSystem(this.hexGrid);
    console.log('Passive effects system initialized');
    
    const effects = this.passiveEffectsSystem.getActiveSummary();
    console.log('Active passive effects:', effects);
  }

  // Diffusion System - Task 3
  
  private initializeDiffusionSystem(): void {
    this.diffusionSystem = new DiffusionSystem(this.hexGrid);
    console.log('Diffusion system initialized');
  }

  private initializeMembraneExchangeSystem(): void {
    this.membraneExchangeSystem = new MembraneExchangeSystem(this.hexGrid);
    console.log('Membrane exchange system initialized');
  }

  private updateDiffusion(deltaSeconds: number): void {
    this.diffusionTimeAccumulator += deltaSeconds;
    
    // Run diffusion at fixed timestep
    while (this.diffusionTimeAccumulator >= this.diffusionTimestep) {
      // Apply passive effects before organelle processing
      this.passiveEffectsSystem.step(this.diffusionTimestep);
      
      // Process organelles (consume/produce species)
      this.organelleSystem.update(this.diffusionTimestep);
      
      // Milestone 6 Task 4: Apply membrane exchange after organelles
      this.membraneExchangeSystem.processExchange(this.diffusionTimestep * 1000); // Convert to milliseconds
      
      // Then run diffusion
      this.diffusionSystem.step();
      this.diffusionTimeAccumulator -= this.diffusionTimestep;
    }
  }

  // Debug Controls - Task 4
  
  private handleDebugControls(): void {
    const playerCoord = this.getPlayerHexCoord();
    if (!playerCoord) return;

    // Clear all species on player's current tile
    if (Phaser.Input.Keyboard.JustDown(this.keys.C)) {
      this.hexGrid.clearConcentrations(playerCoord);
      console.log(`Cleared all species on tile (${playerCoord.q}, ${playerCoord.r})`);
    }

    // Inject species using SHIFT + number keys 1-6 (to avoid conflict with protein installation)
    const injectionAmount = 20; // Modest amount to inject
    
    // Species injection now requires holding SHIFT to avoid conflicts
    const shiftHeld = this.input.keyboard?.checkDown(this.input.keyboard.addKey('SHIFT'), 0);
    
    if (shiftHeld) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) {
        this.injectSpecies('ATP', injectionAmount);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) {
        this.injectSpecies('AA', injectionAmount);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) {
        this.injectSpecies('NT', injectionAmount);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.FOUR)) {
        this.injectSpecies('ROS', injectionAmount);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.FIVE)) {
        this.injectSpecies('GLUCOSE', injectionAmount);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.SIX)) {
        this.injectSpecies('PRE_MRNA', injectionAmount);
      }
    }

    // Show player inventory status (Debug)
    if (Phaser.Input.Keyboard.JustDown(this.keys.V)) {
      console.log('Player Inventory Status:', this.playerInventory.getStatus());
    }

    // F key - Instantly complete construction on current tile
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) {
      this.instantCompleteConstruction(playerCoord);
    }

    // Tile interactions - Tasks 2-9
    this.handleTileInteractions();
  }

  /**
   * Debug function to instantly complete any blueprint construction on the given tile
   */
  private instantCompleteConstruction(coord: HexCoord): void {
    const blueprint = this.blueprintSystem.getBlueprintAtTile(coord.q, coord.r);
    if (!blueprint) {
      console.log(`No blueprint found at (${coord.q}, ${coord.r})`);
      return;
    }

    const recipe = CONSTRUCTION_RECIPES.getRecipe(blueprint.recipeId);
    if (!recipe) {
      console.warn(`Recipe not found for blueprint ${blueprint.id}`);
      return;
    }

    // Fill all requirements instantly
    for (const [speciesId, requiredAmount] of Object.entries(recipe.buildCost)) {
      blueprint.progress[speciesId as SpeciesId] = requiredAmount;
      blueprint.totalProgress += requiredAmount;
    }

    console.log(`🚀 Instantly completed ${recipe.label} construction at (${coord.q}, ${coord.r})`);
  }

  // Blueprint System Input Handling - Milestone 5
  
  private handleBlueprintInput(): void {
    // Toggle build palette with B key
    if (Phaser.Input.Keyboard.JustDown(this.keys.B)) {
      // Milestone 7 Task 2: Check if standing on membrane tile for protein requests
      if (this.currentTileRef && this.hexGrid.isMembraneCoord(this.currentTileRef.coord)) {
        this.handleProteinRequestMenu();
        return;
      }
      
      // Regular build palette for non-membrane tiles
      this.buildPalette.toggle();
      
      // Milestone 6 Task 4: When opening build palette, filter based on current tile
      if (this.buildPalette.getIsVisible()) {
        this.updateBuildPaletteFilter();
      }
      
      // Exit build mode when closing palette
      if (!this.buildPalette.getIsVisible()) {
        this.isInBuildMode = false;
        this.selectedRecipeId = null;
        // Reset palette to show all recipes when closing
        this.buildPalette.rebuildPalette('all');
      }
    }

    // Milestone 6 Task 2: X key to cancel blueprint (uses current tile)
    if (Phaser.Input.Keyboard.JustDown(this.keys.X)) {
      if (!this.currentTileRef) {
        this.showToast("Stand on a valid tile to cancel blueprints");
        return;
      }

      const blueprint = this.blueprintSystem.getBlueprintAtTile(
        this.currentTileRef.coord.q,
        this.currentTileRef.coord.r
      );

      if (blueprint) {
        const success = this.blueprintSystem.cancelBlueprint(blueprint.id, 0.5);
        if (success) {
          console.log(`🗑️ Cancelled blueprint with 50% refund`);
        }
      }
    }

    // Milestone 6 Task 2: ENTER key to place blueprint (uses current tile)
    if (Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) {
      if (this.isInBuildMode && this.selectedRecipeId) {
        if (!this.currentTileRef) {
          this.showToast("Stand on a valid tile to build");
          return;
        }

        const result = this.blueprintSystem.placeBlueprint(
          this.selectedRecipeId,
          this.currentTileRef.coord.q,
          this.currentTileRef.coord.r
        );

        if (result.success) {
          console.log(`Placed ${this.selectedRecipeId} blueprint at (${this.currentTileRef.coord.q}, ${this.currentTileRef.coord.r})`);
          
          // Exit build mode after successful placement
          this.isInBuildMode = false;
          this.selectedRecipeId = null;
          this.buildPalette.hide();
          // Reset palette to show all recipes
          this.buildPalette.rebuildPalette('all');
        } else {
          this.showToast(`Failed to place blueprint: ${result.error}`);
          console.warn(`Failed to place blueprint: ${result.error}`);
        }
      }
    }
  }

  private handleMembraneProteinInput(): void {
    // Detect exactly which protein key was pressed (capture once!)
    let pressed: 'ONE'|'TWO'|'THREE'|'FOUR'|'FIVE'|'SIX'|null = null;
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) pressed = 'ONE';
    else if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) pressed = 'TWO';
    else if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) pressed = 'THREE';
    else if (Phaser.Input.Keyboard.JustDown(this.keys.FOUR)) pressed = 'FOUR';
    else if (Phaser.Input.Keyboard.JustDown(this.keys.FIVE)) pressed = 'FIVE';
    else if (Phaser.Input.Keyboard.JustDown(this.keys.SIX)) pressed = 'SIX';

    if (!pressed) return;

    // Milestone 7 Task 2: Handle protein requests instead of direct installation
    if (this.isInProteinRequestMode) {
      let proteinId: ProteinId | null = null;
      switch (pressed) {
        case 'ONE': proteinId = 'GLUT'; break;
        case 'TWO': proteinId = 'AA_TRANSPORTER'; break;
        case 'THREE': proteinId = 'NT_TRANSPORTER'; break;
        case 'FOUR': proteinId = 'ROS_EXPORTER'; break;
        case 'FIVE': proteinId = 'SECRETION_PUMP'; break;
        case 'SIX': proteinId = 'GROWTH_FACTOR_RECEPTOR'; break;
      }
      
      if (proteinId) {
        this.handleProteinSelection(proteinId);
      }
      return;
    }

    // Milestone 7 Task 10: Remove direct install paths - show message about new flow
    this.showToast("Use B menu on membrane tiles to request proteins (new flow!)");
    
    // The old direct installation code is now disabled for Milestone 7
    console.log("🚫 Direct protein installation disabled - use request flow instead");
  }

  /**
   * Milestone 7 Task 6: Transcript pickup/carry mechanics
   * Handle R key for pickup/drop and Shift+R key for carry management
   */
  private handleTranscriptInput(): void {
    // R key: Pick up or drop transcript at current tile
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      // Check if SHIFT is held for "drop all" functionality
      const shiftHeld = this.input.keyboard?.checkDown(this.input.keyboard.addKey('SHIFT'), 0);
      
      if (shiftHeld) {
        this.handleDropAllTranscripts();
      } else {
        this.handleTranscriptPickupDrop();
      }
    }
  }

  /**
   * Handle pickup/drop of transcript at current tile
   */
  private handleTranscriptPickupDrop(): void {
    const playerHex = this.getPlayerHexCoord();
    if (!playerHex) return;
    
    const CARRY_CAPACITY = 2; // Maximum transcripts player can carry
    
    // Check if player is carrying transcripts at this location - drop one if so
    if (this.carriedTranscripts.length > 0) {
      const transcriptToDrop = this.carriedTranscripts[0];
      transcriptToDrop.isCarried = false;
      transcriptToDrop.atHex = { ...playerHex };
      transcriptToDrop.worldPos = this.hexGrid.hexToWorld(playerHex).clone();
      
      // Remove from carried list
      this.carriedTranscripts.splice(0, 1);
      
      // Check if dropped at ER organelle - if so, process immediately
      this.checkAndProcessTranscriptAtER(transcriptToDrop);
      
      this.showToast(`Dropped ${transcriptToDrop.proteinId} transcript`);
      return;
    }
    
    // Check if there are transcripts at current location to pick up
    const transcriptsAtLocation = this.getTranscriptsAtHex(playerHex);
    if (transcriptsAtLocation.length === 0) {
      this.showToast("No transcripts here to pick up");
      return;
    }
    
    // Check carrying capacity
    if (this.carriedTranscripts.length >= CARRY_CAPACITY) {
      this.showToast(`Already carrying ${CARRY_CAPACITY} transcripts (max capacity)`);
      return;
    }
    
    // Pick up first available transcript
    const transcriptToPickup = transcriptsAtLocation[0];
    transcriptToPickup.isCarried = true;
    this.carriedTranscripts.push(transcriptToPickup);
    
    this.showToast(`Picked up ${transcriptToPickup.proteinId} transcript`);
  }

  /**
   * Drop all carried transcripts at current location
   */
  private handleDropAllTranscripts(): void {
    if (this.carriedTranscripts.length === 0) {
      this.showToast("Not carrying any transcripts");
      return;
    }
    
    const playerHex = this.getPlayerHexCoord();
    if (!playerHex) return;
    
    const droppedCount = this.carriedTranscripts.length;
    
    // Drop all carried transcripts
    for (const transcript of this.carriedTranscripts) {
      transcript.isCarried = false;
      transcript.atHex = { ...playerHex };
      transcript.worldPos = this.hexGrid.hexToWorld(playerHex).clone();
      
      // Check if dropped at ER organelle - if so, process immediately
      this.checkAndProcessTranscriptAtER(transcript);
    }
    
    // Clear carried list
    this.carriedTranscripts.length = 0;
    
    this.showToast(`Dropped ${droppedCount} transcript${droppedCount === 1 ? '' : 's'}`);
  }

  /**
   * Check if transcript is at ER organelle and process if so
   */
  private checkAndProcessTranscriptAtER(transcript: Transcript): void {
    // Find all ER organelles
    const erOrganelles = this.organelleSystem.getAllOrganelles()
      .filter(org => org.type === 'proto-er' && org.isActive);
    
    // Check if transcript is at any ER organelle
    for (const er of erOrganelles) {
      const distance = this.calculateHexDistance(transcript.atHex, er.coord);
      if (distance <= 1) { // At or adjacent to ER
        console.log(`🏭 Manually dropped transcript at ER - starting processing`);
        transcript.state = 'processing_at_er';
        transcript.processingTimer = 0;
        this.showToast(`${transcript.proteinId} being processed at ER...`);
        return;
      }
    }
  }

  /**
   * Milestone 6 Task 4: Update build palette filter based on current tile (where player stands)
   * This determines which recipes are available in the build menu
   */
  private updateBuildPaletteFilter(): void {
    if (!this.currentTileRef) {
      this.buildPalette.rebuildPalette('all');
      return;
    }

    const isMembraneTile = this.hexGrid.isMembraneCoord(this.currentTileRef.coord);
    const filter = isMembraneTile ? 'membrane' : 'cytosol';
    this.buildPalette.rebuildPalette(filter);
  }

  /**
   * Get the hex coordinate of the tile the player is currently standing on
   */
  private getPlayerHexCoord(): { q: number; r: number } | null {
    const coord = this.hexGrid.worldToHex(this.player.x, this.player.y);
    // console.log(`DEBUG: Player world pos (${this.player.x.toFixed(1)}, ${this.player.y.toFixed(1)}) -> hex coord (${coord?.q}, ${coord?.r})`);
    return coord;
  }

  /**
   * Milestone 6 Task 1: Get the player's current hex tile
   * Converts player world coords → axial/hex and returns the tile (or null if outside the grid)
   */
  private getPlayerHex(): HexTile | null {
    const coord = this.getPlayerHexCoord();
    if (!coord) return null;
    return this.hexGrid.getTile(coord) || null;
  }

  /**
   * Milestone 6 Task 1: Get read-only access to current tile
   */
  public getCurrentTile(): HexTile | null {
    return this.currentTileRef;
  }

  /**
   * Milestone 6 Task 2: Handle tile interaction controls for player logistics
   * Updated to use current tile reference
   */
  private handleTileInteractions(): void {
    // Milestone 6 Task 2: Use current tile instead of calculating coordinates
    if (!this.currentTileRef) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.Q) || Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        this.showToast("Stand on a valid tile to scoop/drop");
      }
      return;
    }

    // Q key - Scoop current heatmap species from player's tile
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) {
      this.scoopCurrentSpecies(this.currentTileRef.coord);
    }

    // E key - Drop current heatmap species onto player's tile  
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      this.dropCurrentSpecies(this.currentTileRef.coord);
    }
  }

  /**
   * Scoop current heatmap species from player's current tile
   */
  private scoopCurrentSpecies(coord: { q: number; r: number }): void {
    const currentSpecies = this.heatmapSystem.getCurrentSpecies();
    
    // Debug logging
    console.log(`DEBUG: Player at coord (${coord.q}, ${coord.r}), scooping ${currentSpecies}`);
    
    const tile = this.hexGrid.getTile(coord);
    if (tile) {
      const beforeAmount = tile.concentrations[currentSpecies] || 0;
      console.log(`DEBUG: Tile has ${beforeAmount} ${currentSpecies} before scoop`);
    }
    
    const result = this.playerInventory.scoopFromTile(this.hexGrid, coord, currentSpecies);
    
    if (tile) {
      const afterAmount = tile.concentrations[currentSpecies] || 0;
      console.log(`DEBUG: Tile has ${afterAmount} ${currentSpecies} after scoop`);
    }
    
    if (result.taken > 0) {
      console.log(`Scooped ${currentSpecies}: ${result.taken.toFixed(2)} from tile (${coord.q}, ${coord.r})`);
    } else if (result.available > 0) {
      console.log(`Inventory full! Cannot scoop ${currentSpecies} from tile (${coord.q}, ${coord.r})`);
    } else {
      console.log(`No ${currentSpecies} available on tile (${coord.q}, ${coord.r})`);
    }
  }

  /**
   * Drop current heatmap species onto player's current tile
   */
  private dropCurrentSpecies(coord: { q: number; r: number }): void {
    const currentSpecies = this.heatmapSystem.getCurrentSpecies();
    
    // Check if there's a blueprint at this tile
    const blueprint = this.blueprintSystem.getBlueprintAtTile(coord.q, coord.r);
    
    if (blueprint) {
      // Try to contribute to blueprint first
      const playerHas = this.playerInventory.getAmount(currentSpecies);
      
      if (playerHas > 0) {
        const contributed = this.blueprintSystem.addPlayerContribution(
          blueprint.id, 
          currentSpecies, 
          playerHas
        );
        
        if (contributed) {
          // Remove from player inventory
          this.playerInventory.take(currentSpecies, playerHas);
          console.log(`Contributed ${playerHas.toFixed(2)} ${currentSpecies} to blueprint ${blueprint.id}`);
          
          // TODO: Show "+X to build" toast (Task 4)
          return;
        }
      }
    }
    
    // Normal drop onto tile if no blueprint or contribution failed
    const result = this.playerInventory.dropOntoTile(this.hexGrid, coord, currentSpecies);
    
    if (result.dropped > 0) {
      console.log(`Dropped ${currentSpecies}: ${result.dropped.toFixed(2)} onto tile (${coord.q}, ${coord.r})`);
    } else {
      console.log(`No ${currentSpecies} in inventory to drop`);
    }
  }

  private injectSpecies(speciesId: SpeciesId, amount: number): void {
    const playerCoord = this.getPlayerHexCoord();
    if (!playerCoord) return;
    
    this.hexGrid.addConcentration(playerCoord, speciesId, amount);
    console.log(`Injected ${amount} ${speciesId} into tile (${playerCoord.q}, ${playerCoord.r})`);
  }

  // Milestone 7 Task 1: Helper methods for orders & transcripts

  /**
   * Milestone 7 Task 2: Handle protein request menu for membrane tiles
   */
  private handleProteinRequestMenu(): void {
    if (!this.currentTileRef) return;
    
    // Check if organelle is already installed on this tile
    const existingOrganelle = this.organelleSystem.getOrganelleAtTile(this.currentTileRef.coord);
    if (!existingOrganelle || (existingOrganelle.type !== 'transporter' && existingOrganelle.type !== 'receptor')) {
      this.showToast("Need to build a transporter or receptor first");
      return;
    }
    
    // Check if protein already installed
    const existingProtein = this.membraneExchangeSystem.getInstalledProtein(this.currentTileRef.coord);
    if (existingProtein) {
      this.showToast("Protein already installed on this tile");
      return;
    }
    
    // Check if order already pending
    const pendingOrders = this.getOrdersForHex(this.currentTileRef.coord);
    if (pendingOrders.length > 0) {
      this.showToast("Protein order already pending for this tile");
      return;
    }
    
    // Show protein selection toast
    this.showToast("Choose protein: 1=GLUT 2=AA_TRANS 3=NT_TRANS 4=ROS_EXP 5=SECRETE 6=GROWTH", 5000);
    
    // Set flag to listen for number keys
    this.isInProteinRequestMode = true;
  }

  /**
   * Handle protein selection from numbered keys
   */
  private handleProteinSelection(proteinId: ProteinId): void {
    if (!this.currentTileRef || !this.isInProteinRequestMode) return;
    
    // Create the order
    const order = this.createInstallOrder(proteinId, this.currentTileRef.coord);
    this.showToast(`Requested ${proteinId} for tile (${order.destHex.q}, ${order.destHex.r})`);
    
    // Exit protein request mode
    this.isInProteinRequestMode = false;
    
    console.log(`🧬 Created protein order: ${proteinId} for tile (${order.destHex.q}, ${order.destHex.r})`);
  }

  /**
   * Create a new install order
   */
  private createInstallOrder(proteinId: ProteinId, destHex: HexCoord): InstallOrder {
    const order: InstallOrder = {
      id: `order_${this.nextOrderId++}`,
      proteinId,
      destHex: { ...destHex },
      createdAt: this.time.now
    };
    this.installOrders.set(order.id, order);
    return order;
  }

  /**
   * Remove an install order
   */
  private removeInstallOrder(orderId: string): boolean {
    return this.installOrders.delete(orderId);
  }

  /**
   * Get orders for a specific destination hex
   */
  private getOrdersForHex(hex: HexCoord): InstallOrder[] {
    return Array.from(this.installOrders.values()).filter(
      order => order.destHex.q === hex.q && order.destHex.r === hex.r
    );
  }

  /**
   * Check if there's already an order for a protein at a hex
   */
  private hasOrderForProteinAtHex(proteinId: ProteinId, hex: HexCoord): boolean {
    return this.getOrdersForHex(hex).some(order => order.proteinId === proteinId);
  }

  /**
   * Create a new transcript
   */
  private createTranscript(proteinId: ProteinId, atHex: HexCoord, ttlSeconds: number = 15, destHex?: HexCoord): Transcript {
    const worldPos = this.hexGrid.hexToWorld(atHex);
    const transcript: Transcript = {
      id: `transcript_${this.nextTranscriptId++}`,
      proteinId,
      atHex: { ...atHex },
      ttlSeconds,
      worldPos: worldPos.clone(),
      isCarried: false,
      moveAccumulator: 0,
      destHex: destHex ? { ...destHex } : undefined,
      state: 'traveling',
      processingTimer: 0
    };
    this.transcripts.set(transcript.id, transcript);
    return transcript;
  }

  /**
   * Remove a transcript
   */
  private removeTranscript(transcriptId: string): boolean {
    const transcript = this.transcripts.get(transcriptId);
    if (transcript?.isCarried) {
      // Remove from carried array too
      const index = this.carriedTranscripts.findIndex(t => t.id === transcriptId);
      if (index >= 0) {
        this.carriedTranscripts.splice(index, 1);
      }
    }
    return this.transcripts.delete(transcriptId);
  }

  /**
   * Get transcripts at a specific hex
   */
  private getTranscriptsAtHex(hex: HexCoord): Transcript[] {
    return Array.from(this.transcripts.values()).filter(
      transcript => !transcript.isCarried && 
                   transcript.atHex.q === hex.q && 
                   transcript.atHex.r === hex.r
    );
  }

  /**
   * Move transcript to a new hex
   */
  private moveTranscript(transcriptId: string, newHex: HexCoord): boolean {
    const transcript = this.transcripts.get(transcriptId);
    if (!transcript || transcript.isCarried) return false;
    
    transcript.atHex = { ...newHex };
    transcript.worldPos = this.hexGrid.hexToWorld(newHex).clone();
    return true;
  }

  /**
   * Milestone 7 Task 3: Nucleus transcription system
   * Process pending install orders at nucleus organelles, consuming NT/ATP to produce transcripts
   */
  private updateNucleusTranscription(deltaSeconds: number): void {
    // Find all nucleus organelles
    const nucleusOrganelles = this.organelleSystem.getAllOrganelles()
      .filter(org => org.type === 'nucleus' && org.isActive);
    
    if (nucleusOrganelles.length === 0 || this.installOrders.size === 0) return;
    
    // Production rates and costs
    const TRANSCRIPTS_PER_SECOND = 0.5; // Maximum production rate per nucleus
    const NT_COST_PER_TRANSCRIPT = 2;   // Nucleotides consumed per transcript
    const ATP_COST_PER_TRANSCRIPT = 1;  // ATP consumed per transcript
    const TRANSCRIPT_TTL = 15;          // Transcript lifespan in seconds
    
    // Process each nucleus
    for (const nucleus of nucleusOrganelles) {
      console.log(`🧬 Processing nucleus at (${nucleus.coord.q}, ${nucleus.coord.r})`);
      
      // Get footprint tiles for this nucleus using imported function
      const footprintTiles = getFootprintTiles(
        nucleus.config.footprint,
        nucleus.coord.q,
        nucleus.coord.r
      );
      
      console.log(`🧬 Nucleus footprint has ${footprintTiles.length} tiles`);
      
      // Calculate production budget for this tick
      const maxTranscriptsThisTick = TRANSCRIPTS_PER_SECOND * deltaSeconds;
      let producedThisTick = 0;
      
      // Get oldest pending orders to prioritize them
      const pendingOrders = Array.from(this.installOrders.values())
        .sort((a, b) => a.createdAt - b.createdAt);
      
      console.log(`🧬 Processing ${pendingOrders.length} pending orders`);
      
      // Try to produce transcripts for orders
      for (const order of pendingOrders) {
        if (producedThisTick >= maxTranscriptsThisTick) break;
        
        // Check if we have enough resources across nucleus footprint
        let totalNT = 0;
        let totalATP = 0;
        
        for (const tileCoord of footprintTiles) {
          const tile = this.hexGrid.getTile(tileCoord);
          if (tile) {
            totalNT += tile.concentrations['NT'] || 0;
            totalATP += tile.concentrations['ATP'] || 0;
          }
        }
        
        console.log(`🧬 Available resources: NT=${totalNT.toFixed(1)}, ATP=${totalATP.toFixed(1)} (need NT=${NT_COST_PER_TRANSCRIPT}, ATP=${ATP_COST_PER_TRANSCRIPT})`);
        
        // Check if we have enough resources for this transcript
        if (totalNT >= NT_COST_PER_TRANSCRIPT && totalATP >= ATP_COST_PER_TRANSCRIPT) {
          // Consume resources from nucleus tiles
          let ntToConsume = NT_COST_PER_TRANSCRIPT;
          let atpToConsume = ATP_COST_PER_TRANSCRIPT;
          
          for (const tileCoord of footprintTiles) {
            const tile = this.hexGrid.getTile(tileCoord);
            if (!tile) continue;
            
            // Consume NT
            if (ntToConsume > 0) {
              const ntAvailable = tile.concentrations['NT'] || 0;
              const ntTaken = Math.min(ntToConsume, ntAvailable);
              tile.concentrations['NT'] = ntAvailable - ntTaken;
              ntToConsume -= ntTaken;
            }
            
            // Consume ATP
            if (atpToConsume > 0) {
              const atpAvailable = tile.concentrations['ATP'] || 0;
              const atpTaken = Math.min(atpToConsume, atpAvailable);
              tile.concentrations['ATP'] = atpAvailable - atpTaken;
              atpToConsume -= atpTaken;
            }
            
            if (ntToConsume <= 0 && atpToConsume <= 0) break;
          }
          
          // Create transcript at nucleus center with destination info
          this.createTranscript(order.proteinId, nucleus.coord, TRANSCRIPT_TTL, order.destHex);
          
          // Remove the completed order
          this.removeInstallOrder(order.id);
          
          producedThisTick++;
          
          console.log(`🧬 ✅ Successfully produced ${order.proteinId} transcript!`);
          
          // Show toast for successful transcription
          this.showToast(`Nucleus produced ${order.proteinId} transcript`);
        } else {
          console.log(`🧬 ❌ Insufficient resources for ${order.proteinId} transcript`);
        }
      }
    }
  }

  /**
   * Milestone 7 Task 4: Transcript TTL & decay system
   * Decrease transcript TTL over time and remove expired transcripts
   */
  private updateTranscriptDecay(deltaSeconds: number): void {
    const expiredTranscripts: string[] = [];
    
    // Update TTL for all transcripts
    for (const [transcriptId, transcript] of this.transcripts.entries()) {
      // Only decay if transcript is not being carried
      if (!transcript.isCarried) {
        transcript.ttlSeconds -= deltaSeconds;
        
        // Mark for removal if expired
        if (transcript.ttlSeconds <= 0) {
          expiredTranscripts.push(transcriptId);
        }
      }
    }
    
    // Remove expired transcripts
    for (const transcriptId of expiredTranscripts) {
      const transcript = this.transcripts.get(transcriptId);
      if (transcript) {
        // Show warning for important expired transcripts
        if (transcript.ttlSeconds <= -1) { // Only show once per transcript
          this.showToast(`${transcript.proteinId} transcript expired!`);
        }
        
        // Remove from carried list if player was carrying it
        const carriedIndex = this.carriedTranscripts.findIndex(t => t.id === transcriptId);
        if (carriedIndex >= 0) {
          this.carriedTranscripts.splice(carriedIndex, 1);
        }
        
        // Remove from transcripts map
        this.transcripts.delete(transcriptId);
      }
    }
  }

  /**
   * Milestone 7 Task 5: Enhanced transcript routing & processing system
   * Handles multi-stage transcript lifecycle with realistic timing
   */
  private updateTranscriptRouting(deltaSeconds: number): void {
    // Processing times for each stage
    const ER_PROCESSING_TIME = 3.0;    // seconds to process at ER
    const TRANSPORT_SPEED = 1.5;       // hexes per second for vesicle transport
    const INSTALLATION_TIME = 2.0;     // seconds to install at membrane
    
    // Find all ER organelles (proto-er type)
    const erOrganelles = this.organelleSystem.getAllOrganelles()
      .filter(org => org.type === 'proto-er' && org.isActive);
    
    if (erOrganelles.length === 0) return; // No ER to route to
    
    const TRANSCRIPT_MOVE_SPEED = 0.5; // hexes per second for initial routing
    
    // Process each transcript based on its current state
    for (const transcript of this.transcripts.values()) {
      if (transcript.isCarried) continue; // Skip carried transcripts
      
      switch (transcript.state) {
        case 'traveling':
          this.processTranscriptTravel(transcript, erOrganelles, TRANSCRIPT_MOVE_SPEED, deltaSeconds);
          break;
          
        case 'processing_at_er':
          this.processTranscriptAtER(transcript, ER_PROCESSING_TIME, deltaSeconds);
          break;
          
        case 'packaged_for_transport':
          this.processVesicleTransport(transcript, TRANSPORT_SPEED, deltaSeconds);
          break;
          
        case 'installing_at_membrane':
          this.processMembraneInstallation(transcript, INSTALLATION_TIME, deltaSeconds);
          break;
      }
    }
  }

  /**
   * Handle transcript traveling to ER
   */
  private processTranscriptTravel(transcript: Transcript, erOrganelles: any[], moveSpeed: number, deltaSeconds: number): void {
    // Find nearest ER organelle
    let nearestER = null;
    let shortestDistance = Infinity;
    
    for (const er of erOrganelles) {
      const distance = this.calculateHexDistance(transcript.atHex, er.coord);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        nearestER = er;
      }
    }
    
    if (!nearestER) return;
    
    // Check if arrived at ER
    if (shortestDistance <= 1) {
      transcript.state = 'processing_at_er';
      transcript.processingTimer = 0;
      console.log(`� ${transcript.proteinId} transcript arrived at ER - starting processing`);
      this.showToast(`${transcript.proteinId} being processed at ER...`);
      return;
    }
    
    // Move toward ER
    const moveVector = this.calculateHexMovementVector(transcript.atHex, nearestER.coord);
    if (!moveVector) return;
    
    const moveDistance = moveSpeed * deltaSeconds;
    transcript.moveAccumulator += moveDistance;
    
    if (transcript.moveAccumulator >= 1.0) {
      const targetHex = {
        q: transcript.atHex.q + Math.sign(moveVector.q),
        r: transcript.atHex.r + Math.sign(moveVector.r)
      };
      
      const targetTile = this.hexGrid.getTile(targetHex);
      if (targetTile) {
        const occupyingTranscripts = this.getTranscriptsAtHex(targetHex);
        if (occupyingTranscripts.length === 0) {
          this.moveTranscript(transcript.id, targetHex);
          transcript.moveAccumulator = 0;
        }
      }
    }
  }

  /**
   * Handle transcript processing at ER
   */
  private processTranscriptAtER(transcript: Transcript, processingTime: number, deltaSeconds: number): void {
    transcript.processingTimer += deltaSeconds;
    
    if (transcript.processingTimer >= processingTime) {
      transcript.state = 'packaged_for_transport';
      transcript.processingTimer = 0;
      transcript.moveAccumulator = 0;
      console.log(`📦 ✅ ${transcript.proteinId} processing complete - packaging for transport`);
      this.showToast(`${transcript.proteinId} packaged - transporting to membrane`);
    }
  }

  /**
   * Handle vesicle transport to destination membrane
   */
  private processVesicleTransport(transcript: Transcript, transportSpeed: number, deltaSeconds: number): void {
    if (!transcript.destHex) {
      // No specific destination - find nearest membrane
      const membraneTiles = this.hexGrid.getMembraneTiles();
      if (membraneTiles.length > 0) {
        let nearest = membraneTiles[0].coord;
        let shortestDistance = this.calculateHexDistance(transcript.atHex, nearest);
        
        for (const tile of membraneTiles) {
          const distance = this.calculateHexDistance(transcript.atHex, tile.coord);
          if (distance < shortestDistance) {
            shortestDistance = distance;
            nearest = tile.coord;
          }
        }
        transcript.destHex = nearest;
      }
    }
    
    if (!transcript.destHex) return;
    
    const distance = this.calculateHexDistance(transcript.atHex, transcript.destHex);
    
    // Check if arrived at destination
    if (distance <= 0) {
      transcript.state = 'installing_at_membrane';
      transcript.processingTimer = 0;
      console.log(`� ${transcript.proteinId} vesicle arrived - starting membrane installation`);
      this.showToast(`Installing ${transcript.proteinId} at membrane...`);
      return;
    }
    
    // Move toward destination
    const moveVector = this.calculateHexMovementVector(transcript.atHex, transcript.destHex);
    if (!moveVector) return;
    
    const moveDistance = transportSpeed * deltaSeconds;
    transcript.moveAccumulator += moveDistance;
    
    if (transcript.moveAccumulator >= 1.0) {
      const targetHex = {
        q: transcript.atHex.q + Math.sign(moveVector.q),
        r: transcript.atHex.r + Math.sign(moveVector.r)
      };
      
      const targetTile = this.hexGrid.getTile(targetHex);
      if (targetTile) {
        this.moveTranscript(transcript.id, targetHex);
        transcript.moveAccumulator = 0;
      }
    }
  }

  /**
   * Handle final membrane installation
   */
  private processMembraneInstallation(transcript: Transcript, installationTime: number, deltaSeconds: number): void {
    transcript.processingTimer += deltaSeconds;
    
    if (transcript.processingTimer >= installationTime) {
      // Install the protein
      if (transcript.destHex) {
        const hasProtein = this.membraneExchangeSystem.hasInstalledProtein(transcript.destHex);
        
        if (!hasProtein) {
          const success = this.membraneExchangeSystem.installMembraneProtein(transcript.destHex, transcript.proteinId);
          
          if (success) {
            console.log(`� ✅ ${transcript.proteinId} successfully installed at membrane (${transcript.destHex.q}, ${transcript.destHex.r})`);
            this.showToast(`${transcript.proteinId} protein activated!`);
            
            // Remove the transcript (installation complete)
            this.removeTranscript(transcript.id);
            
            // Update membrane debug visualization
            this.renderMembraneDebug();
          }
        } else {
          console.log(`� ⚠️ Membrane already occupied - removing transcript`);
          this.removeTranscript(transcript.id);
        }
      }
    }
  }

  /**
   * Calculate distance between two hex coordinates
   */
  private calculateHexDistance(hex1: HexCoord, hex2: HexCoord): number {
    return (Math.abs(hex1.q - hex2.q) + Math.abs(hex1.q + hex1.r - hex2.q - hex2.r) + Math.abs(hex1.r - hex2.r)) / 2;
  }

  /**
   * Calculate movement vector from one hex to another
   */
  private calculateHexMovementVector(from: HexCoord, to: HexCoord): {q: number, r: number} | null {
    const dq = to.q - from.q;
    const dr = to.r - from.r;
    
    if (dq === 0 && dr === 0) return null; // Already at target
    
    return { q: dq, r: dr };
  }

}

