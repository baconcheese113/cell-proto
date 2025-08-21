import { NetComponent } from "../network/net-entity";
import { RunOnServer, Multicast } from "../network/decorators";
import type { WorldRefs } from "../core/world-refs";
import type { SpeciesId } from "../species/species-registry";
import type { NetBus } from "@/network/net-bus";

export interface SpeciesInjectionPayload {
  speciesId: SpeciesId;
  amount: number;
  hex: { q: number; r: number };
}

type SpeciesInjectionResult = {
  success: boolean;
  message: string;
  speciesId?: SpeciesId;
  amount?: number;
  hex?: { q: number; r: number };
};

type SpeciesState = {
  injections: Record<string, {
    speciesId: SpeciesId;
    amount: number;
    hex: { q: number; r: number };
    timestamp: number;
  }>;
};

export class SpeciesSystem extends NetComponent {
  private speciesState = this.stateChannel<SpeciesState>('species.injections', { injections: {} });
  
  private injectionCounter = 0;

  constructor(bus: NetBus, private world: WorldRefs) { 
    super(bus, { address: 'SpeciesSystem' }); 
    console.log('🧬 SpeciesSystem initialized');
  }

  /** Cleanup method for GameScene shutdown */
  public destroy(): void {
    console.log('🧬 SpeciesSystem destroyed');
  }

  /**
   * Network-replicated species injection following best practices:
   * - Client calls injectSpecies() -> host @RunOnServer validates and coordinates
   * - Host calls @Multicast applySpeciesInjection() 
   * - All clients (including host) receive and apply the concentration change
   */
  @RunOnServer()
  injectSpecies(speciesId: SpeciesId, amount: number, hex: { q: number; r: number }): SpeciesInjectionResult {
    console.log(`🧬 SERVER: Injecting ${amount} ${speciesId} at (${hex.q}, ${hex.r})`);

    // Validate species ID
    const validSpeciesIds = ['ATP', 'AA', 'NT', 'ROS', 'GLUCOSE', 'PRE_MRNA', 'PROTEIN', 'CARGO', 'SIGNAL'];
    
    if (!validSpeciesIds.includes(speciesId)) {
      return {
        success: false,
        message: 'Invalid species type'
      };
    }
    
    // Validate amount
    if (typeof amount !== 'number' || amount <= 0 || amount > 100) {
      return {
        success: false,
        message: 'Invalid injection amount (must be 1-100)'
      };
    }
    
    // Check if hex is a valid tile
    if (!this.world) {
      console.error('🧬 SERVER: world refs not available');
      return {
        success: false,
        message: 'World refs not initialized'
      };
    }
    
    if (!this.world.hexGrid) {
      console.error('🧬 SERVER: hexGrid is not available in world refs');
      return {
        success: false,
        message: 'HexGrid not initialized'
      };
    }
    
    const tile = this.world.hexGrid.getTile(hex);
    if (!tile) {
      return {
        success: false,
        message: 'Invalid tile coordinates'
      };
    }

    try {
      // Track the injection for replication
      const injectionId = `injection_${++this.injectionCounter}`;
      this.speciesState.injections[injectionId] = {
        speciesId,
        amount,
        hex: { q: hex.q, r: hex.r },
        timestamp: Date.now()
      };

      // Multicast the injection to all clients (including host)
      this.applySpeciesInjection({ speciesId, amount, hex });

      console.log(`🧬 SERVER: Successfully injected ${amount} ${speciesId} at (${hex.q}, ${hex.r})`);
      return {
        success: true,
        message: `Injected ${amount} ${speciesId}`,
        speciesId,
        amount,
        hex: { q: hex.q, r: hex.r }
      };
    } catch (error) {
      console.error(`🧬 SERVER: Failed to inject species:`, error);
      return {
        success: false,
        message: `Failed to inject ${speciesId}: ${error}`
      };
    }
  }

  @Multicast()
  private applySpeciesInjection({ speciesId, amount, hex }: SpeciesInjectionPayload): void {
    console.log(`🧬 Applying species injection: ${amount} ${speciesId} at (${hex.q}, ${hex.r})`);
    
    if (!this.world) {
      console.error('🧬 Cannot apply species injection: world refs not available');
      return;
    }
    
    if (!this.world.hexGrid) {
      console.error('🧬 Cannot apply species injection: hexGrid not available');
      return;
    }
    
    try {
      // Apply the concentration change on this client
      this.world.hexGrid.addConcentration(hex, speciesId as any, amount);
    } catch (error) {
      console.error(`🧬 Failed to apply species injection:`, error);
    }
  }

  // Public accessor for reading replicated state
  public get injections() {
    return this.speciesState.injections;
  }
}
