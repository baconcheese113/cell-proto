import type { NetBus } from "../network/net-bus";
import type { PlayerSystem } from "../systems/player-system";
import type { CargoSystem } from "../systems/cargo-system";
import type { SpeciesSystem } from "../systems/species-system";
import type { CytoskeletonSystem } from "../systems/cytoskeleton-system";
import type { EmoteSystem } from "../systems/emote-system";
import type { InstallOrderSystem } from "../systems/install-order-system";
import type { MembranePhysicsSystem } from "../membrane/membrane-physics-system";

export interface NetBundle {
  bus: NetBus;
  isHost: boolean;
  players: PlayerSystem;           // Direct access to PlayerSystem 
  cargo: CargoSystem;
  species: SpeciesSystem;
  installOrders: InstallOrderSystem;
  cytoskeleton: CytoskeletonSystem;
  emotes: EmoteSystem;
  membranePhysics: MembranePhysicsSystem;  // Network-replicated membrane physics
}
