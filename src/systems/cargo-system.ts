import { NetComponent } from "../network/net-entity";
import { RunOnServer } from "../network/decorators";
import type { WorldRefs, Transcript, Vesicle } from "../core/world-refs";
import type { NetBus } from "@/network/net-bus";

type CargoThrowResult = {
  success: boolean;
  message: string;
  throwId?: string;
};

type CargoPickupResult = {
  success: boolean;
  message: string;
  cargoType?: 'transcript' | 'vesicle';
  cargoId?: string;
};

type CargoDropResult = {
  success: boolean;
  message: string;
  cargoType?: 'transcript' | 'vesicle';
  cargoId?: string;
};

type CargoState = {
  playerCargo: Record<string, {
    type: 'transcript' | 'vesicle';
    cargoId: string;
    pickedUpAt: number;
  } | null>;
};

export class CargoSystem extends NetComponent {
  private cargoState = this.stateChannel<CargoState>('cargo.playerCargo', { playerCargo: {} });

  constructor(bus: NetBus, private world: WorldRefs) { 
    super(bus); 
  }

  @RunOnServer()
  pickup(playerHex: { q: number; r: number }, playerId?: string): CargoPickupResult {
    const actualPlayerId = playerId || (this._isHost ? 'host' : 'client');
    console.log(`📦 SERVER: Player ${actualPlayerId} attempting pickup at (${playerHex.q}, ${playerHex.r})`);

    // Check if player is already carrying something
    const currentCargo = this.cargoState.playerCargo[actualPlayerId];
    if (currentCargo) {
      return {
        success: false,
        message: "Already carrying something"
      };
    }

    console.log('🔍 Attempting transcript pickup at:', playerHex);
    console.log('🔍 World state:', { 
      hasWorld: !!this.world,
      hasTranscripts: !!this.world?.transcripts, 
      transcriptCount: this.world?.transcripts?.size || 0 
    });
    
    // Safety check: ensure world and transcripts exist
    if (!this.world || !this.world.transcripts) {
      console.warn('⚠️ World or transcripts not yet initialized');
      return { success: false, message: 'World not ready for cargo operations' };
    }
    
    // Try to pick up transcript first
    const transcript = this.findTranscriptAt(playerHex);
    if (transcript) {
      return this.pickupTranscript(actualPlayerId, transcript);
    }

    // Try to pick up vesicle
    const vesicle = this.findVesicleAt(playerHex);
    if (vesicle) {
      return this.pickupVesicle(actualPlayerId, vesicle);
    }

    return {
      success: false,
      message: "No cargo available here"
    };
  }

  @RunOnServer()
  drop(playerHex: { q: number; r: number }, playerId?: string): CargoDropResult {
    const actualPlayerId = playerId || (this._isHost ? 'host' : 'client');
    console.log(`📦 SERVER: Player ${actualPlayerId} attempting drop at (${playerHex.q}, ${playerHex.r})`);

    const currentCargo = this.cargoState.playerCargo[actualPlayerId];
    if (!currentCargo) {
      return {
        success: false,
        message: "Not carrying anything"
      };
    }

    const cargo = this.getCargoById(currentCargo.cargoId, currentCargo.type);
    if (!cargo) {
      return {
        success: false,
        message: "Carried cargo not found"
      };
    }

    // Update cargo position and state
    cargo.isCarried = false;
    cargo.atHex = { q: playerHex.q, r: playerHex.r };
    cargo.worldPos = this.world.hexGrid.hexToWorld(playerHex).clone();

    // Return cargo to appropriate world collection
    if (currentCargo.type === 'transcript') {
      this.world.transcripts.set(cargo.id, cargo as Transcript);
      this.removeFromCarriedTranscripts(cargo.id);
    } else {
      this.world.vesicles.set(cargo.id, cargo as Vesicle);
      this.removeFromCarriedVesicles(cargo.id);
    }

    // Clear player's carried cargo
    this.cargoState.playerCargo[actualPlayerId] = null;

    const carriedDuration = (Date.now() - currentCargo.pickedUpAt) / 1000;
    return {
      success: true,
      message: `Dropped ${currentCargo.type} (carried ${carriedDuration.toFixed(1)}s)`,
      cargoType: currentCargo.type,
      cargoId: currentCargo.cargoId
    };
  }

  private pickupTranscript(playerId: string, transcript: Transcript): CargoPickupResult {
    // Remove from world collection
    this.world.transcripts.delete(transcript.id);
    
    // Update transcript state
    transcript.isCarried = true;
    // Note: We keep atHex and worldPos as they were - the isCarried flag indicates it's carried
    
    // Add to carried collection
    this.world.carriedTranscripts.push(transcript);
    
    // Update replicated state
    this.cargoState.playerCargo[playerId] = {
      type: 'transcript',
      cargoId: transcript.id,
      pickedUpAt: Date.now()
    };

    console.log(`📦 SERVER: Player ${playerId} picked up transcript ${transcript.id}`);
    return {
      success: true,
      message: `Picked up transcript ${transcript.id}`,
      cargoType: 'transcript',
      cargoId: transcript.id
    };
  }

  private pickupVesicle(playerId: string, vesicle: Vesicle): CargoPickupResult {
    // Remove from world collection
    this.world.vesicles.delete(vesicle.id);
    
    // Update vesicle state
    vesicle.isCarried = true;
    // Note: We keep atHex and worldPos as they were - the isCarried flag indicates it's carried
    
    // Add to carried collection
    this.world.carriedVesicles.push(vesicle);
    
    // Update replicated state
    this.cargoState.playerCargo[playerId] = {
      type: 'vesicle',
      cargoId: vesicle.id,
      pickedUpAt: Date.now()
    };

    console.log(`📦 SERVER: Player ${playerId} picked up vesicle ${vesicle.id}`);
    return {
      success: true,
      message: `Picked up vesicle ${vesicle.id}`,
      cargoType: 'vesicle',
      cargoId: vesicle.id
    };
  }

  private findTranscriptAt(hex: { q: number; r: number }): Transcript | null {
    // Safety check: ensure transcripts map exists
    if (!this.world.transcripts) {
      console.warn('⚠️ Transcripts map not yet initialized in world');
      return null;
    }
    
    for (const transcript of this.world.transcripts.values()) {
      if (transcript.atHex && transcript.atHex.q === hex.q && transcript.atHex.r === hex.r && !transcript.isCarried) {
        return transcript;
      }
    }
    return null;
  }

  private findVesicleAt(hex: { q: number; r: number }): Vesicle | null {
    for (const vesicle of this.world.vesicles.values()) {
      if (vesicle.atHex && vesicle.atHex.q === hex.q && vesicle.atHex.r === hex.r && !vesicle.isCarried) {
        return vesicle;
      }
    }
    return null;
  }

  private getCargoById(cargoId: string, type: 'transcript' | 'vesicle'): Transcript | Vesicle | null {
    if (type === 'transcript') {
      return this.world.carriedTranscripts.find(t => t.id === cargoId) || null;
    } else {
      return this.world.carriedVesicles.find(v => v.id === cargoId) || null;
    }
  }

  private removeFromCarriedTranscripts(cargoId: string): void {
    const index = this.world.carriedTranscripts.findIndex(t => t.id === cargoId);
    if (index !== -1) {
      this.world.carriedTranscripts.splice(index, 1);
    }
  }

  private removeFromCarriedVesicles(cargoId: string): void {
    const index = this.world.carriedVesicles.findIndex(v => v.id === cargoId);
    if (index !== -1) {
      this.world.carriedVesicles.splice(index, 1);
    }
  }

  @RunOnServer()
  throwCargo(
    _playerPos: { x: number; y: number }, 
    _direction: { x: number; y: number }, 
    chargeLevel: number,
    playerId?: string
  ): CargoThrowResult {
    const actualPlayerId = playerId || (this._isHost ? 'host' : 'client');
    console.log(`🎯 SERVER: Player ${actualPlayerId} throwing cargo with charge ${chargeLevel}`);

    const currentCargo = this.cargoState.playerCargo[actualPlayerId];
    if (!currentCargo) {
      return {
        success: false,
        message: "Not carrying anything to throw"
      };
    }

    const cargo = this.getCargoById(currentCargo.cargoId, currentCargo.type);
    if (!cargo) {
      return {
        success: false,
        message: "Carried cargo not found"
      };
    }

    // Mark cargo as thrown
    cargo.isCarried = false;
    cargo.isThrown = true;
    
    // Remove from carried collection but don't add to world yet - throw system will handle placement
    if (currentCargo.type === 'transcript') {
      this.removeFromCarriedTranscripts(cargo.id);
    } else {
      this.removeFromCarriedVesicles(cargo.id);
    }

    // Clear player's carried cargo
    this.cargoState.playerCargo[actualPlayerId] = null;

    // Let the throw system handle the physics and placement
    // This is just authorization and state management
    const throwId = `throw_${Date.now()}_${actualPlayerId}`;
    
    return {
      success: true,
      message: `Threw ${currentCargo.type}`,
      throwId
    };
  }

  // Public accessor for reading replicated state
  public get playerCargo() {
    return this.cargoState.playerCargo;
  }
}
