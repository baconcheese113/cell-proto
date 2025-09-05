import Phaser from "phaser";
import { addHud, setHud } from "../ui/hud";
import { makeGridTexture, makeCellTexture } from "../gfx/textures";
import { HexGrid, type HexCoord, type HexTile } from "../hex/hex-grid";
import { type SpeciesId } from "../species/species-registry";
import { DiffusionSystem } from "../species/diffusion-system";
import { HeatmapSystem } from "../species/heatmap-system";
import { PassiveEffectsSystem } from "../species/passive-effects-system";
import { ConservationTracker } from "../species/conservation-tracker";
import { OrganelleSystem } from "../organelles/organelle-system";
import { OrganelleRenderer } from "../organelles/organelle-renderer";
import { OrganelleSelectionSystem } from "../organelles/organelle-selection";
import { PlayerInventorySystem } from "../player/player-inventory";
import { BlueprintSystem } from "../construction/blueprint-system";
import { BlueprintRenderer } from "../construction/blueprint-renderer";
import { BlueprintProgressUtils } from "../construction/base-blueprint";
import { BuildPaletteUI, type BuildContext } from "../construction/build-palette-ui";
import type { OrganelleType } from "../organelles/organelle-registry";
import { getOrganelleDefinition, definitionToConfig } from "../organelles/organelle-registry";
import { CONSTRUCTION_RECIPES } from "../construction/construction-recipes";
import { getFootprintTiles } from "../organelles/organelle-footprints";
import { MembraneExchangeSystem } from "../membrane/membrane-exchange-system";

// New modular components
import { Player } from "../actors/player";
import { TileActionController } from "../controllers/tile-action-controller";
// Consolidated system architecture
import { CellTransport } from "../systems/cell-transport";
import { CellOverlays } from "../systems/cell-overlays";
import { CargoHUD } from "../systems/cargo-hud";
// Milestone 9: Cell locomotion systems
import { CellSpaceSystem } from "../core/cell-space-system";
import { SubstrateSystem } from "../core/substrate-system";
import { CellMotility } from "../systems/cell-motility";
// Milestone 12: Throw & Membrane Interactions v2 - Networked Systems
import { ThrowSystem } from "../systems/throw-system";
import { CargoSystem } from "../systems/cargo-system";
// import { MembraneTrampoline } from "../systems/membrane-trampoline";
import { ThrowInputController } from "../systems/throw-input-controller";
// Milestone 13: Cytoskeleton Transport v1
import { CytoskeletonSystem } from "../systems/cytoskeleton-system";
import { CytoskeletonRenderer } from "../systems/cytoskeleton-renderer";
import { FilamentBuilder } from "../systems/filament-builder";
import type { WorldRefs, InstallOrder } from "../core/world-refs";
import { LoopbackTransport } from "../network/transport";
import type { NetBundle } from "../app/net-bundle";
import { RoomUI } from "../network/room-ui";
import type { NetworkTransport } from "../network/transport";
// New network approach
import { NetBus } from "../network/net-bus";
import { SpeciesSystem } from "../systems/species-system";
import { PlayerSystem } from "../systems/player-system";
import { EmoteSystem } from "../systems/emote-system";
import { InstallOrderSystem } from "../systems/install-order-system";
// Membrane Physics System
import { MembranePhysicsSystem } from "../membrane/membrane-physics-system";
// Endocytosis System
import { EndocytosisSystem } from "../systems/endocytosis-system";
import { EndocytosisInputController } from "../systems/endocytosis-input-controller";
// Membrane Tuning UI
import { MembraneTuningUI } from "../ui/membrane-tuning-ui";
// Neighbor Cell System
import { NeighborCellSystem } from "../systems/neighbor-cell-system";

type Keys = Record<"W" | "A" | "S" | "D" | "R" | "ENTER" | "SPACE" | "G" | "I" | "C" | "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "SIX" | "SEVEN" | "H" | "LEFT" | "RIGHT" | "P" | "T" | "V" | "Q" | "E" | "B" | "X" | "M" | "F" | "Y" | "U" | "O" | "K" | "L" | "N" | "F1" | "F2" | "F3" | "F9" | "F10" | "F11" | "F12" | "ESC" | "ZERO" | "SHIFT", Phaser.Input.Keyboard.Key>;

export class GameScene extends Phaser.Scene {
  private grid!: Phaser.GameObjects.Image;
  private cellSprite!: Phaser.GameObjects.Image;

  // NEW: Modular player actor
  private playerActor!: Player;
  private keys!: Keys;

  // NEW: Modular controllers and systems
  private tileActionController!: TileActionController;
  private throwInputController!: ThrowInputController;

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
  private hoveredTile: HexTile | null = null;
  private selectedTile: HexTile | null = null;
  private hexInteractionGraphics!: Phaser.GameObjects.Graphics;
  private tileInfoPanel!: Phaser.GameObjects.Text;
  private debugInfoPanel!: Phaser.GameObjects.Text;
  private buildDateText!: Phaser.GameObjects.Text;
  private lastInfoUpdateTile: HexTile | null = null;
  
  // Client-side position tracking for change detection
  private _lastClientPos: { x: number; y: number; vx: number; vy: number } | null = null;
  private lastInfoUpdateTime = 0; // Track when info was last updated

  // Milestone 6: Membrane debug visualization
  private membraneGraphics!: Phaser.GameObjects.Graphics;
  private showMembraneDebug = true;
  private transporterLabels: Phaser.GameObjects.Text[] = [];
  private proteinGlyphs: Phaser.GameObjects.Text[] = [];
  
  // PHYSICS-BASED POSITIONING: Migration flag
  // PHYSICS-BASED POSITIONING: Using physics membrane center for all positioning
  
  // Pathfinding debug visualization
  private pathfindingGraphics!: Phaser.GameObjects.Graphics;
  private showPathfindingDebug = false; // Enable by default for debugging
  
  // Milestone 6: Membrane exchange system
  private membraneExchangeSystem!: MembraneExchangeSystem;
  
  // Species diffusion system - Task 3
  private diffusionSystem!: DiffusionSystem;

  // Heatmap visualization - Task 5
  private heatmapSystem!: HeatmapSystem;

  // Passive effects system - Task 6
  private passiveEffectsSystem!: PassiveEffectsSystem;

  // Conservation tracking - Task 8
  private conservationTracker!: ConservationTracker;

  // Organelle system - Milestone 3 Task 1
  private organelleSystem!: OrganelleSystem;
  private organelleRenderer!: OrganelleRenderer;
  private organelleSelection!: OrganelleSelectionSystem;

  // Player inventory system - Milestone 4 Task 1
  private playerInventory!: PlayerInventorySystem;

  // Blueprint system - Milestone 5
  private blueprintSystem!: BlueprintSystem;
  private blueprintRenderer!: BlueprintRenderer;
  private buildPalette!: BuildPaletteUI;
  private selectedRecipeId: string | null = null; // Milestone 13: Support all recipe types (organelles, filaments, upgrades)
  private isInBuildMode: boolean = false;
  private wasInBuildModeBeforeLeavingTile: boolean = false; // Track if build menu was open when leaving tile area

  // Milestone 6: Current tile tracking - Task 1
  private currentTileRef: HexTile | null = null;
  private currentTileLabel!: Phaser.GameObjects.Text;

  // Milestone 6: Toast system - Task 2
  private toastText!: Phaser.GameObjects.Text;

  // Neighbor cell system
  private neighborCellSystem!: NeighborCellSystem;

  // Milestone 7: Orders system
  private installOrders: Map<string, InstallOrder> = new Map(); // keyed by order.id
  private nextOrderId = 1;

  // NOTE: Transcripts and Vesicles now managed by CargoSystem
  // Legacy Maps removed - use this.cargoSystem instead

  // NOTE: Movement mechanics now handled by Player actor
  // NOTE: Membrane physics now handled by Player actor

  // Consolidated system architecture
  private cellTransport!: CellTransport;
  
  // Store WorldRefs instance to ensure consistent reference
  private worldRefsInstance!: WorldRefs;
  private cellOverlays!: CellOverlays;
  
  // Milestone 9: Cell locomotion systems
  private cellSpaceSystem!: CellSpaceSystem;
  private substrateSystem!: SubstrateSystem;
  private cellMotility!: CellMotility;
  
  // Milestone 12: Throw & Membrane Interactions v1
  // Milestone 12: Networked Cargo & Throw Systems
  private throwSystem!: ThrowSystem;
  private cargoSystem!: CargoSystem;
  private cargoHUD?: CargoHUD; // CargoHUD instance
  // private membraneTrampoline!: MembraneTrampoline;
  private membranePhysics!: MembranePhysicsSystem; // Constraint-based membrane physics
  
  // Endocytosis System - Membrane budding and vesicle formation
  private endocytosisSystem!: EndocytosisSystem;
  private endocytosisInputController!: EndocytosisInputController;
  
  // Membrane Tuning UI for real-time parameter adjustment
  private membraneTuningUI!: MembraneTuningUI;
  
  // Milestone 13: Cytoskeleton Transport v1
  private cytoskeletonSystem!: CytoskeletonSystem;
  private cytoskeletonRenderer!: CytoskeletonRenderer;
  private filamentBuilder!: FilamentBuilder;
  
  // Milestone 14: Multiplayer Core v1
  private roomUI!: RoomUI;
  
  // New network approach
  public net!: NetBundle;
  
  // Remote player rendering
  private remoteSprites = new Map<string, Phaser.GameObjects.Graphics>();
  
  // Milestone 9: Cell motility mode
  private cellDriveMode = false;

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

  create(data?: { useMultiplayer?: boolean; transport?: NetworkTransport; isHost?: boolean; roomId?: string }) {
    // Store multiplayer settings for later initialization after worldRefs is ready
    const networkConfig = data?.useMultiplayer && data?.transport ? {
      transport: data.transport, 
      isHost: data.isHost!, 
      roomId: data.roomId!
    } : null;

    // Background grid - cap size to prevent memory issues
    const view = this.scale.gameSize;
    const maxGridSize = 2048; // Reasonable maximum for browser memory
    const gridSize = Math.min(Math.max(view.width, view.height) * 2, maxGridSize);
    const gridKey = makeGridTexture(this, gridSize, gridSize, this.col.bg, this.col.gridMinor, this.col.gridMajor);
    this.grid = this.add.image(0, 0, gridKey).setOrigin(0.5, 0.5).setDepth(0);
    this.grid.setPosition(view.width * 0.5, view.height * 0.5);

    // Initialize camera system - no container needed for physics-based positioning
    
    // Cell membrane (static fallback - will be hidden when dynamic membrane is active)
    this.cellCenter.set(view.width * 0.5, view.height * 0.5);
    const cellKey = makeCellTexture(this, this.cellRadius * 2 + this.membraneThickness * 2, this.membraneThickness, this.col.cellFill, this.col.membrane);
    this.cellSprite = this.add.image(view.width * 0.5, view.height * 0.5, cellKey).setDepth(1);
    this.cellSprite.setVisible(false); // Hide static membrane in favor of dynamic physics membrane
    
    // Position cell sprite based on current mode
    this.positionVisualElement(this.cellSprite, 0, 0);

    // Initialize hex grid FIRST (required by Player)
    this.initializeHexGrid();
    this.initializeHexGraphics();

    // NEW: Create modular Player actor (after hex grid is initialized)
    this.playerActor = new Player({
      scene: this,
      x: view.width * 0.5, // Start at screen center
      y: view.height * 0.5, // Start at screen center
      normalMaxSpeed: 120,
      acceleration: 600,
      dashSpeed: 320,
      dashDuration: 0.25,
      maxDashCooldown: 1.2,
      playerColor: this.col.player,
      ringColor: this.col.playerRing,
      cellCenter: new Phaser.Math.Vector2(view.width * 0.5, view.height * 0.5), // World coordinates
      cellRadius: this.playerBoundaryRadius // Use smaller boundary for player movement
    }, this.hexGrid);
    
    // Position player based on current positioning mode
    this.positionPlayerForCurrentMode();

    // Initialize non-network dependent systems first...
    this.initializePlayerInventory();
    this.initializeDebugInfo();
    this.initializeHeatmapSystem();
    this.initializePassiveEffectsSystem();
    this.initializeDiffusionSystem();
    this.conservationTracker = new ConservationTracker(this, this.hexGrid, this.passiveEffectsSystem);
    
    // Milestone 9: Initialize cell locomotion systems
    this.initializeCellLocomotionSystems();

    // Create MINIMAL WorldRefs first (just what networking needs)
    const minimalWorldRefs = {
      hexGrid: this.hexGrid,
      membranePhysics: null as any, // Will be set after membrane physics initialization
      playerInventory: this.playerInventory,
      player: this.playerActor,
      scene: this,
      
      // PHYSICS-BASED POSITIONING: Coordinate conversion utilities
      getPhysicsCenter: () => this.getPhysicsCenter(),
      worldToCell: (worldX: number, worldY: number) => {
        return this.worldToPhysicsCell(worldX, worldY);
      },
      cellToWorld: (cellX: number, cellY: number) => {
        return this.physicsCellToWorld(cellX, cellY);
      },
      
      // Systems that exist at this point
      membraneExchangeSystem: this.membraneExchangeSystem,
      diffusionSystem: this.diffusionSystem,
      passiveEffectsSystem: this.passiveEffectsSystem,
      heatmapSystem: this.heatmapSystem,
      cellSpaceSystem: this.cellSpaceSystem,
      substrateSystem: this.substrateSystem,
      
      // Placeholders for systems that will be created after networking
      organelleSystem: null as any,
      organelleRenderer: null as any,
      blueprintSystem: null as any,
      cellOverlays: null as any,
      cytoskeletonRenderer: null as any,
      cellMotility: null as any,
      cytoskeletonSystem: null as any,
      cytoskeletonGraph: null as any,
      cargoSystem: null as any,
      installOrderSystem: null as any,
      
      // Data collections
      installOrders: this.installOrders,
      nextOrderId: this.nextOrderId,
      
      // UI methods
      showToast: (message: string) => this.showToast(message),
      refreshTileInfo: () => {}, // Placeholder
    };
    
    // Store minimal worldRefs instance for networking initialization
    this.worldRefsInstance = minimalWorldRefs;

    // NETWORKING: Initialize networking now that minimal worldRefs is ready
    if (networkConfig) {
      this.initNetwork(networkConfig);
    } else {
      // Default: local play with loopback transport
      this.initializeNetworking();
    }

    // Initialize network-dependent systems after networking is ready
    this.initializeOrganelleSystem();

    // Initialize CargoSystem early and add to worldRefs
    this.cargoSystem = new CargoSystem(this, this.net.bus, this.worldRefsInstance);

    // UPDATE WorldRefs with newly created network-dependent systems
    this.worldRefsInstance.organelleSystem = this.organelleSystem;
    this.worldRefsInstance.organelleRenderer = this.organelleRenderer;
    this.worldRefsInstance.blueprintSystem = this.blueprintSystem;
    this.worldRefsInstance.cargoSystem = this.cargoSystem;
    
    // Create CellMotility now that we have worldRefs structure
    this.cellMotility = new CellMotility(this, this.net.bus, this.worldRefsInstance, this.cellSpaceSystem);
    this.worldRefsInstance.cellMotility = this.cellMotility;

    // Create modular controllers and systems
    this.tileActionController = new TileActionController({
      scene: this,
      worldRefs: this.worldRefsInstance,
      net: this.net
    });

    // Initialize consolidated systems - NEW ARCHITECTURE
    
    this.cellTransport = new CellTransport(this, this.net.bus, this.worldRefsInstance);
    this.cellOverlays = new CellOverlays(this, this.net.bus, this.worldRefsInstance); // Physics-based positioning
    this.worldRefsInstance.cellOverlays = this.cellOverlays;

    // Milestone 12: CargoSystem already initialized above
    
    // Phase 2.1: Add CargoSystem to WorldRefs for unified access
    this.worldRefsInstance.cargoSystem = this.cargoSystem;
    
    // Initialize CargoHUD after CargoSystem
    this.cargoHUD = new CargoHUD(this, this.cargoSystem);
    
    this.throwSystem = new ThrowSystem(this.net.bus, this, this.cargoSystem);
    
    // Initialize ThrowInputController after systems are ready
    this.throwInputController = new ThrowInputController(
      this,
      this.worldRefsInstance,
      this.throwSystem,
      this.cargoSystem,
      this.net,
      this.playerActor
    );
    
    // this.membraneTrampoline = new MembraneTrampoline(this, this.worldRefsInstance);
    
    // Milestone 13: Initialize Cytoskeleton Transport v1
    this.cytoskeletonSystem = new CytoskeletonSystem(this, this.net.bus, this.worldRefsInstance);
    this.worldRefsInstance.cytoskeletonSystem = this.cytoskeletonSystem; // Add to worldRefs
    this.worldRefsInstance.cytoskeletonGraph = this.cytoskeletonSystem.graph; // Add graph reference
    this.cytoskeletonRenderer = new CytoskeletonRenderer(this, this.worldRefsInstance, this.cytoskeletonSystem);
    this.worldRefsInstance.cytoskeletonRenderer = this.cytoskeletonRenderer; // Add renderer to worldRefs
    
    this.net.cytoskeleton = this.cytoskeletonSystem;
    this.net.bus.registerInstance(this.cytoskeletonSystem);
    
    this.initializeBlueprintSystem();
    
    this.filamentBuilder = new FilamentBuilder(this, this.worldRefsInstance, this.cytoskeletonSystem);

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
      F3: this.input.keyboard!.addKey("F3"), // Toggle pathfinding debug
      F9: this.input.keyboard!.addKey("F9"), // Toggle network HUD
      F10: this.input.keyboard!.addKey("F10"), // Toggle room UI
      F11: this.input.keyboard!.addKey("F11"), // Simulate packet loss
      F12: this.input.keyboard!.addKey("F12"), // Toggle network logging
      ESC: this.input.keyboard!.addKey("ESC"), // Exit build mode
      ZERO: this.input.keyboard!.addKey("ZERO"), // Emote trigger
      SHIFT: this.input.keyboard!.addKey("SHIFT"), // Modifier key for receptor rotation
    };

    // Initialize remaining UI systems
    addHud(this);
    this.initializeHexInteraction();
    this.initializeTileInfoPanel();
    this.initializeDebugInfo();
    
    // Initialize protein glyphs by rendering membrane debug
    this.renderMembraneDebug();
    
    // Initialize HUD with current information
    this.updateHUD();
    
    // Initialize camera to center on physics center
    const initialPhysicsCenter = this.getPhysicsCenter();
    this.cameras.main.centerOn(initialPhysicsCenter.x, initialPhysicsCenter.y);

    // Window resize handling
    this.scale.on("resize", (sz: Phaser.Structs.Size) => {
      const newWidth = Math.ceil(sz.width);
      const newHeight = Math.ceil(sz.height);
      
      // Regenerate background grid with same memory cap as initial creation
      const maxGridSize = 2048; // Reasonable maximum for browser memory  
      const gridSize = Math.min(Math.max(newWidth, newHeight) * 2, maxGridSize);
      const key = makeGridTexture(this, gridSize, gridSize, this.col.bg, this.col.gridMinor, this.col.gridMajor);
      this.grid.setTexture(key).setOrigin(0.5, 0.5);
      this.grid.setPosition(newWidth * 0.5, newHeight * 0.5);
      
      // Re-center cell - physics-based positioning handles this automatically
      this.cellCenter.set(newWidth * 0.5, newHeight * 0.5);

      // Update hex grid to physics center (not screen center)
      if (this.hexGrid) {
        const physicsCenter = this.getPhysicsCenter();
        this.hexGrid.updateCenter(physicsCenter.x, physicsCenter.y);
        this.renderHexGrid();
        
        // Reinitialize diffusion system buffers after grid change
        if (this.diffusionSystem) {
          this.diffusionSystem.reinitialize();
        }
        
        // Re-render organelles with new positions
        if (this.organelleRenderer) {
          this.organelleRenderer.onResize();
        }
        if (this.blueprintRenderer) {
          this.blueprintRenderer.onResize();
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
      this.cellTransport?.destroy();
      this.cellOverlays?.destroy();
      this.net.emotes?.destroy();
    });
  }

  override update() {
    // PHYSICS-BASED POSITIONING: Get current cell center from physics system
    let currentCellCenter: Phaser.Math.Vector2;
    
    if (this.membranePhysics) {
      // Use physics-based center
      currentCellCenter = this.membranePhysics.getCenter();
    } else {
      // Fallback to screen center if physics not ready
      currentCellCenter = new Phaser.Math.Vector2(this.cameras.main.width * 0.5, this.cameras.main.height * 0.5);
    }
    
    // MILESTONE 9 FIX 1: Only drive camera from CellSpaceSystem when in drive mode
    if (this.cellDriveMode) {
      const tf = this.cellSpaceSystem.getTransform();
      this.cellCenter.set(tf.position.x, tf.position.y);
      
      // Physics-based positioning - no container to move
      currentCellCenter = this.getPhysicsCenter();
      
      // Update hex grid center to follow physics center
      if (this.hexGrid) {
        this.hexGrid.updateCenter(currentCellCenter.x, currentCellCenter.y);
      }
      
      this.cameras.main.centerOn(currentCellCenter.x, currentCellCenter.y);
      
      // MILESTONE 9 FIX 1: Keep rendering hex grid after movement
      this.renderHexGrid();
    } else {
      // When not in drive mode, camera follows physics center for stable positioning
      currentCellCenter = this.getPhysicsCenter();
      this.cameras.main.centerOn(currentCellCenter.x, currentCellCenter.y);
    }

    // Handle hex grid toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.G)) {
      this.toggleHexGrid();
    }

    // Milestone 6: Handle membrane debug toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.M)) {
      this.toggleMembraneDebug();
    }

    // Handle pathfinding debug toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.F3)) {
      this.togglePathfindingDebug();
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
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.U)) {
      // Toggle membrane tuning UI
      this.membraneTuningUI.toggle();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.Y)) {
      // System status debug - show consolidated system info
      this.printSystemStatus();
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
    if (Phaser.Input.Keyboard.JustDown(this.keys.F10)) {
      this.roomUI.toggle();
    }

    // ZERO key for emotes
    if (Phaser.Input.Keyboard.JustDown(this.keys.ZERO)) {
      this.net.emotes.send();
    }

    // Debug species controls - Task 4
    this.handleDebugControls();

    this.handleTileInteractions();

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
      // const controlReduction = this.membraneTrampoline.getControlReduction();
      
      // if (controlReduction < 0.9) {
      //   // Significantly reduce or disable control during strong trampoline lockout
      //   const reducedKeys = {
      //     W: { isDown: false, _justDown: false },
      //     A: { isDown: false, _justDown: false },
      //     S: { isDown: false, _justDown: false },
      //     D: { isDown: false, _justDown: false },
      //     SPACE: this.keys.SPACE // Allow dash input
      //   } as any;
      //   this.playerActor.update(deltaSeconds, reducedKeys);
      // } else {
        // Normal mode: player actor handles WASD, cellMotility ignores input
        this.playerActor.update(deltaSeconds, this.keys);
        
        // Send player input to network for replication
        this.synchronizePlayerState();
      // }
    }
    
    // Milestone 6 Task 1: Update current tile tracking
    this.updateCurrentTile();
    
    // Use modular tile action controller for input handling
    this.tileActionController.handleInput(this.keys, this.currentTileRef);
    
    // NOTE: Consolidated systems (CargoSystem, CellTransport, CellOverlays, BlueprintSystem) 
    // are now automatically updated by Phaser's lifecycle via System base class
    
    // Manual updates for systems not yet consolidated:
    
    // Update heatmap - Task 5
    this.heatmapSystem.update();
    
    // Render organelles - Milestone 3 Task 1
    this.organelleRenderer.render();
    
    // Update blueprint rendering - Milestone 5 Task 5
    this.blueprintRenderer.render();
    
    // Update build palette position to maintain fixed screen location
    this.buildPalette.updatePosition();
    
    // Milestone 12: Update throw & membrane interaction systems
    this.throwInputController.update();
    this.cargoHUD?.update();
    
    // Endocytosis system update - ENABLED for testing
    this.endocytosisInputController.update(1/60); // Approximate delta time
    
    // Membrane physics system update
    this.membranePhysics.update(1/60); // Approximate delta time
    
    // Update additional membranes (neighbor cells) through main physics system
    this.membranePhysics.updateAdditionalMembranes(1/60);
    
    // Update neighbor cell network state for replication
    this.neighborCellSystem.updatePhysicsState();
    
    // Update hex grid center to track physics center
    this.updateHexGridPosition();
    
    // Update player cargo indicator
    const carriedCargo = this.cargoSystem.getMyPlayerInventory()[0] || null;
    this.playerActor.updateCargoIndicator(carriedCargo ? 'transcript' : null); // Simplified for now
    
    // Render cargo
    this.cargoSystem.renderCargo();
    
    // Update HUD with current information
    this.updateHUD();
    
    // Update conservation tracking - Task 8
    this.conservationTracker.update();
    
    // Update EmoteSystem for visual effects
    // this.net.emotes.update();
    
    // Update player input and physics
    this.synchronizePlayerState();
    this.net.players.tick(this.game.loop.delta / 1000); // Convert ms to seconds
    
    // Render remote players from network state
    this.updateRemotePlayers();
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
        // Remember that we had the build menu open when we left the tile area
        this.wasInBuildModeBeforeLeavingTile = true;
      }
      
      // Restore build menu if player returns to tile area and had it open before
      if (newCurrentTile && this.wasInBuildModeBeforeLeavingTile && !this.buildPalette.getIsVisible()) {
        this.buildPalette.show();
        this.updateBuildPaletteFilter();
        this.isInBuildMode = true;
        this.wasInBuildModeBeforeLeavingTile = false;
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

  // ===== PHYSICS-BASED POSITIONING UTILITIES =====
  
  /**
   * Get current physics-based cell center position with error handling
   */
  public getPhysicsCenter(): Phaser.Math.Vector2 {
    if (this.membranePhysics) {
      try {
        return this.membranePhysics.getCenter();
      } catch (error) {
        console.warn('🚨 Failed to get physics center, using screen center fallback:', error);
        return new Phaser.Math.Vector2(this.cameras.main.width * 0.5, this.cameras.main.height * 0.5);
      }
    } else {
      // Physics not initialized yet, use screen center
      return new Phaser.Math.Vector2(this.cameras.main.width * 0.5, this.cameras.main.height * 0.5);
    }
  }
  
  /**
   * Update hex grid center to track physics center
   */
  private lastPhysicsCenter: Phaser.Math.Vector2 | null = null;
  
  private updateHexGridPosition(): void {
    if (!this.hexGrid) return;
    
    const currentPhysicsCenter = this.getPhysicsCenter();
    
    // Debug: Always log current physics center to see if it's changing
    if (!this.lastPhysicsCenter) {
      console.log(`🎯 Initial hex grid center: (${currentPhysicsCenter.x.toFixed(1)}, ${currentPhysicsCenter.y.toFixed(1)})`);
    }
    
    // Only update if the physics center has moved significantly (avoid constant updates)
    if (!this.lastPhysicsCenter || 
        Phaser.Math.Distance.Between(
          currentPhysicsCenter.x, currentPhysicsCenter.y,
          this.lastPhysicsCenter.x, this.lastPhysicsCenter.y
        ) > 0.1) { // Lowered threshold for testing
      
      this.hexGrid.updateCenter(currentPhysicsCenter.x, currentPhysicsCenter.y);
      this.renderHexGrid(); // Force re-render after position update
      this.renderMembraneDebug(); // Update membrane debug visualization when position changes
      this.lastPhysicsCenter = currentPhysicsCenter.clone();
    }
  }

  /**
   * Position a visual element based on current positioning mode
   * This is a public method that systems can call to position their graphics
   */
  positionVisualElement(element: Phaser.GameObjects.GameObject, cellLocalX: number = 0, cellLocalY: number = 0) {
    // In physics mode, position element in world coordinates
    const physicsCenter = this.getPhysicsCenter();
    if ('setPosition' in element) {
      (element as any).setPosition(physicsCenter.x + cellLocalX, physicsCenter.y + cellLocalY);
    }
    // Element is positioned directly in scene - no container management needed
  }

  /**
   * Position player for physics-based positioning
   */
  private positionPlayerForCurrentMode() {
    // Physics-based positioning - ensure player is positioned correctly in world coordinates
    const physicsCenter = this.getPhysicsCenter();
    const cellLocalPos = this.playerActor.getCellLocalPosition();
    
    // Position in world coordinates using physics center
    this.playerActor.setPosition(physicsCenter.x + cellLocalPos.x, physicsCenter.y + cellLocalPos.y);
  }
  
  /**
   * Convert world coordinates to cell-local coordinates using physics center
   */
  // @ts-ignore - Infrastructure method for future migration phases
  private worldToPhysicsCell(worldX: number, worldY: number): Phaser.Math.Vector2 {
    const center = this.getPhysicsCenter();
    return new Phaser.Math.Vector2(worldX - center.x, worldY - center.y);
  }
  
  /**
   * Convert cell-local coordinates to world coordinates using physics center
   */
  private physicsCellToWorld(cellX: number, cellY: number): Phaser.Math.Vector2 {
    const center = this.getPhysicsCenter();
    return new Phaser.Math.Vector2(cellX + center.x, cellY + center.y);
  }
  
  /**
   * Set an object's position using physics-based cell coordinates
   */
  // @ts-ignore - Infrastructure method for future migration phases
  private setPhysicsBasedPosition(object: { x: number; y: number }, cellX: number, cellY: number) {
    const worldPos = this.physicsCellToWorld(cellX, cellY);
    object.x = worldPos.x;
    object.y = worldPos.y;
  }

  /**
   * Update remote player avatars from network state
   */
  private updateRemotePlayers(): void {
    const mirror = this.net.players.players; // PlayersState
    
    // Update or create sprites for remote players only (exclude self)
    for (const [id, p] of Object.entries(mirror.byId)) {
      // Skip creating a remote sprite for self - we already have a local player
      if (id === this.net.bus.localId) continue;
      
      let g = this.remoteSprites.get(id);
      if (!g) {
        g = this.add.graphics();
        g.fillStyle(0xff4d4d, 1); // Red color for remote players
        g.fillCircle(0, 0, 6);
        this.add.existing(g); // Add directly to scene
        this.remoteSprites.set(id, g);
      }
      
      g.setPosition(p.x, p.y);
      g.setVisible(true);
    }
    
    // Optionally hide sprites for ids no longer present
    for (const [id, g] of this.remoteSprites) {
      if (!mirror.byId[id] || id === this.net.bus.localId) { // Also clean up any self sprites that shouldn't exist
        g.destroy(); 
        this.remoteSprites.delete(id); 
      }
    }
  }

  /**
   * Check if position or velocity changed meaningfully (>0.01 threshold)
   */
  private hasPlayerStateChanged(
    oldState: { x: number; y: number; vx: number; vy: number },
    newState: { x: number; y: number; vx: number; vy: number }
  ): boolean {
    const posChanged = Math.abs(oldState.x - newState.x) > 0.01 || 
                      Math.abs(oldState.y - newState.y) > 0.01;
    const velChanged = Math.abs(oldState.vx - newState.vx) > 0.01 || 
                      Math.abs(oldState.vy - newState.vy) > 0.01;
    return posChanged || velChanged;
  }

  /**
   * Extract input acceleration from keyboard keys
   */
  private getInputAcceleration(): { ax: number; ay: number; drive: boolean } {
    let ax = 0, ay = 0;
    if (this.keys.A.isDown) ax -= 1;
    if (this.keys.D.isDown) ax += 1;
    if (this.keys.W.isDown) ay -= 1;
    if (this.keys.S.isDown) ay += 1;
    
    const drive = this.keys.SPACE.isDown; // Dash/drive mode
    return { ax, ay, drive };
  }

  /**
   * Send local player state to network for replication
   */
  private synchronizePlayerState(): void {    
    if (!this.net.bus.localId || !this.playerActor) return;
    
    // Get input from keyboard
    const input = this.getInputAcceleration();
    
    // Send input to PlayerSystem for server processing
    this.net.players.setInput(this.net.bus.localId, input);
    
    // Get current player position and velocity for comparison
    const cellPos = this.playerActor.getCellLocalPosition();
    const velocity = this.playerActor.getVelocity();
    
    if (this.net.isHost) {
      // Host: Update state directly - only sync if there are meaningful changes
      const playerData = this.net.players.get(this.net.bus.localId);
      if (playerData) {
        const newState = { x: cellPos.x, y: cellPos.y, vx: velocity.x, vy: velocity.y };
        
        if (this.hasPlayerStateChanged(playerData, newState)) {
          playerData.x = newState.x;
          playerData.y = newState.y;
          playerData.vx = newState.vx;
          playerData.vy = newState.vy;
          playerData.ts = Date.now();
        }
      }
    } else {
      // Client: Only send position to host if it changed meaningfully
      const lastPos = this._lastClientPos || { x: 0, y: 0, vx: 0, vy: 0 };
      const newState = { x: cellPos.x, y: cellPos.y, vx: velocity.x, vy: velocity.y };
      
      if (this.hasPlayerStateChanged(lastPos, newState)) {
        this.net.players.updatePosition(
          this.net.bus.localId,
          newState.x,
          newState.y,
          newState.vx,
          newState.vy
        );
        
        this._lastClientPos = newState;
      }
    }
  }

  // Hex Grid System
  private initializeHexGrid(): void {
    // Initialize hex grid centered at physics center (if available) or screen center
    const physicsCenter = this.getPhysicsCenter();
    this.hexGrid = new HexGrid(this.hexSize, physicsCenter.x, physicsCenter.y);
    this.hexGrid.generateTiles(this.gridRadius);
    
    const maxDistance = this.cellRadius - this.hexSize;
    this.hexGrid.filterTilesInCircle(physicsCenter.x, physicsCenter.y, maxDistance);
    
    // Milestone 6 Task 1: Compute membrane tiles using physics center coordinates
    this.hexGrid.recomputeMembranes(physicsCenter.x, physicsCenter.y, this.cellRadius);
  }

  private initializeHexGraphics(): void {
    this.hexGraphics = this.add.graphics();
    this.hexGraphics.setDepth(1.5); // Above background, below organelles
    this.hexGraphics.setVisible(this.showHexGrid);
    
    // Graphics added directly to scene - hex tile positions are already in world coordinates
    this.add.existing(this.hexGraphics);
    
    this.renderHexGrid();
    
    // Milestone 6: Initialize membrane debug graphics
    this.initializeMembraneGraphics();
    
    // Initialize pathfinding debug graphics
    this.initializePathfindingGraphics();
  }

  private initializePathfindingGraphics(): void {
    this.pathfindingGraphics = this.add.graphics();
    this.pathfindingGraphics.setDepth(5.0); // Above everything for visibility
    this.pathfindingGraphics.setVisible(this.showPathfindingDebug);
    
    // Position based on current mode
    this.positionVisualElement(this.pathfindingGraphics, 0, 0);
  }

  private initializeMembraneGraphics(): void {
    this.membraneGraphics = this.add.graphics();
    this.membraneGraphics.setDepth(1.6); // Above hex grid, below organelles
    this.membraneGraphics.setVisible(true); // Always visible now that it contains protein glyphs
    
    // Add membrane graphics directly to scene
    this.add.existing(this.membraneGraphics);
    
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
            
            // Add transporter labels directly to scene
            this.add.existing(label);
            
            this.transporterLabels.push(label);
          }
        }
      }
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
          
          // Calculate direction toward/away from physics center
          const physicsCenter = this.getPhysicsCenter();
          const deltaX = tile.worldPos.x - physicsCenter.x;
          const deltaY = tile.worldPos.y - physicsCenter.y;
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

  private togglePathfindingDebug(): void {
    this.showPathfindingDebug = !this.showPathfindingDebug;
    if (this.pathfindingGraphics) {
      this.pathfindingGraphics.setVisible(this.showPathfindingDebug);
      if (!this.showPathfindingDebug) {
        this.clearPathfindingDebugPaths();
      }
    }
    console.log(`Pathfinding debug ${this.showPathfindingDebug ? 'shown' : 'hidden'}`);
    this.showToast(`Pathfinding debug ${this.showPathfindingDebug ? 'ON' : 'OFF'} (F3 to toggle)`);
  }

  // Hex Interaction System
  private initializeHexInteraction(): void {
    this.hexInteractionGraphics = this.add.graphics();
    this.hexInteractionGraphics.setDepth(1.6); // Above hex grid, below organelles
    
    // Add interaction graphics directly to scene
    this.add.existing(this.hexInteractionGraphics);
    
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
    
    // Get the tile at the mouse position using world coordinates (hexGrid handles coordinate conversion internally)
    const tile = this.hexGrid.getTileAtWorld(pointer.worldX, pointer.worldY);
    
    this.hoveredTile = tile || null;
    
    // Milestone 6 Task 3: Mouse hover only for info, not for actions
    // Removed build palette filter update - that's now based on current tile only
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.hexGrid) return;
    
    if (pointer.leftButtonDown()) {
      // Get the tile at the mouse position using world coordinates (hexGrid handles coordinate conversion internally)
      const tile = this.hexGrid.getTileAtWorld(pointer.worldX, pointer.worldY);
      
      // Milestone 6 Task 3: Mouse click only for tile selection (info), not actions
      // Remove blueprint placement - that's now handled by ENTER key on current tile
      
      // Normal tile selection for info/inspection
      this.selectedTile = tile || null;
      
      if (tile) {
        // Convert world coordinates to cell-local for logging purposes
        const physicsCenter = this.getPhysicsCenter();
        const cellLocalX = pointer.worldX - physicsCenter.x;
        const cellLocalY = pointer.worldY - physicsCenter.y;
        console.log(`Clicked: mouse world(${Math.round(pointer.worldX)}, ${Math.round(pointer.worldY)}) -> local(${Math.round(cellLocalX)}, ${Math.round(cellLocalY)}) -> hex(${tile.coord.q}, ${tile.coord.r}) at world(${Math.round(tile.worldPos.x)}, ${Math.round(tile.worldPos.y)})`);
      } else {
        // Convert world coordinates to cell-local for logging purposes
        const physicsCenter = this.getPhysicsCenter();
        const cellLocalX = pointer.worldX - physicsCenter.x;
        const cellLocalY = pointer.worldY - physicsCenter.y;
        console.log(`Clicked: mouse world(${Math.round(pointer.worldX)}, ${Math.round(pointer.worldY)}) -> local(${Math.round(cellLocalX)}, ${Math.round(cellLocalY)}) -> no hex found`);
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
      
      // Check for organelle on this tile (use original organelle system)
      const organelle = this.organelleSystem.getOrganelleAtTile(tile.coord);
      if (organelle) {
        info.push(`🏭 Organelle: ${organelle.config.label}`);
        info.push(`  Type: ${organelle.type}`);
        info.push(`  Status: ${organelle.isActive ? 'Active' : 'Inactive'}`);
        info.push(`  Throughput: ${organelle.currentThroughput || 0}`);
        info.push(''); // Add spacing
      }
      
      // Milestone 13: Show cargo (transcripts/vesicles) at this tile
      const cargoAtTile = this.cargoSystem.getCargoAtTile(tile.coord);
      if (cargoAtTile.length > 0) {
        info.push(`📦 Cargo at this tile:`);
        for (const cargo of cargoAtTile) {
          // Calculate real-time TTL like CargoHUD does
          const elapsedSeconds = (Date.now() - cargo.createdAt) / 1000;
          const remainingTTL = Math.max(0, cargo.ttlSecondsInitial - elapsedSeconds);
          const stageInfo = cargo.itinerary 
            ? `${cargo.itinerary.stageIndex + 1}/${cargo.itinerary.stages.length} (${cargo.itinerary.stages[cargo.itinerary.stageIndex]?.kind || 'unknown'})`
            : 'stage info unavailable';
          info.push(`  📝 ${cargo.currentType} ${cargo.proteinId} - Stage ${stageInfo}`);
          info.push(`    TTL: ${remainingTTL.toFixed(1)}s, State: ${cargo.state}`);
        }
        info.push(''); // Add spacing
      }
      
      // Check for blueprint on this tile
      // Use original blueprint system
      const blueprint = this.blueprintSystem.getBlueprintAtTile(tile.coord.q, tile.coord.r);
      
      if (blueprint) {
        const recipe = CONSTRUCTION_RECIPES.getRecipe(blueprint.recipeId);
        info.push(`🔨 Blueprint: ${recipe?.label}`);
        
        // Show progress using shared progress utilities
        const progressRatio = BlueprintProgressUtils.calculateOverallProgress(blueprint);
        const totalPercent = Math.round(progressRatio * 100);
        const status = BlueprintProgressUtils.isComplete(blueprint) ? '✅' : '⏳';
        info.push(`  ${status} Progress: ${totalPercent}%`);
        
        // Show detailed progress per species
        for (const [speciesId, requiredAmount] of Object.entries(recipe?.buildCost || {})) {
          const currentProgress = blueprint.progress?.[speciesId as SpeciesId] || 0;
          const percent = Math.round((currentProgress / requiredAmount) * 100);
          const status = currentProgress >= requiredAmount ? '✅' : '⏳';
          info.push(`  ${status} ${speciesId}: ${currentProgress.toFixed(1)}/${requiredAmount} (${percent}%)`);
        }
        
        info.push(`Press X to cancel (50% refund)`);
        info.push(''); // Add spacing
      }
      
      // Milestone 13: Check for cytoskeleton blueprints at this tile
      const cytoskeletonBlueprints = this.cytoskeletonSystem.getActiveBlueprints().filter(bp => 
        (bp.fromHex.q === tile.coord.q && bp.fromHex.r === tile.coord.r) ||
        (bp.toHex.q === tile.coord.q && bp.toHex.r === tile.coord.r)
      );
      
      if (cytoskeletonBlueprints.length > 0) {
        for (const blueprint of cytoskeletonBlueprints) {
          const icon = blueprint.type === 'actin' ? '🕸️' : '🧬';
          info.push(`${icon} ${blueprint.type} blueprint`);
          
          // Use shared progress utilities for consistency
          const progressRatio = BlueprintProgressUtils.calculateOverallProgress(blueprint);
          const totalPercent = Math.round(progressRatio * 100);
          const status = BlueprintProgressUtils.isComplete(blueprint) ? '✅' : '⏳';
          info.push(`  ${status} Progress: ${totalPercent}%`);
          
          // Show detailed progress per species using shared format
          const aaCurrentProgress = blueprint.progress['AA'] || 0;
          const aaRequiredAmount = blueprint.required['AA'];
          const aaPercent = Math.round((aaCurrentProgress / aaRequiredAmount) * 100);
          const aaStatus = aaCurrentProgress >= aaRequiredAmount ? '✅' : '⏳';
          info.push(`  ${aaStatus} AA: ${aaCurrentProgress.toFixed(1)}/${aaRequiredAmount} (${aaPercent}%)`);
          
          const proteinCurrentProgress = blueprint.progress['PROTEIN'] || 0;
          const proteinRequiredAmount = blueprint.required['PROTEIN'];
          const proteinPercent = Math.round((proteinCurrentProgress / proteinRequiredAmount) * 100);
          const proteinStatus = proteinCurrentProgress >= proteinRequiredAmount ? '✅' : '⏳';
          info.push(`  ${proteinStatus} PROTEIN: ${proteinCurrentProgress.toFixed(1)}/${proteinRequiredAmount} (${proteinPercent}%)`);
          
          info.push(`  From: (${blueprint.fromHex.q},${blueprint.fromHex.r}) To: (${blueprint.toHex.q},${blueprint.toHex.r})`);
        }
        info.push(''); // Add spacing
      }
      
      // Milestone 13: Check for existing cytoskeleton segments at this tile
      const segments = this.cytoskeletonSystem.getSegmentsAtTile(tile.coord);
      if (segments.length > 0) {
        info.push(`🔗 Cytoskeleton segments:`);
        for (const segment of segments) {
          const icon = segment.type === 'actin' ? '🕸️' : '🧬';
          
          info.push(`  ${icon} ${segment.type} (${segment.id})`);
          info.push(`    From: (${segment.fromHex.q},${segment.fromHex.r}) To: (${segment.toHex.q},${segment.toHex.r})`);
          info.push(`    Network: ${segment.networkId}`);
        }
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
      
      // Pathfinding Debug: Show paths from player position to selected tile
      if (this.playerActor && this.cytoskeletonSystem.graph && this.showPathfindingDebug) {
        const playerTile = this.playerActor.getCurrentHex();
        const playerCellPos = this.playerActor.getCellLocalPosition();
        const playerHexCoord = this.playerActor.getHexCoord();
        
        // Also test direct conversion for comparison
        const worldToHexDirect = this.hexGrid.worldToHex(playerCellPos.x, playerCellPos.y);
        
        info.push(`👤 Player Debug:`);
        info.push(`  World: (${playerCellPos.x.toFixed(1)}, ${playerCellPos.y.toFixed(1)})`);
        info.push(`  Hex: ${playerHexCoord ? `(${playerHexCoord.q}, ${playerHexCoord.r})` : 'null'}`);
        info.push(`  Direct: (${worldToHexDirect.q}, ${worldToHexDirect.r})`);
        info.push(`  Tile: ${playerTile ? `(${playerTile.coord.q}, ${playerTile.coord.r})` : 'null'}`);
        
        if (playerTile && (playerTile.coord.q !== tile.coord.q || playerTile.coord.r !== tile.coord.r)) {
          const debugResult = this.cytoskeletonSystem.graph.debugPathfinding(
            playerTile.coord, 
            tile.coord, 
            'vesicle' // Default to vesicle for debugging
          );
          
          info.push(`🗺️ Pathfinding Debug (Player → Selected):`);
          info.push(`  From: (${playerTile.coord.q}, ${playerTile.coord.r}) → To: (${tile.coord.q}, ${tile.coord.r})`);
          
          if (debugResult.issues.length > 0) {
            info.push(`  ❌ Issues: ${debugResult.issues.join(', ')}`);
          }
          
          info.push(`  📊 Graph: ${debugResult.graphInfo.totalNodes} nodes, ${debugResult.graphInfo.totalEdges} edges`);
          info.push(`  🏁 From nodes: ${debugResult.fromNodes.length > 0 ? debugResult.fromNodes.slice(0, 3).join(', ') : 'none'}`);
          info.push(`  🎯 To nodes: ${debugResult.toNodes.length > 0 ? debugResult.toNodes.slice(0, 3).join(', ') : 'none'}`);
          
          // Show only the best path
          const topPaths = debugResult.paths.slice(0, 1); // Only take the best path
          if (topPaths.length > 0) {
            info.push(`  🛤️ Best path:`);
            
            const path = topPaths[0];
            if (path.success) {
              info.push(`    ✅ Cost ${path.cost.toFixed(1)}`);
              info.push(`       ${path.startNode} → ${path.endNode}`);
              info.push(`       Path: ${path.path.slice(0, 4).join(' → ')}${path.path.length > 4 ? '...' : ''}`);
            } else {
              info.push(`    ❌ ${path.reason || 'Unknown'}`);
              info.push(`       ${path.startNode} → ${path.endNode}`);
            }
            
            // Render the top 3 paths visually
            this.renderPathfindingDebugPaths(topPaths);
          } else {
            info.push(`  🛤️ No paths found`);
            // Clear any existing path visualizations
            this.clearPathfindingDebugPaths();
          }
          
          info.push(''); // Add spacing
        } else {
          // Clear path visualizations when not debugging
          this.clearPathfindingDebugPaths();
        }
      } else {
        // Clear path visualizations when cytoskeleton system not available
        this.clearPathfindingDebugPaths();
      }
      
      info.push(`Species Concentrations:`);
      
      // Show all species concentrations with reduced precision to minimize flicker
      for (const speciesId in concentrations) {
        const concentration = concentrations[speciesId as SpeciesId];
        if (concentration > 0.01) { // Only show meaningful amounts
          info.push(`  ${speciesId}: ${concentration.toFixed(1)}`); // Reduced to 1 decimal place
        }
      }
      
      this.tileInfoPanel.setText(info.join('\n'));
      this.tileInfoPanel.setVisible(true);
    } else {
      this.tileInfoPanel.setVisible(false);
      this.clearPathfindingDebugPaths(); // Clear paths when no tile selected
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
      "F3 - Toggle pathfinding debug",
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
    this.currentTileLabel = this.add.text(600, 50, "Current Tile: none", {
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
  

  // Organelle System - Milestone 3 Task 1
  
  private initializeOrganelleSystem(): void {
    this.organelleSystem = new OrganelleSystem(this.net.bus, this.hexGrid);
    this.organelleRenderer = new OrganelleRenderer(this, this.organelleSystem, this.hexSize, this.worldRefsInstance);
    console.log('Organelle renderer initialized');
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
    console.log(`Cytoskeleton system before blueprint init:`, this.cytoskeletonSystem);
    // Initialize blueprint system with reference to organelle occupied tiles and membrane exchange system
    this.blueprintSystem = new BlueprintSystem(
      this,
      this.net.bus,
      this.hexGrid, 
      () => this.organelleSystem.getOccupiedTiles(),
      this.membraneExchangeSystem,
      this.cytoskeletonSystem,
      (organelleType: OrganelleType, coord: HexCoord) => this.spawnOrganelleFromBlueprint(organelleType, coord),
    );
    
    // Initialize blueprint renderer (now that blueprintSystem exists)
    this.blueprintRenderer = new BlueprintRenderer(this, this.blueprintSystem, this.hexGrid, this.hexSize);
    
    // Initialize build palette UI
    this.buildPalette = new BuildPaletteUI(this, 350, 50);
    this.buildPalette.onRecipeSelected = (recipeId: string) => {
      this.selectedRecipeId = recipeId;
      this.isInBuildMode = true;
      console.log(`Entered build mode with recipe: ${recipeId}`);
    };
    
    console.log('Blueprint system initialized');
  }

  private spawnOrganelleFromBlueprint(organelleType: OrganelleType, coord: HexCoord): void {
    console.log(`🏭 Spawning organelle ${organelleType} at (${coord.q}, ${coord.r})`);
    
    // Get the organelle definition from registry
    const definition = getOrganelleDefinition(organelleType);
    if (!definition) {
      console.error(`Cannot spawn organelle: unknown type "${organelleType}"`);
      return;
    }
    
    // Convert definition to config format and generate clean sequential instance ID
    const config = definitionToConfig(definition);
    
    // Create the organelle through the organelle system
    const success = this.organelleSystem.createOrganelle(config, coord);
    if (success) {
      console.log(`✅ Successfully spawned ${organelleType} at (${coord.q}, ${coord.r})`);
    } else {
      console.error(`❌ Failed to spawn ${organelleType} at (${coord.q}, ${coord.r})`);
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
    
    // Milestone 7 Task 8: Transcript and order status (updated for networked cargo)
    const carriedInventory = this.cargoSystem.getMyPlayerInventory();
    const carriedCount = carriedInventory.length;
    const carriedType = carriedInventory[0]?.currentType || 'none';
    const totalCargo = this.cargoSystem?.getAllCargo().length || 0;
    const pendingOrders = this.net.installOrders.getOrderCount();
    const transcriptStatus = `Cargo: ${carriedCount}/1 carried (${carriedType}), ${totalCargo} transcripts total | Orders: ${pendingOrders} pending`;

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
    
    // Always-networked approach: Start with local loopback (no transport switching!)
    const offline = new LoopbackTransport({ roomId: "offline", isHost: true });
    this.initNetwork({ transport: offline, isHost: true, roomId: "offline" });

    // F10 toggles Quick Join panel - simple scene restart approach
    this.roomUI = new RoomUI({
      scene: this,
      connectQuick: async () => {
        const transport = await makeQuickJoinTransport();
        return { transport, isHost: transport.isHost, roomId: "CELL01" };
      },
      onConnected: ({ transport, roomId }) => {
        // Clean approach: Restart scene with multiplayer (no complex switching!)
        console.log(`🎮 Starting multiplayer session: ${transport.isHost ? 'HOST' : 'CLIENT'} in ${roomId}`);
        this.scene.restart({ 
          useMultiplayer: true, 
          transport, 
          isHost: transport.isHost, 
          roomId 
        });
      },
    });
    
    console.log('Networking systems initialized');
  }
  
  // Always-networked initialization - create systems once, never switch transports
  private initNetwork({ transport, isHost, roomId }: 
    { transport: NetworkTransport; isHost: boolean; roomId: string }) {

    const bus = new NetBus(transport);
    
    const players        = new PlayerSystem(bus);
    const species        = new SpeciesSystem(bus, this.worldRefsInstance);
    const installOrders  = new InstallOrderSystem(bus, { address: 'InstallOrderSystem' });
    const cytoskeleton   = this.cytoskeletonSystem; // Use existing system
    const emotes         = new EmoteSystem(bus, this, players);
    
    // Initialize networked membrane systems
    const membraneExchange = new MembraneExchangeSystem(this, bus, this.hexGrid);
    this.membraneExchangeSystem = membraneExchange;
    
    // Initialize Membrane physics physics system
    const cellRadius = 200; // Match the existing membrane radius
    const particleCount = 96; // Number of membrane particles
    const membraneParticles: Phaser.Math.Vector2[] = [];

    const initialCellCenter = new Phaser.Math.Vector2(0, 0);
    
    // Create circular membrane
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const x = initialCellCenter.x + Math.cos(angle) * cellRadius;
      const y = initialCellCenter.y + Math.sin(angle) * cellRadius;
      membraneParticles.push(new Phaser.Math.Vector2(x, y));
    }
    
    const membranePhysics = new MembranePhysicsSystem(this, bus, {
      particles: membraneParticles,
      timeStep: 1/60,
      parent: undefined, // Graphics added directly to scene
      id: 'player' // Unique identifier for main player membrane
    });
    this.membranePhysics = membranePhysics;
    
    // PHYSICS-BASED POSITIONING: Add membrane physics to WorldRefs
    this.worldRefsInstance.membranePhysics = membranePhysics;

    // Configure bounce-house membrane settings
    // membranePhysics.setCenterAnchor(new Phaser.Math.Vector2(0, 0), 1e-3); // DISABLED: was pulling membrane to origin
    membranePhysics.setAllowReset(false); // Disable hard reset to prevent flicker

    // Wire player to use membrane physics for collision
    this.playerActor.setMembranePhysics(membranePhysics);

    // Initialize Endocytosis System
    console.log('🧬 Initializing Endocytosis System...');
    this.endocytosisSystem = new EndocytosisSystem(this, this.worldRefsInstance, membranePhysics, this.playerActor);
    this.endocytosisInputController = new EndocytosisInputController(this, this.worldRefsInstance, this.endocytosisSystem, this.playerActor);
    console.log('🧬 Endocytosis System initialized successfully!');

    // Initialize Membrane Tuning UI for real-time parameter adjustment
    console.log('🔧 Initializing Membrane Tuning UI...');
    this.membraneTuningUI = new MembraneTuningUI(membranePhysics);
    console.log('🔧 Membrane Tuning UI initialized! Press T to toggle. Parameters are synced via state channels.');

    // Initialize Neighbor Cell System for server-authoritative neighbor spawning
    console.log('🏘️ Initializing Neighbor Cell System...');
    this.neighborCellSystem = new NeighborCellSystem(this, bus, membranePhysics);
    console.log('🏘️ Neighbor Cell System initialized!');

    for (const c of [players, this.cargoSystem, species, installOrders, cytoskeleton, emotes, membranePhysics, this.neighborCellSystem].filter(c => c)) bus.registerInstance(c);
    
    // GameScene no longer needs network registration since neighbor logic is in NeighborCellSystem

    // Host initializes self in player roster
    if (bus.isHost) {
      players.join(bus.localId, 0, 0);
    }

    console.log(`🆔 Player ID: ${bus.localId})`);

    this.net = { 
      bus, 
      isHost: bus.isHost, 
      players,            // Direct access to PlayerSystem 
      cargo: this.cargoSystem, 
      species,
      installOrders,
      cytoskeleton, 
      emotes,
      membranePhysics     // Add membrane physics to network interface
    };

    // Add InstallOrderSystem to WorldRefs for CargoSystem access
    this.worldRefsInstance.installOrderSystem = installOrders;
    
    // Add networked MembraneExchangeSystem to WorldRefs
    this.worldRefsInstance.membraneExchangeSystem = membraneExchange;

    // Optional per-frame host flush (microtask batching also works):
    const flush = () => {
      if (bus.isHost) {
        (players as any).flushState?.();
        (this.cargoSystem as any).flushState?.();
        (species as any).flushState?.();
        (emotes as any).flushState?.();
      }
      requestAnimationFrame(flush);
    };
    requestAnimationFrame(flush);
    
    console.log(`Network initialized: ${isHost ? 'HOST' : 'CLIENT'} in room ${roomId}`);
    
    // Connect membrane physics to player now that it's initialized
    (this.playerActor as any).membranePhysics = membranePhysics;
    console.log('🧬 Dynamic membrane physics system initialized and connected to player');
    
    // CargoSystem now provides UI interface methods directly - no wrapper needed
    console.log('CargoSystem provides UI interface methods directly');
    
    // Generate random neighbor cells for visual interest (after networking is fully set up)
    this.neighborCellSystem.generateNeighborCells();
  }

  
  private handleDebugControls(): void {
    const playerCoord = this.playerActor.getHexCoord();
    if (!playerCoord) return;

    // NOTE: C key handling is now managed by EndocytosisInputController
    // Inject species using SHIFT + number keys 1-6 (to avoid conflict with protein installation)
    // Clear all species on player's current tile (SHIFT + C to avoid endocytosis conflict)
    const injectionAmount = 20; // Modest amount to inject
    
    // Species injection now requires holding SHIFT to avoid conflicts
    const shiftHeld = this.input.keyboard?.checkDown(this.input.keyboard.addKey('SHIFT'), 0);
    
    if (shiftHeld) {
      // SHIFT + C clears species (to avoid conflict with endocytosis C key)
      if (Phaser.Input.Keyboard.JustDown(this.keys.C)) {
        this.hexGrid.clearConcentrations(playerCoord);
        console.log(`🧹 Cleared all species on tile (${playerCoord.q}, ${playerCoord.r}) - SHIFT+C used`);
      }
      
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
      // Check for blueprint at current location
      const blueprint = this.blueprintSystem.getBlueprintAtTile(playerCoord.q, playerCoord.r);
      if (blueprint) {
        // Instantly complete the blueprint
        const result = this.blueprintSystem.instantlyComplete(blueprint.id);
        
        // Only check result if we're the host (clients get undefined from @RunOnServer methods)
        if (this.net.bus.isHost) {
          if (result && result.success) {
            console.log(`🏁 Instantly completed construction: ${blueprint.recipeId}`);
            this.showToast(`Completed ${blueprint.recipeId}!`);
          } else {
            console.warn(`❌ Failed to complete construction: ${result?.error}`);
            this.showToast(result?.error || 'Failed to complete construction');
          }
        } else {
          // Client: show optimistic feedback
          console.log(`🏁 Requested instant completion: ${blueprint.recipeId}`);
          this.showToast(`Completing ${blueprint.recipeId}...`);
        }
      } else {
        console.log('No blueprint found at current location');
        this.showToast('No blueprint found here');
      }
    }
  }

  /**
   * Handle essential build input that was lost in modular refactor
   */
  private handleEssentialBuildInput(): void {
    // Toggle build palette with B key for non-membrane tiles
    if (Phaser.Input.Keyboard.JustDown(this.keys.B)) {
      // Check if standing on membrane tile for protein installation
      const isMembraneCoord = this.currentTileRef && this.hexGrid.isMembraneCoord(this.currentTileRef.coord);
      
      // Also check if there's a transporter/receptor organelle at current location
      const organelle = this.currentTileRef ? this.organelleSystem.getOrganelleAtTile(this.currentTileRef.coord) : null;
      const hasTransporterOrReceptor = organelle && (organelle.type === 'transporter' || organelle.type === 'receptor');
      
      console.log(`Build key pressed. Membrane tile: ${isMembraneCoord}, Has transporter/receptor: ${hasTransporterOrReceptor}`);
      if (isMembraneCoord || hasTransporterOrReceptor) {
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
        
        // Only check result if we're the host (clients get undefined from @RunOnServer methods)
        if (this.net.bus.isHost) {
          if (success) {
            console.log(`🗑️ Cancelled blueprint with 50% refund`);
            this.showToast('Blueprint cancelled with 50% refund');
          } else {
            this.showToast('Failed to cancel blueprint');
          }
        } else {
          // Client: show optimistic feedback
          console.log(`🗑️ Requested blueprint cancellation`);
          this.showToast('Cancelling blueprint...');
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
        // Always use network call - it will route properly whether we're host or client
        const result = this.blueprintSystem.placeBlueprint(
          this.selectedRecipeId as OrganelleType,
          this.currentTileRef.coord.q,
          this.currentTileRef.coord.r
        );
        
        // Only check result if we're the host (clients get undefined from @RunOnServer methods)
        if (this.net.bus.isHost) {
          if (result && result.success) {
            console.log(`Placed ${this.selectedRecipeId} blueprint at (${this.currentTileRef.coord.q}, ${this.currentTileRef.coord.r})`);
            this.showToast(`Placed ${this.selectedRecipeId} blueprint`);
          } else {
            this.showToast(result?.error || 'Failed to place blueprint');
          }
        } else {
          // Client: just show optimistic feedback since we can't get immediate result
          console.log(`Requested ${this.selectedRecipeId} blueprint placement at (${this.currentTileRef.coord.q}, ${this.currentTileRef.coord.r})`);
          this.showToast(`Requesting ${this.selectedRecipeId} blueprint...`);
        }
        
        // Exit build mode after placement request
        this.isInBuildMode = false;
        this.selectedRecipeId = null;
        this.buildPalette.hide();
        // Reset palette to show all recipes
        this.buildPalette.rebuildPalette('all');
      }
    }
  }
  
  /**
   * Handle membrane protein request using the proper transcript workflow
   */
  private handleMembraneProteinRequest(): void {
    console.log(`🔬 handleMembraneProteinRequest() called`);
    if (!this.currentTileRef) {
      console.log(`🔬 No currentTileRef, returning`);
      return;
    }
    
    const coord = this.currentTileRef.coord;
    console.log(`🔬 Current tile: (${coord.q}, ${coord.r})`);
    
    // Check if this tile has a built transporter or receptor
    const organelle = this.organelleSystem.getOrganelleAtTile(coord);
    const hasBuiltStructure = organelle?.type === 'transporter' || organelle?.type === 'receptor';
    console.log(`Membrane protein request at (${coord.q}, ${coord.r}). Has transporter/receptor: ${hasBuiltStructure}`);
    console.log(`🔬 Organelle found:`, organelle ? `${organelle.type} (${organelle.id})` : 'none');
    
    if (!hasBuiltStructure) {
      console.log(`🔬 No built structure, showing error toast`);
      this.showToast("No built transporter/receptor here. Build one first with ENTER key.");
      return;
    }
    
    // Check if protein already installed (for membrane tiles only)
    const isMembraneCoord = this.hexGrid.isMembraneCoord(coord);
    console.log(`🔬 Is membrane coord: ${isMembraneCoord}`);
    if (isMembraneCoord && this.membraneExchangeSystem.hasInstalledProtein(coord)) {
      const installedProtein = this.membraneExchangeSystem.getInstalledProtein(coord);
      console.log(`🔬 Protein already installed, showing toast`);
      this.showToast(`${installedProtein?.label || 'Unknown protein'} already installed`);
      return;
    }
    
    // Activate protein request mode directly
    console.log(`🔬 About to activate protein request mode...`);
    this.tileActionController.activateProteinRequestMode();
    console.log(`🔬 Protein request mode activation complete`);
  }
  
  /**
   * Milestone 7 Task 6: Transcript pickup/carry mechanics
   * Handle R key for pickup/drop and Shift+R key for carry management
   */
  private handleUnifiedCargoInput(): void {
    // R key: Pick up or drop cargo using unified cargo system
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      const playerHex = this.playerActor.getHexCoord();
      if (!playerHex) return;

      const isCarrying = this.cargoSystem.getMyPlayerInventory();
      
      // TODO should only run on server - CargoSystem handles everything via @RunOnServer
      if (isCarrying.length === 0) {
        this.cargoSystem.pickup(playerHex, this.net.bus.localId);
        console.log(`📦 Requested cargo pickup at (${playerHex.q}, ${playerHex.r})`);
      } else {
        // Try to drop cargo - CargoSystem handles everything via @RunOnServer
        this.cargoSystem.drop(playerHex, this.net.bus.localId);
        console.log(`📦 Requested cargo drop at (${playerHex.q}, ${playerHex.r})`);
      }
      
      // No complex timing logic needed - state sync will update UI automatically
    }
  }

  /**
   * Milestone 13: Context-aware build palette update
   * This determines which recipes are available based on tile type and organelle proximity
   */
  private updateBuildPaletteFilter(): void {
    if (!this.currentTileRef) {
      // Player outside grid - show all recipes
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
   * Milestone 6 Task 1: Get the player's current hex tile
   * Converts player world coords → axial/hex and returns the tile (or null if outside the grid)
   */
  private getPlayerHex(): HexTile | null {
    const coord = this.playerActor.getHexCoord();
    if (!coord) return null;
    return this.hexGrid.getTile(coord) || null;
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
    const playerCoord = this.playerActor.getHexCoord();
    if (!playerCoord) return;

    // Always use network call - it will route properly whether we're host or client
    console.log(`📤 Requesting species injection: ${amount} ${speciesId} at (${playerCoord.q}, ${playerCoord.r})`);
    
    this.net.species.injectSpecies(speciesId, amount, { q: playerCoord.q, r: playerCoord.r });
    
    this.showToast(`Requesting injection of ${amount} ${speciesId}...`);
  }

  /**
   * Debug command: Print status of consolidated systems
   */
  private printSystemStatus(): void {
    // MILESTONE 9: Drive mode and motility status
    const driveStatus = this.cellDriveMode ? 'ON' : 'OFF';
    if (this.cellMotility) {
      const state = this.cellMotility.getState();
      this.showToast(`Drive: ${driveStatus}, Speed: ${state.speed.toFixed(1)}, Polarity: ${state.polarity.magnitude.toFixed(1)}`);
    } else {
      this.showToast(`Drive Mode: ${driveStatus}`);
    }
    
    // CargoSystem metrics
    const totalCargo = this.cargoSystem?.getAllCargo().length || 0;
    const orderCount = this.net.installOrders.getOrderCount();
    console.log(`🔬 CargoSystem: ${totalCargo} cargo, ${orderCount} pending orders`);
    
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

  // Pathfinding debug visualization methods
  private renderPathfindingDebugPaths(paths: Array<{
    success: boolean;
    path: string[];
    cost: number;
    reason?: string;
    startNode: string;
    endNode: string;
  }>): void {
    if (!this.pathfindingGraphics || !this.cytoskeletonSystem) return;
    
    this.clearPathfindingDebugPaths();
    
    // Render only the best path (simplified visualization)
    const pathStyles = [
      { 
        color: 0x00ff00, 
        alpha: 1.0, 
        lineWidth: 6, 
        offset: { x: 0, y: 0 }, 
        glowColor: 0x88ff88,
        name: 'Best Route'
      } // Single green path for best route
    ];
    
    // Only render the first/best path
    if (paths.length > 0) {
      const path = paths[0];
      const style = pathStyles[0];
      
      if (path.success && path.path.length > 1) {
        this.renderSinglePath(path.path, style, 1, path.startNode, path.endNode);
      }
    }
  }

  private renderSinglePath(path: string[], style: {
    color: number;
    alpha: number;
    lineWidth: number;
    offset: { x: number; y: number };
    glowColor: number;
    name: string;
  }, pathNumber: number, startNodeId: string, endNodeId: string): void {
    if (!this.pathfindingGraphics || !this.cytoskeletonSystem) return;
    
    // Handle organelle-to-organelle movement (path 0 case)
    if (path.length === 2 && startNodeId.includes('organelle_') && endNodeId.includes('organelle_')) {
      this.renderOrganelleToOrganelleMovement(startNodeId, endNodeId, style, pathNumber);
      return;
    }
    
    // Get node positions from the graph
    const nodePositions: { x: number; y: number }[] = [];
    
    for (const nodeId of path) {
      const nodeInfo = this.cytoskeletonSystem.graph.debugNode(nodeId);
      if (nodeInfo.exists && nodeInfo.node) {
        const worldPos = this.hexGrid.hexToWorld(nodeInfo.node.hex);
        // Apply offset to separate overlapping paths
        nodePositions.push({ 
          x: worldPos.x + style.offset.x, 
          y: worldPos.y + style.offset.y 
        });
      }
    }
    
    if (nodePositions.length < 2) return;
    
    // Draw glow effect first (underneath main line)
    this.pathfindingGraphics.lineStyle(style.lineWidth + 4, style.glowColor, style.alpha * 0.3);
    this.pathfindingGraphics.beginPath();
    this.pathfindingGraphics.moveTo(nodePositions[0].x, nodePositions[0].y);
    for (let i = 1; i < nodePositions.length; i++) {
      this.pathfindingGraphics.lineTo(nodePositions[i].x, nodePositions[i].y);
    }
    this.pathfindingGraphics.strokePath();
    
    // Draw the main path line
    this.pathfindingGraphics.lineStyle(style.lineWidth, style.color, style.alpha);
    this.pathfindingGraphics.beginPath();
    this.pathfindingGraphics.moveTo(nodePositions[0].x, nodePositions[0].y);
    
    // Draw path segments
    for (let i = 1; i < nodePositions.length; i++) {
      this.pathfindingGraphics.lineTo(nodePositions[i].x, nodePositions[i].y);
    }
    this.pathfindingGraphics.strokePath();
    
    // Add path number labels at start and end with style name
    this.addPathLabel(nodePositions[0], `${pathNumber}`, style.color, `${style.name} Start`);
    if (nodePositions.length > 1) {
      this.addPathLabel(nodePositions[nodePositions.length - 1], `${pathNumber}`, style.color, `${style.name} End`);
    }
    
    // Add waypoint markers
    for (let i = 1; i < nodePositions.length - 1; i++) {
      this.pathfindingGraphics.fillStyle(style.color, style.alpha * 0.8);
      this.pathfindingGraphics.fillCircle(nodePositions[i].x, nodePositions[i].y, 4);
      
      // Add a white border to waypoint
      this.pathfindingGraphics.lineStyle(1, 0xffffff, 0.8);
      this.pathfindingGraphics.strokeCircle(nodePositions[i].x, nodePositions[i].y, 4);
    }
  }

  private renderOrganelleToOrganelleMovement(startNodeId: string, endNodeId: string, style: {
    color: number;
    alpha: number;
    lineWidth: number;
    offset: { x: number; y: number };
    glowColor: number;
    name: string;
  }, pathNumber: number): void {
    if (!this.pathfindingGraphics || !this.cytoskeletonSystem) return;
    
    // Get start and end organelle positions
    const startNodeInfo = this.cytoskeletonSystem.graph.debugNode(startNodeId);
    const endNodeInfo = this.cytoskeletonSystem.graph.debugNode(endNodeId);
    
    if (!startNodeInfo.exists || !endNodeInfo.exists || !startNodeInfo.node || !endNodeInfo.node) {
      return;
    }
    
    const startWorldPos = this.hexGrid.hexToWorld(startNodeInfo.node.hex);
    const endWorldPos = this.hexGrid.hexToWorld(endNodeInfo.node.hex);
    
    // Apply offsets
    const startPos = { 
      x: startWorldPos.x + style.offset.x, 
      y: startWorldPos.y + style.offset.y 
    };
    const endPos = { 
      x: endWorldPos.x + style.offset.x, 
      y: endWorldPos.y + style.offset.y 
    };
    
    // Draw teleport arc (curved line to indicate special movement)
    this.drawTeleportArc(startPos, endPos, style);
    
    // Add special labels for organelle-to-organelle movement
    this.addPathLabel(startPos, `${pathNumber}`, style.color, `${style.name} Teleport Start`);
    this.addPathLabel(endPos, `${pathNumber}`, style.color, `${style.name} Teleport End`);
  }

  private drawTeleportArc(startPos: { x: number; y: number }, endPos: { x: number; y: number }, style: {
    color: number;
    alpha: number;
    lineWidth: number;
    glowColor: number;
  }): void {
    if (!this.pathfindingGraphics) return;
    
    // Calculate control point for curved arc
    const midX = (startPos.x + endPos.x) / 2;
    const midY = (startPos.y + endPos.y) / 2;
    const distance = Math.sqrt((endPos.x - startPos.x) ** 2 + (endPos.y - startPos.y) ** 2);
    const arcHeight = Math.min(distance * 0.3, 50); // Arc height based on distance
    
    // Control point is perpendicular to the line between start and end
    const controlX = midX;
    const controlY = midY - arcHeight;
    
    // Draw glow effect using Bezier curve
    this.pathfindingGraphics.lineStyle(style.lineWidth + 4, style.glowColor, style.alpha * 0.3);
    const glowCurve = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(startPos.x, startPos.y),
      new Phaser.Math.Vector2(controlX, controlY),
      new Phaser.Math.Vector2(endPos.x, endPos.y)
    );
    glowCurve.draw(this.pathfindingGraphics, 32);
    
    // Draw main arc with dashed pattern for teleport using line segments
    this.pathfindingGraphics.lineStyle(style.lineWidth, style.color, style.alpha);
    
    // Create dashed effect by drawing multiple small segments along the curve
    const segments = 20;
    for (let i = 0; i < segments; i++) {
      if (i % 2 === 0) { // Only draw every other segment for dash effect
        const t1 = i / segments;
        const t2 = Math.min((i + 0.5) / segments, 1); // Half-length segments for dash effect
        
        // Calculate points using quadratic Bezier formula
        const x1 = (1 - t1) * (1 - t1) * startPos.x + 2 * (1 - t1) * t1 * controlX + t1 * t1 * endPos.x;
        const y1 = (1 - t1) * (1 - t1) * startPos.y + 2 * (1 - t1) * t1 * controlY + t1 * t1 * endPos.y;
        const x2 = (1 - t2) * (1 - t2) * startPos.x + 2 * (1 - t2) * t2 * controlX + t2 * t2 * endPos.x;
        const y2 = (1 - t2) * (1 - t2) * startPos.y + 2 * (1 - t2) * t2 * controlY + t2 * t2 * endPos.y;
        
        this.pathfindingGraphics.beginPath();
        this.pathfindingGraphics.moveTo(x1, y1);
        this.pathfindingGraphics.lineTo(x2, y2);
        this.pathfindingGraphics.strokePath();
      }
    }
  }

  private addPathLabel(position: { x: number; y: number }, text: string, color: number, description?: string): void {
    // Convert color to CSS hex string
    const colorStr = `#${color.toString(16).padStart(6, '0')}`;
    
    // Create label text with optional description
    const labelText = description ? `${text}\n${description}` : text;
    
    const label = this.add.text(position.x, position.y - 10, labelText, {
      fontSize: description ? '12px' : '14px',
      color: colorStr,
      backgroundColor: '#000000',
      padding: { x: 4, y: 2 },
      align: 'center'
    });
    
    label.setOrigin(0.5, 1);
    label.setDepth(5.1); // Above the path lines
    
    // Add label directly to scene - positioning handled by positionVisualElement
    this.add.existing(label);
    
    // Store the label so we can clean it up later
    if (!this.pathLabels) {
      this.pathLabels = [];
    }
    this.pathLabels.push(label);
  }

  private pathLabels: Phaser.GameObjects.Text[] = [];

  private clearPathfindingDebugPaths(): void {
    if (this.pathfindingGraphics) {
      this.pathfindingGraphics.clear();
    }
    
    // Clean up path labels
    if (this.pathLabels) {
      for (const label of this.pathLabels) {
        label.destroy();
      }
      this.pathLabels = [];
    }
  }

}

// Implement using WebRTC transport with signaling server
// It should perform discover/join or host, resolve when data channels are open,
// and return an object that matches NetworkTransport.
async function makeQuickJoinTransport(): Promise<import("../network/transport").NetworkTransport> {
  const { createQuickJoinWebRTC } = await import("../network/transport");
  return createQuickJoinWebRTC("CELL01");
}

