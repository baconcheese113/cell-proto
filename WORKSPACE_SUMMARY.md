# Cell Prototype - Workspace Summary

## Overview
This is a **cellular simulation game prototype** built with **TypeScript** and **Phaser 3**. The project implements a sophisticated biological cell simulation featuring:

- **Hexagonal grid-based cellular environment**
- **Multi-species chemical diffusion system**
- **Organelle placement and metabolic processing**
- **Construction/building system with blueprints**
- **Player inventory and resource management**
- **Membrane transport system with protein-mediated exchange**
- **Signal transduction pathways (receptor-mediated)**
- **Real-time protein production pipeline (orders → transcripts → installation)**
- **Multi-stage biological timing system with realistic delays**
- **Real-time visualization and interactive debugging**
- **Consolidated SystemObject architecture with automatic Phaser lifecycle management**
- **Milestone 9: Complete cell motility system with unified visual transform (cellRoot container)**
- **Milestone 10: Advanced motility modes system (Amoeboid, Blebbing, Mesenchymal)**
- **Milestone 12: Throw & membrane interactions v1 (charge-based projectile system)**
- **Milestone 13: Cytoskeleton Transport v1 (blueprint-based filament construction system)**

The codebase uses a **revolutionary consolidated system architecture** that eliminates manual update coordination through three main systems (CellProduction, CellTransport, CellOverlays) extending a common SystemObject base class, achieving "calm, minimal path forward" design principles. **Milestone 9** introduced unified cell movement where all visual elements move together as a single entity. **Milestone 10** revolutionizes locomotion with three biologically-grounded motility modes, each optimized for different terrain types and movement strategies. **Milestone 12** adds sophisticated interaction mechanics through charge-based projectile throwing with realistic membrane physics and boundary detection. **Milestone 13** implements a complete cytoskeleton transport system with blueprint-based filament construction, enabling actin and microtubule network building through gradual resource consumption.

**Technology Stack:**
- **Core**: TypeScript 5.8.3, Phaser 3.90.0, Vite 7.1.0
- **Utilities**: chroma-js (color manipulation), seedrandom (deterministic randomization), simplex-noise (procedural generation)
- **State Management**: XState 5.20.2 (finite state machines)

---

## Revolutionary Architecture: SystemObject Pattern

---

## Complete Source Code Inventory

### **Core Architecture & Entry Point**
- **`src/main.ts`**: Application entry point, Phaser game configuration, scene registration
- **`src/vite-env.d.ts`**: TypeScript environment definitions for Vite build system

### **Scenes & Game Management**
- **`src/scenes/game-scene.ts`**: Main game scene (2,500+ lines) - central coordination, input handling, system initialization, camera management, UI wiring
- **`src/scenes/motility-course-scene.ts`**: Dedicated motility testing environment with substrate zones and performance metrics

### **Core Systems & Data Management**
- **`src/core/world-refs.ts`**: Central data interface, type definitions, shared state management
- **`src/core/cell-space-system.ts`**: Cellular space management and boundaries
- **`src/core/substrate-system.ts`**: Substrate type management for motility interactions

### **Player & Actor Systems**
- **`src/actors/player.ts`**: Player entity (560+ lines) - movement, cargo visualization, membrane effects, dash mechanics
- **`src/player/player-inventory.ts`**: Inventory system with species storage and management

### **Hexagonal Grid System**
- **`src/hex/hex-grid.ts`**: Complete hexagonal grid implementation (1,000+ lines) - coordinate conversion, neighbor finding, membrane detection, tile management

### **Networking & Multiplayer Systems (New Architecture)**
- **`src/network/net-bus.ts`**: Message bus for routing decorated methods to transport layer
- **`src/network/decorators.ts`**: @RunOnServer and @Multicast decorators for network method routing
- **`src/network/net-entity.ts`**: Base NetComponent class with stateChannel for automatic state replication
- **`src/network/transport.ts`**: Transport layer implementations including LoopbackTransport for peer-to-peer communication
- **`src/network/client-prediction.ts`**: Client-side prediction and lag compensation systems
- **`src/network/room-ui.ts`**: Multiplayer room management interface
- **`src/network/schema.ts`**: Network message schemas and type definitions
- **`src/systems/cargo-system.ts`**: NetComponent for multiplayer cargo operations (pickup, drop, throw) with @RunOnServer methods
- **`src/systems/construction-system.ts`**: NetComponent for construction and blueprint operations with network state synchronization
- **`src/systems/species-system.ts`**: NetComponent for species injection operations with multiplayer validation

### **Consolidated Production Systems (Revolutionary Architecture)**
- **`src/systems/cell-production.ts`**: Complete secretory pathway (750+ lines) - transcript creation, ER processing, vesicle transport, membrane installation
- **`src/systems/cell-transport.ts`**: All transport processes - diffusion, membrane exchange, passive effects, conservation tracking
- **`src/systems/cell-overlays.ts`**: Visual overlays - heatmaps, blueprints, vesicle visualization, queue indicators
- **`src/systems/system-object.ts`**: Base class for automatic Phaser lifecycle management

### **Cytoskeleton Transport System (Milestone 13)**
- **`src/systems/cytoskeleton-system.ts`**: Core cytoskeleton management (810+ lines) - filament placement, network topology, transport capacity
- **`src/systems/cytoskeleton-graph.ts`**: Graph theory implementation for transport routing and pathfinding
- **`src/systems/cytoskeleton-renderer.ts`**: Visual rendering (650+ lines) - filament visualization, infrastructure overlay, construction progress
- **`src/systems/cytoskeleton-router.ts`**: Advanced routing algorithms for cargo transport
- **`src/systems/cytoskeleton-vesicle-integration.ts`**: Integration layer between vesicle system and cytoskeleton transport
- **`src/systems/filament-builder.ts`**: Interactive blueprint-based filament construction system

### **Legacy Vesicle & Transport Systems**
- **`src/systems/vesicle-system.ts`**: Vesicle lifecycle management (700+ lines) - state machine, transport, installation
- **`src/systems/unified-cargo-system.ts`**: Unified cargo pickup/drop mechanics for player interaction

### **Motility & Movement Systems**
- **`src/systems/cell-motility.ts`**: Unified cell locomotion with drive mode, polarity, adhesion mechanics
- **`src/systems/motility-mode-registry.ts`**: Registry pattern for locomotion mode management
- **`src/systems/motility-modes.config.ts`**: Configuration system for motility parameters and presets
- **`src/systems/motility-telemetry.ts`**: Performance metrics and movement analytics

### **Interaction & Physics Systems**
- **`src/systems/throw-system.ts`**: Projectile physics and cargo throwing mechanics
- **`src/systems/throw-input-controller.ts`**: Input handling for charge-based throwing system
- **`src/systems/membrane-trampoline.ts`**: Membrane bounce physics and collision detection

### **User Interface & HUD**
- **`src/ui/hud.ts`**: HUD display system with resource monitoring and visual feedback
- **`src/systems/cargo-hud.ts`**: Cargo-specific UI elements and status displays

### **Controller & Input Systems**
- **`src/controllers/tile-action-controller.ts`**: Tile-based action handling, protein request system, build mode coordination

### **Construction & Building Systems**
- **`src/construction/blueprint-system.ts`**: Blueprint management (400+ lines) - construction validation, progress tracking, resource consumption
- **`src/construction/blueprint-renderer.ts`**: Visual rendering of construction blueprints and progress indicators
- **`src/construction/build-palette-ui.ts`**: User interface for construction options and recipes
- **`src/construction/construction-recipes.ts`**: Recipe database and building cost definitions

### **Organelle Systems**
- **`src/organelles/organelle-system.ts`**: Core organelle management (760+ lines) - placement, seat reservation, processing
- **`src/organelles/organelle-registry.ts`**: Central organelle database and starter placements
- **`src/organelles/organelle-renderer.ts`**: Visual rendering of organelles and effects
- **`src/organelles/organelle-selection.ts`**: Selection and interaction system for organelles
- **`src/organelles/organelle-footprints.ts`**: Multi-hex footprint definitions and validation
- **`src/organelles/organelle-io-profiles.ts`**: Input/output specifications for organelle processing

### **Membrane & Transport Systems**
- **`src/membrane/membrane-exchange-system.ts`**: External environment exchange via membrane proteins
- **`src/membrane/membrane-port-system.ts`**: Membrane port management and coordination
- **`src/membrane/membrane-protein-registry.ts`**: Database of membrane protein types and functions

### **Species & Chemical Systems**
- **`src/species/species-registry.ts`**: Complete chemical species database and properties
- **`src/species/diffusion-system.ts`**: Chemical diffusion with 30Hz timestep and conservation
- **`src/species/heatmap-system.ts`**: Real-time concentration visualization system
- **`src/species/passive-effects-system.ts`**: Environmental effects (ATP decay, ROS accumulation)
- **`src/species/conservation-tracker.ts`**: Mass balance monitoring and simulation integrity

### **Graphics & Visual Systems**
- **`src/gfx/textures.ts`**: Procedural texture generation for grid, cells, and effects

---

## Milestone 13: Cytoskeleton Transport System Achievements

### **Complete Infrastructure Implementation**
✅ **Dual Filament System**: Actin (flexible, local transport) vs Microtubules (rigid, long-distance) with distinct biological properties  
✅ **Blueprint Construction**: Progressive filament building through resource consumption (AA for actin, PROTEIN for microtubules)  
✅ **MTOC Integration**: Microtubule organizing center with realistic nucleation rules and starter network generation  
✅ **Network Topology**: Automatic connectivity tracking and transport graph rebuilding  
✅ **Visual Construction System**: Dashed blueprint previews with circular progress indicators  

### **Advanced Transport Capabilities**
✅ **Graph-Based Routing**: Sophisticated pathfinding system with A* algorithms and capacity constraints  
✅ **Vesicle Integration**: Complete integration with existing vesicle transport for ER→Golgi→membrane pathway  
✅ **Capacity Management**: Realistic transport limits with bottleneck detection and flow optimization  
✅ **Edge Occupancy System**: Prevents deadlocks and maintains realistic movement constraints  

### **Interactive Building System**
✅ **Mode-Based Construction**: F1 (actin) / F2 (microtubules) mode switching with visual feedback  
✅ **Drag-and-Drop Placement**: Intuitive filament placement with real-time validation  
✅ **Resource Validation**: Prevents construction without sufficient materials  
✅ **ESC Cancellation**: Clean mode exit with preview cleanup  

### **Infrastructure Visualization**
✅ **Infrastructure Overlay**: Comprehensive visualization system (N key toggle)  
✅ **Utilization Display**: Real-time color-coded capacity usage  
✅ **Flow Arrows**: Directional indicators showing cargo movement  
✅ **Junction Activity**: Visual feedback at network connection points  
✅ **Speed Chevrons**: Animated indicators showing design transport speeds  

### **System Architecture Excellence**
✅ **Three-System Design**: CytoskeletonSystem (logic), CytoskeletonRenderer (visuals), FilamentBuilder (interaction)  
✅ **SystemObject Integration**: Follows established automatic lifecycle management pattern  
✅ **WorldRefs Integration**: Clean dependency injection through central interface  
✅ **Performance Optimization**: Efficient graph operations and selective rendering updates  

### **Biological Accuracy**
✅ **Realistic Construction Timing**: Progressive building matches biological assembly rates  
✅ **Material Requirements**: Accurate resource costs for actin vs microtubule construction  
✅ **Spatial Organization**: MTOC-centered microtubule networks with proper nucleation rules  
✅ **Transport Differentiation**: Actin for local flexibility, microtubules for long-range transport  

---

## Revolutionary Architecture: SystemObject Pattern

### **SystemObject Base Class** (`systems/system-object.ts`)
**Purpose**: Foundational architecture that eliminates manual system coordination

**Key Innovation:**
```typescript
export class SystemObject extends Phaser.GameObjects.GameObject {
  constructor(scene: Phaser.Scene, name: string, fn: (dt: number) => void) {
    super(scene, name)
    scene.add.existing(this) // Automatic registration into Phaser's update lifecycle
  }
  
  preUpdate(_time: number, delta: number) { 
    if (this._enabled) this.fn(delta / 1000) 
  }
}
```

**Revolutionary Benefits:**
- **Automatic Lifecycle Management**: Systems self-register with Phaser's built-in update system
- **No Manual Coordination**: Eliminates the "call update on 12 things" coordination dance
- **Clean Separation**: Each system is independently managed by Phaser
- **Easy Debugging**: Systems can be enabled/disabled individually
- **Memory Management**: Proper cleanup via Phaser's destroy() system

### **Consolidated Systems Architecture**

#### 1. **CellProduction System** (`systems/cell-production.ts`)
**Purpose**: Complete biological transcript and vesicle workflow from order to protein installation

**Responsibilities:**
- **Transcript Creation**: Nucleus-based transcription from installation orders
- **ER Processing**: Protein folding and packaging (3-second realistic timing)
- **Vesicle Management**: FSM-driven vesicle transport with 8 states (QUEUED_ER → EN_ROUTE_GOLGI → QUEUED_GOLGI → EN_ROUTE_MEMBRANE → INSTALLING → DONE)
- **Golgi Processing**: Vesicle glycosylation and enhancement at Golgi stations
- **Pathfinding System**: BFS pathfinding with capacity limits and jamming prevention
- **Membrane Installation**: Final protein activation with glycosylation effects
- **Visual Rendering**: Real-time vesicle movement with state-based colors and directional arrows
- **Performance Management**: 50-vesicle budget with automatic cleanup and telemetry
- **Proximity Enforcement**: Distance validation for Golgi and membrane interactions

**Key Innovation**: Single system handles entire secretory pathway (nucleus → ER → Golgi → membrane) with realistic vesicle transport and capacity constraints.

#### 2. **CellTransport System** (`systems/cell-transport.ts`)
**Purpose**: All cellular transport and diffusion processes

**Responsibilities:**
- **Organelle Updates**: Metabolic processing and resource transformation
- **Membrane Exchange**: External environment interaction via installed proteins
- **Chemical Diffusion**: 30Hz fixed-timestep species movement between tiles
- **Passive Effects**: Environmental changes (ATP decay, ROS accumulation)
- **Conservation Tracking**: Mass balance monitoring for simulation integrity
- **Performance Monitoring**: Real-time diffusion step tracking and metrics

**Key Innovation**: Consolidates 6+ transport-related systems into single cohesive unit with proper timestep management.

#### 3. **CellOverlays System** (`systems/cell-overlays.ts`)
**Purpose**: All visual overlays, UI feedback, and vesicle visualization systems

**Responsibilities:**
- **Heatmap Visualization**: Real-time concentration visualization
- **Blueprint Rendering**: Construction progress and validation feedback
- **Vesicle Overlays**: State-based vesicle colors, directional arrows, and movement visualization
- **Queue Indicators**: Visual badges showing vesicle counts at organelles (U key toggle)
- **Incoming Vesicle Pips**: Real-time indicators for vesicles approaching organelles (O key toggle)
- **Dirty Tile Optimization**: Set-based dirty tile tracking for efficient visual updates
- **UI Coordination**: Interface elements and visual feedback
- **Performance Optimization**: Efficient overlay updates with minimal redraw operations

**Architecture Benefits:**
- **Eliminated Manual Updates**: No more manual system.update() calls in game loop
- **Automatic Coordination**: Phaser manages update order and lifecycle
- **Clean Dependencies**: Systems access shared state via WorldRefs interface
- **Easy Extension**: New systems simply extend SystemObject
- **Performance Monitoring**: Built-in metrics for all consolidated systems
- **Bundle Optimization**: Reduced from 1,592 kB to 1,577 kB through consolidation

---

## Milestone 9-10: Cell Motility & Advanced Motility Modes System

**Revolutionary Achievement**: Complete reimplementation of cell locomotion into two major milestones:
- **Milestone 9**: Unified cell movement with consolidated visual transforms
- **Milestone 10**: Three biologically-grounded motility modes with substrate interactions

### **Milestone 9: Revolutionary CellRoot Container System**

**Purpose**: Unified visual transform system where all cell visual elements move together as a single entity

**Key Innovation**: 
- **CellRoot Container** (`cellRoot: Phaser.GameObjects.Container`) acts as parent for ALL cell visuals
- **Local Coordinate System**: (0,0) at center, all positions relative to cellRoot
- **Unified Movement**: Single transform drives hex grid, organelles, player, transcripts, vesicles, heatmaps, blueprints, overlays, and membrane effects
- **Drive Mode Toggle**: T key switches between normal player movement and unified cell locomotion

**Visual Elements in CellRoot:**
- Hex grid graphics and interaction highlights
- All organelles (graphics and text labels)
- Player actor and selection ring
- Transcript and vesicle rendering graphics
- Heatmap visualization
- Blueprint construction progress
- Membrane protein glyphs and transporter labels
- Queue badges and vesicle indicators
- Membrane ripple effects

### **Milestone 10: Advanced Motility Modes System**

#### **Three Biologically-Grounded Movement Modes**

**1. Amoeboid Mode** 🟢
- **Biology**: Cytoplasmic streaming locomotion like real amoebas
- **Mechanics**: High speed (75), moderate energy cost (0.15 ATP/s), best on soft substrates
- **Optimization**: Membrane deformation allows navigation through tight spaces
- **Best For**: Maze navigation, soft tissue environments

**2. Blebbing Mode** 🔵
- **Biology**: Pressure-driven membrane protrusions for rapid movement  
- **Mechanics**: Fastest speed (90), highest energy cost (0.25 ATP/s), excels in low-adhesion environments
- **Optimization**: Membrane pressure dynamics enable quick escapes
- **Best For**: Open spaces, escaping threats, low-adhesion surfaces

**3. Mesenchymal Mode** 🟣
- **Biology**: Adhesion-mediated crawling with cytoskeletal reorganization
- **Mechanics**: Slower speed (60), energy-efficient (0.1 ATP/s), optimal for structured substrates  
- **Optimization**: Strong substrate adhesion provides precise navigation
- **Best For**: Structured environments, energy conservation, precise movements

#### **Substrate Interaction Matrix**
```typescript
SUBSTRATE_SCALARS = {
    amoeboid:    { soft: 1.4, adhesive: 0.8, structured: 0.9 },
    blebbing:    { soft: 1.1, adhesive: 1.3, structured: 0.7 },
    mesenchymal: { soft: 0.9, adhesive: 1.2, structured: 1.4 }
}
```

#### **Configuration Architecture**
- **Single Source Configuration**: `motility-modes.config.ts` defines all parameters
- **Mode Registry**: `MotilityModeRegistry` handles switching and state management
- **Preset System**: Easy configuration switching for testing and balancing
- **Runtime Switching**: Dynamic mode changes with smooth transitions

#### **Enhanced User Interface**
- **Real-time Mode Display**: Current mode indicator with color-coded styling
- **Substrate Effects**: Live visualization of movement bonuses/penalties
- **Energy Monitoring**: Per-mode ATP consumption tracking with efficiency metrics
- **Performance Metrics**: Speed and substrate effectiveness indicators

#### **Motility Test Course**
- **Dedicated Test Environment**: Accessible via `M` key
- **Three Specialized Zones**:
  - **Soft Maze**: Narrow passages favoring amoeboid movement (yellow substrate)
  - **Low-Adhesion Runway**: Open straightaway optimized for blebbing speed (cyan substrate)
  - **ECM Chicanes**: Structured obstacles ideal for mesenchymal precision (magenta substrate)
- **Performance Timing**: Lap time tracking for objective mode comparison
- **Visual Feedback**: Clear zone boundaries and optimal path indicators

### **Core Locomotion Systems**

#### **CellSpaceSystem** (`core/cell-space-system.ts`)
**Purpose**: Single source of truth for cell's spatial relationship with external world

**Key Features:**
- **Transform Management**: Position, rotation, and scale of entire cell
- **Smooth Interpolation**: Lerp-based movement for fluid cell locomotion
- **Target System**: Separate target and current transforms for predictive movement
- **World Integration**: Converts between cell-local and world coordinates

#### **Enhanced CellMotility System** (`systems/cell-motility.ts`)
**Purpose**: Complete three-mode locomotion with substrate interactions and energy management

**Milestone 10 Enhancements:**
- **Three Movement Modes**: Amoeboid, blebbing, mesenchymal with distinct physics
- **Substrate Optimization**: Real-time movement modifier calculations
- **Mode Registry Integration**: Centralized mode switching and state management
- **Enhanced Energy System**: Mode-specific ATP consumption rates
- **Performance Telemetry**: Comprehensive movement analytics

**Legacy Features (Milestone 9):**
- **Polarity System**: Direction and magnitude-based cell orientation
- **Collision System**: Obstacle detection with normal vectors and collision damping
- **Membrane Deformation**: Visual squash effects during collisions

#### **Enhanced SubstrateSystem** (`core/substrate-system.ts`)
**Purpose**: Environment management with three substrate types for mode optimization

**Milestone 10 Enhancements:**
- **Three Substrate Types**: SOFT, ADHESIVE, STRUCTURED with distinct properties
- **Movement Modifier System**: Real-time substrate effect calculations
- **Visual Coding**: Color-coded substrate zones (yellow, cyan, magenta)
- **Performance Integration**: Substrate effectiveness feedback to UI

### **Complete Control System**

#### **Mode Controls (Milestone 10)**
- **1 Key**: Switch to Amoeboid mode (best for soft substrates)
- **2 Key**: Switch to Blebbing mode (best for low-adhesion)
- **3 Key**: Switch to Mesenchymal mode (best for structured substrates)
- **M Key**: Access motility test course for mode comparison

#### **Movement Controls (Milestone 9)**
- **T Key**: Toggle between normal player movement and unified cell locomotion
- **WASD**: In drive mode, controls cell movement instead of player
- **SPACE**: Dash ability (requires ATP, has cooldown)

#### **Development Tools**
- **Y Key**: System status including motility metrics and mode information
- **K Key**: Debug ATP injection for testing movement mechanics

### **Technical Implementation**

#### **File Structure**
```
src/
  motility/
    motility-modes.config.ts           # Central configuration and presets
    motility-mode-registry.ts          # Mode switching and state management
  systems/
    cell-motility.ts                   # Enhanced three-mode movement system
  scenes/
    motility-course-scene.ts           # Dedicated test environment
  core/
    substrate-system.ts                # Enhanced substrate management
  ui/hud.ts                           # Mode display and performance metrics
```

#### **Key Technical Achievements**
- **Biologically Accurate**: Each mode reflects real cellular locomotion mechanisms
- **Performance Optimized**: Efficient substrate calculations with minimal overhead
- **Highly Configurable**: Easy parameter tuning through centralized configuration
- **Extensible Architecture**: Framework supports additional modes and substrates
- **Visual Polish**: Comprehensive UI feedback and real-time performance metrics
- **Unified Visual System**: All components move together through cellRoot container

---

## Project Structure

### Core Entry Points
- **`main.ts`**: Phaser 3 game initialization and configuration
- **`vite-env.d.ts`**: Vite TypeScript environment declarations

### **Modular Architecture** (`actors/`, `controllers/`)

#### **Player Actor** (`actors/player.ts`)
**Purpose**: Encapsulated player behavior with physics and interaction

**Key Features:**
- **Phaser Container**: Extends Phaser.GameObjects.Container for proper lifecycle
- **Physics Integration**: Arcade physics with acceleration/deceleration
- **Dash Mechanics**: Speed boost with cooldown management  
- **Membrane Constraints**: Cell boundary collision detection with visual ripple effects
- **Hex Grid Integration**: Current tile tracking and coordinate conversion
- **Transcript Interaction**: Pickup/carry mechanics for protein transport
- **Visual Management**: Player sprite and selection ring rendering
- **CellRoot Integration**: Membrane ripple effects positioned within unified cell coordinate system

#### **TileActionController** (`controllers/tile-action-controller.ts`)
**Purpose**: Centralized tile-based interaction management

**Key Features:**
- **Build Mode Coordination**: Construction interface and placement validation
- **Protein Request Handling**: Membrane protein installation workflows
- **Input State Management**: Mode tracking (build, protein selection, etc.)
- **Order Generation**: Install order creation for protein production pipeline
- **Validation Logic**: Placement rules and prerequisite checking

### **Hotfix Epic: Unified Visual Transform System**

**Problem Solved**: Visual disconnection where hex grid moved but organelles, player, and overlays remained anchored to scene root

**Comprehensive Solution Phases:**
- **H1**: CellRoot container creation and initialization
- **H2**: Re-parenting all visual elements to cellRoot (hex graphics, player, organelles, overlays)
- **H3**: Unified transform driving through cellRoot.setPosition()
- **H4**: Camera centering and coordinate system fixes
- **H5**: Final visual element positioning (heatmap, blueprints, membrane effects, text labels)

**Technical Implementation:**
- **Local Coordinate System**: All positions now relative to cellRoot (0,0 at center)
- **Mouse Interaction Fix**: `localX = pointer.worldX - this.cellRoot.x` for proper hex detection
- **Visual Element Re-parenting**: Systematic addition to cellRoot for unified movement
- **Container Hierarchy**: Complete visual hierarchy under single cellRoot container

**Systems Modified:**
- **GameScene**: cellRoot creation, camera management, coordinate conversion
- **OrganelleRenderer**: Local coordinates, parentContainer support for labels
- **CellProduction**: Re-parented transcriptGraphics for transcript/vesicle rendering
- **CellOverlays**: Re-parented overlay graphics and dynamic text elements
- **HeatmapSystem**: parentContainer support for graphics
- **BlueprintRenderer**: parentContainer support for construction visuals
- **Player**: cellRoot reference for membrane ripple effects

---

## Milestone 13: Cytoskeleton Transport v1

**Revolutionary Achievement**: Complete cytoskeleton transport system with blueprint-based filament construction, enabling realistic actin and microtubule network building through gradual resource consumption.

### **Core Cytoskeleton Architecture**

#### **Three-System Implementation**

**1. CytoskeletonSystem** (`systems/cytoskeleton-system.ts`)
- **Purpose**: Core logic for filament networks, blueprints, upgrades, and validation
- **Blueprint Management**: FilamentBlueprint interface with progressive AA/PROTEIN consumption  
- **Network Topology**: Automatic network rebuilding and connectivity tracking
- **MTOC Integration**: Microtubule organizing center for realistic microtubule nucleation
- **Filament Rules**: Distinct placement and construction rules for actin vs microtubules
- **Starter Networks**: Automatic initialization of basic cytoskeleton near nucleus

**2. CytoskeletonRenderer** (`systems/cytoskeleton-renderer.ts`)  
- **Purpose**: Visual rendering with infrastructure overlay support
- **Filament Visualization**: Distinct actin (meandering, red) vs microtubule (straight, cyan) styles
- **Blueprint Rendering**: Dashed lines with progressive construction indicators
- **Progress Visualization**: Circular progress indicators showing AA/PROTEIN consumption
- **Infrastructure Overlay**: Utilization colors, flow arrows, junction activity (N key toggle)
- **Performance Optimization**: Efficient rendering with proper depth layering

**3. FilamentBuilder** (`systems/filament-builder.ts`)
- **Purpose**: Interactive drag-and-drop filament placement with validation
- **Blueprint Creation**: Creates construction blueprints instead of instant filaments
- **Placement Validation**: Enforces biological rules (microtubules from MTOC, actin flexibility)
- **Visual Feedback**: Real-time preview during drag placement
- **Cost Display**: Shows build requirements and validates placement constraints

### **Filament Blueprint System**

#### **Biological Construction Process**
```typescript
// Blueprint gradually consumes resources from tiles
interface FilamentBlueprint {
  progress: { AA: number; PROTEIN: number };
  required: { AA: number; PROTEIN: number };
  buildRatePerTick: number; // Actin: 2.0, Microtubules: 1.5
}
```

**Construction Workflow:**
1. **Placement**: Player drags to place filament blueprint (F1=actin, F2=microtubules)
2. **Resource Consumption**: Blueprint gradually consumes AA/PROTEIN from starting tile  
3. **Visual Progress**: Dashed line becomes more solid as construction progresses
4. **Completion**: When resources are satisfied, blueprint becomes actual filament segment
5. **Network Integration**: Completed segments automatically join cytoskeleton networks

#### **Filament Type Differences**

**Actin Filaments** 🔴
- **Cost**: 5 AA + 3 PROTEIN per segment
- **Build Rate**: 2.0 units/tick (faster construction)
- **Placement Rules**: Can start anywhere except MTOC, flexible connection points
- **Max Chain Length**: 8 segments per continuous filament
- **Visual Style**: Meandering lines with slight curves (organic appearance)
- **Biology**: Short, flexible filaments for local transport and cell shape

**Microtubules** 🔵  
- **Cost**: 8 AA + 12 PROTEIN per segment
- **Build Rate**: 1.5 units/tick (slower, more complex construction)
- **Placement Rules**: Must start from MTOC or existing microtubule  
- **Max Chain Length**: 20 segments per continuous filament
- **Visual Style**: Straight lines with plus-end tips (rigid highways)
- **Biology**: Long, rigid highways for fast long-distance transport

### **Advanced Features**

#### **Infrastructure Overlay System** (N Key)
- **Utilization Visualization**: Color-coded segments (green→yellow→red) based on cargo load
- **Flow Arrows**: Directional indicators showing active cargo movement
- **Junction Activity**: Visual badges showing upgrade connections and activity
- **Network Metrics**: Real-time display of network performance and capacity

#### **Blueprint Visualization**
- **Construction State**: Dashed lines indicate "under construction" status
- **Progress Indicators**: Small circular progress bars at blueprint midpoints
- **Resource Tracking**: Visual feedback showing AA vs PROTEIN consumption progress  
- **Completion Animation**: Smooth transition from dashed blueprint to solid filament

#### **Starter Cytoskeleton**
- **MTOC Placement**: Automatically positioned adjacent to nucleus  
- **Microtubule Spokes**: 3-5 short microtubule segments radiating from MTOC
- **Cortical Actin**: Sparse actin ring near cell periphery
- **Biological Accuracy**: Reflects real cell organization with organelle-cytoskeleton integration

### **User Interface & Controls**

#### **Construction Controls**
- **F1**: Switch to actin filament building mode
- **F2**: Switch to microtubule filament building mode  
- **ESC**: Cancel current filament placement
- **Mouse Drag**: Click and drag to place filament segments
- **N**: Toggle infrastructure overlay (utilization, flow, junctions)

#### **Visual Feedback**
- **Mode Indicator**: Toast notifications showing current filament type and costs
- **Preview Rendering**: Real-time preview during drag placement
- **Validation Errors**: Clear error messages for invalid placements
- **Construction Progress**: "Started building X segments" confirmation messages

---

## Milestone 12: Throw & Membrane Interactions v1

**Revolutionary Achievement**: Complete throw system implementation with charge-based aiming, projectile physics, boundary detection, and membrane trampoline interactions.

### **Core Throw Mechanics**

#### **ThrowSystem** (`systems/throw-system.ts`)
**Purpose**: Physics and visual rendering for charged projectile throws

**Key Features:**
- **Charge-Based Throwing**: Hold right mouse button or gamepad trigger to charge throw (1.5 second max)
- **Visual Feedback**: Trajectory preview with charge-based thickness and brightness
- **Projectile Physics**: Realistic projectile creation with speed based on charge level
- **Boundary Detection**: Prevents projectiles from leaving the cellular environment
- **State Management**: AimState interface with chargeLevel, target position, and visual elements

**Technical Implementation:**
- **Charge System**: 0-1 charge level affects throw speed and visual feedback
- **Trajectory Rendering**: Dynamic arc preview showing throw path with visual charge indicators
- **Coordinate Conversion**: Proper world-to-cell-local coordinate transformation
- **Physics Integration**: Uses effectivePower calculated from charge level for realistic throws

#### **ThrowInputController** (`systems/throw-input-controller.ts`)
**Purpose**: Input handling for charge-based throwing with mouse and gamepad support

**Key Features:**
- **Mouse Controls**: Right mouse button hold-to-charge with mouse cursor aiming
- **Gamepad Support**: Right bumper (R1) charging with right stick aiming
- **Coordinate System**: Proper mouse coordinate conversion to cell-local space
- **Input Conflict Resolution**: Disabled keyboard input when mouse is active to prevent conflicts
- **Minimum Hold Time**: 50ms minimum to prevent accidental immediate throws

**Visual Feedback:**
- **Cargo Indicator Rotation**: Cargo rotates around player based on aim direction
- **Charge-Based Scaling**: Cargo indicator grows with charge level
- **Trajectory Preview**: Real-time arc showing throw direction and power

#### **UnifiedCargoSystem** (`systems/unified-cargo-system.ts`)
**Purpose**: Complete cargo management system for picking up, carrying, and throwing objects

**Key Features:**
- **Cargo State Management**: Tracks what player is carrying and cargo position
- **Pickup System**: Ability to pick up thrown cargo and other objects
- **Throw Integration**: Seamless integration with throw system for cargo release
- **State Persistence**: Maintains cargo state across throw attempts

#### **MembraneTrampoline** (`systems/membrane-trampoline.ts`)
**Purpose**: Realistic membrane physics for projectile interactions

**Key Features:**
- **Bounce Physics**: Projectiles bounce off membrane boundaries with realistic physics
- **Velocity Conservation**: Proper momentum transfer during membrane collisions
- **Visual Effects**: Membrane ripple effects at impact points
- **Boundary Enforcement**: Prevents projectiles from escaping the cellular environment

### **User Interface & Controls**

#### **Throw Controls**
- **Right Mouse Button**: Hold to charge throw, aim with mouse cursor movement
- **Mouse Movement**: Aim direction while charging (cargo indicator rotates to show direction)
- **Gamepad R1**: Alternative throw charging for gamepad users
- **Gamepad Right Stick**: Aiming direction for gamepad throwing

#### **Visual Feedback System**
- **Trajectory Preview**: Shows throw arc with charge-based visual intensity
- **Cargo Indicator**: Rotates around player to show throw direction, scales with charge
- **Charge Level Display**: Visual feedback through trajectory thickness and cargo scaling
- **Toast Messages**: Displays charge percentage and throw feedback

### **Technical Achievements**

#### **Coordinate System Mastery**
- **World-to-Cell Conversion**: Proper coordinate transformation using cellRoot offset
- **Mouse Coordinate Handling**: Fixed spazzing issue with clean coordinate conversion pipeline
- **Unified Transform**: All throw elements work seamlessly with cellRoot container system

#### **Input System Integration**
- **Conflict Resolution**: Eliminated keyboard/mouse input conflicts
- **Event Timing**: Proper event handling with minimum hold times
- **Cross-Platform Support**: Works with mouse, keyboard, and gamepad inputs

#### **Physics & Rendering**
- **Projectile System**: Complete physics simulation for thrown objects
- **Boundary Detection**: Robust system preventing projectiles from leaving game area
- **Visual Polish**: Smooth animations, charge feedback, and trajectory previews

### **Milestone 12 Controls Summary**
- **Right Mouse**: Hold to charge throw, move mouse to aim
- **Release Mouse**: Execute throw at current charge level
- **Q/E Keys**: Pick up and drop cargo (existing inventory system)
- **Gamepad R1**: Alternative throw charging
- **Gamepad Right Stick**: Aiming for gamepad users

### **Integration with Existing Systems**
- **Player System**: Cargo indicator positioning and rotation during aiming
- **CellRoot Container**: All throw visuals properly integrated with unified transform system
- **Inventory System**: Seamless integration with existing Q/E pickup/drop mechanics
- **Physics System**: Proper collision detection and boundary enforcement
- **Visual System**: Trajectory preview and charge feedback rendered at correct depths

---

### **Core Data Systems**

#### **Species Registry System** (`species/`)
**Purpose**: Centralized management of all chemical species in the cellular environment

**Key Files:**
- **`species-registry.ts`**: Core species definitions with strict typing
  - **Union Type**: `SpeciesId` (13 species: ATP, AA, NT, ROS, GLUCOSE, PRE_MRNA, PROTEIN, CARGO, LIPID, H2O, CO2, SIGNAL, LIGAND_GROWTH)
  - **Species Data**: Each species has diffusion coefficients, concentration limits, colors
  - **Helper Functions**: `getAllSpeciesIds()`, `createEmptyConcentrations()`, etc.
  - **New Species**: SIGNAL (intracellular signaling), LIGAND_GROWTH (external growth factors)

- **`diffusion-system.ts`**: Chemical diffusion between hex tiles
  - **Two-buffer system** prevents order bias in diffusion calculations
  - **Species-specific diffusion rates** based on molecular properties
  - **Stable numerical integration** for concentration gradients

- **`heatmap-system.ts`**: Real-time concentration visualization
  - **Color-coded heatmaps** for each species type
  - **Interactive cycling** through different species views
  - **Overlay rendering** on hex grid

- **`passive-effects-system.ts`**: Global environmental effects
  - **ATP decay simulation** (cellular energy consumption)
  - **ROS accumulation** (oxidative stress modeling)
  - **Configurable rates** per species

- **`conservation-tracker.ts`**: Mass conservation debugging
  - **Total species tracking** across entire grid
  - **Rate change monitoring** to detect simulation errors
  - **Real-time conservation statistics** with getAllConservationData() API

#### **Hex Grid System** (`hex/`)
**Purpose**: Spatial foundation using axial coordinate system

**Key Files:**
- **`hex-grid.ts`**: Complete hexagonal grid implementation
  - **Axial Coordinates**: `{q, r}` coordinate system for hex tiles
  - **Species Concentrations**: Each tile stores `Record<SpeciesId, number>`
  - **Membrane Detection**: Automatic boundary tile identification
  - **Coordinate Conversion**: Hex ↔ world position transforms
  - **Neighbor Finding**: Efficient adjacent tile lookups
  - **Circular Filtering**: Cell boundary constraints
  - **Membrane Tagging**: Dynamic membrane tile identification for exchange system

#### **Organelle System** (`organelles/`)
**Purpose**: Cellular machinery that processes species through metabolic pathways

**Key Files:**
- **`organelle-registry.ts`**: Centralized organelle definitions
  - **Union Type**: `OrganelleType` (9 types: nucleus, ribosome-hub, proto-er, golgi, peroxisome, membrane-port, transporter, receptor, secretion-pump)
  - **Organelle Properties**: Size, color, footprint, build costs, throughput caps
  - **Golgi Integration**: New Golgi organelle type supporting vesicle processing and glycosylation
  - **Starter Placements**: Initial organelle configurations
  - **Build Integration**: Links with construction system

- **`organelle-footprints.ts`**: Multi-hex organelle shapes
  - **Union Type**: `FootprintName` (5 patterns: SINGLE, NUCLEUS_LARGE_DISK, RIBOSOME_HUB_SMALL, PROTO_ER_BLOB, MEDIUM_DISK)
  - **Footprint Definitions**: Relative hex coordinate patterns
  - **Placement Validation**: Collision detection and boundary checking
  - **Center Offsets**: Proper positioning calculations

- **`organelle-io-profiles.ts`**: Metabolic pathway definitions
  - **Input/Output Specs**: What each organelle consumes and produces
  - **Processing Rates**: Species throughput per simulation tick
  - **Priority System**: Execution order for resource competition
  - **Biological Accuracy**: Nucleus (transcription), Ribosomes (translation), ER (protein processing)
  - **Signal-Driven Bonuses**: Organelles respond to SIGNAL species
    - **Nucleus Enhancement**: Increased pre-mRNA production when SIGNAL is present
    - **Coefficient System**: Configurable multipliers for signal effects
    - **Max Bonus Caps**: Prevents runaway production from signal feedback

- **`organelle-system.ts`**: Main organelle processing engine
  - **Priority-based Processing**: Lower priority number = higher priority
  - **Resource Competition**: Limited inputs affect processing rates
  - **Multi-hex Support**: Organelles spanning multiple tiles
  - **Throughput Tracking**: Real-time processing statistics
  - **Species Conservation**: Input consumption and output production
  - **Dynamic Creation**: Support for blueprint completion spawning

- **`organelle-renderer.ts`**: Visual representation system
  - **Multi-hex Rendering**: Complex organelle shapes
  - **Dynamic Colors**: Organelle-specific color coding
  - **Labels and Outlines**: Visual identification aids
  - **Depth Management**: Proper layering with other game elements
  - **Immediate Updates**: Re-render when organelles are created/removed

- **`organelle-selection.ts`**: Interactive selection system
  - **Hover Effects**: Visual feedback for mouse interaction
  - **Selection State**: Track currently selected organelle
  - **Multi-hex Selection**: Handle complex organelle shapes
  - **UI Integration**: Connect with information panels

#### **Construction System** (`construction/`)
**Purpose**: Building new organelles through resource-based construction

**Key Files:**
- **`construction-recipes.ts`**: Build recipes and requirements
  - **Recipe Definitions**: What resources are needed to build each organelle
  - **Footprint Integration**: Links with organelle footprint system
  - **Membrane Constraints**: Some structures (transporters) only buildable on membrane
  - **Cytosol Constraints**: Regular organelles only buildable in interior
  - **Build Rates**: How fast construction proceeds

- **`blueprint-system.ts`**: Construction management
  - **Placement Validation**: Check if construction is possible at location
  - **Progress Tracking**: `Record<SpeciesId, number>` for resource contributions
  - **Resource Consumption**: Pull required species from nearby tiles
  - **Player Contributions**: Accept direct resource deposits from player
  - **Completion Detection**: Automatic organelle spawning when finished
  - **Cancellation Support**: Refund resources when construction cancelled

- **`blueprint-renderer.ts`**: Visual construction feedback
  - **Ghost Visuals**: Show planned organelle placement
  - **Progress Indicators**: Visual construction progress
  - **Validation Feedback**: Show placement errors
  - **Animation Effects**: Construction progress animations

- **`build-palette-ui.ts`**: Construction interface
  - **Recipe Selection**: Choose what to build
  - **Cost Display**: Show resource requirements
  - **Category Filtering**: Membrane vs cytosol structures
  - **Visual Feedback**: Highlight selected recipes

#### **Player System** (`player/`)
**Purpose**: Player resource management and interaction

**Key Files:**
- **`player-inventory.ts`**: Resource carrying system
  - **Inventory Storage**: `Partial<Record<SpeciesId, number>>` for carried resources
  - **Capacity Management**: Limited carrying capacity with load tracking
  - **Take/Drop Operations**: Resource pickup and deposit mechanics
  - **Resource Validation**: Ensure valid species types
  - **Cleanup Logic**: Remove zero-amount entries

#### **Membrane System** (`membrane/`)
**Purpose**: Cell boundary transport and exchange with environment

**Key Files:**
- **`membrane-exchange-system.ts`**: External resource exchange and protein management
  - **Membrane Transporters**: Protein structures that import/export species
  - **External Concentrations**: Constant external environment (glucose, ROS, H2O, CO2)
  - **Flux Calculations**: Import/export rates based on transporter properties
  - **Membrane Constraints**: Only membrane tiles can have transporters
  - **Transport Statistics**: Track total imports and exports
  - **Receptor System**: Growth factor receptors that convert external ligands to internal signals
  - **Protein Installation**: Dynamic membrane protein installation system
  - **Future Integration**: Hooks for secretory pathway (ER → Golgi → membrane)

- **`membrane-protein-registry.ts`**: Membrane protein definitions and behaviors
  - **Protein Types**: Transporters (directional flux) and Receptors (ligand detection)
  - **Transporter Proteins**: 5 types (GLUT, AA_TRANSPORTER, NT_TRANSPORTER, ROS_EXPORTER, SECRETION_PUMP)
  - **Receptor Proteins**: Growth Factor Receptor (LIGAND_GROWTH → SIGNAL conversion)
  - **Transport Directions**: Bidirectional import/export capabilities
  - **Rate Specifications**: Species-specific transport rates per simulation tick
  - **Visual Integration**: Color coding for different protein types

#### **Graphics System** (`gfx/`)
**Purpose**: Visual assets and rendering utilities

**Key Files:**
- **`textures.ts`**: Procedural texture generation
  - **Grid Textures**: Hex grid overlays with major/minor lines
  - **Cell Textures**: Circular cell membrane visualization

### **Core System Integration** (`core/world-refs.ts`)
**Purpose**: Centralized system references and shared state management

**Key Components:**
- **System References**: Access to all major systems (hex grid, organelles, membrane, species, motility)
- **CellRoot Container**: Unified visual transform container for all cell elements
- **Data Sharing**: Maps for transcripts, vesicles, install orders with shared access
- **Milestone 9 Integration**: CellSpaceSystem, SubstrateSystem, and CellMotility references
- **UI Callbacks**: Toast messages and tile information refresh functions
  - **Ring Textures**: Selection and highlight indicators
  - **Dot Textures**: Small visual markers
  - **Station Textures**: Organelle-specific symbols

#### **UI System** (`ui/`)
**Purpose**: User interface and information display

**Key Files:**
- **`hud.ts`**: Heads-up display system
  - **Control Instructions**: Movement and interaction help
  - **Dynamic Messages**: Context-sensitive information
  - **Screen-space Rendering**: UI elements that don't scroll with camera
  - **Transcript Status**: Display current orders and transcript counts
  - **Protein Production Status**: Show active membrane protein requests

#### **Core Integration** (`core/`)
**Purpose**: Central interfaces and shared state management

**Key Files:**
- **`world-refs.ts`**: Unified system interface (cleaned up post-consolidation)
  - **Streamlined Interface**: Removed dependencies on old individual systems
  - **Shared State**: InstallOrder and Transcript data structures
  - **System References**: Access to diffusion, passive effects, conservation tracker
  - **UI Callbacks**: Toast notifications and tile info refresh methods
  - **Modern Architecture**: Supports consolidated SystemObject pattern

#### **Game Scene** (`scenes/`)
**Purpose**: Orchestration layer using consolidated systems

**Key Files:**
- **`game-scene.ts`**: Dramatically simplified game orchestration (~1,850 lines vs previous 2,400+)
  - **SystemObject Integration**: Three consolidated systems auto-managed by Phaser
  - **Simplified Update Loop**: Manual coordination eliminated
  - **Input Handling**: Player movement, selection, building via modular controllers
  - **Visual Management**: Hex grid, heatmaps, selection highlights
  - **Debug Features**: Y key system status with species tracking and change rates
  - **Performance Monitoring**: Consolidated systems report 120 updates/sec
  - **Cleaned Architecture**: Removed 500+ lines of unused legacy methods
---

## Revolutionary Technical Achievements

### **SystemObject Architecture Revolution**
- **Eliminated Manual Coordination**: Removed 500+ lines of manual system.update() calls
- **Automatic Lifecycle Management**: Phaser's built-in update system manages all consolidated systems
- **Performance Optimization**: 120 updates/sec across all systems with built-in monitoring
- **Bundle Size Reduction**: From 1,592 kB to 1,577 kB through system consolidation
- **Clean Dependencies**: Systems communicate via well-defined WorldRefs interface
- **Easy Debugging**: Y key provides comprehensive system status with species change rates

### **Consolidated Biological Workflows**
- **CellProduction**: Handles complete protein production pipeline (nucleus → ER → vesicle → membrane)
- **CellTransport**: Manages all cellular transport (organelles, diffusion, membrane exchange)
- **CellOverlays**: Coordinates all visual feedback and UI overlays
- **Unified State Management**: Shared data structures eliminate duplication and synchronization issues

### Type Safety Excellence
- **Comprehensive Union Types**: `SpeciesId`, `OrganelleType`, `FootprintName`, `ProteinId` replace generic strings
- **Record Types**: `Record<SpeciesId, number>` for concentrations, `Partial<Record<SpeciesId, number>>` for optional data
- **Helper Functions**: Type-safe utilities like `createEmptyProgressRecord()`, `getSpeciesKeysFromPartialRecord()`
- **Interface Evolution**: Rich interfaces for InstallOrder, Transcript with state machines
- **No Type Casting**: Proper type design eliminates need for unsafe casts

### Performance Optimizations
- **SystemObject Efficiency**: Automatic Phaser lifecycle eliminates manual coordination overhead
- **Two-Buffer Diffusion**: Eliminates order bias and enables parallelization
- **Spatial Indexing**: Efficient hex coordinate mapping with string keys
- **Selective Updates**: Only process active organelles and changed tiles
- **Memory Management**: Cleanup zero-amount entries and unused structures
- **Real-time Monitoring**: Built-in performance tracking with 5-second logging intervals

### Biological Accuracy & Realism
- **Realistic Metabolic Pathways**: Nucleus (DNA→mRNA), Ribosomes (mRNA+AA→Protein), ER (Protein→Cargo)
- **Diffusion Physics**: Species-specific molecular diffusion rates
- **Conservation Laws**: Mass tracking and conservation validation
- **Membrane Biology**: Selective permeability and active transport
- **Signal Transduction**: Growth factor receptors converting external ligands to internal signals
- **Transcriptional Regulation**: Signal-driven enhancement of gene expression
- **Membrane Protein Diversity**: Multiple transporter types with directional specificity
- **Protein Production Pipeline**: Realistic multi-stage process from order to installation
- **Biological Timing**: ER processing (3s), vesicle transport (1.5 hex/s), membrane integration (2s)
- **Cellular Communication**: Orders → transcripts → processing → delivery lifecycle

### Advanced State Management
- **Multi-Stage Processing**: Transcript state machine with 4 distinct phases
- **Real-Time Coordination**: Synchronization between nucleus transcription and membrane installation
- **Dynamic Protein Installation**: Runtime membrane protein placement system
- **Order-Driven Production**: Request-based protein manufacturing replacing instant placement
- **Realistic Delays**: Biologically accurate timing for cellular processes
- **Visual Movement**: Gradual transcript and vesicle movement across the cell

### Debugging Infrastructure
- **Conservation Tracking**: Monitor total species amounts with getAllConservationData() API
- **Visual Debugging**: Heatmaps, selection highlights, membrane visualization
- **Info Panels**: Real-time organelle status and processing statistics
- **Logging System**: Comprehensive console output for system events
- **Transcript Tracking**: Monitor order fulfillment and production pipeline status
- **Performance Monitoring**: Real-time throughput and processing metrics (120 updates/sec)
- **Y Key Debug Command**: Comprehensive system status including species change rates

### Revolutionary Architecture Benefits
- **"Calm, Minimal Path Forward"**: Achieved through elimination of manual coordination
- **Automatic System Management**: Phaser handles all lifecycle, update order, and cleanup
- **Clean Separation**: Each system is independently testable and debuggable
- **Easy Extension**: New systems simply extend SystemObject base class
- **No "Folder Explosion"**: Three consolidated systems replace 12+ individual systems
- **Performance Transparency**: Built-in monitoring shows exactly what each system is doing

---

## Data Flow: Consolidated Architecture

### **Automatic Update Cycle (Phaser Managed):**
1. **CellProduction System** (automatically updated by Phaser):
   - Nucleus transcription from orders
   - ER processing (3s timing)
   - Vesicle transport across cell
   - Membrane protein installation
   - Transcript visual rendering

2. **CellTransport System** (automatically updated by Phaser):
   - Organelle metabolic processing
   - Membrane exchange with environment
   - 30Hz fixed-timestep diffusion
   - Passive effects (ATP decay, ROS)
   - Conservation tracking

3. **CellOverlays System** (automatically updated by Phaser):
   - Heatmap visualization updates
   - Blueprint rendering
   - UI overlay coordination

4. **Manual Updates** (still required):
   - Player movement and physics
   - Input handling and mode management
   - Blueprint construction progress
   - UI element positioning

### **Vesicle Production Pipeline** (CellProduction System):
```
Install Order → Nucleus Transcription → Transcript Created → Travels to ER →
ER Processing (3s) → Vesicle Creation → QUEUED_ER → EN_ROUTE_GOLGI → QUEUED_GOLGI →
Golgi Processing → EN_ROUTE_MEMBRANE → INSTALLING → Membrane Installation → DONE
```

### **Vesicle State Flow**:
```
QUEUED_ER → EN_ROUTE_GOLGI → QUEUED_GOLGI → EN_ROUTE_MEMBRANE → INSTALLING → DONE
     ↓              ↓               ↓               ↓              ↓
   BLOCKED ←—————————————————————————————————————————————————————
```

### **Glycosylation Effects**:
```
ER Processing → Partial Glycosylation (50% throughput) →
Golgi Processing → Complete Glycosylation (100% throughput) →
Membrane Installation → Active Protein with Full Efficiency
```

### **Resource Flow** (CellTransport System):
```
External Environment → Membrane Transporters → Hex Tiles → Organelles → Products
        ↓                      ↑                              ↑
External Ligands → Receptors → SIGNAL → Enhanced Organelle Activity
                              ↑
                         Player Inventory
                              ↓
                        Construction Blueprints
```

### **Signal Transduction Flow**:
```
LIGAND_GROWTH (external) → Growth Factor Receptor → SIGNAL (internal) → Nucleus Transcription Boost → Enhanced PRE_MRNA Production
```

### **Transcript State Flow**:
```
'traveling' → 'processing_at_er' → 'packaged_for_transport' → 'installing_at_membrane' → Protein Active
```

---

## Current Milestone Status

The project has achieved **revolutionary architectural consolidation** while completing **Milestone 10** with advanced motility modes system:

### ✅ **REVOLUTIONARY ACHIEVEMENT: SystemObject Consolidation**
- **Eliminated Manual Coordination**: No more "call update on 12 things" dance
- **Automatic Lifecycle Management**: Phaser manages all consolidated systems
- **Code Reduction**: Removed 500+ lines of unused legacy methods from game-scene.ts
- **Bundle Optimization**: Reduced bundle size from 1,592 kB to 1,577 kB
- **Performance Monitoring**: Built-in 120 updates/sec tracking across all systems
- **Debug Excellence**: Y key provides comprehensive system status with species change rates
- **Clean Dependencies**: Streamlined WorldRefs interface removing old system dependencies

### ✅ **Milestone 10: Advanced Motility Modes v1**
- **Three Biological Movement Modes**: Amoeboid, Blebbing, Mesenchymal with distinct physics and energy costs
- **Substrate Optimization System**: Real-time movement modifiers based on substrate type (soft, adhesive, structured)
- **Configuration Architecture**: Centralized `motility-modes.config.ts` with preset system for easy parameter tuning
- **Mode Registry Pattern**: `MotilityModeRegistry` handles state management and smooth mode transitions
- **Enhanced User Interface**: Real-time mode display, substrate effects visualization, and energy monitoring
- **Motility Test Course**: Dedicated test environment with three specialized zones optimizing different modes
- **Performance Telemetry**: Comprehensive movement analytics with speed, efficiency, and substrate effectiveness metrics
- **User Controls**: 1/2/3 keys for mode switching, M key for test course access
- **Biological Accuracy**: Each mode reflects real cellular locomotion mechanisms with appropriate energy costs

### ✅ **Milestone 9: Cell Motility & Unified Visual Transform**
- **CellRoot Container System**: All cell visuals move together as unified entity through single transform
- **Enhanced CellMotility System**: Complete locomotion with polarity, adhesion, and substrate interaction
- **Drive Mode Toggle**: T key switches between player movement and unified cell locomotion
- **Collision Physics**: Proper obstacle detection with membrane deformation effects
- **Energy Integration**: ATP costs for movement, dash abilities, and adhesion maintenance
- **Visual Coherence**: All organelles, membrane effects, and overlays move together seamlessly

### ✅ **Milestone 8: Visible Secretory Pipeline & Membrane Install v1**
- **Vesicle FSM System**: Complete finite state machine with 8 states (QUEUED_ER → EN_ROUTE_GOLGI → QUEUED_GOLGI → EN_ROUTE_MEMBRANE → INSTALLING → DONE)
- **Golgi Integration**: Added Golgi organelle type with vesicle processing capabilities
- **Pathfinding with Capacity**: BFS pathfinding with per-tile capacity limits (max 2 vesicles) and jamming prevention
- **Glycosylation Effects**: Partial (50% throughput) vs complete (100% throughput) glycosylation states affecting membrane protein efficiency
- **Visual Overlay System**: State-based vesicle colors, directional arrows, queue badges, and incoming vesicle indicators
- **Performance Guardrails**: Maximum 50 vesicles with automatic cleanup and comprehensive telemetry
- **External Interface**: MembranePortSystem scaffolding and stable APIs for future extensibility
- **Proximity Enforcement**: Distance validation for Golgi and membrane interactions (1 hex range)
- **Dirty Tile Optimization**: Set-based dirty tile tracking for efficient visual updates
- **User Controls**: U key (queue overlays), O key (vesicle indicators) for debug visualization

### ✅ **Milestone 7: Orders & Transcripts (Protein Production Pipeline)**
- **Install Order System**: Request-based protein production replacing instant placement
- **Nucleus Transcription**: Dynamic transcript creation based on membrane protein orders
- **Multi-Stage Processing**: Realistic transcript lifecycle with state machine
- **Player Interaction**: Transcript pickup, carry, and delivery mechanics
- **Visual Movement**: Gradual transcript and vesicle movement across cellular space
- **Biological Timing**: Realistic delays for ER processing, transport, and installation

### ✅ **Milestone 6: Membrane Transport & Signaling**
- **Membrane detection system** (automatic boundary identification)
- **Membrane exchange system** (external resource transport via installed proteins)
- **Membrane protein registry** (transporters and receptors with specialized functions)
- **Membrane-specific construction** (transporters, receptors, ports)
- **Build constraints** (membrane-only vs cytosol-only structures)
- **Signal transduction pathways** (receptor-mediated signaling)
- **Signal-driven organelle enhancement** (transcriptional regulation)
- **Dynamic protein installation** (runtime membrane protein placement)

### ✅ **Previous Milestones (Fully Implemented)**
- **M1**: Basic hex grid and movement
- **M2**: Species diffusion and passive effects  
- **M3**: Organelle system and metabolic processing
- **M4**: Player inventory and resource management
- **M5**: Construction and blueprint system

### 🚀 **Ready for Future Milestones**
- **M11**: Advanced organelle types (mitochondria, lysosomes, enhanced Golgi functions)
- **M12**: Cell division and growth mechanics
- **M13**: Multi-cellular interactions and tissue formation
- **M14**: Genetic regulation and adaptation systems

### **Revolutionary Architectural Achievements**
- **SystemObject Pattern**: Revolutionary base class enabling automatic Phaser lifecycle management
- **Consolidated Systems**: Three main systems replace 12+ individual systems
- **Manual Coordination Elimination**: No more manual system.update() calls in game loop
- **Bundle Optimization**: Smaller, cleaner codebase with better performance
- **Performance Monitoring**: Built-in 120 updates/sec tracking with 5-second logging
- **Debug Excellence**: Y key system status with comprehensive species tracking
- **Clean Architecture**: "Calm, minimal path forward" achieved through consolidation

---

## Development Patterns & Architecture

### **SystemObject Pattern** (Revolutionary):
```typescript
// Old way: Manual coordination nightmare
class GameScene {
  update() {
    this.system1.update(delta);
    this.system2.update(delta);
    // ... 12+ more systems
  }
}

// New way: Automatic Phaser lifecycle
class CellProduction extends SystemObject {
  constructor(scene, worldRefs) {
    super(scene, 'CellProduction', (dt) => this.update(dt));
    // Automatically registers with Phaser's update system
  }
}
```

### **Consolidated System Benefits**:
- **Single Responsibility**: Each system has one clear biological purpose
- **Automatic Management**: Phaser handles lifecycle, update order, cleanup
- **Performance Monitoring**: Built-in metrics for debugging and optimization
- **Easy Debugging**: Systems can be enabled/disabled individually
- **Clean Dependencies**: Well-defined WorldRefs interface

### **Type-First Design**:
- **Registry Pattern**: Central databases for species, organelles, recipes, membrane proteins
- **Union Types**: Compile-time validation for all major data types
- **Interface Segregation**: Small, focused interfaces
- **Composition**: Systems composed together via dependency injection

### **Error Handling & Robustness**:
- **Validation Functions**: Check preconditions before operations
- **Graceful Degradation**: Continue simulation even with missing data
- **Console Logging**: Extensive debugging information with appropriate detail levels
- **Type Safety**: Prevent errors at compile time
- **State Consistency**: Ensure transcript states remain valid throughout lifecycle

### **Performance Excellence**:
- **SystemObject Efficiency**: Automatic lifecycle eliminates coordination overhead
- **Map-based Lookups**: O(1) tile access by coordinate
- **Efficient Algorithms**: Optimized diffusion and neighbor finding
- **Memory Pooling**: Reuse objects where possible
- **Selective Processing**: Only update what changed
- **Built-in Monitoring**: Real-time performance tracking (120 updates/sec)

### **Biological Accuracy**:
- **Multi-Stage Processing**: Realistic cellular protein production timeline
- **Spatial Organization**: Proper nucleus → ER → membrane pathway
- **Timing Accuracy**: Biologically plausible processing delays
- **Resource Conservation**: Mass balance in all transformations
- **Signal Integration**: Receptor-mediated enhancement of cellular processes

---

## Summary: Revolutionary Achievement

This codebase demonstrates a **revolutionary architectural transformation** from manual system coordination to automatic Phaser lifecycle management, culminating in **advanced biological motility modes**. The **SystemObject pattern** combined with sophisticated locomotion systems provides:

✅ **Simplified Architecture**: Three consolidated systems replace 12+ individual systems  
✅ **Performance Excellence**: 120 updates/sec with built-in monitoring  
✅ **Bundle Optimization**: Reduced size from 1,592 kB to 1,577 kB  
✅ **Debug Excellence**: Comprehensive Y key system status  
✅ **Advanced Secretory Pipeline**: Complete vesicle-based protein trafficking with FSM and visual feedback  
✅ **Vesicle System**: 8-state FSM with pathfinding, capacity limits, and glycosylation effects  
✅ **Visual Excellence**: Real-time vesicle movement, queue indicators, and state-based visualization  
✅ **Performance Guardrails**: 50-vesicle budget with automatic cleanup and comprehensive telemetry  
✅ **Biological Accuracy**: Realistic ER→Golgi→membrane secretory pathway with proper timing  
✅ **Type Safety**: Comprehensive union types and interfaces  
✅ **Clean Code**: Removed 500+ lines of unused legacy methods  
✅ **"Calm, Minimal Path Forward"**: Achieved through elimination of manual coordination

### **Milestone 13: Cytoskeleton Transport v1 Achievements**
✅ **Blueprint Construction System**: Filaments built gradually through resource consumption rather than instant placement  
✅ **Dual Filament Types**: Distinct actin (flexible, local) vs microtubule (rigid, long-distance) with unique costs and rules  
✅ **Progressive Resource Consumption**: AA and PROTEIN consumed from tiles at realistic rates (actin 2.0, microtubules 1.5 units/tick)  
✅ **MTOC Integration**: Microtubule organizing center with realistic nucleation rules and starter network generation  
✅ **Visual Construction Feedback**: Dashed blueprint lines with circular progress indicators showing build completion  
✅ **Biological Placement Rules**: Microtubules must start from MTOC, actin flexible placement, proper validation system  
✅ **Network Topology**: Automatic network rebuilding and connectivity tracking for completed filaments  
✅ **Infrastructure Overlay**: Real-time utilization visualization, flow arrows, and junction activity (N key toggle)  
✅ **Starter Cytoskeleton**: Automatic basic network initialization with MTOC placement and radiating spokes  
✅ **Interactive Building**: F1/F2 mode switching, drag-and-drop placement, ESC cancellation with real-time preview  
✅ **CytoskeletonSystem Integration**: Three-system architecture (System, Renderer, Builder) following established patterns  
✅ **Blueprint Visualization**: Smooth construction state transitions from dashed to solid with progress tracking  

### **Milestone 12: Throw & Membrane Interactions v1 Achievements**
✅ **Charge-Based Throw System**: Right mouse button hold-to-charge with 1.5 second charge time and visual feedback  
✅ **Mouse & Gamepad Controls**: Comprehensive input system with right mouse button and gamepad R1 charging  
✅ **Trajectory Preview System**: Real-time arc visualization with charge-based thickness and brightness feedback  
✅ **Coordinate System Mastery**: Fixed mouse coordinate conversion to eliminate aiming spazzing during movement  
✅ **Cargo Indicator Rotation**: Dynamic cargo positioning around player showing throw direction with charge scaling  
✅ **Projectile Physics**: Complete physics simulation with realistic speed calculation from charge level  
✅ **Boundary Detection**: Robust system preventing projectiles from leaving cellular environment  
✅ **Membrane Trampoline System**: Realistic bounce physics with membrane collision and velocity conservation  
✅ **Input Conflict Resolution**: Clean separation of mouse and keyboard inputs to prevent control conflicts  
✅ **Visual Polish**: Smooth animations, charge feedback, trajectory preview, and cargo state management  
✅ **CellRoot Integration**: All throw visuals properly integrated with unified container transform system  
✅ **Cross-Platform Support**: Seamless operation with mouse, keyboard, and gamepad input methods  

### **Milestone 10: Advanced Motility Modes Achievements**
✅ **Three Biological Movement Modes**: Amoeboid, Blebbing, Mesenchymal with distinct physics and energy costs  
✅ **Substrate Optimization Matrix**: Real-time movement modifiers for soft, adhesive, and structured substrates  
✅ **Configuration Architecture**: Single-source `motility-modes.config.ts` with preset system for parameter tuning  
✅ **Mode Registry Pattern**: Centralized state management with smooth transitions between locomotion modes  
✅ **Enhanced User Interface**: Real-time mode display, substrate effects visualization, and comprehensive energy monitoring  
✅ **Motility Test Course**: Dedicated test environment with three specialized zones (soft maze, low-adhesion runway, ECM chicanes)  
✅ **Performance Telemetry**: Movement analytics with speed, efficiency, and substrate effectiveness metrics  
✅ **Biological Grounding**: Each mode reflects real cellular locomotion mechanisms with appropriate energy costs  
✅ **User Controls**: Intuitive 1/2/3 keys for mode switching, M key for test course access  
✅ **Visual Feedback**: Color-coded mode indicators and real-time substrate effect visualization  

### **Milestone 9: Cell Motility Achievements**
✅ **Unified Visual Transform**: Complete cellRoot container system for seamless cell movement  
✅ **Cell Locomotion**: Full motility system with polarity, adhesion, and substrate interaction  
✅ **Drive Mode**: T key toggle between player movement and unified cell locomotion  
✅ **Coordinate System Unity**: All visual elements move together (grid, organelles, player, transcripts, vesicles, overlays, effects)  
✅ **Mouse Interaction Fix**: Proper coordinate conversion for hex tile detection during cell movement  
✅ **Membrane Effects**: Visual ripple effects properly positioned within cell coordinate system  
✅ **Performance Monitoring**: Real-time motility metrics (speed, polarity, adhesion, ATP drain)  
✅ **Collision System**: Realistic obstacle interaction with collision normals and damping  
✅ **Energy Integration**: ATP costs for movement, dash ability, and adhesion maintenance  

The project has achieved a **revolutionary biological simulation** with a solid, maintainable, and performant foundation. **Milestone 13** introduces a sophisticated cytoskeleton transport system with blueprint-based filament construction, enabling realistic actin and microtubule network building through progressive resource consumption. **Milestone 12** adds cellular interaction mechanics through charge-based projectile throwing with membrane physics, while **Milestone 10** completed biologically-grounded cellular locomotion with three distinct movement modes. Together, these systems provide a comprehensive framework for realistic cellular behavior, from precise locomotion control to dynamic object manipulation, membrane-mediated physics, and now cytoskeletal infrastructure development.
