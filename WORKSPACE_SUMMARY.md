# Cell Prototype - Workspace Summary

## Overview
This is a **cellular simulation game prototype** built with **TypeScript** and **Phaser 3**. The project implements a sophisticated biological cell simulation featuring:

- **Hexagonal grid-based cellular environment**
- **Multi-species chemical diffusion system**
- **Organelle placement and metabolic processing**
- **Construction/building system with blueprints**
- **Player inventory and resource management**
- **Membrane transport system**
- **Real-time visualization and interactive debugging**

The codebase is organized into modular systems following milestone-based development with comprehensive type safety using TypeScript union types.

---

## Project Structure

### Core Entry Points
- **`main.ts`**: Phaser 3 game initialization and configuration
- **`vite-env.d.ts`**: Vite TypeScript environment declarations

### Core Systems

#### 1. **Species Registry System** (`species/`)
**Purpose**: Centralized management of all chemical species in the cellular environment

**Key Files:**
- **`species-registry.ts`**: Core species definitions with strict typing
  - **Union Type**: `SpeciesId` (11 species: ATP, AA, NT, ROS, GLUCOSE, PRE_MRNA, PROTEIN, CARGO, LIPID, H2O, CO2)
  - **Species Data**: Each species has diffusion coefficients, concentration limits, colors
  - **Helper Functions**: `getAllSpeciesIds()`, `createEmptyConcentrations()`, etc.

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
  - **Real-time conservation statistics**

#### 2. **Hex Grid System** (`hex/`)
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

#### 3. **Organelle System** (`organelles/`)
**Purpose**: Cellular machinery that processes species through metabolic pathways

**Key Files:**
- **`organelle-registry.ts`**: Centralized organelle definitions
  - **Union Type**: `OrganelleType` (8 types: nucleus, ribosome-hub, proto-er, golgi, peroxisome, membrane-port, transporter, receptor)
  - **Organelle Properties**: Size, color, footprint, build costs, throughput caps
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

- **`organelle-system.ts`**: Main organelle processing engine
  - **Priority-based Processing**: Lower priority number = higher priority
  - **Resource Competition**: Limited inputs affect processing rates
  - **Multi-hex Support**: Organelles spanning multiple tiles
  - **Throughput Tracking**: Real-time processing statistics
  - **Species Conservation**: Input consumption and output production

- **`organelle-renderer.ts`**: Visual representation system
  - **Multi-hex Rendering**: Complex organelle shapes
  - **Dynamic Colors**: Organelle-specific color coding
  - **Labels and Outlines**: Visual identification aids
  - **Depth Management**: Proper layering with other game elements

- **`organelle-selection.ts`**: Interactive selection system
  - **Hover Effects**: Visual feedback for mouse interaction
  - **Selection State**: Track currently selected organelle
  - **Multi-hex Selection**: Handle complex organelle shapes
  - **UI Integration**: Connect with information panels

#### 4. **Construction System** (`construction/`)
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

#### 5. **Player System** (`player/`)
**Purpose**: Player resource management and interaction

**Key Files:**
- **`player-inventory.ts`**: Resource carrying system
  - **Inventory Storage**: `Partial<Record<SpeciesId, number>>` for carried resources
  - **Capacity Management**: Limited carrying capacity with load tracking
  - **Take/Drop Operations**: Resource pickup and deposit mechanics
  - **Resource Validation**: Ensure valid species types
  - **Cleanup Logic**: Remove zero-amount entries

#### 6. **Membrane System** (`membrane/`)
**Purpose**: Cell boundary transport and exchange with environment

**Key Files:**
- **`membrane-exchange-system.ts`**: External resource exchange
  - **Membrane Transporters**: Protein structures that import/export species
  - **External Concentrations**: Constant external environment (glucose, ROS, H2O, CO2)
  - **Flux Calculations**: Import/export rates based on transporter properties
  - **Membrane Constraints**: Only membrane tiles can have transporters
  - **Transport Statistics**: Track total imports and exports
  - **Future Integration**: Hooks for secretory pathway (ER → Golgi → membrane)

#### 7. **Graphics System** (`gfx/`)
**Purpose**: Visual assets and rendering utilities

**Key Files:**
- **`textures.ts`**: Procedural texture generation
  - **Grid Textures**: Hex grid overlays with major/minor lines
  - **Cell Textures**: Circular cell membrane visualization
  - **Ring Textures**: Selection and highlight indicators
  - **Dot Textures**: Small visual markers
  - **Station Textures**: Organelle-specific symbols

#### 8. **UI System** (`ui/`)
**Purpose**: User interface and information display

**Key Files:**
- **`hud.ts`**: Heads-up display system
  - **Control Instructions**: Movement and interaction help
  - **Dynamic Messages**: Context-sensitive information
  - **Screen-space Rendering**: UI elements that don't scroll with camera

#### 9. **Game Scene** (`scenes/`)
**Purpose**: Main game orchestration and state management

**Key Files:**
- **`game-scene.ts`**: Central game loop and system coordination (1300+ lines)
  - **System Integration**: Coordinates all subsystems
  - **Input Handling**: Player movement, selection, building
  - **Camera Management**: Follow player with membrane constraints
  - **Update Loop**: Organelles → membrane exchange → diffusion
  - **Visual Management**: Hex grid, heatmaps, selection highlights
  - **Debug Features**: Extensive debugging tools and visualizations
  - **State Management**: Build mode, selection state, inventory display

---

## Key Technical Features

### Type Safety
- **Comprehensive Union Types**: `SpeciesId`, `OrganelleType`, `FootprintName` replace generic strings
- **Record Types**: `Record<SpeciesId, number>` for concentrations, `Partial<Record<SpeciesId, number>>` for optional data
- **Helper Functions**: Type-safe utilities like `createEmptyProgressRecord()`, `getSpeciesKeysFromPartialRecord()`
- **No Type Casting**: Proper type design eliminates need for unsafe casts

### Performance Optimizations
- **Two-Buffer Diffusion**: Eliminates order bias and enables parallelization
- **Spatial Indexing**: Efficient hex coordinate mapping with string keys
- **Selective Updates**: Only process active organelles and changed tiles
- **Memory Management**: Cleanup zero-amount entries and unused structures

### Biological Accuracy
- **Realistic Metabolic Pathways**: Nucleus (DNA→mRNA), Ribosomes (mRNA+AA→Protein), ER (Protein→Cargo)
- **Diffusion Physics**: Species-specific molecular diffusion rates
- **Conservation Laws**: Mass tracking and conservation validation
- **Membrane Biology**: Selective permeability and active transport

### Debugging Infrastructure
- **Conservation Tracking**: Monitor total species amounts for simulation validity
- **Visual Debugging**: Heatmaps, selection highlights, membrane visualization
- **Info Panels**: Real-time organelle status and processing statistics
- **Logging System**: Comprehensive console output for system events

### Modular Architecture
- **System Separation**: Each major system is independently testable
- **Clean Interfaces**: Well-defined APIs between systems
- **Event Coordination**: Proper update order (organelles → membrane → diffusion)
- **Plugin Architecture**: Easy to add new organelle types and species

---

## Data Flow

### Main Game Loop (60 FPS):
1. **Input Processing**: Player movement, selection, building actions
2. **Player Updates**: Movement physics, inventory management
3. **Organelle Processing**: Resource consumption/production by priority
4. **Membrane Exchange**: Import/export through transporters
5. **Diffusion Step**: Species movement between adjacent tiles (30 Hz)
6. **Passive Effects**: Environmental changes (ATP decay, ROS buildup)
7. **Construction Processing**: Blueprint progress and completion
8. **Rendering**: Visual updates, heatmaps, UI

### Resource Flow:
```
External Environment → Membrane Transporters → Hex Tiles → Organelles → Products
                                              ↑
                                         Player Inventory
                                              ↓
                                        Construction Blueprints
```

### Information Flow:
- **Species Registry** → defines what exists
- **Organelle Registry** → defines cellular machinery
- **IO Profiles** → define metabolic transformations  
- **Construction Recipes** → define building requirements
- **Hex Grid** → spatial container for everything
- **Game Scene** → orchestrates all interactions

---

## Current Milestone Status

The project appears to be implementing **Milestone 6** features:
- ✅ **Membrane detection system** (automatic boundary identification)
- ✅ **Membrane exchange system** (external resource transport)
- ✅ **Membrane-specific construction** (transporters, receptors, ports)
- ✅ **Build constraints** (membrane-only vs cytosol-only structures)
- 🔄 **Future integrations** (secretory pathway, protein trafficking)

Previous milestones fully implemented:
- ✅ **M1**: Basic hex grid and movement
- ✅ **M2**: Species diffusion and passive effects  
- ✅ **M3**: Organelle system and metabolic processing
- ✅ **M4**: Player inventory and resource management
- ✅ **M5**: Construction and blueprint system

---

## Development Patterns

### Code Organization:
- **Registry Pattern**: Central databases for species, organelles, recipes
- **System Pattern**: Modular systems with clear responsibilities
- **Type-First Design**: Union types guide valid operations
- **Interface Segregation**: Small, focused interfaces
- **Composition**: Systems composed together in game scene

### Error Handling:
- **Validation Functions**: Check preconditions before operations
- **Graceful Degradation**: Continue simulation even with missing data
- **Console Logging**: Extensive debugging information
- **Type Safety**: Prevent errors at compile time

### Performance Considerations:
- **Map-based Lookups**: O(1) tile access by coordinate
- **Efficient Algorithms**: Optimized diffusion and neighbor finding
- **Memory Pooling**: Reuse objects where possible
- **Selective Processing**: Only update what changed

This codebase demonstrates sophisticated game architecture with biological simulation accuracy, comprehensive type safety, and modular design principles suitable for continued expansion and development.
