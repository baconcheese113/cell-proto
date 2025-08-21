import { NetComponent } from "../network/net-entity";
import { RunOnServer } from "../network/decorators";
import type { WorldRefs } from "../core/world-refs";
import type { SpeciesId } from "../species/species-registry";

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

  constructor(bus: any, private world: WorldRefs) { 
    super(bus); 
  }

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
    const tile = this.world.hexGrid.getTile(hex);
    if (!tile) {
      return {
        success: false,
        message: 'Invalid tile coordinates'
      };
    }

    try {
      // Use the hex grid's addConcentration method to inject species
      this.world.hexGrid.addConcentration(hex, speciesId as any, amount);
      
      // Track the injection for replication
      const injectionId = `injection_${++this.injectionCounter}`;
      this.speciesState.injections[injectionId] = {
        speciesId,
        amount,
        hex: { q: hex.q, r: hex.r },
        timestamp: Date.now()
      };

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

  // Public accessor for reading replicated state
  public get injections() {
    return this.speciesState.injections;
  }
}
