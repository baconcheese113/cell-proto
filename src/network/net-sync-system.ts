/**
 * NetSyncSystem - Core multiplayer synchronization system
 * 
 * Handles host-authoritative simulation with client prediction.
 * Manages input collection, state replication, and     console.log(`📡 HOST: Creating and sending snapshot...`);
    
    // Process any pending client inputs
    // (inputs are processed immediately when received)
    
    // Send snapshot to all clients
    const snapshot = this.createHostSnapshot();
    console.log(`📦 HOST: Snapshot created with ${snapshot.cargo.length} cargo, ${snapshot.seats.length} seats, ${snapshot.organelles.length} organelles, ${snapshot.blueprints.length} blueprints`);
    
    this.broadcastSnapshot(snapshot);tion.
 */

import { SystemObject } from "../systems/system-object";
import type { NetworkTransport, ConnectionEvent } from "./transport";
import type { WorldRefs } from "../core/world-refs";
import type { Player } from "../actors/player";
import { ClientPrediction } from "./client-prediction";
import { EntityReplicator } from "./entity-replicator";
import type { 
  ClientInput, 
  HostCommand, 
  HostSnapshot, 
  NetworkMessage, 
  NetworkPlayer, 
  NetworkStatus,
  NetworkCargo,
  InputSeq
} from "./schema";

export interface NetSyncConfig {
  scene: Phaser.Scene;
  transport: NetworkTransport;
  worldRefs: WorldRefs;
  player: Player;
  isHost: boolean;
}

export class NetSyncSystem extends SystemObject {
  private transport: NetworkTransport;
  private player: Player;
  private isHost: boolean;
  private worldRefs: WorldRefs;
  
  // Entity replication
  private entityReplicator: EntityReplicator;
  
  // Client-side prediction
  private clientPrediction?: ClientPrediction;
  
  // Network timing
  private readonly TICK_RATE = 15; // Hz - network update rate
  private readonly TICK_INTERVAL = 1000 / this.TICK_RATE; // ms
  private lastNetTick = 0;
  private currentTick = 0;
  
  // Client-side input prediction
  private inputSequence: InputSeq = 0;
  private inputBuffer: Map<InputSeq, ClientInput> = new Map();
  private lastAckedInput: InputSeq = 0;
  private readonly MAX_INPUT_BUFFER = 60; // ~4 seconds at 15Hz
  
  // Host-side state
  private connectedPlayers: Map<string, NetworkPlayer> = new Map();
  private remotePlayers: Map<string, Phaser.GameObjects.Sprite> = new Map(); // Visual sprites for remote players
  private hostPlayerId: string = 'host';
  
  // Status tracking
  private status: NetworkStatus;
  
  constructor(config: NetSyncConfig) {
    super(config.scene, 'NetSyncSystem', (dt) => this.networkUpdate(dt));
    
    this.transport = config.transport;
    this.worldRefs = config.worldRefs;
    this.player = config.player;
    this.isHost = config.isHost;
    
    // Initialize entity replication
    this.entityReplicator = new EntityReplicator(this.worldRefs);
    
    // Initialize client prediction for non-host players
    if (!this.isHost) {
      this.clientPrediction = new ClientPrediction(this.player);
    }
    
    this.status = {
      isHost: this.isHost,
      connected: false,
      playerId: this.isHost ? this.hostPlayerId : 'client',
      ping: 0,
      tickRate: this.TICK_RATE,
      inputBuffer: 0,
      lastSnapshot: 0
    };
    
    this.setupNetworkHandlers();
    this.logStartup();
  }
  
  private setupNetworkHandlers(): void {
    this.transport.addEventListener('connection', (event: any) => {
      const connectionEvent = event.detail as ConnectionEvent;
      this.handleConnectionEvent(connectionEvent);
    });
  }
  
  private handleConnectionEvent(event: ConnectionEvent): void {
    // Only log message events for important stuff, filter out routine command/snapshot/input spam
    if (event.type !== 'message' || 
        (event.data?.type !== 'input' && event.data?.type !== 'command' && event.data?.type !== 'snapshot')) {
      console.log(`🔌 NetSyncSystem: Connection event:`, event.type, event.data);
    }
    
    switch (event.type) {
      case 'connected':
        this.status.connected = true;
        console.log('🎉 NetSyncSystem: Connected to network - enabling network ticks');
        break;
        
      case 'disconnected':
        this.status.connected = false;
        console.log('❌ NetSyncSystem: Disconnected from network - disabling network ticks');
        break;
        
      case 'message':
        this.handleNetworkMessage(event.data);
        break;
        
      case 'error':
        console.error('❌ NetSyncSystem: Network error:', event.data?.error);
        break;
    }
  }
  
  private handleNetworkMessage(message: NetworkMessage): void {
    switch (message.type) {
      case 'input':
        if (this.isHost) {
          this.handleClientInput(message.playerId!, message.data as ClientInput);
        }
        break;
        
      case 'command':
        if (!this.isHost) {
          this.handleHostCommand(message.data as HostCommand);
        }
        break;
        
      case 'snapshot':
        if (!this.isHost) {
          this.handleHostSnapshot(message.data as HostSnapshot);
        }
        break;
        
      case 'join':
        if (this.isHost) {
          this.handlePlayerJoin(message.playerId!);
        }
        break;
        
      case 'leave':
        if (this.isHost) {
          this.handlePlayerLeave(message.playerId!);
        }
        break;
    }
  }
  
  private networkUpdate(_dt: number): void {
    if (!this.status.connected) {
      console.log('🔌 NetSyncSystem: Not connected, skipping network update');
      return;
    }
    
    const now = Date.now();
    
    // Network tick timing
    if (now - this.lastNetTick >= this.TICK_INTERVAL) {
      this.lastNetTick = now;
      this.currentTick++;
      
      // Only log every 50th tick to reduce spam (about every 3 seconds)
      if (this.currentTick % 50 === 0) {
        console.log(`🎮 NetSyncSystem: Network tick ${this.currentTick} (${this.isHost ? 'HOST' : 'CLIENT'})`);
      }
      
      if (this.isHost) {
        this.hostNetworkTick();
      } else {
        this.clientNetworkTick();
      }
    }
    
    // Update status
    this.status.inputBuffer = this.inputBuffer.size;
    this.status.ping = this.transport.getStats().ping;
  }
  
  /**
   * Host network tick - process inputs and send snapshots
   */
  private hostNetworkTick(): void {
    // Only log every 50th tick to reduce spam
    if (this.currentTick % 50 === 0) {
      console.log('📡 HOST: Creating and sending snapshot...');
    }
    
    // Process any pending client inputs
    // (inputs are processed immediately when received)
    
    // Send snapshot to all clients
    const snapshot = this.createHostSnapshot();
    
    // Only log every 50th tick to reduce spam
    if (this.currentTick % 50 === 0) {
      console.log(`📦 HOST: Snapshot created with ${snapshot.cargo.length} cargo, ${snapshot.seats.length} seats`);
    }
    
    this.broadcastSnapshot(snapshot);
    
    // Clean up old input acknowledgments
    this.cleanupInputBuffer();
  }
  
  /**
   * Client network tick - send inputs and handle prediction
   */
  private clientNetworkTick(): void {
    // Only log every 300th tick to reduce spam (300 ticks = ~20 seconds at 15Hz)
    if (this.currentTick % 300 === 0) {
      console.log('📤 CLIENT: Network tick - collecting input...');
    }
    
    // Collect current input state
    const input = this.collectClientInput();
    
    if (input) {
      // Only log every 300th input to reduce spam
      if (input.seq % 300 === 0) {
        console.log(`📤 CLIENT: Sending input seq ${input.seq}:`, {
          moveX: input.moveAxis.x,
          moveY: input.moveAxis.y,
          dash: input.dash
        });
      }
      
      // Store input for potential replay
      this.inputBuffer.set(input.seq, input);
      
      // Send to host
      this.sendClientInput(input);
      
      // Apply client-side prediction
      if (this.clientPrediction) {
        this.clientPrediction.addInput(input);
      }
    } else {
      // Only log no-input every 300th tick to reduce spam
      if (this.currentTick % 300 === 0) {
        console.log('📤 CLIENT: No input to send');
      }
    }
    
    // Clean up old inputs
    this.cleanupInputBuffer();
  }
  
  /**
   * Collect current client input state
   */
  private collectClientInput(): ClientInput | null {
    const scene = this.scene as any; // Access scene's input system
    if (!scene.keys) return null;
    
    const keys = scene.keys;
    this.inputSequence++;
    
    // Calculate movement axis
    let moveX = 0;
    let moveY = 0;
    if (keys.A.isDown) moveX -= 1;
    if (keys.D.isDown) moveX += 1;
    if (keys.W.isDown) moveY -= 1;
    if (keys.S.isDown) moveY += 1;
    
    // Normalize movement vector
    if (moveX !== 0 || moveY !== 0) {
      const length = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= length;
      moveY /= length;
    }
    
    // Get aim direction from mouse or touch
    const pointer = scene.input.activePointer;
    const playerWorldPos = this.player.getWorldPosition();
    const aimX = pointer.worldX - playerWorldPos.x;
    const aimY = pointer.worldY - playerWorldPos.y;
    const aimLength = Math.sqrt(aimX * aimX + aimY * aimY);
    
    const input: ClientInput = {
      seq: this.inputSequence,
      dt: this.scene.game.loop.delta / 1000,
      
      moveAxis: { x: moveX, y: moveY },
      dash: keys.SPACE.isDown,
      driveToggle: Phaser.Input.Keyboard.JustDown(keys.T),
      
      aimDir: aimLength > 0 ? {
        x: aimX / aimLength,
        y: aimY / aimLength
      } : undefined,
      
      throwCharge: 0, // TODO: Implement throw charging
      throwRelease: false, // TODO: Implement throw release
      
      scoopDrop: Phaser.Input.Keyboard.JustDown(keys.R),
      interact: Phaser.Input.Keyboard.JustDown(keys.E)
    };
    
    return input;
  }
  
  /**
   * Send client input to host
   */
  private sendClientInput(input: ClientInput): void {
    const message: NetworkMessage = {
      type: 'input',
      playerId: this.status.playerId,
      data: input,
      timestamp: Date.now()
    };
    
    // Only log every 300th input send to reduce spam
    if (input.seq % 300 === 0) {
      console.log(`🚀 CLIENT: Sending input message seq ${input.seq}`);
    }
    
    try {
      this.transport.sendUnreliable(message);
      // Only log success every 300th input to reduce spam
      if (input.seq % 300 === 0) {
        console.log('✅ CLIENT: Input sent successfully');
      }
    } catch (error) {
      console.error('❌ CLIENT: Failed to send input:', error);
    }
  }
  
  /**
   * Handle incoming client input (host only)
   */
  private handleClientInput(playerId: string, input: ClientInput): void {
    if (!this.isHost) return;
    
    // Only log every 100th input to reduce spam
    if (input.seq % 100 === 0) {
      console.log(`Processing input from ${playerId}, seq ${input.seq}`);
    }
    
    // Get or create player state
    let playerState = this.connectedPlayers.get(playerId);
    if (!playerState) {
      playerState = this.createNetworkPlayer(playerId);
      this.connectedPlayers.set(playerId, playerState);
    }
    
    // Validate and apply input
    if (this.validateInput(input, playerState)) {
      this.applyInputToNetworkPlayer(input, playerState);
      
      // Send acknowledgment
      this.sendInputAck(playerId, input.seq);
    } else {
      // Send rejection
      this.sendInputRejection(playerId, input.seq, 'Invalid input');
    }
  }
  
  /**
   * Validate client input (basic validation)
   */
  private validateInput(input: ClientInput, _player: NetworkPlayer): boolean {
    // Basic validation - movement vector should be normalized
    const moveLength = Math.sqrt(input.moveAxis.x ** 2 + input.moveAxis.y ** 2);
    if (moveLength > 1.1) return false; // Allow small floating point errors
    
    // Aim direction should be normalized if present
    if (input.aimDir) {
      const aimLength = Math.sqrt(input.aimDir.x ** 2 + input.aimDir.y ** 2);
      if (Math.abs(aimLength - 1.0) > 0.1) return false;
    }
    
    return true;
  }
  
  /**
   * Apply input to network player state
   */
  private applyInputToNetworkPlayer(input: ClientInput, player: NetworkPlayer): void {
    // Basic movement physics
    const speed = 120; // pixels per second
    const deltaTime = input.dt;
    
    // Update velocity based on input
    player.vel.x = input.moveAxis.x * speed;
    player.vel.y = input.moveAxis.y * speed;
    
    // Update position
    player.pos.x += player.vel.x * deltaTime;
    player.pos.y += player.vel.y * deltaTime;
    
    // Update direction if moving or aiming
    if (input.aimDir) {
      player.dir.x = input.aimDir.x;
      player.dir.y = input.aimDir.y;
    } else if (input.moveAxis.x !== 0 || input.moveAxis.y !== 0) {
      // Use movement direction if not aiming
      const moveLength = Math.sqrt(input.moveAxis.x ** 2 + input.moveAxis.y ** 2);
      if (moveLength > 0) {
        player.dir.x = input.moveAxis.x / moveLength;
        player.dir.y = input.moveAxis.y / moveLength;
      }
    }
    
    // Handle dash
    if (input.dash && player.dashCooldown <= 0) {
      player.dashCooldown = 1.2; // seconds
      // Apply dash velocity boost
      player.vel.x *= 2.5;
      player.vel.y *= 2.5;
    }
    
    // Update dash cooldown
    if (player.dashCooldown > 0) {
      player.dashCooldown -= deltaTime;
    }
  }
  
  /**
   * Create host snapshot
   */
  private createHostSnapshot(): HostSnapshot {
    // Add host player to the player list
    const hostPlayer: NetworkPlayer = this.createNetworkPlayerFromLocal(this.hostPlayerId);
    const allPlayers = [hostPlayer, ...Array.from(this.connectedPlayers.values())];
    
    const snapshot: HostSnapshot = {
      tick: this.currentTick,
      timestamp: Date.now(),
      ackSeq: this.lastAckedInput,
      
      players: allPlayers,
      
      // Entity replication - full state for now (TODO: optimize with deltas)
      cargo: this.entityReplicator.serializeCargo(),
      seats: this.entityReplicator.serializeSeats(),
      organelles: this.entityReplicator.serializeOrganelles(),
      blueprints: this.entityReplicator.serializeBlueprints(),
      species: this.entityReplicator.serializeSpecies(),
      membraneProteins: this.entityReplicator.serializeMembraneProteins(),
      
      // Delta updates for performance
      railsDelta: {
        added: this.entityReplicator.serializeRails(),
        removed: [],
        updated: []
      }
    };
    
    return snapshot;
  }
  
  /**
   * Broadcast snapshot to all clients
   */
  private broadcastSnapshot(snapshot: HostSnapshot): void {
    const message: NetworkMessage = {
      type: 'snapshot',
      data: snapshot,
      timestamp: Date.now()
    };
    
    // Only log every 50th tick to reduce spam
    if (this.currentTick % 50 === 0) {
      console.log('🚀 HOST: Broadcasting snapshot message:', {
        type: message.type,
        cargoCount: snapshot.cargo.length,
        seatCount: snapshot.seats.length,
        tick: snapshot.tick
      });
    }
    
    try {
      this.transport.sendReliable(message);
      // Only log success every 50th tick to reduce spam
      if (this.currentTick % 50 === 0) {
        console.log('✅ HOST: Snapshot sent successfully');
      }
    } catch (error) {
      console.error('❌ HOST: Failed to send snapshot:', error);
    }
    
    this.status.lastSnapshot = Date.now();
  }
  
  /**
   * Handle incoming host snapshot (client only)
   */
  private handleHostSnapshot(snapshot: HostSnapshot): void {
    if (this.isHost) return;
    
    // Only log every 50th snapshot to reduce spam
    if (snapshot.tick % 50 === 0) {
      console.log(`📥 CLIENT: Received snapshot tick ${snapshot.tick}, ack ${snapshot.ackSeq}`, {
        cargoCount: snapshot.cargo.length,
        seatCount: snapshot.seats.length
      });
    }
    
    // Update acknowledged input sequence
    this.lastAckedInput = snapshot.ackSeq;
    
    // Apply snapshot to game state
    this.applySnapshot(snapshot);
    
    // Perform client-side reconciliation
    if (this.clientPrediction) {
      this.clientPrediction.reconcile(snapshot);
    }
    
    this.status.lastSnapshot = Date.now();
  }
  
  /**
   * Apply snapshot to game state
   */
  private applySnapshot(snapshot: HostSnapshot): void {
    // Update remote players
    for (const networkPlayer of snapshot.players) {
      if (networkPlayer.id !== this.status.playerId) {
        this.updateRemotePlayer(networkPlayer);
      }
    }
    
    // Apply entity updates
    this.entityReplicator.applyCargo(snapshot.cargo);
    this.entityReplicator.applySeats(snapshot.seats);
    this.entityReplicator.applyOrganelles(snapshot.organelles);
    this.entityReplicator.applyBlueprints(snapshot.blueprints);
    this.entityReplicator.applySpecies(snapshot.species);
    this.entityReplicator.applyMembraneProteins(snapshot.membraneProteins);
    
    // Handle cargo removal - remove any cargo that exists locally but not in the snapshot
    this.handleCargoRemoval(snapshot.cargo);
    
    // Debug logging for entity replication (reduced frequency)
    if (snapshot.tick % 50 === 0) {
      console.log(`📦 Applied entity snapshot: ${snapshot.cargo.length} cargo, ${snapshot.seats.length} seats, ${snapshot.organelles.length} organelles, ${snapshot.blueprints.length} blueprints, ${snapshot.species.tiles.length} species tiles, ${snapshot.membraneProteins.length} membrane proteins`);
    }
    
    // Apply delta updates if present
    if (snapshot.railsDelta) {
      // Only log rail changes every 100th tick or when there are actual changes to reduce spam
      if ((snapshot.railsDelta.added.length > 0 || snapshot.railsDelta.removed.length > 0) && snapshot.tick % 100 === 0) {
        console.log(`🚄 Rail delta: ${snapshot.railsDelta.added.length} added, ${snapshot.railsDelta.removed.length} removed`);
      }
      this.entityReplicator.applyRails(snapshot.railsDelta);
    }
  }
  
  /**
   * Handle cargo removal - remove any cargo that exists locally but not in the host snapshot
   */
  private handleCargoRemoval(networkCargo: NetworkCargo[]): void {
    if (!this.worldRefs) return;
    
    // Create a set of cargo IDs that exist in the network snapshot
    const networkCargoIds = new Set(networkCargo.map(c => c.id));
    
    // Find local cargo that's missing from the network snapshot
    const removedIds: string[] = [];
    
    // Check transcripts
    for (const [id] of this.worldRefs.transcripts) {
      if (!networkCargoIds.has(id)) {
        removedIds.push(id);
      }
    }
    
    // Check carried transcripts
    for (const transcript of this.worldRefs.carriedTranscripts) {
      if (!networkCargoIds.has(transcript.id)) {
        removedIds.push(transcript.id);
      }
    }
    
    // Check vesicles
    for (const [id] of this.worldRefs.vesicles) {
      if (!networkCargoIds.has(id)) {
        removedIds.push(id);
      }
    }
    
    // Check carried vesicles
    for (const vesicle of this.worldRefs.carriedVesicles) {
      if (!networkCargoIds.has(vesicle.id)) {
        removedIds.push(vesicle.id);
      }
    }
    
    // Remove the cargo that's no longer present on the host
    if (removedIds.length > 0) {
      console.log(`🧪 [CLIENT] Removing ${removedIds.length} cargo entities that completed installation or expired on host`);
      this.entityReplicator.removeCargoEntities(removedIds);
    }
  }

  /**
   * Update remote player visual representation
   */
  private updateRemotePlayer(networkPlayer: NetworkPlayer): void {
    // Only log occasionally to reduce spam
    if (Math.random() < 0.1) {
      console.log(`Updating remote player ${networkPlayer.id} at (${networkPlayer.pos.x}, ${networkPlayer.pos.y})`);
    }
    
    // Get or create remote player sprite
    let remoteSprite = this.remotePlayers.get(networkPlayer.id);
    if (!remoteSprite) {
      // Create a proper player sprite similar to local player but different color
      const graphics = this.scene.add.graphics();
      
      // Draw a filled circle (player body) - orange for remote players
      // Center the circle at (9,9) so it's not clipped when positioned at (0,0)
      graphics.fillStyle(0xff8800); // Orange color for remote players
      graphics.fillCircle(9, 9, 7); // Center at (9,9) with radius 7
      
      // Add a small ring around it for better visibility
      graphics.lineStyle(1, 0xffaa44); // Lighter orange ring
      graphics.strokeCircle(9, 9, 8); // Center at (9,9) with radius 8
      
      const key = `remote_player_${networkPlayer.id}`;
      graphics.generateTexture(key, 18, 18); // 18x18 texture
      graphics.destroy();
      
      // Create new remote player sprite with the generated texture
      remoteSprite = this.scene.add.sprite(
        networkPlayer.pos.x, 
        networkPlayer.pos.y, 
        key
      );
      
      // Add remote player to cellRoot container (same as local player)
      if (this.worldRefs.cellRoot) {
        this.worldRefs.cellRoot.add(remoteSprite);
      }
      
      this.remotePlayers.set(networkPlayer.id, remoteSprite);
      
      console.log(`Created remote player sprite for ${networkPlayer.id}`);
    } else {
      // Update existing sprite position
      remoteSprite.setPosition(networkPlayer.pos.x, networkPlayer.pos.y);
    }
  }
  
  /**
   * Create network player state
   */
  private createNetworkPlayer(playerId: string): NetworkPlayer {
    return {
      id: playerId,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      motilityMode: 'default',
      dashCooldown: 0,
      health: 100
    };
  }

  /**
   * Create network player from local player state
   */
  private createNetworkPlayerFromLocal(playerId: string): NetworkPlayer {
    const playerPos = this.player.getWorldPosition();
    
    // Get velocity from physics body if available
    let velocity = { x: 0, y: 0 };
    const playerSprite = (this.player as any).sprite;
    if (playerSprite?.body?.velocity) {
      velocity = {
        x: playerSprite.body.velocity.x,
        y: playerSprite.body.velocity.y
      };
    }
    
    // Calculate direction from velocity or use default
    let direction = { x: 1, y: 0 };
    if (velocity.x !== 0 || velocity.y !== 0) {
      const length = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
      if (length > 0) {
        direction = {
          x: velocity.x / length,
          y: velocity.y / length
        };
      }
    }
    
    return {
      id: playerId,
      pos: { x: playerPos.x, y: playerPos.y },
      vel: velocity,
      dir: direction,
      motilityMode: 'default', // TODO: Get from player when available
      dashCooldown: 0, // TODO: Get from player when available
      health: 100
    };
  }
  
  /**
   * Handle player join
   */
  private handlePlayerJoin(playerId: string): void {
    console.log(`Player ${playerId} joined`);
    
    if (this.isHost) {
      const playerState = this.createNetworkPlayer(playerId);
      this.connectedPlayers.set(playerId, playerState);
    }
  }
  
  /**
   * Handle player leave
   */
  private handlePlayerLeave(playerId: string): void {
    console.log(`Player ${playerId} left`);
    
    if (this.isHost) {
      this.connectedPlayers.delete(playerId);
    }
  }
  
  /**
   * Send input acknowledgment
   */
  private sendInputAck(playerId: string, seq: InputSeq): void {
    const command: HostCommand = {
      type: 'confirm',
      action: 'build', // Generic action for input ack
      data: { seq }
    };
    
    const message: NetworkMessage = {
      type: 'command',
      playerId,
      data: command,
      timestamp: Date.now()
    };
    
    this.transport.sendReliable(message);
  }
  
  /**
   * Send input rejection
   */
  private sendInputRejection(playerId: string, seq: InputSeq, reason: string): void {
    const command: HostCommand = {
      type: 'reject',
      action: 'build', // Generic action for input rejection
      data: { seq },
      reason
    };
    
    const message: NetworkMessage = {
      type: 'command',
      playerId,
      data: command,
      timestamp: Date.now()
    };
    
    this.transport.sendReliable(message);
  }
  
  /**
   * Handle host command (client only)
   */
  private handleHostCommand(command: HostCommand): void {
    // Only log rejections and important commands, filter out routine confirmations
    if (command.type === 'reject' || command.action !== 'build') {
      console.log(`Received host command: ${command.type} ${command.action}`);
    }
    
    if (command.type === 'reject') {
      console.warn(`Action rejected: ${command.reason}`);
      // TODO: Show user feedback
    }
  }
  
  /**
   * Clean up old input buffer entries
   */
  private cleanupInputBuffer(): void {
    const cutoff = this.inputSequence - this.MAX_INPUT_BUFFER;
    
    for (const [seq] of this.inputBuffer) {
      if (seq < cutoff) {
        this.inputBuffer.delete(seq);
      }
    }
  }
  
  /**
   * Get current network status
   */
  public getStatus(): NetworkStatus {
    return { ...this.status };
  }
  
  /**
   * Get entity replication statistics for debugging
   */
  public getEntityStats(): { 
    cargoCount: number; 
    seatCount: number; 
    railCount: number;
    organelleCount: number;
    blueprintCount: number;
    speciesTileCount: number;
  } {
    const cargo = this.entityReplicator.serializeCargo();
    const seats = this.entityReplicator.serializeSeats();
    const rails = this.entityReplicator.serializeRails();
    const organelles = this.entityReplicator.serializeOrganelles();
    const blueprints = this.entityReplicator.serializeBlueprints();
    const species = this.entityReplicator.serializeSpecies();
    
    return {
      cargoCount: cargo.length,
      seatCount: seats.length,
      railCount: rails.length,
      organelleCount: organelles.length,
      blueprintCount: blueprints.length,
      speciesTileCount: species.tiles.length
    };
  }

  /**
   * Get prediction statistics for debugging
   */
  public getPredictionStats() {
    if (this.clientPrediction) {
      return this.clientPrediction.getStats();
    }
    
    return {
      inputBufferSize: this.inputBuffer.size,
      snapshotCount: 0,
      lastAckedInput: this.lastAckedInput,
      unackedInputs: Array.from(this.inputBuffer.keys()).filter(seq => seq > this.lastAckedInput).length
    };
  }
  
  /**
   * Log system startup information
   */
  private logStartup(): void {
    console.log('=== NetSyncSystem Startup ===');
    console.log(`Mode: ${this.isHost ? 'HOST' : 'CLIENT'}`);
    console.log(`Tick Rate: ${this.TICK_RATE}Hz`);
    console.log(`Player ID: ${this.status.playerId}`);
    console.log(`Channels: reliable + unreliable`);
    console.log('===============================');
  }
}
