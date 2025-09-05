import { NetComponent } from '../network/net-entity';
import { RunOnServer } from '../network/decorators';
import type { NetBus } from '../network/net-bus';
import { MembranePhysicsSystem } from '../membrane/membrane-physics-system';

/**
 * Data structure for neighbor cell definition that can be replicated across network
 */
interface NeighborCellData {
  id: string;
  centerX: number;
  centerY: number;
  radius: number;
  numParticles: number;
  // Physics parameters for this specific neighbor
  alphaEdge: number;
  alphaArea: number;
  alphaBend: number;
  damping: number;
  impactImpulseScale: number;
}

/**
 * Physics particle state for network replication
 */
interface ParticleState {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
}

/**
 * Individual neighbor cell runtime state for network synchronization
 */
interface NeighborCellRuntimeState {
  particles: ParticleState[];
  center: { x: number; y: number };
}

/**
 * Complete neighbor cell state structure for network replication
 */
type NeighborCellState = {
  neighbors: Record<string, NeighborCellRuntimeState>;
};

/**
 * NeighborCellSystem - Server-authoritative neighbor cell spawning and management
 * 
 * Handles the generation and replication of interactive neighbor cells that:
 * - Spawn in deterministic locations using seeded random generation on the server
 * - Have consistent properties across all clients via multicast data sharing
 * - Provide fully synchronized collision interactions with the main player membrane
 * - Use consolidated state replication to prevent network flooding
 * - Only host simulates physics, clients display received state
 */
export class NeighborCellSystem extends NetComponent {
  private scene: Phaser.Scene;
  private neighborCellData: NeighborCellData[] = [];
  private neighborMembranes: Map<string, MembranePhysicsSystem> = new Map();
  private mainMembranePhysics?: MembranePhysicsSystem;

  // State channels for network replication
  private readonly neighborStates = this.stateChannel<NeighborCellState>('neighborCells', { neighbors: {} });
  private readonly neighborDefinitions = this.stateChannel<{ definitions: NeighborCellData[] }>('neighborDefinitions', { definitions: [] });

  constructor(
    scene: Phaser.Scene,
    bus: NetBus,
    mainMembranePhysics?: MembranePhysicsSystem
  ) {
    super(bus);
    
    this.scene = scene;
    this.mainMembranePhysics = mainMembranePhysics;
  }

  /**
   * Override state patch handler to react to neighbor data changes
   */
  protected override onStatePatched(channel: string): void {
    if (channel === 'neighborDefinitions') {
      // Only clients should create neighbor cells from state changes
      // Host creates them immediately in generateNeighborCellDataOnServer()
      if (!this._netBus.isHost) {
        this.createNeighborCellsFromData();
      }
    }
    
    if (channel === 'neighborCells') {
      // When neighbor physics states are updated, apply them to local membranes
      this.applyNeighborStates();
    }
  }

  /**
   * Update neighbor cell physics states on host
   * This method should be called periodically by the host to sync physics state
   */
  public updatePhysicsState(): void {
    if (!this._netBus.isHost) return;
    
    const states: Record<string, NeighborCellRuntimeState> = {};
    let hasUpdates = false;
    
    for (const [cellId, membrane] of this.neighborMembranes) {
      const particles = membrane.getParticles();
      if (particles && particles.length > 0) {
        states[cellId] = {
          particles: particles.map(p => ({
            position: { x: p.position.x, y: p.position.y },
            velocity: { x: p.velocity.x, y: p.velocity.y }
          })),
          center: membrane.getCenter()
        };
        hasUpdates = true;
      }
    }
    
    if (hasUpdates) {
      // Update the state channel - automatic network sync
      Object.assign(this.neighborStates.neighbors, states);
    }
  }

  /**
   * Apply received neighbor states from network to local physics
   */
  private applyNeighborStates(): void {
    if (this._netBus.isHost) return;
    
    for (const [cellId, state] of Object.entries(this.neighborStates.neighbors)) {
      const membrane = this.neighborMembranes.get(cellId);
      if (membrane && state && state.particles) {
        const particles = membrane.getParticles();
        if (particles && particles.length === state.particles.length) {
          // Apply received particle positions
          for (let i = 0; i < particles.length; i++) {
            particles[i].position.x = state.particles[i].position.x;
            particles[i].position.y = state.particles[i].position.y;
            particles[i].velocity.x = state.particles[i].velocity.x;
            particles[i].velocity.y = state.particles[i].velocity.y;
          }
        }
      }
    }
  }

  /**
   * Set the main membrane physics system for collision registration
   */
  public setMainMembranePhysics(membranePhysics: MembranePhysicsSystem): void {
    this.mainMembranePhysics = membranePhysics;
    
    // Re-register existing neighbor membranes with the new main membrane
    for (const neighborMembrane of this.neighborMembranes.values()) {
      this.mainMembranePhysics.registerAdditionalMembrane(neighborMembrane);
    }
  }

  /**
   * Generate neighbor cells using server-authoritative data
   * This ensures all players see the same neighbor cells in the same locations
   * Uses a fixed seed based on room/session to ensure deterministic results
   */
  @RunOnServer()
  public generateNeighborCells(): void {
    // Prevent regenerating if neighbor cells already exist
    if (this.neighborMembranes.size > 0) {
      console.log('🏠 SERVER: Neighbor cells already exist, skipping generation');
      return;
    }
    
    console.log('🏠 SERVER: Generating neighbor cells...');
    
    // Use a deterministic seed based on room or session
    // For now, we'll use a simple fixed seed - in production you'd want this based on room ID
    const seed = 12345; // Could be derived from room ID or other session data
    
    // Simple seeded random number generator (Linear Congruential Generator)
    let seedValue = seed;
    const seededRandom = () => {
      seedValue = (seedValue * 1664525 + 1013904223) % (2 ** 32);
      return seedValue / (2 ** 32);
    };
    
    const numCells = 4 + Math.floor(seededRandom() * 4); // 4-7 cells
    const minDistance = 500;
    const maxDistance = 800;
    
    // Get the current center of the player's cell membrane
    const playerCellCenter = this.mainMembranePhysics 
      ? this.mainMembranePhysics.getCenter() 
      : new Phaser.Math.Vector2(0, 0);
    
    const neighborData: NeighborCellData[] = [];
    
    for (let i = 0; i < numCells; i++) {
      // Deterministic position around player's cell center
      const angle = (Math.PI * 2 * i / numCells) + (seededRandom() - 0.5) * 0.5;
      const distance = minDistance + seededRandom() * (maxDistance - minDistance);
      const x = playerCellCenter.x + Math.cos(angle) * distance;
      const y = playerCellCenter.y + Math.sin(angle) * distance;
      
      // Deterministic cell properties
      const cellRadius = 80 + seededRandom() * 120; // 80-200 radius
      const numParticles = Math.floor(12 + seededRandom() * 24); // 12-36 particles
      
      // Deterministic membrane parameters
      const cellData: NeighborCellData = {
        id: `neighbor_${i}`,
        centerX: x,
        centerY: y,
        radius: cellRadius,
        numParticles: numParticles,
        alphaEdge: 0.2 + seededRandom() * 0.2, // 0.2-0.4
        alphaArea: 0.08 + seededRandom() * 0.08, // 0.08-0.16
        alphaBend: 0.8 + seededRandom() * 1.0, // 0.8-1.8
        damping: 0.98 + seededRandom() * 0.01, // 0.98-0.99
        impactImpulseScale: 100 + seededRandom() * 50 // 100-150
      };
      
      neighborData.push(cellData);
    }
    
    // Update the state channel - this automatically replicates to all clients
    this.neighborDefinitions.definitions = neighborData;
    
    // Host also needs to create neighbor cells immediately (state channels don't trigger onStatePatched for the sender)
    this.createNeighborCellsFromLocalData(neighborData);
    
    console.log(`🏠 SERVER: Generated ${neighborData.length} neighbor cells`);
  }

  /**
   * Create actual neighbor cell membranes from the shared data
   * This runs on all clients using the same deterministic data from state channels
   */
  private createNeighborCellsFromData(): void {
    // Use data from the state channel
    const neighborData = this.neighborDefinitions.definitions;
    
    if (!neighborData || neighborData.length === 0) {
      console.log('🏠 CLIENT: No neighbor cell definitions available yet');
      return;
    }
    
    // Prevent recreation if cells already exist with same data
    if (this.neighborMembranes.size > 0 && this.neighborCellData.length === neighborData.length) {
      console.log('🏠 CLIENT: Neighbor cells already exist with same data, skipping creation');
      return;
    }
    
    console.log(`🏠 CLIENT: Creating ${neighborData.length} neighbor cells from state channel`);
    
    // Clear existing neighbor membranes
    this.clearExistingNeighbors();
    
    // Store the data locally for reference
    this.neighborCellData = neighborData;
    
    // Create new neighbor cells from shared data
    for (const cellData of neighborData) {
      this.createSingleNeighborCell(cellData);
    }
  }

  /**
   * Create neighbor cells from provided data (used by host immediately after generation)
   */
  private createNeighborCellsFromLocalData(neighborData: NeighborCellData[]): void {
    console.log(`🏠 HOST: Creating ${neighborData.length} neighbor cells from local data`);
    
    // Clear existing neighbor membranes
    this.clearExistingNeighbors();
    
    // Store the data locally for reference
    this.neighborCellData = neighborData;
    
    // Create new neighbor cells from provided data
    for (const cellData of neighborData) {
      this.createSingleNeighborCell(cellData);
    }
  }

  /**
   * Create a single neighbor cell from its data definition
   * Host creates physics-enabled cells, clients create display-only cells
   */
  private createSingleNeighborCell(cellData: NeighborCellData): void {
    console.log(`🏠 Creating neighbor cell ${cellData.id} - isHost: ${this._netBus.isHost}`);
    
    // Generate membrane particles for this cell
    const cellParticles: Phaser.Math.Vector2[] = [];
    for (let j = 0; j < cellData.numParticles; j++) {
      const particleAngle = (j / cellData.numParticles) * Math.PI * 2;
      const particleX = cellData.centerX + Math.cos(particleAngle) * cellData.radius;
      const particleY = cellData.centerY + Math.sin(particleAngle) * cellData.radius;
      cellParticles.push(new Phaser.Math.Vector2(particleX, particleY));
    }
    
    if (this._netBus.isHost) {
      // HOST: Create physics-enabled membrane with NULL BUS to prevent individual state channels
      const nullBus = {
        isHost: true,
        localId: 'neighbor-host',
        registerInstance: () => {},
        registerHandler: () => {},
        sendPatch: () => {},
        sendMulticast: () => {},
        sendRpcToHost: () => {}
      };
      
      const cellMembrane = new MembranePhysicsSystem(this.scene, nullBus as any, {
        particles: cellParticles,
        timeStep: 1/60,
        parent: undefined,
        id: `neighbor-${cellData.id}`
      });
      
      // Apply the deterministic membrane properties
      const params = cellMembrane.getParametersStateChannel();
      params.alphaEdge = cellData.alphaEdge;
      params.alphaArea = cellData.alphaArea;
      params.alphaBend = cellData.alphaBend;
      params.damping = cellData.damping;
      params.impactImpulseScale = cellData.impactImpulseScale;
      
      cellMembrane.setAllowReset(false);
      
      // Register for collision detection
      if (this.mainMembranePhysics) {
        this.mainMembranePhysics.registerAdditionalMembrane(cellMembrane);
      }
      
      this.neighborMembranes.set(cellData.id, cellMembrane);
      this.addDeterministicPerturbations(cellMembrane, cellData.id);
      
      console.log(`🖥️ Host: Created physics-enabled neighbor ${cellData.id}`);
      
    } else {
      // CLIENT: Create display-only membrane with NULL BUS
      const nullBus = {
        isHost: false,
        localId: 'neighbor-client',
        registerInstance: () => {},
        registerHandler: () => {},
        sendPatch: () => {},
        sendMulticast: () => {},
        sendRpcToHost: () => {}
      };
      
      const cellMembrane = new MembranePhysicsSystem(this.scene, nullBus as any, {
        particles: cellParticles,
        timeStep: 1/60,
        parent: undefined,
        id: `neighbor-${cellData.id}`
      });
      
      // Apply properties for initial display
      const params = cellMembrane.getParametersStateChannel();
      params.alphaEdge = cellData.alphaEdge;
      params.alphaArea = cellData.alphaArea;
      params.alphaBend = cellData.alphaBend;
      params.damping = cellData.damping;
      params.impactImpulseScale = cellData.impactImpulseScale;
      
      cellMembrane.setAllowReset(false);
      
      // Register for collision detection (visual feedback)
      if (this.mainMembranePhysics) {
        this.mainMembranePhysics.registerAdditionalMembrane(cellMembrane);
      }
      
      this.neighborMembranes.set(cellData.id, cellMembrane);
      
      console.log(`💻 Client: Created display-only neighbor ${cellData.id}`);
    }
  }

  /**
   * Add deterministic perturbations to membrane particles for organic appearance
   */
  private addDeterministicPerturbations(cellMembrane: MembranePhysicsSystem, cellId: string): void {
    const membraneParticles = cellMembrane.getParticles();
    if (!membraneParticles) return;
    
    // Use the cell ID as a secondary seed for perturbations
    let perturbSeed = cellId.charCodeAt(cellId.length - 1) * 1337;
    const perturbRandom = () => {
      perturbSeed = (perturbSeed * 1664525 + 1013904223) % (2 ** 32);
      return perturbSeed / (2 ** 32);
    };
    
    for (let k = 0; k < membraneParticles.length; k++) {
      const perturbation = (perturbRandom() - 0.5) * 2; // Small perturbation
      const particleAngle = (k / membraneParticles.length) * Math.PI * 2;
      membraneParticles[k].position.x += Math.cos(particleAngle) * perturbation;
      membraneParticles[k].position.y += Math.sin(particleAngle) * perturbation;
    }
  }

  /**
   * Clear all existing neighbor membranes
   */
  private clearExistingNeighbors(): void {
    console.log(`🧹 Clearing ${this.neighborMembranes.size} existing neighbor cells`);
    for (const membrane of this.neighborMembranes.values()) {
      // Unregister from main physics system
      if (this.mainMembranePhysics) {
        this.mainMembranePhysics.unregisterAdditionalMembrane(membrane);
      }
      // Note: MembranePhysicsSystem should handle its own cleanup
    }
    this.neighborMembranes.clear();
  }

  /**
   * Get the number of active neighbor cells
   */
  public getNeighborCount(): number {
    return this.neighborMembranes.size;
  }

  /**
   * Get neighbor cell data for debugging
   */
  public getNeighborData(): NeighborCellData[] {
    return [...this.neighborCellData];
  }

  /**
   * Clean up all neighbor cells when system is destroyed
   */
  public destroy(): void {
    this.clearExistingNeighbors();
  }
}
