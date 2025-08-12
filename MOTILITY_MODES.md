# Motility Modes v1 System

## Overview

The Motility Modes system replaces one-size-fits-all movement with three grounded, biologically-inspired modes. Each mode has its own traction model, shape response, costs, and terrain strengths, providing strategic depth and setting up future gameplay features.

## Architecture

### Core Components

- **`motility-modes.config.ts`**: Single source of truth for all mode parameters
- **`motility-mode-registry.ts`**: Central registry and state management
- **`cell-motility.ts`**: Updated motility system with mode integration
- **`substrate-system.ts`**: Enhanced with ECM substrate type

### Mode Configuration

All mode parameters are defined in `MOTILITY_MODES` constant:

```typescript
// Example mode definition
amoeboid: {
  id: 'amoeboid',
  name: 'Amoeboid Crawl',
  icon: '🔄',
  description: 'Fast turns, good in soft/porous spaces',
  params: {
    baseSpeed: 18.0,
    turnResponsiveness: 1.4,
    adhesionFrontBias: 0.7,
    // ... more parameters
  }
}
```

## The Three Modes

### 🔄 Amoeboid / Lamellipodial Crawl

**Strengths**: Fast turns, good in soft/porous spaces
**Mechanics**:
- Protrusion cycles with periodic speed pulses
- High front adhesion bias with automatic rear release
- Medium membrane tension
- Handbrake turn ability (Z key, cooldown-gated)

**Best Substrates**: SOFT (120% speed), FIRM (100% speed)
**Costs**: 0.6 ATP/sec

### 💥 Blebbing Motility

**Strengths**: Burst dashes with poor steering; excels in low adhesion
**Mechanics**:
- Burst action (SPACE key) for rapid movement
- Suppressed adhesion during burst
- Low membrane tension for flexibility
- Refractory period with reduced steering

**Parameters**:
- Burst Duration: 800ms
- Cooldown: 2500ms
- Burst Speed: 35.0 hex/second

**Best Substrates**: SOFT (140% speed)
**Costs**: 0.2 ATP/sec idle, 4.0 ATP per burst

### 🧗 Mesenchymal Migration

**Strengths**: Slow, adhesion-heavy; excels on firm ECM with protease
**Mechanics**:
- Focal adhesion maturation over 2 seconds
- Speed scales with adhesion maturity (30% → 100%)
- Protease pulse (X key) clears ECM paths
- High membrane tension for stability

**Best Substrates**: ECM (130% speed), FIRM (110% speed)
**Costs**: 0.8 ATP/sec + 0.3 protease/sec when active

## Substrate Interactions

### Substrate Types
- **SOFT**: Porous, low-resistance areas
- **FIRM**: Standard cellular environment
- **ECM**: Dense extracellular matrix
- **STICKY**: High-adhesion surfaces

### Interaction Matrix

Each mode has different multipliers for speed, turning, and adhesion efficiency on each substrate:

```typescript
// Example: Blebbing on different substrates
blebbing: {
  SOFT: { speedMultiplier: 1.4, turnMultiplier: 0.7, adhesionEfficiency: 0.3 },
  FIRM: { speedMultiplier: 0.8, turnMultiplier: 0.5, adhesionEfficiency: 0.6 },
  ECM: { speedMultiplier: 0.4, turnMultiplier: 0.3, adhesionEfficiency: 0.2 },
  STICKY: { speedMultiplier: 0.3, turnMultiplier: 0.2, adhesionEfficiency: 0.1 }
}
```

## Controls

- **TAB**: Cycle between available modes
- **SPACE**: Mode-specific action (bleb burst)
- **X**: Protease toggle (mesenchymal mode)
- **Z**: Handbrake turn (amoeboid mode)
- **WASD**: Movement (when in drive mode)

## HUD Information

The enhanced HUD displays:
- Current mode with icon and name
- Substrate effects (speed/turn/grip percentages)
- Mode-specific state (cooldowns, maturity, etc.)
- ATP drain rate

## Configuration Presets

Three difficulty presets are available:

### Simulation
- **Purpose**: Realistic cell physics with energy constraints
- **Speed Scale**: 80%
- **ATP Scale**: 120% (higher costs)

### Arcade
- **Purpose**: Faster, more responsive for gameplay
- **Speed Scale**: 130%
- **ATP Scale**: 70% (lower costs)

### Competitive
- **Purpose**: Balanced for skilled play
- **Speed Scale**: 110%
- **ATP Scale**: 100%

## Adding New Modes

To add a fourth mode:

1. **Define the mode** in `motility-modes.config.ts`:
```typescript
newMode: {
  id: 'newMode',
  name: 'New Mode',
  icon: '🆕',
  description: 'Your description here',
  params: {
    baseSpeed: 15.0,
    // ... other parameters
  }
}
```

2. **Add substrate scalars** in `SUBSTRATE_SCALARS`

3. **Update registry** to handle mode-specific state in `MotilityModeRegistry`

4. **Add locomotion logic** in `CellMotility.updateLocomotionMode()`

5. **Test** in the motility course scene

## Motility Course Test Scene

Access via `MotilityCourseScene` - a purpose-built test environment with three zones:

### Zone A: Soft Maze
- Narrow corridors favoring amoeboid mode
- Tests turning agility and gap navigation

### Zone B: Low-Adhesion Runway  
- Open area with scattered obstacles
- Favors blebbing mode for straight-line speed

### Zone C: ECM Chicanes
- Dense matrix with tight turns
- Tests mesenchymal anchoring and protease usage

**Controls in Course**:
- **R**: Reset course
- **ESC**: Return to main game

## Performance Considerations

- Mode switching applies new parameters immediately (< 1 frame)
- Registry update is O(1) for mode switches
- State tracking is lightweight (< 10 properties per mode)
- No memory allocation during normal operation

## Future Extensions

The system is designed to support:
- **External resource patches**: Protease/energy sources in environment
- **Chemotaxis**: Mode-specific chemical sensing
- **Pathogen AI**: NPCs that respond to different modes
- **Co-op play**: Multi-player control of mode systems
- **Dynamic environments**: Substrates that change over time

## Telemetry

The system tracks for balancing:
- Average speed by mode and substrate
- Turn rate and slip percentage
- Adhesion count and maturity curves
- Burst usage patterns
- ATP consumption profiles
- Zone completion times

Access telemetry via browser console when in course mode.
