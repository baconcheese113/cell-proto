import Phaser from "phaser";
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture } from "../gfx/textures";
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
import { BuildPaletteUI, type BuildContext } from "../construction/build-palette-ui";
import type { OrganelleType } from "../organelles/organelle-registry";
import { BlueprintRenderer } from "../construction/blueprint-renderer";
import { CONSTRUCTION_RECIPES } from "../construction/construction-recipes";
import { getOrganelleDefinition, definitionToConfig } from "../organelles/organelle-registry";
import { getFootprintTiles } from "../organelles/organelle-footprints";
import { MembraneExchangeSystem } from "../membrane/membrane-exchange-system";
import { MembranePortSystem } from "../membrane/membrane-port-system";

// New modular components
import { Player } from "../actors/player";
import { TileActionController } from "../controllers/tile-action-controller";
// Consolidated system architecture
import { CellProduction } from "../systems/cell-production";
import { CellTransport } from "../systems/cell-transport";
import { CellOverlays } from "../systems/cell-overlays";
// Milestone 9: Cell locomotion systems
import { CellSpaceSystem } from "../core/cell-space-system";
import { SubstrateSystem } from "../core/substrate-system";
import { CellMotility } from "../systems/cell-motility";
// Milestone 12: Throw & Membrane Interactions v1
import { ThrowSystem } from "../systems/throw-system";
import { UnifiedCargoSystem } from "../systems/unified-cargo-system";
import { MembraneTrampoline } from "../systems/membrane-trampoline";
import { ThrowInputController } from "../systems/throw-input-controller";
import { CargoHUD } from "../systems/cargo-hud";
// Milestone 13: Cytoskeleton Transport v1
import { CytoskeletonSystem } from "../systems/cytoskeleton-system";
import { CytoskeletonRenderer } from "../systems/cytoskeleton-renderer";
import { FilamentBuilder } from "../systems/filament-builder";
import { initializeEnhancedVesicleRouting, updateEnhancedVesicleRouting } from "../systems/cytoskeleton-vesicle-integration";
import type { WorldRefs, InstallOrder, Transcript, Vesicle } from "../core/world-refs";
// Milestone 14: Multiplayer Core v1
import { NetworkTransport } from "../network/transport";
import { RoomUI } from "../network/room-ui";
import { NetHUD } from "../network/net-hud";
import { NetSyncSystem } from "../network/net-sync-system";

type Keys = Record<"W" | "A" | "S" | "D" | "R" | "ENTER" | "SPACE" | "G" | "I" | "C" | "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "SIX" | "SEVEN" | "H" | "LEFT" | "RIGHT" | "P" | "T" | "V" | "Q" | "E" | "B" | "X" | "M" | "F" | "Y" | "U" | "O" | "K" | "L" | "N" | "F1" | "F2" | "F9" | "F10" | "F11" | "F12" | "ESC", Phaser.Input.Keyboard.Key>;

export class GameScene extends Phaser.Scene {
  private grid!: Phaser.GameObjects.Image;
  private cellSprite!: Phaser.GameObjects.Image;

  // NEW: Modular player actor
  private playerActor!: Player;
  private keys!: Keys;

  // NEW: Modular controllers and systems
  private tileActionController!: TileActionController;

  private cellCenter = new Phaser.Math.Vector2(0, 0);
  private cellRadius = 216; // Original size for hex grid area
  private playerBoundaryRadius = this.cellRadius - 12; // Smaller boundary for player movement
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
  private buildDateText!: Phaser.GameObjects.Text;
  private lastInfoUpdateTile: any = null; // Track last tile that was used for info update
  private lastInfoUpdateTime = 0; // Track when info was last updated

  // Milestone 6: Membrane debug visualization
  private membraneGraphics!: Phaser.GameObjects.Graphics;
  private showMembraneDebug = false;
  private transporterLabels: Phaser.GameObjects.Text[] = [];
  private proteinGlyphs: Phaser.GameObjects.Text[] = [];
  
  // Milestone 6: Membrane exchange system
  private membraneExchangeSystem!: MembraneExchangeSystem;
  
  // Story 8.11: External interface system
  private membranePortSystem!: MembranePortSystem;

  // Species diffusion system - Task 3
  private diffusionSystem!: DiffusionSystem;

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
  private selectedRecipeId: string | null = null; // Milestone 13: Support all recipe types (organelles, filaments, upgrades)
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

  // Milestone 8: Vesicle system for secretory pipeline
  private vesicles: Map<string, Vesicle> = new Map();
  private carriedVesicles: Vesicle[] = [];
  private nextVesicleId = 1;

  // NOTE: Movement mechanics now handled by Player actor
  // NOTE: Membrane physics now handled by Player actor

  // Consolidated system architecture - NEW
  private cellProduction!: CellProduction;
  private cellTransport!: CellTransport;
  
  // Store WorldRefs instance to ensure consistent reference
  private worldRefsInstance!: WorldRefs;
  private cellOverlays!: CellOverlays;
  
  // Milestone 9: Cell locomotion systems
  private cellSpaceSystem!: CellSpaceSystem;
  private substrateSystem!: SubstrateSystem;
  private cellMotility!: CellMotility;
  
  // Milestone 12: Throw & Membrane Interactions v1
  private throwSystem!: ThrowSystem;
  private unifiedCargoSystem!: UnifiedCargoSystem;
  private membraneTrampoline!: MembraneTrampoline;
  public throwInputController!: ThrowInputController;
  private cargoHUD!: CargoHUD;
  
  // Milestone 13: Cytoskeleton Transport v1
  private cytoskeletonSystem!: CytoskeletonSystem;
  private cytoskeletonRenderer!: CytoskeletonRenderer;
  private filamentBuilder!: FilamentBuilder;
  
  // Milestone 14: Multiplayer Core v1
  private networkTransport!: NetworkTransport;
  private roomUI!: RoomUI;
  private netHUD!: NetHUD;
  private netSyncSystem!: NetSyncSystem;
  
  // Milestone 9: Cell motility mode
  private cellDriveMode = false;
  
  // HOTFIX: Root container for all cell visuals
  private cellRoot!: Phaser.GameObjects.Container;

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

    // HOTFIX H1: Create cellRoot container for unified transform FIRST
    this.cellRoot = this.add.container(view.width * 0.5, view.height * 0.5);
    this.cellRoot.setDepth(1); // Above background, will contain all cell visuals
    
    // Cell membrane
    this.cellCenter.set(view.width * 0.5, view.height * 0.5);
    const cellKey = makeCellTexture(this, this.cellRadius * 2 + this.membraneThickness * 2, this.membraneThickness, this.col.cellFill, this.col.membrane);
    this.cellSprite = this.add.image(0, 0, cellKey).setDepth(1); // Position relative to cellRoot
    
    // HOTFIX H2: Re-parent cell sprite to cellRoot
    this.cellRoot.add(this.cellSprite);
    
    console.log('CellRoot container created at:', this.cellCenter.x, this.cellCenter.y);

    // Initialize hex grid FIRST (required by Player)
    this.initializeHexGrid();
    this.initializeHexGraphics();

    // NEW: Create modular Player actor (after hex grid is initialized)
    this.playerActor = new Player({
      scene: this,
      x: 0, // Position relative to cellRoot
      y: 0, // Position relative to cellRoot
      normalMaxSpeed: 120,
      acceleration: 600,
      dashSpeed: 320,
      dashDuration: 0.25,
      maxDashCooldown: 1.2,
      playerColor: this.col.player,
      ringColor: this.col.playerRing,
      cellCenter: new Phaser.Math.Vector2(0, 0), // Relative to cellRoot
      cellRadius: this.playerBoundaryRadius, // Use smaller boundary for player movement
      cellRoot: this.cellRoot // HOTFIX H5: Pass cellRoot for membrane effects
    }, this.hexGrid);
    
    // HOTFIX H2: Re-parent player to cellRoot
    this.cellRoot.add(this.playerActor);

    // Initialize all other systems...
    this.initializeOrganelleSystem();
    this.initializePlayerInventory();
    this.initializeDebugInfo();
    this.initializeHeatmapSystem();
    this.initializePassiveEffectsSystem();
    this.initializeDiffusionSystem();
    this.initializeMembraneExchangeSystem();
    this.initializeBlueprintSystem(); // Initialize before WorldRefs creation
    this.initializeConservationTracker();
    
    // Milestone 9: Initialize cell locomotion systems
    this.initializeCellLocomotionSystems();

    // NEW: After all systems initialized, create transcript systems and WorldRefs 
    
    // Create a temporary WorldRefs for system initialization (without cellMotility)
    const baseWorldRefs = {
      hexGrid: this.hexGrid,
      cellRoot: this.cellRoot,
      playerInventory: this.playerInventory,
      player: this.playerActor,
      organelleSystem: this.organelleSystem,
      organelleRenderer: this.organelleRenderer,
      blueprintSystem: this.blueprintSystem,
      blueprintRenderer: this.blueprintRenderer,
      membraneExchangeSystem: this.membraneExchangeSystem,
      membranePortSystem: this.membranePortSystem, // Story 8.11: External interface
      diffusionSystem: this.diffusionSystem,
      passiveEffectsSystem: this.passiveEffectsSystem,
      heatmapSystem: this.heatmapSystem,
      conservationTracker: this.conservationTracker,
      // Milestone 9: Cell locomotion systems
      cellSpaceSystem: this.cellSpaceSystem,
      substrateSystem: this.substrateSystem,
      cellMotility: undefined as any, // Will be set after creation
      installOrders: this.installOrders,
      transcripts: this.transcripts,
      carriedTranscripts: this.carriedTranscripts,
      nextOrderId: this.nextOrderId,
      nextTranscriptId: this.nextTranscriptId,
      // Milestone 8: Vesicle system
      vesicles: this.vesicles,
      carriedVesicles: this.carriedVesicles,
      nextVesicleId: this.nextVesicleId,
      showToast: (message: string) => this.showToast(message),
      refreshTileInfo: () => this.updateTileInfoPanel()
    };

    // Now create complete WorldRefs with all systems (old individual systems removed)
    const worldRefs: WorldRefs = {
      ...baseWorldRefs,
      scene: this, // Add scene reference for membrane visual refreshes
      cellMotility: null as any, // Placeholder, will be set after creation
      cytoskeletonSystem: null as any, // Placeholder, will be set after creation
      cytoskeletonGraph: null as any, // Placeholder, will be set after cytoskeleton system creation
      cytoskeletonRenderer: null as any, // Placeholder, will be set after creation
      cellOverlays: null as any // Placeholder, will be set after creation
    };
    
    // Store worldRefs instance for consistent reference across systems
    this.worldRefsInstance = worldRefs;
    
    console.log(`🧪 [SCENE] WorldRefs created with scene reference:`, !!worldRefs.scene);

    // Create CellMotility now that we have worldRefs structure
    this.cellMotility = new CellMotility(this, worldRefs, this.cellSpaceSystem);
    worldRefs.cellMotility = this.cellMotility;

    // Create modular controllers and systems
    this.tileActionController = new TileActionController({
      scene: this,
      worldRefs
    });

    // Initialize consolidated systems - NEW ARCHITECTURE
    this.cellProduction = new CellProduction(this, worldRefs, this.cellRoot);
    this.cellTransport = new CellTransport(this, worldRefs);
    this.cellOverlays = new CellOverlays(this, worldRefs, this.cellRoot); // Now cellMotility is defined
    worldRefs.cellOverlays = this.cellOverlays;

    // Milestone 12: Initialize Unified Cargo System (throw system after networking)
    this.unifiedCargoSystem = new UnifiedCargoSystem(this, worldRefs);
    this.membraneTrampoline = new MembraneTrampoline(this, worldRefs);
    
    // Milestone 13: Initialize Cytoskeleton Transport v1
    this.cytoskeletonSystem = new CytoskeletonSystem(this, worldRefs);
    worldRefs.cytoskeletonSystem = this.cytoskeletonSystem; // Add to worldRefs
    worldRefs.cytoskeletonGraph = this.cytoskeletonSystem.graph; // Add graph reference
    this.cytoskeletonRenderer = new CytoskeletonRenderer(this, worldRefs, this.cytoskeletonSystem);
    worldRefs.cytoskeletonRenderer = this.cytoskeletonRenderer; // Add renderer to worldRefs
    this.filamentBuilder = new FilamentBuilder(this, worldRefs, this.cytoskeletonSystem);
    
    // Milestone 13 Part D: Initialize enhanced vesicle routing with cytoskeleton
    initializeEnhancedVesicleRouting(worldRefs);

    // Milestone 14: Initialize Multiplayer Core v1
    this.initializeNetworking();

    // Milestone 12: Initialize Throw System (after networking for isHost check)
    const isHost = (this.netSyncSystem as any)?.isHost ?? true; // Default to true if no network
    console.log(`🎯 GameScene: Creating ThrowInputController - netSyncSystem exists: ${!!this.netSyncSystem}, isHost: ${isHost}`);
    this.throwSystem = new ThrowSystem(this, worldRefs, this.unifiedCargoSystem, isHost);
    this.throwInputController = new ThrowInputController(
      this, 
      worldRefs, 
      this.throwSystem, 
      this.unifiedCargoSystem,
      { netSyncSystem: this.netSyncSystem }
    );
    this.cargoHUD = new CargoHUD(this, this.unifiedCargoSystem, {
      position: { x: 20, y: 130 } // Position below other HUD elements
    });

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
      SEVEN: this.input.keyboard!.addKey("SEVEN"),
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
      Y: this.input.keyboard!.addKey("Y"),
      U: this.input.keyboard!.addKey("U"), // Toggle queue badges
      O: this.input.keyboard!.addKey("O"), // Toggle vesicle debug
      K: this.input.keyboard!.addKey("K"), // Debug ATP injection
      L: this.input.keyboard!.addKey("L"), // Launch motility course
      N: this.input.keyboard!.addKey("N"), // Toggle infrastructure overlay
      F1: this.input.keyboard!.addKey("F1"), // Build actin filaments
      F2: this.input.keyboard!.addKey("F2"), // Build microtubules
      F9: this.input.keyboard!.addKey("F9"), // Toggle network HUD
      F10: this.input.keyboard!.addKey("F10"), // Toggle room UI
      F11: this.input.keyboard!.addKey("F11"), // Simulate packet loss
      F12: this.input.keyboard!.addKey("F12"), // Toggle network logging
      ESC: this.input.keyboard!.addKey("ESC"), // Exit build mode
    };

    // Initialize remaining UI systems
    addHud(this);
    this.initializeHexInteraction();
    this.initializeTileInfoPanel();
    this.initializeDebugInfo();
    this.initializeTranscriptSystem(); // Milestone 7 Task 1
    
    // Initialize protein glyphs by rendering membrane debug
    this.renderMembraneDebug();
    
    // Milestone 8: Story 8.7 - Listen for dirty tile refresh events
    this.events.on('refresh-membrane-glyphs', () => {
      this.renderMembraneDebug();
    });
    
    // Initialize HUD with current information
    this.updateHUD();
    
    // HOTFIX H4: Initialize camera to center on cell
    this.cameras.main.centerOn(this.cellCenter.x, this.cellCenter.y);
    console.log('Camera centered on cell at:', this.cellCenter.x, this.cellCenter.y);

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
      
      // HOTFIX H3: Update unified cellRoot position instead of individual elements
      this.cellRoot.setPosition(this.cellCenter.x, this.cellCenter.y);

      // HOTFIX H5: Update hex grid to use local coordinates (0,0 relative to cellRoot)
      if (this.hexGrid) {
        this.hexGrid.updateCenter(0, 0); // Local coordinates relative to cellRoot
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

    // Setup shutdown handler for consolidated systems
    this.events.once('shutdown', () => {
      this.cellProduction?.destroy();
      this.cellTransport?.destroy();
      this.cellOverlays?.destroy();
    });
  }

  override update() {
    // MILESTONE 9 FIX 1: Only drive camera from CellSpaceSystem when in drive mode
    if (this.cellDriveMode) {
      const tf = this.cellSpaceSystem.getTransform();
      this.cellCenter.set(tf.position.x, tf.position.y);
      
      // HOTFIX H3: Drive unified cellRoot transform instead of individual updates
      this.cellRoot.setPosition(tf.position.x, tf.position.y);
      
      this.cameras.main.centerOn(tf.position.x, tf.position.y);
      
      // MILESTONE 9 FIX 1: Keep rendering hex grid after movement
      this.renderHexGrid();
    } else {
      // HOTFIX H4: When not in drive mode, camera follows player's world position
      const playerWorldX = this.cellRoot.x + this.playerActor.x;
      const playerWorldY = this.cellRoot.y + this.playerActor.y;
      this.cameras.main.centerOn(playerWorldX, playerWorldY);
    }

    // MILESTONE 14: Block game input when room UI input field has focus
    if (this.roomUI.hasInputFocus()) {
      // Only allow F10 to close room UI and other F keys for dev tools
      if (Phaser.Input.Keyboard.JustDown(this.keys.F10)) {
        this.roomUI.toggle();
      }
      
      // Allow other F keys for dev tools
      if (Phaser.Input.Keyboard.JustDown(this.keys.F9)) {
        this.netHUD.toggle();
      }
      
      if (Phaser.Input.Keyboard.JustDown(this.keys.F11)) {
        // Toggle packet loss simulation
        const currentLoss = this.networkTransport.getDevStats().packetLossRate;
        const newLoss = currentLoss > 0 ? 0 : 0.1; // 10% packet loss
        this.networkTransport.setPacketLossRate(newLoss);
        this.showToast(`Packet loss: ${(newLoss * 100).toFixed(1)}%`);
      }
      
      // Skip all other game input processing
      return;
    }

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
      // MILESTONE 9 FIX 3: Toggle cell drive mode
      this.cellDriveMode = !this.cellDriveMode;
      this.cellMotility.setDriveMode(this.cellDriveMode);
      
      // Sync cell space system position when entering drive mode
      if (this.cellDriveMode) {
        this.cellSpaceSystem.setPosition(this.cellCenter.x, this.cellCenter.y);
      }
      
      console.log(`Cell drive mode: ${this.cellDriveMode ? 'ON' : 'OFF'}`);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.Y)) {
      // System status debug - show consolidated system info
      this.printSystemStatus();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.U)) {
      // Milestone 8: Toggle queue badges
      this.cellOverlays.toggleQueueBadges();
    }
    
    // MILESTONE 9 FIX 4: Debug ATP injection for testing dash
    if (Phaser.Input.Keyboard.JustDown(this.keys.K)) {
      this.playerInventory.take('ATP', 50);
      this.showToast("Added 50 ATP for dash testing");
    }
    
    // MILESTONE 10: Launch motility course
    if (Phaser.Input.Keyboard.JustDown(this.keys.L)) {
      this.scene.start('MotilityCourse');
    }

    // MILESTONE 13: Toggle infrastructure overlay
    if (Phaser.Input.Keyboard.JustDown(this.keys.N)) {
      this.cytoskeletonRenderer.toggleInfrastructureOverlay();
      const state = this.cytoskeletonRenderer.isInfrastructureOverlayEnabled() ? 'ON' : 'OFF';
      this.showToast(`Infrastructure overlay: ${state}`);
    }

    // MILESTONE 13 TESTING: Cytoskeleton integration debugging
    if (Phaser.Input.Keyboard.JustDown(this.keys.V)) {
      // Debug key: Log cytoskeleton and vesicle stats
      console.log("=== CYTOSKELETON INTEGRATION DEBUG ===");
      
      // Log cytoskeleton graph stats
      console.log("🚂 Cytoskeleton System Stats:");
      console.log(`📊 Cytoskeleton Graph: nodes and edges available`);
      
      // Log vesicle stats
      console.log(`📦 Vesicle Stats: ${this.vesicles.size} active vesicles`);
      let railVesicles = 0;
      for (const vesicle of this.vesicles.values()) {
        if (vesicle.railState) railVesicles++;
      }
      console.log(`🚂 Rail Transport: ${railVesicles} vesicles on rails`);
      
      this.showToast("Cytoskeleton stats logged to console");
    }

    // MILESTONE 13: Filament building
    if (Phaser.Input.Keyboard.JustDown(this.keys.F1)) {
      this.filamentBuilder.setFilamentType('actin');
      this.filamentBuilder.setEnabled(true);
      this.showToast("Actin building mode: Click and drag to place filaments");
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.F2)) {
      this.filamentBuilder.setFilamentType('microtubule');
      this.filamentBuilder.setEnabled(true);
      this.showToast("Microtubule building mode: Click and drag to place filaments");
    }

    // MILESTONE 13: Exit filament building mode
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      this.filamentBuilder.setEnabled(false);
      this.showToast("Exited filament building mode");
    }

    // MILESTONE 14: Network controls
    if (Phaser.Input.Keyboard.JustDown(this.keys.F9)) {
      this.netHUD.toggle();
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keys.F10)) {
      this.roomUI.toggle();
    }
    
    // Network dev tools
    if (Phaser.Input.Keyboard.JustDown(this.keys.F11)) {
      // Toggle packet loss simulation
      const currentLoss = this.networkTransport.getDevStats().packetLossRate;
      const newLoss = currentLoss > 0 ? 0 : 0.1; // 10% packet loss
      this.networkTransport.setPacketLossRate(newLoss);
      this.showToast(`Packet loss: ${(newLoss * 100).toFixed(1)}%`);
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keys.F12)) {
      // Toggle network logging
      const loggingEnabled = this.networkTransport.toggleNetworkLogging();
      this.showToast(`Network logging: ${loggingEnabled ? 'ON' : 'OFF'}`);
    }
    
    // Shift+F10 for artificial latency
    if (Phaser.Input.Keyboard.JustDown(this.keys.F10) && this.input.keyboard!.checkDown(this.input.keyboard!.addKey('SHIFT'))) {
      const currentLatency = this.networkTransport.getDevStats().artificialLatency;
      const newLatency = currentLatency > 0 ? 0 : 150; // 150ms artificial latency
      this.networkTransport.setArtificialLatency(newLatency);
      this.showToast(`Artificial latency: ${newLatency}ms`);
    }
    
    // O key for creating test entities (multiplayer testing)
    if (Phaser.Input.Keyboard.JustDown(this.keys.O)) {
      this.createTestEntities();
    }

    // Debug species controls - Task 4
    this.handleDebugControls();

    // NEW: Modular input handling through tile action controller
    // (Handles build mode, protein requests, etc.)
    this.tileActionController.handleInput(this.keys, this.currentTileRef);
    
    // CRITICAL: Restore essential build system functionality that was lost
    this.handleEssentialBuildInput();

    // Milestone 12: Unified cargo pickup/drop mechanics (R key)
    this.handleUnifiedCargoInput();

    // Update hex interaction
    this.updateHexInteraction();

    // NEW: MODULAR UPDATE SYSTEM
    const deltaSeconds = this.game.loop.delta / 1000;
    
    // MILESTONE 9 FIX 3: Conditional movement based on drive mode
    if (this.cellDriveMode) {
      // Cell drive mode: cellMotility handles WASD, player stays put
      const disabledKeys = {
        W: { isDown: false, _justDown: false },
        A: { isDown: false, _justDown: false },
        S: { isDown: false, _justDown: false },
        D: { isDown: false, _justDown: false },
        SPACE: { isDown: false, _justDown: false }
      } as any;
      this.playerActor.update(deltaSeconds, disabledKeys);
      this.cellMotility.updateInput(this.keys);
    } else {
      // Check for membrane trampoline control reduction
      const controlReduction = this.membraneTrampoline.getControlReduction();
      
      if (controlReduction < 0.9) {
        // Significantly reduce or disable control during strong trampoline lockout
        const reducedKeys = {
          W: { isDown: false, _justDown: false },
          A: { isDown: false, _justDown: false },
          S: { isDown: false, _justDown: false },
          D: { isDown: false, _justDown: false },
          SPACE: this.keys.SPACE // Allow dash input
        } as any;
        this.playerActor.update(deltaSeconds, reducedKeys);
        console.log(`🏀 Control locked out (${(controlReduction * 100).toFixed(0)}% control)`);
      } else {
        // Normal mode: player actor handles WASD, cellMotility ignores input
        this.playerActor.update(deltaSeconds, this.keys);
      }
    }
    
    // Milestone 6 Task 1: Update current tile tracking
    this.updateCurrentTile();
    
    // Use modular tile action controller for input handling
    this.tileActionController.handleInput(this.keys, this.currentTileRef);
    
    // NOTE: Consolidated systems (CellProduction, CellTransport, CellOverlays) 
    // are now automatically updated by Phaser's lifecycle via SystemObject
    
    // Manual updates for systems not yet consolidated:
    if (!this.conservationTracker.isPausedState()) {
      // Update blueprint construction - Milestone 5
      this.blueprintSystem.processConstruction(this.game.loop.delta);
    }
    
    // Update heatmap - Task 5
    this.heatmapSystem.update();
    
    // Update blueprint rendering - Milestone 5 Task 5
    this.blueprintRenderer.render();
    
    // NOTE: Transcript rendering now handled by CellProduction system
    
    // Update build palette position to maintain fixed screen location
    this.buildPalette.updatePosition();
    
    // Milestone 12: Update throw & membrane interaction systems
    this.throwInputController.update();
    this.cargoHUD.update();
    
    // Update player cargo indicator
    const carriedCargo = this.unifiedCargoSystem.getCarriedCargo();
    this.playerActor.updateCargoIndicator(carriedCargo ? carriedCargo.type : null);
    
    // Update HUD with current information
    this.updateHUD();
    
    // Milestone 14: Update network HUD
    this.netHUD.update();
    
    // Update conservation tracking - Task 8
    this.conservationTracker.update();
    this.updateConservationPanel();
    
    // Milestone 13 Part D: Update enhanced vesicle routing
    updateEnhancedVesicleRouting();
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
    
    // HOTFIX H5: Initialize hex grid with local coordinates (0,0) since it's now in cellRoot
    this.hexGrid = new HexGrid(this.hexSize, 0, 0);
    this.hexGrid.generateTiles(this.gridRadius);
    
    const maxDistance = this.cellRadius - this.hexSize;
    this.hexGrid.filterTilesInCircle(0, 0, maxDistance);
    
    // Milestone 6 Task 1: Compute membrane tiles using local coordinates
    this.hexGrid.recomputeMembranes(0, 0, this.cellRadius);
    
    console.log(`Hex Grid initialized:
      - Tiles: ${this.hexGrid.getTileCount()}
      - Hex size: ${this.hexSize}
      - Grid radius: ${this.gridRadius}
      - Cell radius: ${this.cellRadius}
      - Max distance: ${maxDistance}
      - Cell center: (0, 0) [local coordinates in cellRoot]`);
    
    // Test coordinate conversion and neighbors
    const testTiles = this.hexGrid.getAllTiles().slice(0, 3);
    testTiles.forEach((tile, i) => {
      const neighbors = this.hexGrid.getNeighbors(tile.coord);
      console.log(`Tile ${i}: coord(${tile.coord.q},${tile.coord.r}) local(${Math.round(tile.worldPos.x)},${Math.round(tile.worldPos.y)}) neighbors: ${neighbors.length}`);
    });
    
    // Test center tile conversion
    const centerTile = this.hexGrid.getTile({ q: 0, r: 0 });
    if (centerTile) {
      const backToHex = this.hexGrid.worldToHex(centerTile.worldPos.x, centerTile.worldPos.y);
      console.log(`Center tile test: original(0,0) -> local(${Math.round(centerTile.worldPos.x)}, ${Math.round(centerTile.worldPos.y)}) -> back to hex(${backToHex.q}, ${backToHex.r})`);
    }
    
    console.log('Hex grid initialization complete!');
  }

  private initializeHexGraphics(): void {
    this.hexGraphics = this.add.graphics();
    this.hexGraphics.setDepth(1.5); // Above background, below organelles
    this.hexGraphics.setVisible(this.showHexGrid);
    
    // HOTFIX H2: Re-parent hex graphics to cellRoot
    this.cellRoot.add(this.hexGraphics);
    
    this.renderHexGrid();
    
    // Milestone 6: Initialize membrane debug graphics
    this.initializeMembraneGraphics();
  }

  private initializeMembraneGraphics(): void {
    this.membraneGraphics = this.add.graphics();
    this.membraneGraphics.setDepth(1.6); // Above hex grid, below organelles
    this.membraneGraphics.setVisible(true); // Always visible now that it contains protein glyphs
    
    // HOTFIX H2: Re-parent membrane graphics to cellRoot
    this.cellRoot.add(this.membraneGraphics);
    
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
            
            // HOTFIX H5: Add transporter labels to cellRoot
            this.cellRoot.add(label);
            
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
          
          // HOTFIX H5: Calculate direction toward/away from local center (0,0) since we're in cellRoot
          const centerX = 0; // Local coordinates center
          const centerY = 0; // Local coordinates center
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
    
    // Toggle background grid texture
    if (this.grid) {
      this.grid.setVisible(this.showHexGrid);
    }
    
    // Toggle hex line graphics
    if (this.hexGraphics) {
      this.hexGraphics.setVisible(this.showHexGrid);
    }
    
    // Toggle organelle renderer
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
    
    // HOTFIX H2: Re-parent interaction graphics to cellRoot
    this.cellRoot.add(this.hexInteractionGraphics);
    
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerdown', this.onPointerDown, this);
  }

  private updateHexInteraction(): void {
    this.renderHexInteractionHighlights();
    
    // Only update tile info panel when tile changes or periodically (every 250ms)
    const now = Date.now();
    const shouldUpdate = 
      this.selectedTile !== this.lastInfoUpdateTile || 
      (now - this.lastInfoUpdateTime) > 250; // Update every 250ms at most
    
    if (shouldUpdate) {
      this.updateTileInfoPanel();
      this.lastInfoUpdateTile = this.selectedTile;
      this.lastInfoUpdateTime = now;
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.hexGrid) return;
    
    // HOTFIX H5: Convert world coordinates to local coordinates relative to cellRoot
    const localX = pointer.worldX - this.cellRoot.x;
    const localY = pointer.worldY - this.cellRoot.y;
    const tile = this.hexGrid.getTileAtWorld(localX, localY);
    
    this.hoveredTile = tile || null;
    
    // Milestone 6 Task 3: Mouse hover only for info, not for actions
    // Removed build palette filter update - that's now based on current tile only
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.hexGrid) return;
    
    if (pointer.leftButtonDown()) {
      // HOTFIX H5: Convert world coordinates to local coordinates relative to cellRoot
      const localX = pointer.worldX - this.cellRoot.x;
      const localY = pointer.worldY - this.cellRoot.y;
      const tile = this.hexGrid.getTileAtWorld(localX, localY);
      
      // Milestone 6 Task 3: Mouse click only for tile selection (info), not actions
      // Remove blueprint placement - that's now handled by ENTER key on current tile
      
      // Normal tile selection for info/inspection
      this.selectedTile = tile || null;
      
      if (tile) {
        console.log(`Clicked: mouse world(${Math.round(pointer.worldX)}, ${Math.round(pointer.worldY)}) -> local(${Math.round(localX)}, ${Math.round(localY)}) -> hex(${tile.coord.q}, ${tile.coord.r}) at local(${Math.round(tile.worldPos.x)}, ${Math.round(tile.worldPos.y)})`);
      } else {
        console.log(`Clicked: mouse world(${Math.round(pointer.worldX)}, ${Math.round(pointer.worldY)}) -> local(${Math.round(localX)}, ${Math.round(localY)}) -> no hex found`);
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
    
    // Milestone 13: For now, only handle organelle recipes through blueprint system
    // TODO: Add filament and upgrade preview rendering
    const recipe = CONSTRUCTION_RECIPES.getRecipe(this.selectedRecipeId);
    if (!recipe || recipe.type !== 'organelle') return;
    
    const validation = this.blueprintSystem.validatePlacement(
      this.selectedRecipeId as OrganelleType,
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
      
      // Milestone 13: Show cargo (transcripts/vesicles) at this tile
      const cargoAtTile = this.getCargoAtTile(tile.coord);
      if (cargoAtTile.length > 0) {
        info.push(`📦 Cargo at this tile:`);
        for (const cargo of cargoAtTile) {
          if (cargo.type === 'transcript') {
            const transcript = cargo.item as Transcript;
            const stageInfo = transcript.itinerary 
              ? `${transcript.itinerary.stageIndex + 1}/${transcript.itinerary.stages.length} (${transcript.itinerary.stages[transcript.itinerary.stageIndex]?.kind || 'unknown'})`
              : 'legacy';
            info.push(`  📝 Transcript ${transcript.proteinId} - Stage ${stageInfo}`);
            info.push(`    TTL: ${transcript.ttlSeconds.toFixed(1)}s, State: ${transcript.state}`);
          } else {
            const vesicle = cargo.item as Vesicle;
            const stageInfo = vesicle.itinerary 
              ? `${vesicle.itinerary.stageIndex + 1}/${vesicle.itinerary.stages.length} (${vesicle.itinerary.stages[vesicle.itinerary.stageIndex]?.kind || 'unknown'})`
              : 'legacy';
            info.push(`  🧬 Vesicle ${vesicle.proteinId} - Stage ${stageInfo}`);
            info.push(`    TTL: ${(vesicle.ttlMs / 1000).toFixed(1)}s, State: ${vesicle.state}`);
          }
        }
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
      
      // Milestone 13: Show cytoskeleton segments at this tile
      const cytoskeletonSegments = this.cytoskeletonSystem.getSegmentsAtTile(tile.coord);
      if (cytoskeletonSegments.length > 0) {
        info.push(`🚂 Cytoskeleton Rails:`);
        for (const segment of cytoskeletonSegments) {
          const utilization = Math.round(segment.utilization * 100);
          const utilizationIcon = utilization > 70 ? '🔴' : utilization > 30 ? '🟡' : '🟢';
          info.push(`  ${segment.type} - ${utilizationIcon} ${utilization}% utilization`);
          info.push(`    Capacity: ${segment.capacity}/tick, Speed: ${segment.speed}x`);
        }
        info.push(''); // Add spacing
      }
      
      info.push(`Species Concentrations:`);
      
      // Show all species concentrations with reduced precision to minimize flicker
      for (const speciesId in concentrations) {
        const concentration = concentrations[speciesId];
        if (concentration > 0.01) { // Only show meaningful amounts
          info.push(`  ${speciesId}: ${concentration.toFixed(1)}`); // Reduced to 1 decimal place
        }
      }
      
      this.tileInfoPanel.setText(info.join('\n'));
      this.tileInfoPanel.setVisible(true);
    } else {
      this.tileInfoPanel.setVisible(false);
    }
  }

  /**
   * Force an immediate tile info panel update (call when something significant changes)
   */
  private forceUpdateTileInfoPanel(): void {
    this.lastInfoUpdateTime = 0; // Reset timer to force update
    this.updateTileInfoPanel();
  }

  /**
   * Milestone 13: Get cargo (transcripts/vesicles) at a specific tile
   */
  private getCargoAtTile(coord: HexCoord): Array<{type: 'transcript' | 'vesicle', item: Transcript | Vesicle}> {
    const cargo: Array<{type: 'transcript' | 'vesicle', item: Transcript | Vesicle}> = [];
    
    // Check transcripts
    for (const transcript of this.transcripts.values()) {
      if (!transcript.isCarried && transcript.atHex.q === coord.q && transcript.atHex.r === coord.r) {
        cargo.push({ type: 'transcript', item: transcript });
      }
    }
    
    // Check vesicles
    for (const vesicle of this.vesicles.values()) {
      if (!vesicle.isCarried && vesicle.atHex.q === coord.q && vesicle.atHex.r === coord.r) {
        cargo.push({ type: 'vesicle', item: vesicle });
      }
    }
    
    return cargo;
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

    // Build info debug text at bottom of screen
    const buildInfo = __BUILD_INFO__; // Injected at build time by Vite
    const buildText = [
      `Current Build: ${buildInfo.buildTime}`,
      ...buildInfo.commits.map(commit => `• ${commit}`)
    ].join('\n');
    
    this.buildDateText = this.add.text(this.scale.width - 10, this.scale.height - 10, buildText, {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#666666",
      backgroundColor: "#000000aa",
      padding: { x: 6, y: 4 },
      lineSpacing: 2,
    });
    this.buildDateText.setOrigin(1, 1); // Anchor to bottom-right
    this.buildDateText.setDepth(1000);
    this.buildDateText.setScrollFactor(0);
  }

  // Milestone 7 Task 1: Initialize transcript system
  private initializeTranscriptSystem(): void {
    // Graphics for rendering transcript dots
    this.transcriptGraphics = this.add.graphics();
    this.transcriptGraphics.setDepth(3.5); // Above organelles, below player
    
    // HOTFIX H2: Re-parent transcript graphics to cellRoot
    this.cellRoot.add(this.transcriptGraphics);
    
    console.log('Transcript system initialized');
  }
  
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
    this.organelleRenderer = new OrganelleRenderer(this, this.organelleSystem, this.hexSize, this.cellRoot);
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
    this.buildPalette.onRecipeSelected = (recipeId: string) => {
      this.selectedRecipeId = recipeId;
      this.isInBuildMode = true;
      console.log(`Entered build mode with recipe: ${recipeId}`);
    };
    
    // Initialize blueprint renderer
    this.blueprintRenderer = new BlueprintRenderer(this, this.blueprintSystem, this.hexSize, this.cellRoot);
    
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
        this.forceUpdateTileInfoPanel();
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
    
    // Milestone 7 Task 8: Transcript and order status (updated for unified cargo)
    const carriedCargo = this.unifiedCargoSystem.getCarriedCargo();
    const carriedCount = carriedCargo ? 1 : 0;
    const carriedType = carriedCargo ? carriedCargo.type : 'none';
    const totalTranscripts = this.transcripts.size;
    const pendingOrders = this.installOrders.size;
    const transcriptStatus = `Cargo: ${carriedCount}/1 carried (${carriedType}), ${totalTranscripts} transcripts total | Orders: ${pendingOrders} pending`;
    
    // Milestone 10: Updated control hints for motility modes
    // Milestone 7: Added transcript controls
    const controls = `B: Build/Request | ENTER: Confirm | X: Cancel/Protease | Q/E: Scoop/Drop | R: Pickup/Drop transcript | Z: Handbrake | TAB: Cycle Mode | L: Motility Course`;
    const message = `${heatmapStatus} | ${inventoryStatus}${blueprintStatus} | ${transcriptStatus} | ${controls}`;
    
    // Milestone 10: Enhanced motility information with modes
    let motilityInfo = undefined;
    if (this.cellMotility) {
      const motilityState = this.cellMotility.getState();
      const modeRegistry = this.cellMotility.getModeRegistry();
      const currentMode = modeRegistry.getCurrentMode();
      const modeState = modeRegistry.getState();
      const substrateScalars = modeRegistry.getSubstrateScalars(motilityState.currentSubstrate);
      
      motilityInfo = {
        speed: motilityState.speed,
        adhesionCount: motilityState.adhesion.count,
        atpDrain: motilityState.atpDrainPerSecond,
        mode: motilityState.mode,
        substrate: motilityState.currentSubstrate,
        currentMotilityMode: {
          id: currentMode.id,
          name: currentMode.name,
          icon: currentMode.icon
        },
        modeState: {
          blebCooldown: modeState.blebbing.cooldownRemaining / 1000, // Convert to seconds
          adhesionMaturity: motilityState.adhesion.maturity,
          proteaseActive: modeState.mesenchymal.proteaseActive,
          handbrakeAvailable: modeState.amoeboid.handbrakeAvailable
        },
        substrateEffects: substrateScalars
      };
    }
    
    setHud(this, { message, motilityInfo, driveMode: this.cellDriveMode });
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
    this.heatmapSystem = new HeatmapSystem(this, this.hexGrid, this.hexSize, this.cellRoot);
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
    this.membranePortSystem = new MembranePortSystem(); // Story 8.11: External interface
    console.log('Membrane exchange system and port system initialized');
  }

  private initializeCellLocomotionSystems(): void {
    // Initialize cell space system with current cell center
    this.cellSpaceSystem = new CellSpaceSystem(this.cellCenter.x, this.cellCenter.y);
    console.log('Cell space system initialized');
    
    // Initialize substrate system
    this.substrateSystem = new SubstrateSystem();
    console.log('Substrate system initialized');
    
    // Initialize cell motility (depends on the other systems)
    // Note: This will be created after worldRefs is ready
  }

  // Milestone 14: Multiplayer Core v1 - Networking initialization
  private initializeNetworking(): void {
    console.log('Initializing networking systems...');
    
    // Create network transport
    this.networkTransport = new NetworkTransport();
    
    // Create room management UI
    const view = this.scale.gameSize;
    this.roomUI = new RoomUI({
      scene: this,
      x: view.width * 0.5,
      y: view.height * 0.5
    }, this.networkTransport);
    
    // Create network HUD (top-right corner)
    this.netHUD = new NetHUD({
      scene: this,
      x: view.width - 120,
      y: 80
    }, this.networkTransport);
    
    // Set up event handlers for when networking is established
    this.networkTransport.addEventListener('connection', (event: any) => {
      const connectionEvent = event.detail;
      if (connectionEvent.type === 'connected') {
        this.initializeNetSyncSystem();
      }
    });
    
    console.log('Networking systems initialized');
  }
  
  // Initialize NetSyncSystem after connection is established
  private initializeNetSyncSystem(): void {
    if (this.netSyncSystem) return; // Already initialized
    
    const isHost = this.roomUI.isHostPlayer();
    
    console.log(`Initializing NetSyncSystem as ${isHost ? 'HOST' : 'CLIENT'}`);
    
    this.netSyncSystem = new NetSyncSystem({
      scene: this,
      transport: this.networkTransport,
      worldRefs: this.getWorldRefs(),
      player: this.playerActor,
      isHost: isHost
    });
    
    // Connect NetHUD to NetSyncSystem for prediction stats
    this.netHUD.setNetSyncSystem(this.netSyncSystem);
  }
  
  /**
   * Create test entities for multiplayer replication testing
   */
  private createTestEntities(): void {
    const playerPos = this.getPlayerHexCoord();
    if (!playerPos) return;
    
    // Create a test transcript near the player
    const transcriptId = `transcript_${this.nextTranscriptId++}`;
    const transcriptHex = { q: playerPos.q + 1, r: playerPos.r };
    const transcript: Transcript = {
      id: transcriptId,
      proteinId: 'GLUT', // Test protein
      atHex: transcriptHex,
      ttlSeconds: 30, // 30 second TTL
      worldPos: this.hexGrid.hexToWorld(transcriptHex),
      isCarried: false,
      moveAccumulator: 0,
      state: 'traveling',
      processingTimer: 0,
      glycosylationState: 'none'
    };
    
    this.transcripts.set(transcriptId, transcript);
    
    // Create a test vesicle near the player  
    const vesicleId = `vesicle_${this.nextVesicleId++}`;
    const vesicleHex = { q: playerPos.q - 1, r: playerPos.r };
    const vesicle: Vesicle = {
      id: vesicleId,
      proteinId: 'GLUT',
      atHex: vesicleHex,
      ttlMs: 45000, // 45 second TTL
      worldPos: this.hexGrid.hexToWorld(vesicleHex),
      isCarried: false,
      destHex: { q: playerPos.q, r: playerPos.r + 2 },
      state: 'EN_ROUTE_GOLGI',
      glyco: 'partial',
      processingTimer: 0,
      retryCounter: 0
    };
    
    this.vesicles.set(vesicleId, vesicle);
    
    this.showToast(`Created test entities: 1 transcript, 1 vesicle`);
    console.log(`🧪 Created test entities for entity replication testing`);
  }

  // Helper to get current world refs
  private getWorldRefs(): WorldRefs {
    return this.worldRefsInstance;
  }

  
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
      if (Phaser.Input.Keyboard.JustDown(this.keys.SEVEN)) {
        this.injectSpecies('PROTEIN', injectionAmount);
      }
    }

    // Show player inventory status (Debug)
    if (Phaser.Input.Keyboard.JustDown(this.keys.V)) {
      console.log('Player Inventory Status:', this.playerInventory.getStatus());
    }

    // F key - Instantly complete construction on current tile
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) {
      // Network-aware construction completion
      if (this.netSyncSystem && !(this.netSyncSystem as any).isHost) {
        // Client: request finish construction from host
        this.requestFinishConstruction(playerCoord.q, playerCoord.r);
      } else {
        // Host or single-player: instant complete directly
        this.instantCompleteConstruction(playerCoord);
      }
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
  
  /**
   * Handle essential build input that was lost in modular refactor
   */
  private handleEssentialBuildInput(): void {
    // Toggle build palette with B key for non-membrane tiles
    if (Phaser.Input.Keyboard.JustDown(this.keys.B)) {
      // Check if standing on membrane tile for protein installation
      if (this.currentTileRef && this.hexGrid.isMembraneCoord(this.currentTileRef.coord)) {
        this.handleMembraneProteinRequest();
        return;
      }
      
      // Regular build palette for non-membrane tiles
      this.buildPalette.toggle();
      
      // When opening build palette, filter based on current tile
      if (this.buildPalette.getIsVisible()) {
        this.updateBuildPaletteFilter();
        this.isInBuildMode = true;
      }
      
      // Exit build mode when closing palette
      if (!this.buildPalette.getIsVisible()) {
        this.isInBuildMode = false;
        this.selectedRecipeId = null;
        // Reset palette to show all recipes when closing
        this.buildPalette.rebuildPalette('all');
      }
    }

    // X key to cancel blueprint
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

    // ENTER key to place blueprint
    if (Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) {
      if (this.isInBuildMode && this.selectedRecipeId) {
        if (!this.currentTileRef) {
          this.showToast("Stand on a valid tile to build");
          return;
        }

        // Milestone 13: For now, only handle organelle recipes through blueprint system
        // TODO: Add filament and upgrade construction
        const recipe = CONSTRUCTION_RECIPES.getRecipe(this.selectedRecipeId);
        if (!recipe || recipe.type !== 'organelle') {
          this.showToast(`Building ${recipe?.type || 'unknown'} not yet implemented`);
          return;
        }

        // Check if we're in multiplayer and not the host
        if (this.netSyncSystem && !(this.netSyncSystem as any).isHost) {
          // Send network command to host for blueprint placement
          this.requestBlueprintPlacement(
            this.selectedRecipeId as OrganelleType,
            this.currentTileRef.coord.q,
            this.currentTileRef.coord.r
          );
        } else {
          // Direct placement for host or single-player
          const result = this.blueprintSystem.placeBlueprint(
            this.selectedRecipeId as OrganelleType,
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
  }
  
  /**
   * Handle membrane protein request using the proper transcript workflow
   */
  private handleMembraneProteinRequest(): void {
    if (!this.currentTileRef) return;
    
    const coord = this.currentTileRef.coord;
    
    // Check if this membrane tile has a built transporter or receptor
    const organelle = this.organelleSystem.getOrganelleAtTile(coord);
    const hasBuiltStructure = organelle && (organelle.type === 'transporter' || organelle.type === 'receptor');
    
    if (!hasBuiltStructure) {
      this.showToast("No built transporter/receptor here. Build one first with ENTER key.");
      return;
    }
    
    // Check if protein already installed
    if (this.membraneExchangeSystem.hasInstalledProtein(coord)) {
      const installedProtein = this.membraneExchangeSystem.getInstalledProtein(coord);
      this.showToast(`${installedProtein?.label || 'Unknown protein'} already installed`);
      return;
    }
    
    // Activate protein request mode directly
    this.tileActionController.activateProteinRequestMode();
  }
  
  /**
   * Milestone 7 Task 6: Transcript pickup/carry mechanics
   * Handle R key for pickup/drop and Shift+R key for carry management
   */
  private handleUnifiedCargoInput(): void {
    // R key: Pick up or drop cargo using unified cargo system
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      const playerHex = this.getPlayerHexCoord();
      if (!playerHex) return;

      // Check if we're in multiplayer mode and not the host
      if (this.netSyncSystem && !(this.netSyncSystem as any).isHost) {
        // Multiplayer client: Send command to host instead of executing locally
        const isCarrying = this.unifiedCargoSystem.isCarrying();
        if (!isCarrying) {
          const commandId = this.netSyncSystem.requestAction('cargoPickup', { playerHex });
          console.log(`📤 CLIENT: Requested cargo pickup at (${playerHex.q}, ${playerHex.r}), commandId: ${commandId}`);
          this.showToast("Pickup request sent...");
        } else {
          const commandId = this.netSyncSystem.requestAction('cargoDrop', { playerHex });
          console.log(`📤 CLIENT: Requested cargo drop at (${playerHex.q}, ${playerHex.r}), commandId: ${commandId}`);
          this.showToast("Drop request sent...");
        }
      } else {
        // Single-player or host: Execute cargo action directly
        if (!this.unifiedCargoSystem.isCarrying()) {
          const result = this.unifiedCargoSystem.attemptPickup(playerHex);
          this.showToast(result.message);
        } else {
          const result = this.unifiedCargoSystem.dropCargo(playerHex);
          this.showToast(result.message);
        }
      }
    }
  }

  /**
   * Request blueprint placement from the host (for multiplayer clients)
   */
  private requestBlueprintPlacement(recipeId: OrganelleType, q: number, r: number): void {
    if (!this.netSyncSystem) return;

    const commandId = this.netSyncSystem.requestAction('buildBlueprint', {
      recipeId,
      hex: { q, r }
    });

    console.log(`📤 CLIENT: Requested blueprint placement for ${recipeId} at (${q}, ${r}), commandId: ${commandId}`);
    this.showToast("Blueprint placement request sent...");
  }

  /**
   * Request finish construction from the host (for multiplayer clients)
   */
  private requestFinishConstruction(q: number, r: number): void {
    if (!this.netSyncSystem) return;

    const commandId = this.netSyncSystem.requestAction('finishConstruction', {
      hex: { q, r }
    });

    console.log(`📤 CLIENT: Requested finish construction at (${q}, ${r}), commandId: ${commandId}`);
    this.showToast("Construction completion request sent...");
  }

  /**
   * Milestone 13: Context-aware build palette update
   * This determines which recipes are available based on tile type and organelle proximity
   */
  private updateBuildPaletteFilter(): void {
    if (!this.currentTileRef) {
      // Player outside grid - show all recipes (legacy behavior)
      this.buildPalette.rebuildPalette('all');
      return;
    }

    // Build context from current tile and surroundings
    const context: BuildContext = {
      isMembrane: this.hexGrid.isMembraneCoord(this.currentTileRef.coord),
      isCytosol: !this.hexGrid.isMembraneCoord(this.currentTileRef.coord)
    };

    // Check if player is inside an organelle footprint
    const organelleAtTile = this.organelleSystem.getOrganelleAtTile(this.currentTileRef.coord);
    if (organelleAtTile) {
      // Player is inside an organelle - check if it's a rim tile for upgrades
      const isRimTile = this.isOrganelleRimTile(this.currentTileRef.coord, organelleAtTile);
      if (isRimTile) {
        // Player is on the rim of an organelle - show upgrades for this organelle type
        context.isOrganelleRim = true;
        context.organelleType = organelleAtTile.type;
        context.isCytosol = false; // Override cytosol since we're inside organelle
        context.isMembrane = false;
      } else {
        // Player is inside organelle but not on rim - no building allowed
        this.buildPalette.rebuildForContext({});
        return;
      }
    }

    // Update build palette with context
    this.buildPalette.rebuildForContext(context);
  }

  /**
   * Milestone 13: Check if a tile inside an organelle is on the rim (borders unoccupied space)
   */
  private isOrganelleRimTile(coord: HexCoord, organelle: any): boolean {
    // Get all tiles occupied by this organelle
    const footprintTiles = getFootprintTiles(organelle.config.footprint, organelle.coord.q, organelle.coord.r);
    if (!footprintTiles || footprintTiles.length === 0) return false;
    
    // Check if this coordinate is part of the organelle footprint
    const isPartOfOrganelle = footprintTiles.some((tile: HexCoord) => 
      tile.q === coord.q && tile.r === coord.r
    );
    
    if (!isPartOfOrganelle) return false;
    
    // Check if this footprint tile borders any unoccupied space
    const adjacentOffsets = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];
    
    for (const offset of adjacentOffsets) {
      const adjacentQ = coord.q + offset.q;
      const adjacentR = coord.r + offset.r;
      const adjacentCoord = { q: adjacentQ, r: adjacentR };
      
      // Check if adjacent tile is NOT part of this organelle
      const isAdjacentPartOfOrganelle = footprintTiles.some((tile: HexCoord) => 
        tile.q === adjacentQ && tile.r === adjacentR
      );
      
      // Check if adjacent tile exists in the grid and is unoccupied by this organelle
      const adjacentTile = this.hexGrid.getTile(adjacentCoord);
      if (adjacentTile && !isAdjacentPartOfOrganelle) {
        // This organelle tile borders unoccupied space - it's a rim tile
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get the hex coordinate of the tile the player is currently standing on
   */
  private getPlayerHexCoord(): { q: number; r: number } | null {
    // NEW: Use player actor for position
    return this.playerActor.getHexCoord();
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
   * Public method to refresh membrane visuals (for network replication)
   */
  public refreshMembraneVisuals(): void {
    this.renderMembraneDebug();
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
    
    // Check for manual vesicle installation on membrane tiles
    if (this.tryManualVesicleInstallation(coord, currentSpecies)) {
      return; // Installation handled
    }
    
    // Normal drop onto tile if no blueprint or contribution failed
    const result = this.playerInventory.dropOntoTile(this.hexGrid, coord, currentSpecies);
    
    if (result.dropped > 0) {
      console.log(`Dropped ${currentSpecies}: ${result.dropped.toFixed(2)} onto tile (${coord.q}, ${coord.r})`);
    } else {
      console.log(`No ${currentSpecies} in inventory to drop`);
    }
  }

  /**
   * Try to manually install a vesicle on a membrane tile
   * Returns true if installation was attempted (success or failure)
   */
  private tryManualVesicleInstallation(coord: HexCoord, speciesId: SpeciesId): boolean {
    // Check if we're dropping on a membrane tile
    if (!this.hexGrid.isMembraneCoord(coord)) {
      return false; // Not a membrane tile
    }

    // Check if the species is a vesicle (contains protein)
    if (!speciesId.startsWith('VESICLE_')) {
      return false; // Not a vesicle
    }

    // Extract protein ID from vesicle ID (e.g., "VESICLE_GLUT1" -> "GLUT1")
    const proteinId = speciesId.replace('VESICLE_', '');
    
    // Check if player has any of this vesicle
    const available = this.playerInventory.getAmount(speciesId);
    if (available <= 0) {
      console.log(`No ${speciesId} in inventory to install`);
      return true; // We handled it (even if failed)
    }

    // Try to install the protein
    const installed = this.membraneExchangeSystem.installMembraneProtein(coord, proteinId);
    
    if (installed) {
      // Consume one vesicle from inventory
      const consumed = this.playerInventory.drop(speciesId, 1);
      console.log(`Manually installed ${proteinId} protein from ${consumed} vesicle(s) at (${coord.q}, ${coord.r})`);
      
      // Refresh UI to show the newly installed protein
      this.updateTileInfoPanel();
    } else {
      console.log(`Failed to install ${proteinId} protein at (${coord.q}, ${coord.r}) - tile may be occupied`);
    }
    
    return true; // We handled the drop attempt
  }

  private injectSpecies(speciesId: SpeciesId, amount: number): void {
    const playerCoord = this.getPlayerHexCoord();
    if (!playerCoord) return;

    // Check if we're in a networked game and need to route through the network
    if (this.netSyncSystem && !this.netSyncSystem.getIsHost()) {
      // Client - send request to host
      console.log(`📤 CLIENT: Requesting species injection: ${amount} ${speciesId} at (${playerCoord.q}, ${playerCoord.r})`);
      
      const commandId = this.netSyncSystem.requestAction('injectSpecies', {
        speciesId,
        amount,
        hex: { q: playerCoord.q, r: playerCoord.r }
      });
      
      if (commandId) {
        this.showToast(`Requesting injection of ${amount} ${speciesId}...`);
      } else {
        this.showToast('Failed to send species injection request');
      }
      return;
    }

    // Host or single-player - inject directly
    this.hexGrid.addConcentration(playerCoord, speciesId, amount);
    console.log(`Injected ${amount} ${speciesId} into tile (${playerCoord.q}, ${playerCoord.r})`);
  }


  /**
   * Get transcripts at a specific hex
  /**
   * Debug command: Print status of consolidated systems
   */
  private printSystemStatus(): void {
    console.log("=== CONSOLIDATED SYSTEMS STATUS ===");
    
    // MILESTONE 9: Drive mode and motility status
    console.log(`🚗 Cell Drive Mode: ${this.cellDriveMode ? 'ON' : 'OFF'}`);
    if (this.cellMotility) {
      const state = this.cellMotility.getState();
      console.log(`🏃 Motility: ${state.mode}, Speed: ${state.speed.toFixed(2)}, Polarity: ${state.polarity.magnitude.toFixed(2)}`);
      console.log(`📍 Cell Center: (${this.cellCenter.x.toFixed(1)}, ${this.cellCenter.y.toFixed(1)})`);
    }
    
    // MILESTONE 12: Throw & Membrane systems
    console.log(`📦 Unified Cargo: ${this.unifiedCargoSystem.isCarrying() ? 'Carrying cargo' : 'Empty'}`);
    console.log(`🏀 Membrane Trampoline: ${this.membraneTrampoline.isOnCooldown() ? 'On cooldown' : 'Ready'}`);
    
    // CellProduction metrics
    const transcriptCount = this.transcripts.size;
    const orderCount = this.installOrders.size;
    console.log(`🔬 CellProduction: ${transcriptCount} transcripts, ${orderCount} pending orders`);
    
    // CellTransport metrics  
    const organelleCount = this.organelleSystem.getAllOrganelles().length;
    const activeOrganelles = this.organelleSystem.getAllOrganelles().filter(o => o.isActive).length;
    console.log(`🚚 CellTransport: ${activeOrganelles}/${organelleCount} organelles active`);
    
    // Species tracking
    const conservationData = this.conservationTracker.getAllConservationData();
    console.log(`📊 Species counts:`);
    for (const data of conservationData) {
      if (data.totalAmount > 0.01) { // Only show species with meaningful amounts
        const changeSign = data.changeRate >= 0 ? '+' : '';
        console.log(`  ${data.speciesId}: ${data.totalAmount.toFixed(1)} (${changeSign}${data.changeRate.toFixed(2)}/s)`);
      }
    }
    
    // System architecture info
    console.log(`🏗️ Architecture: SystemObject lifecycle active, manual updates eliminated`);
    
    this.showToast("System status logged to console (F12)");
  }

}

