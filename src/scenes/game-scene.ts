import Phaser from "phaser";
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture, makeDotTexture, makeRingTexture } from "../gfx/textures";
import { HexGrid, type HexCoord } from "../hex/hex-grid";
import { getAllSpecies } from "../species/species-registry";
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
import { BlueprintRenderer } from "../construction/blueprint-renderer";
import { CONSTRUCTION_RECIPES } from "../construction/construction-recipes";
import { getOrganelleDefinition, definitionToConfig } from "../organelles/organelle-registry";
import { MembraneExchangeSystem } from "../membrane/membrane-exchange-system";

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
  private selectedRecipeId: string | null = null;
  private isInBuildMode: boolean = false;

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
    // Background grid
    const view = this.scale.gameSize;
    const gridSize = Math.max(view.width, view.height) * 2;
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

    // Update hex interaction
    this.updateHexInteraction();

    // Core movement system
    const deltaSeconds = this.game.loop.delta / 1000;
    this.updateMovement(deltaSeconds);
    
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
    
    // Update build palette position to maintain fixed screen location
    this.buildPalette.updatePosition();
    
    // Update HUD with current information
    this.updateHUD();
    
    // Update conservation tracking - Task 8
    this.conservationTracker.update();
    this.updateConservationPanel();
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
    this.membraneGraphics.setVisible(this.showMembraneDebug);
    this.renderMembraneDebug();
  }

  private renderMembraneDebug(): void {
    if (!this.hexGrid || !this.membraneGraphics) return;
    
    this.membraneGraphics.clear();
    
    // Clean up old transporter labels
    for (const label of this.transporterLabels) {
      label.destroy();
    }
    this.transporterLabels = [];
    
    if (!this.showMembraneDebug) return;
    
    // Draw membrane tiles with a distinct outline
    this.membraneGraphics.lineStyle(2, 0xff4444, 0.8); // Red outline
    this.membraneGraphics.fillStyle(0xff4444, 0.2); // Semi-transparent red fill
    
    const membraneTiles = this.hexGrid.getMembraneTiles();
    
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
    
    // Milestone 6 Task 6: Update build palette based on hovered tile type
    if (this.buildPalette && this.isInBuildMode) {
      this.updateBuildPaletteFilter();
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.hexGrid) return;
    
    if (pointer.leftButtonDown()) {
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const tile = this.hexGrid.getTileAtWorld(worldX, worldY);
      
      // Priority 1: Blueprint placement in build mode
      if (this.isInBuildMode && this.selectedRecipeId && tile) {
        const result = this.blueprintSystem.placeBlueprint(
          this.selectedRecipeId,
          tile.coord.q,
          tile.coord.r
        );

        if (result.success) {
          console.log(`Placed ${this.selectedRecipeId} blueprint at (${tile.coord.q}, ${tile.coord.r})`);
          
          // Exit build mode after successful placement
          this.isInBuildMode = false;
          this.selectedRecipeId = null;
          this.buildPalette.hide();
          // Reset palette to show all recipes
          this.buildPalette.rebuildPalette('all');
        } else {
          console.warn(`Failed to place blueprint: ${result.error}`);
        }
        return; // Don't do normal tile selection
      }
      
      // Priority 2: Normal tile selection
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
    
    // Blueprint preview in build mode
    if (this.isInBuildMode && this.selectedRecipeId && this.hoveredTile) {
      this.renderBlueprintPreview();
    }
    
    // Selected tile highlight (only if not in build mode)
    if (this.selectedTile && !this.isInBuildMode) {
      this.hexInteractionGraphics.fillStyle(0x66ffcc, 0.2);
      this.hexInteractionGraphics.lineStyle(2, 0x66ffcc, 0.8);
      this.drawHexagonHighlight(this.selectedTile.worldPos.x, this.selectedTile.worldPos.y, this.hexSize);
    }
    
    // Hovered tile highlight (only if not in build mode)
    if (this.hoveredTile && this.hoveredTile !== this.selectedTile && !this.isInBuildMode) {
      this.hexInteractionGraphics.fillStyle(0x88ddff, 0.1);
      this.hexInteractionGraphics.lineStyle(1, 0x88ddff, 0.5);
      this.drawHexagonHighlight(this.hoveredTile.worldPos.x, this.hoveredTile.worldPos.y, this.hexSize);
    }
  }

  private renderBlueprintPreview(): void {
    if (!this.selectedRecipeId || !this.hoveredTile) return;
    
    const validation = this.blueprintSystem.validatePlacement(
      this.selectedRecipeId,
      this.hoveredTile.coord.q,
      this.hoveredTile.coord.r
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
          const currentProgress = blueprint.progress[speciesId] || 0;
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
        
        // Check if there's a membrane organelle built on this tile
        if (organelle && (organelle.type === 'membrane-port' || organelle.type === 'transporter' || organelle.type === 'receptor')) {
          // Already shown above in organelle info section, just add a note
          info.push(`🏗️ Membrane structure built`);
        } else {
          // Show installed transporters (from test system, if any remain)
          const transporters = this.membraneExchangeSystem.getTransportersAt(tile.coord);
          if (transporters.length > 0) {
            info.push(`🚛 Test Transporters:`);
            for (const transporter of transporters) {
              const direction = transporter.fluxRate > 0 ? '⬇️' : '⬆️';
              info.push(`  ${direction} ${transporter.type}: ${transporter.speciesId} ${transporter.fluxRate > 0 ? '+' : ''}${transporter.fluxRate}/sec`);
            }
          } else {
            info.push(`🔧 Available`);
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
      "DEBUG CONTROLS:",
      "G - Toggle hex grid",
      "H - Toggle heatmap",
      "← → - Cycle species",
      "P - Toggle passive effects",
      "T - Pause/show conservation",
      "M - Toggle membrane debug",
      "B - Toggle build menu",
      "F - Instant construction",
      "X - Cancel blueprint",
      "Click tile to select",
      "C - Clear selected tile",
      "1 - Inject ATP",
      "2 - Inject AA", 
      "3 - Inject NT",
      "4 - Inject ROS",
      "5 - Inject GLUCOSE"
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
      (organelleType: string, coord: HexCoord) => this.spawnOrganelleFromBlueprint(organelleType, coord),
      this.membraneExchangeSystem
    );
    
    // Initialize build palette UI
    this.buildPalette = new BuildPaletteUI(this, 350, 50);
    this.buildPalette.onRecipeSelected = (recipeId: string) => {
      this.selectedRecipeId = recipeId;
      this.isInBuildMode = true;
      console.log(`Entered build mode with recipe: ${recipeId}`);
    };
    
    // Initialize blueprint renderer
    this.blueprintRenderer = new BlueprintRenderer(this, this.blueprintSystem, this.hexSize);
    
    console.log('Blueprint system initialized');
  }

  private spawnOrganelleFromBlueprint(organelleType: string, coord: HexCoord): void {
    console.log(`🔧 spawnOrganelleFromBlueprint called: type="${organelleType}", coord=(${coord.q}, ${coord.r})`);
    
    // Use centralized organelle registry instead of hardcoded mapping
    const definition = getOrganelleDefinition(organelleType);
    if (definition) {
      const config = definitionToConfig(definition);
      console.log(`📍 Creating organelle with config:`, config);
      const success = this.organelleSystem.createOrganelle(config, coord);
      console.log(`🏗️ Organelle creation result: ${success}`);
      console.log(`✅ Spawned ${config.label} at (${coord.q}, ${coord.r})`);
      
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
    
    const message = `${heatmapStatus}  |  ${inventoryStatus}${blueprintStatus}  |  Q: Scoop Current Species  |  E: Drop Current Species  |  B: Build Menu  |  X: Cancel Blueprint`;
    
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

    // Inject species using number keys 1-6
    const injectionAmount = 20; // Modest amount to inject
    
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
      blueprint.progress[speciesId] = requiredAmount;
      blueprint.totalProgress += requiredAmount;
    }

    console.log(`🚀 Instantly completed ${recipe.label} construction at (${coord.q}, ${coord.r})`);
  }

  // Blueprint System Input Handling - Milestone 5
  
  private handleBlueprintInput(): void {
    // Toggle build palette with B key
    if (Phaser.Input.Keyboard.JustDown(this.keys.B)) {
      this.buildPalette.toggle();
      
      // Exit build mode when closing palette
      if (!this.buildPalette.getIsVisible()) {
        this.isInBuildMode = false;
        this.selectedRecipeId = null;
        // Reset palette to show all recipes when closing
        this.buildPalette.rebuildPalette('all');
      }
    }

    // X key to cancel blueprint
    if (Phaser.Input.Keyboard.JustDown(this.keys.X) && this.hoveredTile) {
      const blueprint = this.blueprintSystem.getBlueprintAtTile(
        this.hoveredTile.coord.q,
        this.hoveredTile.coord.r
      );

      if (blueprint) {
        const success = this.blueprintSystem.cancelBlueprint(blueprint.id, 0.5);
        if (success) {
          console.log(`🗑️ Cancelled blueprint with 50% refund`);
        }
      }
    }
  }

  /**
   * Milestone 6 Task 6: Update build palette filter based on hovered tile
   */
  private updateBuildPaletteFilter(): void {
    if (!this.hoveredTile) {
      this.buildPalette.rebuildPalette('all');
      return;
    }

    const isMembraneTile = this.hexGrid.isMembraneCoord(this.hoveredTile.coord);
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
   * Handle tile interaction controls for player logistics
   */
  private handleTileInteractions(): void {
    const playerCoord = this.getPlayerHexCoord();
    if (!playerCoord) return;

    // Q key - Scoop current heatmap species from player's tile
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) {
      this.scoopCurrentSpecies(playerCoord);
    }

    // E key - Drop current heatmap species onto player's tile  
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      this.dropCurrentSpecies(playerCoord);
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

  private injectSpecies(speciesId: string, amount: number): void {
    const playerCoord = this.getPlayerHexCoord();
    if (!playerCoord) return;
    
    this.hexGrid.addConcentration(playerCoord, speciesId, amount);
    console.log(`Injected ${amount} ${speciesId} into tile (${playerCoord.q}, ${playerCoord.r})`);
  }

}

