import Phaser from "phaser";
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture, makeDotTexture, makeRingTexture, makeStationTexture } from "../gfx/textures";
import { HexGrid } from "../hex/hex-grid";
import { getAllSpecies } from "../species/species-registry";
import { DiffusionSystem } from "../species/diffusion-system";
import { HeatmapSystem } from "../species/heatmap-system";
import { PassiveEffectsSystem } from "../species/passive-effects-system";
import { ConservationTracker } from "../species/conservation-tracker";

type Keys = Record<"W" | "A" | "S" | "D" | "R" | "ENTER" | "SPACE" | "G" | "I" | "C" | "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "H" | "LEFT" | "RIGHT" | "P" | "T", Phaser.Input.Keyboard.Key>;

export class GameScene extends Phaser.Scene {
  private grid!: Phaser.GameObjects.Image;
  private cellSprite!: Phaser.GameObjects.Image;
  private nucleusSprite!: Phaser.GameObjects.Image;
  private ribosomeSprite!: Phaser.GameObjects.Image;
  private peroxisomeSprite!: Phaser.GameObjects.Image;
  private chaperoneSprite!: Phaser.GameObjects.Image;

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
  private showHexGrid = false;
  private hoveredTile: any = null; // HexTile | null
  private selectedTile: any = null; // HexTile | null
  private hexInteractionGraphics!: Phaser.GameObjects.Graphics;
  private tileInfoPanel!: Phaser.GameObjects.Text;
  private debugInfoPanel!: Phaser.GameObjects.Text;

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

  // Station visuals (legacy organelles kept as decoration)
  private nucleusLabel!: Phaser.GameObjects.Text;
  private ribosomeLabel!: Phaser.GameObjects.Text;
  private peroxisomeLabel!: Phaser.GameObjects.Text;
  private chaperoneLabel!: Phaser.GameObjects.Text;
  private nucleusGlow!: Phaser.GameObjects.Image;
  private ribosomeGlow!: Phaser.GameObjects.Image;
  private peroxisomeGlow!: Phaser.GameObjects.Image;
  private chaperoneGlow!: Phaser.GameObjects.Image;

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

    // Organelle stations (kept as visual decoration)
    const nucleusKey = makeCellTexture(this, 180, 8, this.col.nucleusFill, this.col.nucleusRim);
    this.nucleusSprite = this.add.image(this.cellCenter.x - 80, this.cellCenter.y - 20, nucleusKey).setDepth(2);
    const riboKey = makeCellTexture(this, 140, 8, this.col.riboFill, this.col.riboRim);
    this.ribosomeSprite = this.add.image(this.cellCenter.x + 100, this.cellCenter.y + 40, riboKey).setDepth(2);
    const peroxiKey = makeCellTexture(this, 120, 8, this.col.peroxiFill, this.col.peroxiRim);
    this.peroxisomeSprite = this.add.image(this.cellCenter.x - 110, this.cellCenter.y + 80, peroxiKey).setDepth(2);
    const chaperoneKey = makeCellTexture(this, 100, 8, this.col.chaperoneFill, this.col.chaperoneRim);
    this.chaperoneSprite = this.add.image(this.cellCenter.x + 120, this.cellCenter.y - 60, chaperoneKey).setDepth(2);

    this.add.image(this.nucleusSprite.x, this.nucleusSprite.y, makeStationTexture(this, "Nucleus")).setDepth(3).setAlpha(0.9);
    this.add.image(this.ribosomeSprite.x, this.ribosomeSprite.y, makeStationTexture(this, "Ribosome")).setDepth(3).setAlpha(0.9);
    this.add.image(this.peroxisomeSprite.x, this.peroxisomeSprite.y, makeStationTexture(this, "Peroxisome")).setDepth(3).setAlpha(0.9);
    this.add.image(this.chaperoneSprite.x, this.chaperoneSprite.y, makeStationTexture(this, "Chaperone")).setDepth(3).setAlpha(0.9);

    // Station glow effects
    const glowKey = makeRingTexture(this, 200, 6, 0x88ddff);
    this.nucleusGlow = this.add.image(this.nucleusSprite.x, this.nucleusSprite.y, glowKey).setDepth(1).setAlpha(0).setTint(this.col.nucleusRim);
    const riboGlowKey = makeRingTexture(this, 160, 6, 0x88ddff);
    this.ribosomeGlow = this.add.image(this.ribosomeSprite.x, this.ribosomeSprite.y, riboGlowKey).setDepth(1).setAlpha(0).setTint(this.col.riboRim);
    const peroxiGlowKey = makeRingTexture(this, 140, 6, 0x88ddff);
    this.peroxisomeGlow = this.add.image(this.peroxisomeSprite.x, this.peroxisomeSprite.y, peroxiGlowKey).setDepth(1).setAlpha(0).setTint(this.col.peroxiRim);
    const chaperoneGlowKey = makeRingTexture(this, 120, 6, 0x88ddff);
    this.chaperoneGlow = this.add.image(this.chaperoneSprite.x, this.chaperoneSprite.y, chaperoneGlowKey).setDepth(1).setAlpha(0).setTint(this.col.chaperoneRim);

    // Station labels
    this.nucleusLabel = this.add.text(this.nucleusSprite.x, this.nucleusSprite.y - 110, "Nucleus", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

    this.ribosomeLabel = this.add.text(this.ribosomeSprite.x, this.ribosomeSprite.y - 90, "Ribosome", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

    this.peroxisomeLabel = this.add.text(this.peroxisomeSprite.x, this.peroxisomeSprite.y - 80, "Peroxisome", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

    this.chaperoneLabel = this.add.text(this.chaperoneSprite.x, this.chaperoneSprite.y - 70, "Chaperone", {
      fontFamily: "monospace", fontSize: "16px", color: "#88ddff", stroke: "#000", strokeThickness: 2
    }).setOrigin(0.5).setDepth(5);

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
      H: this.input.keyboard!.addKey("H"),
      LEFT: this.input.keyboard!.addKey("LEFT"),
      RIGHT: this.input.keyboard!.addKey("RIGHT"),
      P: this.input.keyboard!.addKey("P"),
      T: this.input.keyboard!.addKey("T"),
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
    this.initializeDebugInfo();
    setHud(this, { message: "" });

    // Window resize handling
    this.scale.on("resize", (sz: Phaser.Structs.Size) => {
      const newWidth = Math.ceil(sz.width);
      const newHeight = Math.ceil(sz.height);
      
      // Regenerate background grid
      const gridSize = Math.max(newWidth, newHeight) * 2;
      const key = makeGridTexture(this, gridSize, gridSize, this.col.bg, this.col.gridMinor, this.col.gridMajor);
      this.grid.setTexture(key).setOrigin(0.5, 0.5);
      this.grid.setPosition(newWidth * 0.5, newHeight * 0.5);
      
      // Re-center cell and stations
      this.cellCenter.set(newWidth * 0.5, newHeight * 0.5);
      this.cellSprite.setPosition(this.cellCenter.x, this.cellCenter.y);
      
      this.nucleusSprite.setPosition(this.cellCenter.x - 80, this.cellCenter.y - 20);
      this.ribosomeSprite.setPosition(this.cellCenter.x + 100, this.cellCenter.y + 40);
      this.peroxisomeSprite.setPosition(this.cellCenter.x - 110, this.cellCenter.y + 80);
      this.chaperoneSprite.setPosition(this.cellCenter.x + 120, this.cellCenter.y - 60);
      
      this.nucleusGlow.setPosition(this.nucleusSprite.x, this.nucleusSprite.y);
      this.ribosomeGlow.setPosition(this.ribosomeSprite.x, this.ribosomeSprite.y);
      this.peroxisomeGlow.setPosition(this.peroxisomeSprite.x, this.peroxisomeSprite.y);
      this.chaperoneGlow.setPosition(this.chaperoneSprite.x, this.chaperoneSprite.y);
      
      this.nucleusLabel.setPosition(this.nucleusSprite.x, this.nucleusSprite.y - 110);
      this.ribosomeLabel.setPosition(this.ribosomeSprite.x, this.ribosomeSprite.y - 90);
      this.peroxisomeLabel.setPosition(this.peroxisomeSprite.x, this.peroxisomeSprite.y - 80);
      this.chaperoneLabel.setPosition(this.chaperoneSprite.x, this.chaperoneSprite.y - 70);

      // Update hex grid
      if (this.hexGrid) {
        this.hexGrid.updateCenter(this.cellCenter.x, this.cellCenter.y);
        this.renderHexGrid();
        
        // Reinitialize diffusion system buffers after grid change
        if (this.diffusionSystem) {
          this.diffusionSystem.reinitialize();
        }
      }
    });
  }

  override update() {
    // Handle hex grid toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.G)) {
      this.toggleHexGrid();
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

    // Update hex interaction
    this.updateHexInteraction();

    // Core movement system
    const deltaSeconds = this.game.loop.delta / 1000;
    this.updateMovement(deltaSeconds);
    
    // Update diffusion system - Task 3 (only if not paused)
    if (!this.conservationTracker.isPausedState()) {
      this.updateDiffusion(deltaSeconds);
    }
    
    // Update heatmap - Task 5
    this.heatmapSystem.update();
    
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
    console.log(`Hex grid ${this.showHexGrid ? 'shown' : 'hidden'}`);
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
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.hexGrid) return;
    
    if (pointer.leftButtonDown()) {
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const tile = this.hexGrid.getTileAtWorld(worldX, worldY);
      
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
    
    // Selected tile highlight
    if (this.selectedTile) {
      this.hexInteractionGraphics.fillStyle(0x66ffcc, 0.2);
      this.hexInteractionGraphics.lineStyle(2, 0x66ffcc, 0.8);
      this.drawHexagonHighlight(this.selectedTile.worldPos.x, this.selectedTile.worldPos.y, this.hexSize);
    }
    
    // Hovered tile highlight
    if (this.hoveredTile && this.hoveredTile !== this.selectedTile) {
      this.hexInteractionGraphics.fillStyle(0x88ddff, 0.1);
      this.hexInteractionGraphics.lineStyle(1, 0x88ddff, 0.5);
      this.drawHexagonHighlight(this.hoveredTile.worldPos.x, this.hoveredTile.worldPos.y, this.hexSize);
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
        `World: (${Math.round(tile.worldPos.x)}, ${Math.round(tile.worldPos.y)})`,
        `Species Concentrations:`
      ];
      
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
      "Click tile to select",
      "C - Clear selected tile",
      "1 - Inject ATP",
      "2 - Inject AA", 
      "3 - Inject NT",
      "4 - Inject ROS",
      "5 - Inject GLUCOSE"
    ].join('\n');

    this.debugInfoPanel = this.add.text(14, 200, debugText, {
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
    
    this.conservationPanel = this.add.text(14, 350, "", {
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
    console.log('Heatmap system initialized');
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

  private updateDiffusion(deltaSeconds: number): void {
    this.diffusionTimeAccumulator += deltaSeconds;
    
    // Run diffusion at fixed timestep
    while (this.diffusionTimeAccumulator >= this.diffusionTimestep) {
      // Apply passive effects before diffusion
      this.passiveEffectsSystem.step(this.diffusionTimestep);
      
      // Then run diffusion
      this.diffusionSystem.step();
      this.diffusionTimeAccumulator -= this.diffusionTimestep;
    }
  }

  // Debug Controls - Task 4
  
  private handleDebugControls(): void {
    if (!this.selectedTile) return;

    // Clear all species on selected tile
    if (Phaser.Input.Keyboard.JustDown(this.keys.C)) {
      this.hexGrid.clearConcentrations(this.selectedTile.coord);
      console.log(`Cleared all species on tile (${this.selectedTile.coord.q}, ${this.selectedTile.coord.r})`);
    }

    // Inject species using number keys 1-5
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
  }

  private injectSpecies(speciesId: string, amount: number): void {
    if (!this.selectedTile) return;
    
    this.hexGrid.addConcentration(this.selectedTile.coord, speciesId, amount);
    console.log(`Injected ${amount} ${speciesId} into tile (${this.selectedTile.coord.q}, ${this.selectedTile.coord.r})`);
  }

}

